// Events and funding deadlines (scripts/events.mjs): the iCalendar reader, Congress.gov hearings, Grants.gov deadlines, calendar feeds, the owner's own events and hidden ones, the calendar file.
// usage: node events_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
const REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data", { recursive: true }); mkdirSync(TMP + "/private", { recursive: true });
const EV = await import(REPO + "/scripts/events.mjs"), REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), STARTER = JSON.parse(readFileSync(REPO + "/hubs.json", "utf8"));
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); ok.push(!!c); };
const NOW = Date.parse("2026-11-02T12:00:00Z"), at = ms => new Date(ms).toISOString();

// ---------------------------------------------------------------- the iCalendar reader
{
  const P = EV.parseIcs([
    "BEGIN:VCALENDAR", "X-WR-TIMEZONE:Pacific/Honolulu", "BEGIN:VTIMEZONE", "TZID:America/New_York", "BEGIN:STANDARD", "DTSTART:20251102T060000", "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:a1", "DTSTART;TZID=America/New_York:20261112T140000", "DTEND;TZID=America/New_York:20261112T150000", "SUMMARY:Winter webinar", "LOCATION:Zoom\\, online", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a2", "DTSTART;TZID=America/New_York:20261020T140000", "SUMMARY:Autumn webinar", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a3", "DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20261203", "SUMMARY:Two day legislative day", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a4", "DTSTART:20261120T180000Z", "SUMMARY:Hmong\\, Lao and Khmer", "  community call", "DESCRIPTION:<p>Join us&nbsp;at&#8217;s <b>noon</b></p>\\nSecond line", "BEGIN:VALARM", "DESCRIPTION:Reminder text", "END:VALARM", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a5", "DTSTART:20261121T100000", "SUMMARY:Floating time", "STATUS:CANCELLED", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a6", "SUMMARY:No start", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  const g = u => P.find(x => x.uid === u);
  chk("ics: events are read (an event with no start is dropped)", P.length === 5 && !g("a6"), P.map(x => x.uid));
  chk("ics: a New York time in November is five hours behind UTC (and the end is read)", g("a1").d === "2026-11-12T19:00:00.000Z" && g("a1").e === "2026-11-12T20:00:00.000Z", g("a1"));
  chk("ics: a New York time in October is four hours behind UTC (daylight time)", g("a2").d === "2026-10-20T18:00:00.000Z", g("a2"));
  chk("ics: an all-day end is the day after the last day, so a two-day event ends on the 2nd", g("a3").ad === true && g("a3").d === "2026-12-01" && g("a3").e === "2026-12-02", g("a3"));
  chk("ics: a time with Z is UTC; escaped commas and folded lines are put back together", g("a4").d === "2026-11-20T18:00:00.000Z" && g("a4").t === "Hmong, Lao and Khmer community call", g("a4"));
  chk("ics: HTML and entities in a description become plain text, and a reminder (VALARM) is not mistaken for it", g("a4").m === "Join us at’s noon Second line", g("a4").m);
  chk("ics: a time with no zone uses the calendar's own zone (Honolulu, ten hours behind), and a cancelled event is marked", g("a5").d === "2026-11-21T20:00:00.000Z" && g("a5").cancelled === true, g("a5"));
  chk("ics: an unknown zone name falls back instead of failing", EV.parseIcs("BEGIN:VEVENT\nDTSTART;TZID=Nowhere/Land:20261112T140000\nSUMMARY:x\nEND:VEVENT")[0].d === "2026-11-12T19:00:00.000Z");
  chk("ics: Windows zone names (Pacific Standard Time) are understood", EV.parseIcs("BEGIN:VEVENT\nDTSTART;TZID=Pacific Standard Time:20261112T140000\nSUMMARY:x\nEND:VEVENT")[0].d === "2026-11-12T22:00:00.000Z");
  chk("congress number: the 119th until 3 January 2027, then the 120th", EV.congressOn(Date.parse("2026-11-02")) === 119 && EV.congressOn(Date.parse("2027-01-02")) === 119 && EV.congressOn(Date.parse("2027-01-03")) === 120 && EV.congressOn(Date.parse("2025-01-03")) === 119 && EV.congressOn(Date.parse("2025-01-02")) === 118);
}

// ---------------------------------------------------------------- fake Congress.gov, Grants.gov and calendar servers
const HIT = { list: 0, detail: new Map(), grants: 0, feed: new Map(), keys: new Set() }; let CG_FAIL = 0;
const detail = {
  100001: { date: "2026-11-12T15:00:00Z", title: "Birthright Citizenship and the Fourteenth Amendment", type: "Hearing", meetingStatus: "Scheduled", chamber: "House", committees: [{ name: "Judiciary Committee" }], location: { room: "2141", building: "Rayburn House Office Building" }, witnesses: [{ name: "Jane Doe", organization: "A University" }] },
  100002: { date: "2026-11-13T15:00:00Z", title: "Farm Bill Reauthorization", type: "Hearing", meetingStatus: "Scheduled", chamber: "House", committees: [{ name: "Agriculture Committee" }] },
  100003: { date: "2026-11-14T15:00:00Z", title: "Oversight of immigration enforcement", type: "Hearing", meetingStatus: "Canceled", chamber: "House", committees: [{ name: "Judiciary Committee" }] },
  100004: { date: "2026-11-16T15:00:00Z", title: "Small business tax relief", type: "Hearing", meetingStatus: "Scheduled", chamber: "House", committees: [{ name: "Small Business Committee" }], witnesses: [{ name: "John Roe", organization: "Asian Americans Advancing Justice - AAJC" }] },
  100005: { date: "2026-10-01T15:00:00Z", title: "AANHPI economic mobility", type: "Hearing", meetingStatus: "Scheduled", chamber: "House", committees: [{ name: "Small Business Committee" }] },
  200001: { date: "2026-11-18T14:30:00Z", title: "Language access in federal agencies", type: "Markup", meetingStatus: "Scheduled", chamber: "Senate", committees: [{ name: "Homeland Security and Governmental Affairs Committee" }], location: { address: "Field hearing, 100 Main St, Honolulu" } },
};
const upd = { 100001: "2026-11-01T10:00:00Z", 100002: "2026-11-01T11:00:00Z", 100003: "2026-11-01T12:00:00Z", 100004: "2026-11-01T13:00:00Z", 100005: "2026-10-30T10:00:00Z", 200001: "2026-11-01T14:00:00Z" };
const grant = (id, title, close, extra = {}) => ({ id, number: "HHS-2027-" + id, title, agencyName: "Health Resources and Services Administration", openDate: "09/01/2026", closeDate: close, oppStatus: "posted", ...extra });
const ICS_A = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "UID:e1", "DTSTART;TZID=America/New_York:20261112T140000", "DTEND;TZID=America/New_York:20261112T150000", "SUMMARY:Census 2030 race categories webinar", "DESCRIPTION:<p>Join us for a briefing.</p> Register at https://reg.example/e1 today", "LOCATION:Zoom", "END:VEVENT",
  "BEGIN:VEVENT", "UID:e2", "DTSTART;VALUE=DATE:20261201", "DTEND;VALUE=DATE:20261203", "SUMMARY:Legislative Day", "URL:https://leg.example/day", "END:VEVENT",
  "BEGIN:VEVENT", "UID:e3", "DTSTART:20261125T180000Z", "SUMMARY:Cancelled call", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "UID:e4", "DTSTART;VALUE=DATE:20261215", "SUMMARY:AAPI Fellowship application due", "END:VEVENT", // the same title and day as the owner's own entry
  "BEGIN:VEVENT", "UID:e5", "DTSTART:20260801T180000Z", "SUMMARY:Long past", "END:VEVENT",
  "END:VCALENDAR"].join("\r\n");
const ICS_MINE = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:m1", "DTSTART:20261122T200000Z", "SUMMARY:My own followed calendar event", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x"), p = u.pathname, json = (o, c = 200) => { r.writeHead(c, { "content-type": "application/json" }); r.end(JSON.stringify(o)); };
  if (p.startsWith("/congress/")) {
    HIT.keys.add(q.headers["x-api-key"] ?? ""); if (q.headers["x-api-key"] !== "test-key") return json({ error: "no key" }, 403);
    if (CG_FAIL) return json({ error: "slow down" }, 429);
    let m = /^\/congress\/committee-meeting\/119\/(house|senate)$/.exec(p);
    if (m) { HIT.list++; return json({ committeeMeetings: Object.keys(upd).filter(id => (m[1] === "house") === (id < 200000)).map(id => ({ chamber: m[1] === "house" ? "House" : "Senate", congress: 119, eventId: id, updateDate: upd[id], url: "x" })), pagination: { count: 5 } }); }
    m = /^\/congress\/committee-meeting\/119\/(house|senate)\/(\d+)$/.exec(p);
    if (m && detail[m[2]]) { HIT.detail.set(m[2], (HIT.detail.get(m[2]) ?? 0) + 1); return json({ committeeMeeting: { eventId: m[2], ...detail[m[2]] } }); }
    return json({}, 404);
  }
  if (p === "/grants" && q.method === "POST") {
    HIT.grants++; let b = ""; q.on("data", c => b += c); q.on("end", () => {
      const kw = JSON.parse(b).keyword;
      json({ errorcode: 0, data: { hitCount: 3, oppHits: kw === "Asian American" ? [grant("1001", "Native Hawaiian Health Care Program", "12/15/2026"), grant("1002", "Expired program", "10/01/2026"), grant("1003", "Forecast with no close date", ""), ...(HIT.ent ? [grant("1004", "Invited to Apply &ndash; Hawai&#699;i &amp; Pacific", "12/20/2026", { agencyName: "Dept. of Health &amp; Human Services" })] : [])] : [grant("1001", "Native Hawaiian Health Care Program", "12/15/2026"), grant("1004", "AANAPISI Program", "01/30/2027", { agencyName: "Department of Education" })] } });
    }); return;
  }
  if (p.startsWith("/cal/")) { HIT.feed.set(p, (HIT.feed.get(p) ?? 0) + 1); if (p === "/cal/a.ics") { r.writeHead(200, { "content-type": "text/calendar" }); return r.end(ICS_A); } if (p === "/cal/mine.ics") { r.writeHead(200, { "content-type": "text/calendar" }); return r.end(ICS_MINE); } if (p === "/cal/c.txt") { r.writeHead(200); return r.end("hello"); } r.writeHead(404); return r.end("no"); }
  r.writeHead(404); r.end("no");
});
await new Promise(res => srv.listen(0, "127.0.0.1", res));
const base = "http://127.0.0.1:" + srv.address().port, realFetch = globalThis.fetch;
globalThis.fetch = (u, i) => { const s = String(u); return realFetch(s.startsWith("https://cal.example/") ? base + "/cal" + s.slice("https://cal.example".length) : s.startsWith("https://www.grants.example/") ? base + s.slice("https://www.grants.example".length) : u, i); };

