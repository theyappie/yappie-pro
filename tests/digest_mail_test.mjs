// usage: node digest_test.mjs <repo>   — the daily brief's mailing step against a stand-in mail server: what reaches the (public) run log when sending works and when it fails
import net from "node:net"; import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { mkdirSync, cpSync, symlinkSync, rmSync, existsSync } from "node:fs"; import { join } from "node:path";
const REPO = process.argv[2], T = process.argv[3] ?? "/tmp/digest_test_tmp"; rmSync(T, { recursive: true, force: true }); mkdirSync(T + "/data", { recursive: true });
for (const f of ["scripts", "sources.json", "taxonomy.json", "package.json"]) cpSync(join(REPO, f), join(T, f), { recursive: true }); cpSync(join(REPO, "data/feed.json"), join(T, "data/feed.json")); symlinkSync(join(REPO, "node_modules"), join(T, "node_modules"));
const run = promisify(execFile); let bad = 0; const chk = (name, ok, info) => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " | " + String(info).slice(0, 700)}`); };
const TO = ["alice@one.example", "bob@two.example", "carol.d+news@three.example"], FROM = "The Yappie Pro <brief@sender.example>", USER = "mailuser", PASS = "Secr@t-pass1 100%";
function server(mode) { let seen = { rcpt: [], auth: false, data: false };
  const s = net.createServer(sock => { sock.write("220 test ESMTP\r\n"); let inData = false, buf = "";
    sock.on("data", ch => { buf += ch.toString("latin1"); let i;
      while ((i = buf.indexOf("\r\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === ".") { inData = false; seen.data = true; sock.write(mode === "fail-data" ? "554 5.7.1 Message for <bob@two.example> refused by policy\r\n" : "250 queued\r\n"); } continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO") || up.startsWith("HELO")) sock.write("250-test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
        else if (up.startsWith("AUTH")) { seen.auth = true; sock.write(mode === "auth-fail" ? "535 5.7.8 Username and Password not accepted for mailuser\r\n" : "235 ok\r\n"); }
        else if (up.startsWith("MAIL FROM")) sock.write("250 ok\r\n");
        else if (up.startsWith("RCPT TO")) { const a = (line.match(/<([^>]+)>/) ?? [])[1]; seen.rcpt.push(a); sock.write(mode === "reject-all" || (mode === "reject-one" && a === "bob@two.example") ? `550 5.1.1 <${a}>: Recipient address rejected: User unknown\r\n` : "250 ok\r\n"); }
        else if (up === "DATA") { inData = true; sock.write("354 go\r\n"); }
        else if (up === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else if (up === "RSET") sock.write("250 ok\r\n");
        else sock.write("250 ok\r\n"); } });
    sock.on("error", () => {}); });
  return new Promise(r => s.listen(0, "127.0.0.1", () => r({ s, seen, port: s.address().port }))); }
const SECRETS = [...TO, "brief@sender.example", FROM, USER, PASS, encodeURIComponent(PASS)];
async function go(mode, extra = {}) { const { s, seen, port } = await server(mode);
  const env = { ...process.env, GITHUB_ACTIONS: "true", SMTP_URL: `smtp://${USER}:${encodeURIComponent(PASS)}@127.0.0.1:${port}`, DIGEST_FROM: FROM, DIGEST_TO: TO.join(", "), DIGEST_SEND_EMPTY: "1", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1", ...extra };
  delete env.NODE_USE_ENV_PROXY; let code = 0, out = "";
  try { const r = await run(process.execPath, [join(T, "scripts/digest.mjs")], { env, timeout: 60000 }); out = r.stdout + r.stderr; } catch (e) { code = e.code ?? 1; out = (e.stdout ?? "") + (e.stderr ?? ""); }
  s.close(); const lines = out.split("\n"), masks = lines.filter(l => l.startsWith("::add-mask::")).map(l => l.slice(12).replace(/%0A/g, "\n").replace(/%0D/g, "\r").replace(/%25/g, "%")), rest = lines.filter(l => !l.startsWith("::add-mask::")).join("\n");
  return { code, out, masks, rest, seen }; }
const leaks = rest => SECRETS.filter(x => rest.includes(x)).concat((rest.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g) ?? []));
let r = await go("ok");
chk("sending works: the mail server saw all three addresses and the log gives only their number", r.code === 0 && r.seen.rcpt.filter(a => TO.includes(a)).length === 3 && r.seen.data && /Sent to 3 addresses\./.test(r.rest), r.out.slice(-400));
chk("... nothing private is in the log outside the lines that tell GitHub what to hide", leaks(r.rest).length === 0, leaks(r.rest));
chk("... every address, the sender, and the mail server's name and password are registered to be hidden", [...TO, "brief@sender.example", FROM, USER, PASS].every(x => r.masks.includes(x)), r.masks);
r = await go("reject-one");
chk("one address refused by the server: the others are still sent, and the log names nobody", r.code === 0 && r.seen.data && leaks(r.rest).length === 0, r.rest.slice(-400));
r = await go("reject-all");
chk("every address refused (the three and the sender, who is on the To line): the run fails, says how many were refused, and quotes no address", r.code === 1 && /The brief was not sent:/.test(r.rest) && /4 addresses refused/.test(r.rest) && leaks(r.rest).length === 0, r.rest.slice(-500));
r = await go("fail-data");
chk("the server refuses the message and quotes an address: the run fails and the log does not repeat it", r.code === 1 && /The brief was not sent:/.test(r.rest) && leaks(r.rest).length === 0, r.rest.slice(-500));
r = await go("auth-fail");
chk("the server refuses the password: the run fails and neither name nor password is in the log", r.code === 1 && /The brief was not sent:/.test(r.rest) && leaks(r.rest).length === 0 && !/Secr/.test(r.rest), r.rest.slice(-500));
r = await go("ok", { SMTP_URL: "smtp://127.0.0.1:1" });
chk("the mail server cannot be reached: the run fails with a plain message and no address", r.code === 1 && /The brief was not sent:/.test(r.rest) && leaks(r.rest).length === 0 && !/127\.0\.0\.1:1\b.*smtp:\/\//.test(r.rest), r.rest.slice(-400));
r = await go("ok", { SMTP_URL: "", GITHUB_ACTIONS: "true" });
chk("mailing not set up: nothing is sent and nothing is registered", r.code === 0 && /Not emailed/.test(r.rest) && r.masks.length === 0, r.out.slice(-300));
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
