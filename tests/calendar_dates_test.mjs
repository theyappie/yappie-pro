// Observances, anniversaries, election dates and comment deadlines on the Events calendar (scripts/events.mjs). usage: node calendar_dates_test.mjs <repo absolute path> <tmp dir>
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs"; import { join } from "node:path"; import { pathToFileURL } from "node:url";
const REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(join(TMP, "data"), { recursive: true });
const M = await import(pathToFileURL(join(REPO, "scripts/events.mjs")).href);
let bad = 0; const chk = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(x).slice(0, 500))); if (!c) bad++; };
const NOW = Date.parse("2026-11-02T12:00:00Z"), DAY = 864e5, lo = NOW - 7 * DAY, hi = NOW + 400 * DAY;
const hubsOf = t => /voting|election/i.test(t) ? ["elections"] : [];
const OBS = [
  { id: "aanhpi-month", k: "observance", t: "Heritage Month", md: "05-01", to: "05-31", m: "A month.", u: "https://www.loc.gov/a/", c: [] },
  { id: "lny", k: "observance", t: "Lunar New Year", dates: { "2026": "2026-02-17", "2027": "2027-02-06", "2028": "2028-01-26" }, m: "Movable.", u: "https://example.org/lny" },
  { id: "vincent-chin", k: "anniversary", t: "Vincent Chin's death", y: 1982, md: "06-23", m: "Killed in Detroit.", u: "https://www.loc.gov/vc/", c: ["CN"] },
  { id: "voting-act", k: "anniversary", t: "A voting rights law signed", y: 1965, md: "08-06", u: "https://example.org/v" },
  { id: "future", k: "anniversary", t: "Not yet", y: 2030, md: "03-01", u: "https://example.org/f" },
  { id: "http", k: "observance", t: "Plain http link", md: "03-01", u: "http://example.org/x" },
  { id: "feb30", k: "observance", t: "Impossible day", md: "02-30", u: "https://example.org/x" },
  { id: "Bad Id", k: "observance", t: "Bad id", md: "03-01", u: "https://example.org/x" },
  { id: "kindx", k: "festival", t: "Wrong kind", md: "03-01", u: "https://example.org/x" },
  { id: "yearless", k: "anniversary", t: "No year", md: "03-01", u: "https://example.org/x" },
  { id: "backwards", k: "observance", t: "Ends before it starts", md: "05-31", to: "05-01", u: "https://example.org/x" },
  null, "x"];