const cfg = { ...REAL, events: { ...REAL.events, grants: { ...REAL.events.grants, keywords: ["Asian American", "Pacific Islander"] }, feeds: [{ name: "Cal A", url: "https://cal.example/a.ics" }, { name: "Cal B", url: "https://cal.example/b.ics" }, { name: "Cal C", url: "https://cal.example/c.txt" }, { name: "Cal Off", url: "https://cal.example/off.ics" }] } };
writeFileSync(TMP + "/sources.json", JSON.stringify(cfg)); writeFileSync(TMP + "/hubs.json", JSON.stringify(STARTER));
const D = f => TMP + "/data/" + f, readJ = f => JSON.parse(readFileSync(D(f), "utf8")), state = o => writeFileSync(TMP + "/private/admin.json", JSON.stringify({ v: 1, updated: "", ...o }));
const env = (extra = {}) => ({ SOURCES: TMP + "/sources.json", HUBS: TMP + "/hubs.json", EVENTS_OUT: D("events.json"), ADMIN_DIR: TMP + "/private", CONGRESS_API: base + "/congress", GRANTS_API: base + "/grants", API_DATA_GOV_KEY: "test-key", ...extra });
const logs = []; const origLog = console.log; const quiet = async f => { console.log = (...a) => logs.push(a.join(" ")); try { return await f(); } finally { console.log = origLog; } };
const go = (nowMs, extra) => quiet(() => EV.main(env({ EVENTS_NOW: at(nowMs), ...extra }), nowMs));
const own = [{ id: "own00001", k: "funding", t: "AAPI Fellowship application due", d: "2026-12-15", ad: true, o: "Example Fund", u: "https://example.org/fellowship" }, { id: "own00002", k: "event", t: "Old webinar", d: "2026-09-01T18:00:00Z" }, { id: "own00003", k: "hearing", t: "Field hearing on census undercount", d: "2026-11-30T21:00:00Z", loc: "Honolulu" }];
state({ settings: { events: own, eventFeeds: [{ name: "Mine", url: "https://cal.example/mine.ics" }], eventFeedsOff: ["https://cal.example/off.ics"] } });

