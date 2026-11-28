// The word AANHPI is written AAPI in summaries and article text; headlines and web addresses are left exactly as the outlet wrote them.
// usage: node plainterms_test.mjs <repo> <tmp dir>   (a local mock server; no real network)
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, cpSync, symlinkSync } from "node:fs"; import { execFile } from "node:child_process";
import { resolve } from "node:path"; const REPO = resolve(process.argv[2]), TMP = resolve(process.argv[3]); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data", { recursive: true });
for (const f of ["scripts", "taxonomy.json", "hubs.json", "package.json", "elections.json", "numbers.json", "observances.json", "orgs.json"]) { try { cpSync(REPO + "/" + f, TMP + "/" + f, { recursive: true }); } catch {} }
symlinkSync(REPO + "/node_modules", TMP + "/node_modules");
const res = []; const chk = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " " + String(x).slice(0, 500))); res.push(!!ok); };
const rfc = d => new Date(Date.now() - d * 864e5).toUTCString();
let base = "";
const feed = () => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>x</title>
<item><title>AANHPI voters rally in Ohio</title><link>${base}/a/aanhpi-voters-rally</link><pubDate>${rfc(1)}</pubDate><description>This Asian American, Native Hawaiian and Pacific Islander (AANHPI) Heritage Month, AANHPIs and allies gathered. Nearly 5,000 AANHPI voters came.</description><content:encoded><![CDATA[<p>Hundreds of AANHPI voters came. Read more at <a href="${base}/AANHPI-guide">the AANHPI guide</a>.</p><p>Second paragraph.</p>]]></content:encoded></item>
</channel></rss>`;
const srv = http.createServer((q, r) => { if (q.url.startsWith("/feed")) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(feed()); } else { r.writeHead(404); r.end(); } }).listen(0, "127.0.0.1", () => {
  base = "http://127.0.0.1:" + srv.address().port;
  const cfg = JSON.parse(readFileSync(REPO + "/sources.json", "utf8"));
  cfg.sources = [{ name: "Plain Terms", home: base, kind: "community", feed: base + "/feed.xml", fullText: true }];
  for (const k of ["federalRegister", "executiveActions", "regulations", "govinfo", "congress", "openStates", "events"]) if (cfg[k]) cfg[k].enabled = false;
  delete cfg.keepFrom;
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg));
  execFile("node", ["scripts/fetch.mjs"], { cwd: TMP, env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: TMP + "/data/feed.json", NO_PROXY: "127.0.0.1,localhost", NODE_OPTIONS: "" }, timeout: 120000 }, (err, so, se) => {
    srv.close();
    let f; try { f = JSON.parse(readFileSync(TMP + "/data/feed.json", "utf8")); } catch (e) { console.log("FAIL no feed written", err?.message, so.slice(-500), se.slice(-500)); process.exit(1); }
    const i = f.items.find(x => x.s === "Plain Terms");
    chk("the item is collected", !!i, JSON.stringify(f.items.map(x => x.h)));
    chk("the headline keeps AANHPI exactly as the outlet wrote it", i && i.h === "AANHPI voters rally in Ohio", i && i.h);
    chk("the summary says AAPI (and AAPIs), not AANHPI", i && !/AANHPI/.test(i.m) && /\(AAPI\) Heritage Month, AAPIs and allies/.test(i.m), i && i.m);
    chk("the web address is untouched", i && i.u === base + "/a/aanhpi-voters-rally", i && i.u);
    let art = null; try { art = JSON.parse(readFileSync(TMP + "/data/articles/" + i.id + ".json", "utf8")); } catch {}
    chk("the stored article text says AAPI, and the link address keeps its original capitals", art && !/AANHPI voters|the AANHPI guide/.test(art.body) && /AAPI voters/.test(art.body) && art.body.includes("/AANHPI-guide"), art && art.body);
    console.log(res.every(Boolean) ? "ALL PASS " + res.length : "SOME FAILED");
    process.exit(res.every(Boolean) ? 0 : 1);
  });
});
