// mergeEvents: a feed entry that runs for months (a museum exhibition) is left out; owner entries and short events stay. usage: node events_span_test.mjs <repo>
import { join } from "node:path"; import { pathToFileURL } from "node:url";
const { mergeEvents } = await import(pathToFileURL(join(process.argv[2], "scripts/events.mjs")).href);
let bad = 0; const chk = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(x))); if (!c) bad++; };
const now = Date.parse("2026-11-02T12:00:00Z");
const auto = [
  { id: "feed0001", k: "event", t: "Exhibition that runs for months", d: "2026-09-10", e: "2027-01-03", ad: 1, o: "Feed" },
  { id: "feed0002", k: "event", t: "Three day conference", d: "2026-11-10", e: "2026-11-12", ad: 1, o: "Feed" },
  { id: "feed0003", k: "event", t: "Three week festival", d: "2026-10-25", e: "2026-11-14", ad: 1, o: "Feed" },
  { id: "gran0004", k: "funding", sub: "Fellowship", t: "Long application window", d: "2026-12-01", e: "2027-06-01", ad: 1, o: "Fund" },
  { id: "feed0005", k: "event", t: "Timed webinar", d: "2026-11-05T15:00:00.000Z", e: "2026-11-05T16:00:00.000Z", o: "Feed" }];
const own = [{ id: "own00001", k: "event", t: "Owner's season of events", d: "2026-10-01", e: "2027-02-01", ad: true, o: "Us" }];
const t = o => mergeEvents({ own, auto, now, ...o }).map(e => e.id).sort().join();
chk("with a limit of 21 days: the exhibition goes, the 20-day festival and the short ones stay, and so do funding items and the owner's own long event", t({ maxSpanDays: 21 }) === "feed0002,feed0003,feed0005,gran0004,own00001", t({ maxSpanDays: 21 }));
chk("with no limit set everything is kept", t({}) === "feed0001,feed0002,feed0003,feed0005,gran0004,own00001", t({}));
chk("a tighter limit (10 days) also drops the festival", t({ maxSpanDays: 10 }) === "feed0002,feed0005,gran0004,own00001", t({ maxSpanDays: 10 }));
console.log(bad ? "SOME FAILED" : "ALL PASS"); process.exit(bad ? 1 : 0);