// run 1
let code = await go(NOW), J = readJ("events.json"), ev = t => J.events.find(e => e.t === t), titles = () => J.events.map(e => e.t);
chk("run 1 ends well and writes events.json, events-cache.json and events.ics", code === 0 && J.events.length > 5, logs.slice(-3));
chk("the key travels in the x-api-key header and nowhere in the output", [...HIT.keys].every(k => k === "test-key") && !JSON.stringify(J).includes("test-key") && !readFileSync(D("events-cache.json"), "utf8").includes("test-key"));
chk("hearing: the birthright citizenship hearing is kept, with committee, room and link", (e => e && e.k === "hearing" && e.d === "2026-11-12T15:00:00.000Z" && e.o === "House: Judiciary Committee" && e.loc === "2141, Rayburn House Office Building" && e.u === "https://www.congress.gov/event/119th-congress/house-event/100001" && e.sub === "Hearing" && e.m === "Witnesses: Jane Doe (A University)")(ev("Birthright Citizenship and the Fourteenth Amendment")), ev("Birthright Citizenship and the Fourteenth Amendment"));
chk("hearing: it is tagged with its topic hub", (ev("Birthright Citizenship and the Fourteenth Amendment") || {}).hb?.includes("birthright-citizenship"));
chk("hearing: an unrelated hearing, a cancelled one and one that is already past are not listed", !titles().includes("Farm Bill Reauthorization") && !titles().includes("Oversight of immigration enforcement") && !titles().includes("AANHPI economic mobility"), titles());
chk("hearing: one with a witness from an advocacy group is kept", !!ev("Small business tax relief"));
chk("hearing: a Senate markup is kept as a markup, with its field-hearing address", (e => e && e.sub === "Markup" && e.o === "Senate: Homeland Security and Governmental Affairs Committee" && /Honolulu/.test(e.loc) && e.u.includes("senate-event/200001"))(ev("Language access in federal agencies")), ev("Language access in federal agencies"));
chk("hearing: every meeting was read once", HIT.list === 2 && [...HIT.detail.values()].every(n => n === 1) && HIT.detail.size === 6, [HIT.list, [...HIT.detail]]);
chk("grants: a future closing date becomes an all-day deadline with the agency and a link; past and undated ones are left out; the same opportunity found twice is listed once", (g => g && g.k === "funding" && g.ad === 1 && g.d === "2026-12-15" && g.o.startsWith("Health Resources") && g.u === "https://www.grants.gov/search-results-detail/1001" && /HHS-2027-1001/.test(g.m))(ev("Native Hawaiian Health Care Program")) && !titles().includes("Expired program") && !titles().includes("Forecast with no close date") && titles().filter(t => t === "Native Hawaiian Health Care Program").length === 1 && !!ev("AANAPISI Program"), titles());
chk("feed: a webinar keeps its time (New York to UTC), place, plain-text summary and the link found in its description", (e => e && e.k === "event" && e.o === "Cal A" && e.d === "2026-11-12T19:00:00.000Z" && e.e === "2026-11-12T20:00:00.000Z" && e.loc === "Zoom" && e.u === "https://reg.example/e1" && e.m === "Join us for a briefing. Register at today")(ev("Census 2030 race categories webinar")), ev("Census 2030 race categories webinar"));
chk("feed: that webinar is tagged with its hub (census), and an all-day event has its last day", (ev("Census 2030 race categories webinar") || {}).hb?.includes("census-race-categories") && (e => e && e.ad === 1 && e.d === "2026-12-01" && e.e === "2026-12-02" && e.u === "https://leg.example/day")(ev("Legislative Day")));
chk("feed: a cancelled event and one long past are left out", !titles().includes("Cancelled call") && !titles().includes("Long past"));
chk("feed: a feed the owner follows is read too, and one the owner stopped following is not asked for", !!ev("My own followed calendar event") && !HIT.feed.has("/cal/off.ics"), [...HIT.feed.keys()]);
chk("feed: a failing feed (404) and a file that is not a calendar are reported, and do not stop the rest", J.status.feeds.find(f => f.name === "Cal B").ok === false && /404/.test(J.status.feeds.find(f => f.name === "Cal B").note) && J.status.feeds.find(f => f.name === "Cal C").ok === false && /not a calendar/.test(J.status.feeds.find(f => f.name === "Cal C").note) && J.status.feeds.find(f => f.name === "Cal A").ok === true && J.status.feeds.find(f => f.name === "Cal A").n === 4, J.status.feeds);
chk("status: the owner's followed feed is listed, the stopped one is not, and starter ones are marked", J.status.feeds.some(f => f.name === "Mine" && f.ok) && !J.status.feeds.some(f => f.name === "Cal Off") && J.status.feeds.filter(f => f.starter).length === 3);
chk("owner: their own events are listed (marked), an old one is not, and a hearing they typed gets its hub", (a => a && a.own === 1 && a.k === "funding" && a.u === "https://example.org/fellowship")(ev("AAPI Fellowship application due")) && !titles().includes("Old webinar") && (ev("Field hearing on census undercount") || {}).hb?.includes("census-race-categories"));
chk("owner: the same title on the same day from a calendar and from the owner is one entry (the owner's)", titles().filter(t => t === "AAPI Fellowship application due").length === 1);
chk("the list is in date order, all-day entries first on their day", J.events.every((e, i) => i === 0 || EV.startMs(J.events[i - 1]) <= EV.startMs(e)));
chk("nothing private reaches events.json (no keywords, no key, no admin file)", !/words|admin|test-key/.test(JSON.stringify(J)), Object.keys(J));
const ICS = readFileSync(D("events.ics"), "utf8"), lines = ICS.split("\r\n");
chk("events.ics: a calendar with one VEVENT for each upcoming event", ICS.startsWith("BEGIN:VCALENDAR\r\n") && ICS.endsWith("END:VCALENDAR\r\n") && (ICS.match(/BEGIN:VEVENT/g) || []).length === J.events.filter(e => EV.endMs(e) >= NOW).length, [(ICS.match(/BEGIN:VEVENT/g) || []).length, J.events.length]);
chk("events.ics: an all-day entry uses VALUE=DATE with the day after its last day as the end; a timed one is in UTC", ICS.includes("DTSTART;VALUE=DATE:20261201\r\nDTEND;VALUE=DATE:20261203") && ICS.includes("DTSTART:20261112T190000Z\r\nDTEND:20261112T200000Z"));
chk("events.ics: no line is longer than 75 bytes, commas are escaped, and it reads back with the same reader", lines.every(l => Buffer.byteLength(l) <= 75) && EV.parseIcs(ICS).length === (ICS.match(/BEGIN:VEVENT/g) || []).length && /DESCRIPTION:Funding or fellowship deadline/.test(ICS.replace(/\r\n /g, "")));

