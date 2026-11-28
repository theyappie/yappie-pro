// A caucus's press release on a .gov address is stored twice (a statement and a government statement). The feeds that mix kinds and the daily brief list it once; the feeds of one kind keep their copy.
// usage: node twins_test.mjs <repo> <tmp dir>
import { execFileSync } from "node:child_process"; import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
const REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data", { recursive: true });
cpSync(`${REPO}/scripts`, `${TMP}/scripts`, { recursive: true }); for (const f of ["taxonomy.json", "sources.json", "package.json"]) cpSync(`${REPO}/${f}`, `${TMP}/${f}`); symlinkSync(`${REPO}/node_modules`, `${TMP}/node_modules`);
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); ok.push(!!c); };
const L = "https://caucus.house.gov/press-release/a-release", L2 = "https://caucus.house.gov/press-release/another";
const items = [
  { id: "s1", h: "Caucus condemns the rule", s: "Caucus", u: L, d: "2026-11-02T12:00:00.000Z", k: "statement", t: "IMMIGRATION", cm: ["PH"], st: ["CA"] },
  { id: "g1", h: "Caucus condemns the rule", s: "Caucus", u: L, d: "2026-11-02T12:00:00.000Z", k: "govstmt", t: "IMMIGRATION", cm: ["PH"], st: ["CA"], rl: "n" },
  { id: "g2", h: "A government statement of its own", s: "Office", u: L2, d: "2026-11-02T11:00:00.000Z", k: "govstmt", t: "IMMIGRATION", cm: ["PH"], st: ["CA"], rl: "n" },
  { id: "n1", h: "A news story", s: "Paper", u: "https://paper.example/n1", d: "2026-11-02T10:00:00.000Z", k: "news", t: "IMMIGRATION", cm: ["PH"], st: ["CA"] }];
writeFileSync(TMP + "/data/feed.json", JSON.stringify({ generated: "2026-11-02T13:00:00.000Z", sources: [], items }));
execFileSync("node", [TMP + "/scripts/build-outputs.mjs"], { cwd: TMP, stdio: "pipe" });
const n = (f, link) => { let t = ""; try { t = readFileSync(`${TMP}/data/rss/${f}`, "utf8"); } catch { return -1; } return t.split(`<link>${link}</link>`).length - 1; };
const mixed = ["all.xml", "topic-immigration.xml", "community-ph.xml", "state-ca.xml"];
chk("a feed that mixes kinds lists the release once", mixed.every(f => n(f, L) === 1), mixed.map(f => [f, n(f, L)]));
chk("and what it lists is the statement: the government statement's own release is still there", mixed.every(f => n(f, L2) === 1 && n(f, "https://paper.example/n1") === 1), mixed.map(f => [f, n(f, L2)]));
chk("the feeds of one kind keep their copy", n("kind-statement.xml", L) === 1 && n("kind-govstmt.xml", L) === 1 && n("policy.xml", L) === 1 && n("kind-govstmt.xml", L2) === 1, [n("kind-statement.xml", L), n("kind-govstmt.xml", L), n("policy.xml", L)]);
const latest = JSON.parse(readFileSync(TMP + "/data/latest.json", "utf8"));
chk("the page's data still holds both copies (each tab lists its own)", latest.items.filter(i => i.u === L).length === 2, latest.items.map(i => i.id));
execFileSync("node", [TMP + "/scripts/digest.mjs"], { cwd: TMP, stdio: "pipe", env: { ...process.env, DIGEST_NOW: "2026-11-02T14:00:00.000Z", SMTP_URL: "", DIGEST_FROM: "", DIGEST_TO: "", OUT: TMP + "/data/feed.json" } });
const txt = readFileSync(TMP + "/data/digest/latest.txt", "utf8"), html = readFileSync(TMP + "/data/digest/latest.html", "utf8");
chk("the daily brief lists the release once and counts it once", txt.split(L).length - 1 === 1 && html.split(`href="${L}"`).length - 1 === 1 && /^3 new stories/m.test(txt) && txt.includes(L2), txt.slice(0, 700));
console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED", ok.length);