const o = M.observanceEvents(OBS, lo, hi, hubsOf);
const ids = o.map(e => e.id);
chk("a month-long observance becomes one all-day event with an end date, for each year in the window (2027 only: 2026's May is past)", ids.includes("obs-aanhpi-month-2027") && !ids.includes("obs-aanhpi-month-2026") && o.find(e => e.id === "obs-aanhpi-month-2027").d === "2027-05-01" && o.find(e => e.id === "obs-aanhpi-month-2027").e === "2027-05-31" && o.find(e => e.id === "obs-aanhpi-month-2027").ad === 1, ids);
chk("a movable observance uses the dates given for that year, and skips years without one", ids.includes("obs-lny-2027") && o.find(e => e.id === "obs-lny-2027").d === "2027-02-06" && !ids.includes("obs-lny-2026") && ids.includes("obs-lny-2028") === (Date.parse("2028-01-26") <= hi), ids);
const vc = o.find(e => e.id === "ann-vincent-chin-2027");
chk("an anniversary counts the years since the event, and keeps the year", vc && vc.nth === 45 && vc.yr === 1982 && vc.d === "2027-06-23" && vc.k === "anniversary" && vc.c[0] === "CN", vc);
chk("anniversaries in the past window are dropped, the next one is listed (Aug 6, 2027 = 62nd)", o.find(e => e.id === "ann-voting-act-2027")?.nth === 62 && !ids.includes("ann-voting-act-2026"), ids);
chk("an anniversary of something that has not happened yet is not listed", !ids.some(i => i.includes("future")));
chk("a link that is not https, an impossible date, a bad id, a wrong kind, a missing year and a backwards range are all skipped; junk entries do not crash", !ids.some(i => /http|feb30|bad|kindx|yearless|backwards/i.test(i)) && o.length >= 4, ids);
chk("every one is marked as kept by the site (sys) and keeps its source link", o.every(e => e.sys === 1 && e.u.startsWith("https://")));
chk("topic hubs are tagged from the title and text", M.electionEvents([{ id: "g", d: "2026-11-03", t: "General election", n: "Voting day.", u: "https://vote.gov/x", o: "vote.gov", st: [] }], lo, hi, hubsOf)[0].hb?.[0] === "elections");
const el = M.electionEvents([{ id: "ge", d: "2026-11-03", t: "General election", st: ["CA", "ZZZ", "ny"], n: "Federal, state and local elections.", u: "https://vote.gov/x", o: "vote.gov" }, { id: "late", d: "2030-01-01", t: "Too far", u: "https://x.gov/" }, { id: "badend", d: "2026-12-01", e: "2026-11-01", t: "Backwards", u: "https://x.gov/" }, { id: "ok2", d: "2026-12-01", t: "Runoff", u: "http://x.gov/" }], lo, hi);
chk("election dates: kept inside the window with valid state codes only; too far, backwards and non-https dropped", el.length === 1 && el[0].id === "el-ge" && el[0].k === "election" && JSON.stringify(el[0].st) === '["CA"]' && el[0].m === "Federal, state and local elections.", el);
const fi = [{ h: "Proposed rule on language access", u: "https://www.federalregister.gov/d/2026-1", dl: "2026-11-20", ag: "Department of Justice", ty: "Proposed Rule", m: "Summary." }, { h: "Closed rule", u: "https://www.federalregister.gov/d/2026-2", dl: "2026-10-01" }, { h: "No link", u: "javascript:1", dl: "2026-11-20" }, { h: "Bad date", u: "https://x.gov/", dl: "2026-13-40" }, { h: "Not a rule" }];
const cm = M.commentEvents(fi, lo, hi);
chk("comment deadlines: an open one is listed on its last day with agency and type; a closed one, a non-https link and a bad date are not", cm.length === 1 && cm[0].k === "comment" && cm[0].d === "2026-11-20" && cm[0].o === "Department of Justice" && cm[0].sub === "Proposed Rule" && /^cmt-[0-9a-f]{12}$/.test(cm[0].id), cm);
const mg = M.mergeEvents({ own: [], auto: [], sys: [...o, ...el, ...cm], off: ["el-ge"], now: NOW, hubsOf });
chk("merge: system events pass through, are sorted by date, and the owner can hide one by its id", mg.length === o.length + cm.length && !mg.some(e => e.id === "el-ge") && mg.every((e, i) => !i || M.startMs(mg[i - 1]) <= M.startMs(e)), mg.map(e => e.id));
// ---- the whole step, with files
const w = (f, j) => writeFileSync(join(TMP, f), JSON.stringify(j));
w("sources.json", { events: { hearings: { enabled: false }, grants: { enabled: false }, feeds: [], keepPastDays: 7, aheadDays: 400 } });
w("observances.json", { items: OBS }); w("elections.json", { dates: [{ id: "ge", d: "2026-11-03", t: "General election", n: "Federal, state and local elections.", u: "https://vote.gov/x", o: "vote.gov" }, { id: "far", d: "2028-11-07", t: "General election 2028", u: "https://vote.gov/y", o: "vote.gov" }] });
w("data/feed.json", { items: fi });
const env = { SOURCES: join(TMP, "sources.json"), EVENTS_OUT: join(TMP, "data/events.json"), OBSERVANCES: join(TMP, "observances.json"), ELECTIONS: join(TMP, "elections.json"), FEED: join(TMP, "data/feed.json"), HUBS: join(REPO, "hubs.json"), ADMIN_DIR: "" };
const code = await M.main({ ...env }, NOW);
const J = JSON.parse(readFileSync(join(TMP, "data/events.json"), "utf8")), ICS = readFileSync(join(TMP, "data/events.ics"), "utf8");
chk("the step succeeds and writes all four kinds into events.json", code === 0 && ["observance", "anniversary", "election", "comment"].every(k => J.events.some(e => e.k === k)), J.events.map(e => e.k));
chk("events.json says how many of each were found", J.status.dates && J.status.dates.elections === 2 && J.status.dates.comments === 1 && J.status.dates.observances === o.length, J.status);
chk("voting dates are kept however far ahead they are (the window of 400 days applies to the other kinds)", J.events.some(e => e.id === "el-far" && e.k === "election") && !J.events.some(e => e.k === "observance" && e.d > "2028-01-01"), J.events.map(e => e.id + ":" + e.d));
chk("the calendar file carries them: all-day, with the anniversary count in the title and a category per kind", /SUMMARY:45th anniversary: Vincent Chin's death/.test(ICS.replace(/\r\n /g, "")) && /CATEGORIES:Comment deadline/.test(ICS) && /CATEGORIES:Election date/.test(ICS) && /CATEGORIES:Observance/.test(ICS) && /DTSTART;VALUE=DATE:20261103/.test(ICS), ICS.slice(0, 600));
// ---- nothing breaks without the files
rmSync(join(TMP, "observances.json")); rmSync(join(TMP, "elections.json")); rmSync(join(TMP, "data/feed.json"));
const code2 = await M.main({ ...env }, NOW); const J2 = JSON.parse(readFileSync(join(TMP, "data/events.json"), "utf8"));
chk("without the three files the step still succeeds, with no system events", code2 === 0 && J2.events.length === 0, J2.events.length);
// ---- an owner event with the same title and day is not shown twice
const A = join(TMP, "admin"); mkdirSync(A, { recursive: true });
w("observances.json", { items: [OBS[0]] });
writeFileSync(join(A, "admin.json"), JSON.stringify({ v: 1, settings: { events: [{ id: "own00000001", k: "event", t: "Heritage Month", d: "2027-05-01", e: "2027-05-31", ad: true }] } }));
const code3 = await M.main({ ...env, ADMIN_DIR: A }, NOW); const J3 = JSON.parse(readFileSync(join(TMP, "data/events.json"), "utf8"));
chk("an event the owner typed with the same title and day wins over the site's own observance", code3 === 0 && J3.events.filter(e => /Heritage Month/.test(e.t) && e.d === "2027-05-01").length === 1 && J3.events.find(e => /Heritage Month/.test(e.t))?.own === 1, J3.events);
console.log(bad ? `${bad} FAILED` : "ALL PASS"); process.exit(bad ? 1 : 0);