// run 2: ten minutes later: nothing is due, except the feeds that failed
const before = { list: HIT.list, grants: HIT.grants, a: HIT.feed.get("/cal/a.ics"), b: HIT.feed.get("/cal/b.ics") };
code = await go(NOW + 11 * 60e3); J = readJ("events.json");
chk("run 2 (11 minutes later): hearings, grants and the calendars that worked are not asked again; the ones that failed are retried", HIT.list === before.list && HIT.grants === before.grants && HIT.feed.get("/cal/a.ics") === before.a && HIT.feed.get("/cal/b.ics") === before.b + 1, [...HIT.feed]);
chk("run 2: the same events are listed", !!ev("Birthright Citizenship and the Fourteenth Amendment") && !!ev("AANAPISI Program") && !!ev("Legislative Day"));

// the owner hides a collected event: it goes at once, without asking any source again
const hidId = ev("Legislative Day").id, hearId = ev("Small business tax relief").id;
state({ settings: { events: own, eventsOff: [{ id: hidId, t: "Legislative Day" }, { id: hearId, t: "Small business tax relief" }], eventFeeds: [{ name: "Mine", url: "https://cal.example/mine.ics" }], eventFeedsOff: ["https://cal.example/off.ics"] } });
const calls = HIT.list + HIT.grants; code = await go(NOW + 12 * 60e3); J = readJ("events.json");
chk("hidden: a hidden feed event and a hidden hearing are gone, the rest stay", !titles().includes("Legislative Day") && !titles().includes("Small business tax relief") && !!ev("Census 2030 race categories webinar") && HIT.list + HIT.grants === calls, titles());
state({ settings: { events: own, eventFeeds: [{ name: "Mine", url: "https://cal.example/mine.ics" }], eventFeedsOff: ["https://cal.example/off.ics"] } });
code = await go(NOW + 13 * 60e3); J = readJ("events.json");
chk("hidden: showing them again brings them back (they were kept, not forgotten)", !!ev("Legislative Day") && !!ev("Small business tax relief"));

