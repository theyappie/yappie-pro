// Generated files that carry a time (RSS lastBuildDate, calendar DTSTAMP) must not change when only the time of the run changed, so an update run commits only what really changed.
// usage: node outputs_stable_test.mjs <repo> <tmp dir>
import { execFileSync } from "node:child_process"; import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
const REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/scripts", { recursive: true }); mkdirSync(TMP + "/data", { recursive: true });
for (const f of ["build-outputs.mjs", "admin.mjs"]) cpSync(`${REPO}/scripts/${f}`, `${TMP}/scripts/${f}`);
for (const f of ["taxonomy.json", "sources.json"]) cpSync(`${REPO}/${f}`, `${TMP}/${f}`);
cpSync(REPO + "/package.json", TMP + "/package.json");
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); ok.push(!!c); };
const items = [
  { id: "a1", h: "Newest story", s: "Src", u: "https://example.org/a1", d: "2026-11-02T10:00:00Z", k: "news", t: "IMMIGRATION", cm: ["PH"], st: ["CA"] },
  { id: "a2", h: "Older story", s: "Src", u: "https://example.org/a2", d: "2026-10-30T10:00:00Z", k: "news", t: "HEALTH", cm: ["CN"], st: ["NY"] },
  { id: "a3", h: "Open for comment", s: "Fed", u: "https://example.gov/a3", d: "2026-10-29T10:00:00Z", k: "rule", t: "IMMIGRATION", dl: "2099-01-01", ty: "Rule", ag: "DHS" }];
const build = gen => { writeFileSync(TMP + "/data/feed.json", JSON.stringify({ generated: gen, sources: [], items })); execFileSync("node", [TMP + "/scripts/build-outputs.mjs"], { cwd: TMP, stdio: "pipe" }); };
const snap = () => Object.fromEntries([...readdirSync(TMP + "/data/rss").map(f => ["rss/" + f, readFileSync(TMP + "/data/rss/" + f, "utf8")]), ["deadlines.ics", readFileSync(TMP + "/data/deadlines.ics", "utf8")]]);
build("2026-11-02T12:00:00.000Z"); const a = snap(); build("2026-11-02T12:10:00.000Z"); const b = snap();
chk("RSS and calendar files are byte for byte the same when only the time of the run changed", JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length > 10, Object.keys(a).filter(k => a[k] !== b[k]));
chk("lastBuildDate is the newest story's date", /<lastBuildDate>Mon, 02 Nov 2026 10:00:00 GMT<\/lastBuildDate>/.test(a["rss/all.xml"]) && /<lastBuildDate>Fri, 30 Oct 2026 10:00:00 GMT<\/lastBuildDate>/.test(a["rss/topic-health.xml"] ?? ""), a["rss/all.xml"].slice(0, 400));
chk("DTSTAMP in the deadlines calendar is the story's date", /DTSTAMP:20261029T100000Z/.test(a["deadlines.ics"]), a["deadlines.ics"].slice(0, 400));
items.push({ id: "a4", h: "A newer story", s: "Src", u: "https://example.org/a4", d: "2026-11-02T11:00:00Z", k: "news", t: "HEALTH", cm: ["CN"], st: ["NY"] }); build("2026-11-02T12:20:00.000Z"); const c = snap();
chk("a new story changes the feeds it belongs to (and only those)", c["rss/all.xml"] !== b["rss/all.xml"] && c["rss/topic-health.xml"] !== b["rss/topic-health.xml"] && c["rss/topic-immigration.xml"] === b["rss/topic-immigration.xml"] && c["rss/community-ph.xml"] === b["rss/community-ph.xml"]);
const EV = await import(REPO + "/scripts/events.mjs"), evs = [{ id: "e1", k: "event", t: "Webinar", d: "2026-11-12T19:00:00.000Z", u: "https://example.org/e" }, { id: "e2", k: "event", t: "Day", d: "2026-11-20", ad: 1 }];
const i1 = EV.eventsIcs(evs, Date.parse("2026-11-02T12:00:00Z")), i2 = EV.eventsIcs(evs, Date.parse("2026-11-02T12:30:00Z"));
chk("events calendar: DTSTAMP does not depend on the time of the run", i1 === i2 && /DTSTAMP:20261112T190000Z/.test(i1) && /DTSTAMP:20261120T000000Z/.test(i1), i1.slice(0, 500));
// The page's first file (data/latest.json): every open page asks for it again every ten minutes, so it must not change when no story did.
{ const write = (gen, sources, its = items) => { writeFileSync(TMP + "/data/feed.json", JSON.stringify({ generated: gen, sources, items: its })); execFileSync("node", [TMP + "/scripts/build-outputs.mjs"], { cwd: TMP, stdio: "pipe" }); return readFileSync(TMP + "/data/latest.json", "utf8"); };
  const rows = ok => [{ name: "Src", home: "https://example.org", kind: "community", ok: true }, { name: "Org", home: "https://org.example", kind: "statement", ok, ...(ok ? {} : { r: 2 }) }];
  const a = write("2026-11-02T13:00:00.000Z", rows(true)), b = write("2026-11-02T13:10:00.000Z", rows(false)), c = write("2026-11-02T13:20:00.000Z", rows(true));
  const ja = JSON.parse(a);
  chk("latest.json lists each source's name, site and kind, and not whether its last read worked", JSON.stringify(ja.sources) === JSON.stringify([{ name: "Src", home: "https://example.org", kind: "community" }, { name: "Org", home: "https://org.example", kind: "statement" }]), ja.sources);
  chk("latest.json is byte for byte the same when only a source's last read failed or worked again", a === b && b === c && ja.generated === "2026-11-02T13:00:00.000Z", [a === b, b === c, ja.generated]);
  const d = write("2026-11-02T13:30:00.000Z", rows(true), [...items, { id: "a5", h: "One more story", s: "Src", u: "https://example.org/a5", d: "2026-11-02T12:30:00Z", k: "news", t: "HEALTH" }]), jd = JSON.parse(d);
  chk("a new story changes it, and then it carries the time of that run", d !== c && jd.generated === "2026-11-02T13:30:00.000Z" && jd.items.some(i => i.id === "a5"), [jd.generated, jd.items.length]);
  const e = write("2026-11-02T13:40:00.000Z", [...rows(true), { name: "New Org", home: "https://new.example", kind: "statement", ok: true }], JSON.parse(d).items.concat(JSON.parse(readFileSync(TMP + "/data/feed.json", "utf8")).items.filter(i => !JSON.parse(d).items.some(j => j.id === i.id)))), je = JSON.parse(e);
  chk("a new source changes it too", e !== d && je.sources.length === 3 && je.generated === "2026-11-02T13:40:00.000Z", [je.sources.length, je.generated]);
  writeFileSync(TMP + "/data/latest.json", "{ not json"); const f = write("2026-11-02T13:50:00.000Z", rows(true));
  chk("a latest.json that cannot be read is written anew", JSON.parse(f).generated === "2026-11-02T13:50:00.000Z", f.slice(0, 80)); }
console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED", ok.length);