// run 3: three hours later: hearings and feeds are due again, grants (six hours) are not; a changed meeting is read again, unchanged ones are not
upd[100001] = "2026-11-03T09:00:00Z"; detail[100001] = { ...detail[100001], title: "Birthright Citizenship hearing (new room)" };
const dBefore = new Map(HIT.detail), gBefore = HIT.grants;
code = await go(NOW + 3 * 3600e3); J = readJ("events.json");
chk("run 3 (3 hours later): hearings are read again, but only the changed meeting is fetched again", HIT.detail.get("100001") === 2 && ["100002", "100003", "100004", "100005", "200001"].every(id => HIT.detail.get(id) === dBefore.get(id)), [...HIT.detail]);
chk("run 3: the changed meeting shows its new title, and grants (not due for six hours) were not asked again", !!ev("Birthright Citizenship hearing (new room)") && !titles().includes("Birthright Citizenship and the Fourteenth Amendment") && HIT.grants === gBefore);
// run 4: Congress.gov refuses (429): the hearings already known stay, and the status says why
CG_FAIL = 1; code = await go(NOW + 6 * 3600e3); J = readJ("events.json");
chk("run 4: when Congress.gov says slow down (429) the known hearings stay and the status explains", code === 0 && !!ev("Birthright Citizenship hearing (new room)") && J.status.hearings.ok === false && /429/.test(J.status.hearings.note) && J.status.grants.ok === true, J.status);
CG_FAIL = 0;
// run 5: no key: hearings are skipped (with a note), everything else works, known hearings stay
code = await go(NOW + 9 * 3600e3, { API_DATA_GOV_KEY: "", CONGRESS_API_KEY: "" }); J = readJ("events.json");
chk("run 5: without the API key hearings are skipped and the status says so; other sources carry on", code === 0 && J.status.hearings.ok === false && /no API key/.test(J.status.hearings.note) && !!ev("AANAPISI Program") && !!ev("Census 2030 race categories webinar"), J.status.hearings);
// run 6: Grants.gov down: the grants listed before stay
code = await go(NOW + 30 * 3600e3, { GRANTS_API: base + "/nowhere", EVENTS_FORCE: "1" }); J = readJ("events.json");
chk("run 6: when Grants.gov cannot be reached the grants listed before stay, and the status says why", !!ev("AANAPISI Program") && J.status.grants.ok === false && /404/.test(J.status.grants.note), J.status.grants);
chk("run 6: forced run asked every source again", HIT.feed.get("/cal/a.ics") >= 4);
// the owner gives a collected event a new title (every name it has had leads to the newest); the same event is not listed twice, and an event of the owner's own is not touched by it
state({ settings: { names: { sources: [], hubs: {}, events: [{ f: "AANAPISI Program", t: "AANAPISI grant" }] }, events: [{ id: "own00001", k: "event", t: "AANAPISI Program", d: "2026-12-09T18:00:00Z" }] } });
code = await go(NOW + 30.5 * 3600e3, { EVENTS_FORCE: "1" }); J = readJ("events.json");
chk("a collected event shows the title the owner gave it", code === 0 && !!ev("AANAPISI grant") && J.events.filter(e => e.t === "AANAPISI grant").length >= 1, titles());
chk("an event the owner entered themselves keeps its own title", !!J.events.find(e => e.id === "own00001" && e.t === "AANAPISI Program"), titles());
state({ settings: { events: [] } });
code = await go(NOW + 30.6 * 3600e3, { EVENTS_FORCE: "1" }); J = readJ("events.json");
chk("without the new title the event shows the title it was collected with", !!ev("AANAPISI Program") && !ev("AANAPISI grant"), titles());
// a damaged admin.json stops the run before anything is changed
const keep = readFileSync(D("events.json"), "utf8"); writeFileSync(TMP + "/private/admin.json", "{ not json");
code = await go(NOW + 31 * 3600e3);
chk("a damaged admin.json stops the run and leaves events.json as it was", code === 1 && readFileSync(D("events.json"), "utf8") === keep);
// validation of the owner's entries when read from the file: bad ones are skipped, good ones kept
state({ settings: { events: [{ id: "good0001", k: "event", t: "Good one", d: "2026-12-05T18:00:00Z" }, { id: "bad00001", k: "party", t: "Wrong kind", d: "2026-12-05T18:00:00Z" }, { id: "bad00002", k: "event", t: "No date" }, { id: "x", k: "event", t: "Short id", d: "2026-12-05" }, { id: "bad00003", k: "event", t: "Bad link", d: "2026-12-05", u: "javascript:alert(1)" }] } });
code = await go(NOW + 32 * 3600e3, { EVENTS_FORCE: "" }); J = readJ("events.json");
chk("owner's events read from the file: only the valid one is listed (a javascript: link is refused)", titles().includes("Good one") && !titles().some(t => ["Wrong kind", "No date", "Short id", "Bad link"].includes(t)) && J.events.every(e => !e.u || /^https?:/.test(e.u)), titles());
// run 7: Grants.gov sends a title and an agency name with HTML entities in them: they are shown as the characters they stand for
HIT.ent = true; code = await go(NOW + 33 * 3600e3, { EVENTS_FORCE: "1" }); J = readJ("events.json");
chk("run 7: HTML entities in a Grants.gov title or agency name (&ndash; &#699; &amp;) are shown as the characters, not as code", (g => !!g && g.o === "Dept. of Health & Human Services" && !/&[#a-z0-9]+;/i.test(g.t))(ev("Invited to Apply \u2013 Hawai\u02bbi & Pacific")), titles().filter(t => /Invited/.test(t)));
globalThis.fetch = realFetch; srv.close(); console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
