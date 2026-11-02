// The Yappie Pro: events and funding deadlines (Node 20+). Usage: node scripts/events.mjs
// Writes data/events.json (what the Events page shows) and data/events.ics (a calendar people can subscribe to), and keeps data/events-cache.json (what each source returned last time).
//   - Congressional hearings and markups: the Congress.gov API (needs the free api.data.gov key; without it this part is skipped). Only meetings about the issues the site follows are kept.
//   - Grant deadlines: the Grants.gov search API (no key). Open funding opportunities that name Asian American, Native Hawaiian or Pacific Islander communities.
//   - Webinars and other events: calendar feeds (iCalendar, .ics) from coalition and community organizations: the starter list in sources.json ("events", "feeds") plus the ones the owner follows in the dashboard.
//   - Events and deadlines the owner typed into the dashboard (admin.json), and the collected ones the owner hid.
// A source that fails keeps what it returned last time, and the step never stops the news update (the workflow runs it with continue-on-error).
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeState, hubList, hubTagger, cleanEvent, cleanFeed, EVENT_KINDS, httpsUrl, renameMap, renamedTo } from "./admin.mjs";

const UA = { "user-agent": "TheYappiePro/1.0 (open-source policy index; events)", accept: "*/*" };
const DAY = 864e5, MIN = 6e4;
const sha = s => createHash("sha1").update(String(s)).digest("hex");
const clip = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const c = s.slice(0, n - 1), i = c.lastIndexOf(" "); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[ ,;:.\-–]+$/, "") + "…"; };
const normTitle = s => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const dayOf = ev => ev.d.slice(0, 10);
/** Sorting key: an all-day entry sorts before the timed ones of its day. */
// kinds the site adds itself (not typed in the dashboard, so the dashboard code is unchanged)
export const SYSTEM_KINDS = { comment: "Comment deadline", observance: "Observance", anniversary: "Anniversary", election: "Election date" };
const KIND_LABEL = { ...EVENT_KINDS, ...SYSTEM_KINDS };
export const startMs = ev => ev.d.length === 10 ? Date.parse(ev.d + "T00:00:00Z") : Date.parse(ev.d);
/** The last moment of an event (ms): its end, or the end of its day for an all-day entry, or an hour after it starts. */
export const endMs = ev => ev.ad || ev.d.length === 10 ? Date.parse((ev.e || ev.d).slice(0, 10) + "T23:59:59Z") : ev.e ? Date.parse(ev.e) : Date.parse(ev.d) + 36e5;

// ---------------------------------------------------------------- iCalendar (.ics)
const WIN_TZ = { "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles", "Hawaiian Standard Time": "Pacific/Honolulu", "Alaskan Standard Time": "America/Anchorage" };
function offsetMs(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** A wall-clock time in a named time zone as a moment (ms). An unknown zone name falls back to "fallback". */
export function zonedMs(y, mo, d, h, mi, s, tz, fallback = "America/New_York") {
  tz = WIN_TZ[tz] ?? tz;
  for (const z of [tz, fallback]) {
    try {
      const guess = Date.UTC(y, mo - 1, d, h, mi, s), off = offsetMs(guess, z); let r = guess - off; const off2 = offsetMs(r, z); if (off2 !== off) r = guess - off2; return r;
    } catch { /* unknown zone: try the fallback */ }
  }
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
function icsDate(val, params, tz) { // -> { ad, d } with d "YYYY-MM-DD" (all day) or an ISO time (UTC); null when it is not a date
  val = String(val).trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(val);
  if (m) return { ad: true, d: `${m[1]}-${m[2]}-${m[3]}` };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/.exec(val);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", z] = m;
  const ms = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : zonedMs(+y, +mo, +d, +h, +mi, +s, /TZID=([^;:]+)/i.exec(params)?.[1]?.replace(/^"|"$/g, "") || tz, tz);
  return Number.isNaN(ms) ? null : { ad: false, d: new Date(ms).toISOString() };
}
const unesc = v => String(v ?? "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
const plain = h => String(h ?? "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? (() => { const c = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return " "; } })() : ENT[e.toLowerCase()] ?? " ").replace(/\s+/g, " ").trim();
/** The events in an iCalendar file: [{ uid, t, d, e?, ad, m?, loc?, u?, cancelled? }]. A repeating event is read once, as the calendar lists it. */
export function parseIcs(text, o = {}) {
  const defTz = o.tz || "America/New_York", rows = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let calTz = "", cur = null, alarm = 0; const out = [];
  for (const ln of rows) {
    if (ln === "BEGIN:VEVENT") { cur = {}; alarm = 0; continue; }
    if (ln === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (cur && /^BEGIN:/.test(ln)) { alarm++; continue; } if (cur && /^END:/.test(ln)) { alarm = Math.max(0, alarm - 1); continue; } // a reminder (VALARM) inside an event has its own DESCRIPTION
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(ln); if (!m) continue;
    const name = m[1].toUpperCase(), params = m[2], val = m[3];
    if (!cur) { if (name === "X-WR-TIMEZONE") calTz = val.trim(); continue; }
    if (alarm) continue;
    const tz = calTz || defTz;
    switch (name) {
      case "UID": cur.uid = val.trim(); break;
      case "SUMMARY": cur.t = plain(unesc(val)); break;
      case "DESCRIPTION": cur.m = plain(unesc(val)); break;
      case "LOCATION": cur.loc = plain(unesc(val)); break;
      case "URL": cur.u = val.trim(); break;
      case "STATUS": cur.cancelled = /^CANCEL/i.test(val.trim()); break;
      case "DTSTART": { const x = icsDate(val, params, tz); if (x) { cur.d = x.d; cur.ad = x.ad; } break; }
      case "DTEND": { const x = icsDate(val, params, tz); if (x) cur._e = x; break; }
      default:
    }
  }
  return out.filter(c => c.t && c.d).map(c => {
    const e = c._e; delete c._e;
    if (e) {
      if (c.ad && e.ad) { const last = new Date(Date.parse(e.d + "T12:00:00Z") - DAY).toISOString().slice(0, 10); if (last > c.d) c.e = last; } // an all-day end is the day after the last day
      else if (!c.ad && !e.ad && Date.parse(e.d) > Date.parse(c.d)) c.e = e.d;
    }
    return c;
  });
}
const icsEsc = t => String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = l => { if (Buffer.byteLength(l) <= 74) return l; const parts = []; let s = l, first = true; while (Buffer.byteLength(s) > (first ? 74 : 73)) { let n = first ? 74 : 73; while (Buffer.byteLength(s.slice(0, n)) > (first ? 74 : 73)) n--; parts.push(s.slice(0, n)); s = s.slice(n); first = false; } parts.push(s); return parts.join("\r\n "); };
const zstamp = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
/** The calendar file people subscribe to: every upcoming event. */
export function eventsIcs(events, now = Date.now(), host = "pro.theyappie.com") {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Yappie Pro//Events and funding//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:The Yappie Pro: events and funding deadlines"];
  for (const ev of events) {
    if (endMs(ev) < now) continue;
    L.push("BEGIN:VEVENT", `UID:${ev.id}@${host}`, `DTSTAMP:${zstamp(now)}`);
    if (ev.ad || ev.d.length === 10) { const last = (ev.e || ev.d).slice(0, 10), next = new Date(Date.parse(last + "T12:00:00Z") + DAY).toISOString().slice(0, 10); L.push(`DTSTART;VALUE=DATE:${ev.d.slice(0, 10).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next.replace(/-/g, "")}`); }
    else L.push(`DTSTART:${zstamp(Date.parse(ev.d))}`, `DTEND:${zstamp(ev.e ? Date.parse(ev.e) : Date.parse(ev.d) + 36e5)}`);
    L.push(`SUMMARY:${icsEsc(ev.nth ? `${ordinal(ev.nth)} anniversary: ${ev.t}` : ev.t)}`);
    const desc = [KIND_LABEL[ev.k] + (ev.sub ? ` (${ev.sub})` : ""), ev.o && `From ${ev.o}`, ev.m].filter(Boolean).join(". ");
    if (desc) L.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (ev.loc) L.push(`LOCATION:${icsEsc(ev.loc)}`);
    if (ev.u) L.push(`URL:${ev.u}`);
    L.push(`CATEGORIES:${icsEsc(KIND_LABEL[ev.k])}`, "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- the sources
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th");
/** The number of the Congress that sits on a day (the 119th began on 3 January 2025; each lasts two years). */
export const congressOn = ms => { const d = new Date(ms); let y = d.getUTCFullYear(); if (d.getUTCMonth() === 0 && d.getUTCDate() < 3) y--; return Math.floor((y - 1789) / 2) + 1; };

async function getJson(url, init = {}, ms = 30000) {
  const res = await fetch(url, { ...init, headers: { ...UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(ms) });
  if (res.status === 429) { const e = new Error("rate limited (HTTP 429)"); e.rate = true; throw e; }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
const firstArray = (j, key) => Array.isArray(j?.[key]) ? j[key] : Object.values(j ?? {}).find(v => Array.isArray(v) && v.some(x => x && typeof x === "object" && "eventId" in x)) ?? [];

/** Congress.gov committee meetings. Returns the state to remember: { at, ok, n, note?, seen: { "<chamber>/<eventId>": { u: updateDate, d: date, ev? } } }. */
async function collectHearings(ctx, prev) {
  const c = ctx.cfg.hearings ?? {}, key = ctx.key, st = { ...(prev ?? {}), at: new Date(ctx.now).toISOString() };
  if (!key) return { ...st, ok: false, note: "skipped: no API key set (API_DATA_GOV_KEY)", n: 0, seen: prev?.seen ?? {} };
  const api = (ctx.env.CONGRESS_API ?? c.api ?? "https://api.congress.gov/v3").replace(/\/$/, ""), seen = { ...(prev?.seen ?? {}) }, hd = { "x-api-key": key };
  const from = new Date(Math.max(ctx.now - (c.lookbackDays ?? 30) * DAY, prev?.from ? Date.parse(prev.from) - DAY : 0)).toISOString().replace(/\.\d+Z$/, "Z"), cg = ctx.env.EVENTS_CONGRESS ? +ctx.env.EVENTS_CONGRESS : congressOn(ctx.now);
  const todo = []; let errNote = "";
  try {
    for (const chamber of c.chambers ?? ["house", "senate"]) {
      let url = `${api}/committee-meeting/${cg}/${chamber}?format=json&limit=250&fromDateTime=${encodeURIComponent(from)}`;
      for (let page = 0; page < 3 && url; page++) {
        const j = await getJson(url, { headers: hd });
        for (const it of firstArray(j, "committeeMeetings")) { const id = String(it.eventId ?? ""); if (!/^[A-Za-z0-9]+$/.test(id)) continue; const k = `${chamber}/${id}`; if (seen[k]?.u !== (it.updateDate ?? "")) todo.push({ k, chamber, id, upd: it.updateDate ?? "" }); }
        url = j?.pagination?.next ? String(j.pagination.next).replace(/([?&])api_key=[^&]*&?/, "$1") + (/[?&]format=/.test(j.pagination.next) ? "" : "&format=json") : "";
        if (url && !url.startsWith(api)) url = ""; // the next page must stay on the same host
      }
    }
    todo.sort((a, b) => b.upd.localeCompare(a.upd));
    let used = 0;
    for (const t of todo) {
      if (used >= (c.maxDetails ?? 40)) { errNote = `${todo.length - used} more meetings will be read on the next run`; break; }
      used++;
      let j; try { j = await getJson(`${api}/committee-meeting/${cg}/${t.chamber}/${t.id}?format=json`, { headers: hd }); } catch (e) { if (e.rate) throw e; continue; }
      const m = j?.committeeMeeting ?? j, ms = Date.parse(m?.date ?? "");
      if (!m || Number.isNaN(ms)) { seen[t.k] = { u: t.upd, d: "" }; continue; }
      const ev = hearingEvent(ctx, m, t, cg);
      seen[t.k] = ev ? { u: t.upd, d: new Date(ms).toISOString(), ev } : { u: t.upd, d: new Date(ms).toISOString() };
    }
  } catch (e) { return { ...st, ok: false, note: e.message, n: Object.values(seen).filter(x => x.ev).length, seen: prune(seen, ctx.now), from: prev?.from }; }
  const n = Object.values(seen).filter(x => x.ev).length;
  return { ...st, ok: true, note: errNote || undefined, n, seen: prune(seen, ctx.now), from: errNote ? prev?.from : st.at };
}
function prune(seen, now) { const out = {}; for (const [k, v] of Object.entries(seen)) { const d = Date.parse(v.d || v.u || ""); if (Number.isNaN(d) || d > now - 45 * DAY) out[k] = v; } return out; } // meetings more than 45 days old are forgotten
function hearingEvent(ctx, m, t, cg) {
  const status = String(m.meetingStatus ?? ""); if (/cancel|postpon/i.test(status)) return null;
  const title = clip(String(m.title ?? "").replace(/\s+/g, " "), 160); if (!title) return null;
  const committees = (Array.isArray(m.committees) ? m.committees : []).map(x => String(x?.name ?? "")).filter(Boolean);
  const wit = (Array.isArray(m.witnesses) ? m.witnesses : []).map(w => ({ name: String(w?.name ?? ""), org: String(w?.organization ?? "") }));
  const text = [title, ...committees, ...wit.map(w => `${w.name} ${w.org}`)].join(" ");
  const hb = ctx.hubsOf(text), orgHit = wit.some(w => w.org && ctx.advocacy.some(a => normTitle(w.org).includes(a)));
  if (!hb.length && !ctx.community.test(text) && !orgHit) return null;
  const chamber = /^senate/i.test(m.chamber ?? t.chamber) ? "Senate" : "House", loc = m.location ?? {};
  const where = [loc.room, loc.building].filter(Boolean).join(", ") || String(loc.address ?? "").replace(/\s+/g, " ").trim();
  const ws = wit.filter(w => w.name).slice(0, 5).map(w => w.org ? `${w.name} (${w.org})` : w.name);
  const ev = {
    id: "h" + sha(`${t.chamber}/${t.id}`).slice(0, 11), k: "hearing", t: title, d: new Date(Date.parse(m.date)).toISOString(),
    o: `${chamber}${committees[0] ? ": " + committees[0].replace(/^(House|Senate) /i, "") : ""}`.slice(0, 80),
    u: `https://www.congress.gov/event/${ordinal(cg)}-congress/${chamber.toLowerCase()}-event/${t.id}`, sub: /markup/i.test(m.type ?? "") ? "Markup" : /hearing/i.test(m.type ?? "") ? "Hearing" : "Meeting",
  };
  if (where) ev.loc = where.slice(0, 120);
  if (ws.length) ev.m = clip("Witnesses: " + ws.join("; "), 400);
  return ev;
}

/** Grants.gov: open funding opportunities that name the communities. Returns { at, ok, n, events }. */
async function collectGrants(ctx, prev) {
  const c = ctx.cfg.grants ?? {}, at = new Date(ctx.now).toISOString(), api = ctx.env.GRANTS_API ?? c.api ?? "https://api.grants.gov/v1/api/search2", today = at.slice(0, 10), byId = new Map();
  try {
    for (const kw of c.keywords ?? ["Asian American", "Native Hawaiian", "Pacific Islander"]) {
      const j = await getJson(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: c.rows ?? 40, keyword: kw, oppStatuses: "forecasted|posted" }) });
      const hits = j?.data?.oppHits ?? j?.oppHits; if (!Array.isArray(hits)) throw new Error("unexpected answer from Grants.gov");
      for (const h of hits) {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(h?.closeDate ?? "").trim()); if (!m || !h.id || !h.title) continue;
        const close = `${m[3]}-${m[1]}-${m[2]}`; if (close < today || byId.has(String(h.id))) continue;
        const op = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(h.openDate ?? "")), opened = op ? `${op[3]}-${op[1]}-${op[2]}` : "";
        byId.set(String(h.id), { id: "g" + sha("grant" + h.id).slice(0, 11), k: "funding", sub: "Federal grant", t: clip(String(h.title).replace(/\s+/g, " "), 160), d: close, ad: 1, o: clip(h.agencyName ?? h.agencyCode ?? "", 80), u: `https://www.grants.gov/search-results-detail/${encodeURIComponent(h.id)}`, m: clip(`Closing date for applications. Opportunity ${h.number ?? ""}${opened ? `, open since ${opened}` : ""}${h.oppStatus ? `, ${h.oppStatus}` : ""}.`.replace(/Opportunity ,/, "Opportunity"), 300) });
      }
    }
  } catch (e) { return { at, ok: false, note: e.message, n: prev?.events?.length ?? 0, events: prev?.events ?? [] }; }
  const events = [...byId.values()].slice(0, c.max ?? 80);
  return { at, ok: true, n: events.length, events };
}

/** One calendar feed. Returns { at, ok, n, events }. */
async function collectFeed(ctx, feed, prev) {
  const at = new Date(ctx.now).toISOString();
  try {
    const res = await fetch(feed.url, { headers: { ...UA, accept: "text/calendar, text/plain, */*" }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text(); if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not a calendar file");
    const events = [];
    for (const x of parseIcs(text).slice(0, 600)) {
      if (x.cancelled) continue;
      const ev = { id: "f" + sha(`${feed.url}|${x.uid ?? x.t}|${x.d}`).slice(0, 11), k: "event", t: clip(x.t, 160), d: x.d, o: feed.name.slice(0, 80) };
      if (x.ad) ev.ad = 1; if (x.e) ev.e = x.e;
      const u = httpsUrl(x.u || (x.m ?? "").match(/https?:\/\/[^\s<>"')]+/)?.[0] || "", 500, true); if (u) ev.u = u;
      if (x.loc) ev.loc = clip(x.loc, 120); if (x.m) ev.m = clip(x.m.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim(), 300);
      if (!ev.m) delete ev.m;
      if (cleanEvent({ ...ev, id: ev.id }, false)) events.push(ev);
    }
    return { at, ok: true, n: events.length, events };
  } catch (e) { return { at, ok: false, note: e.message, n: prev?.events?.length ?? 0, events: prev?.events ?? [] }; }
}

// ---------------------------------------------------------------- putting it together
/** The events the page shows: collected ones the owner has not hidden, plus the owner's own; only what is current; one entry for the same title on the same day. */
// ---------------------------------------------------------------- dates the site keeps itself
const okDay = s => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = Date.parse(s + "T00:00:00Z"); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const okMd = (y, md) => typeof md === "string" && /^\d{2}-\d{2}$/.test(md) && okDay(`${y}-${md}`);
const okId = s => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
const okHttps = u => typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u) && u.length <= 500;
/** Observances (a month, a day, a movable holiday) and anniversaries (a day each year; nth counts the years since y), from observances.json. */
export function observanceEvents(items, lo, hi, hubsOf = () => []) {
  const out = [], y0 = new Date(lo).getUTCFullYear(), y1 = new Date(hi).getUTCFullYear();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object" || !okId(it.id) || !["observance", "anniversary"].includes(it.k) || typeof it.t !== "string" || !it.t.trim() || !okHttps(it.u)) continue;
    const anniv = it.k === "anniversary"; if (anniv && !(Number.isInteger(it.y) && it.y > 1500 && it.y < 2200)) continue;
    for (let Y = y0; Y <= y1; Y++) {
      let d = "", e = "";
      if (it.dates && typeof it.dates === "object") { const v = it.dates[String(Y)]; if (!okDay(v)) continue; d = v; }
      else { if (!okMd(Y, it.md)) continue; d = `${Y}-${it.md}`; if (it.to) { if (!okMd(Y, it.to) || it.to < it.md) continue; e = `${Y}-${it.to}`; } }
      const nth = anniv ? Y - it.y : 0; if (anniv && nth < 1) continue;
      const ev = { id: `${anniv ? "ann" : "obs"}-${it.id}-${Y}`, k: it.k, t: clip(it.t, 120), d, ...(e ? { e } : {}), ad: 1, ...(anniv ? { nth, yr: it.y, ...(nth >= 5 && nth % 5 === 0 ? { mile: 1 } : {}) } : {}), ...(it.o ? { o: clip(it.o, 80) } : {}), u: it.u, ...(it.m ? { m: clip(it.m, 300) } : {}), ...(Array.isArray(it.c) && it.c.length ? { c: it.c.filter(x => typeof x === "string" && /^[A-Z]{2,4}$/.test(x)).slice(0, 8) } : {}), sys: 1 };
      const hb = hubsOf([ev.t, ev.m].join(" ")); if (hb.length) ev.hb = hb;
      if (endMs(ev) < lo || startMs(ev) > hi) continue;
      out.push(ev);
    }
  }
  return out;
}
/** Open comment periods from the Policy tracker: items in feed.json that carry a deadline (dl). */
export function commentEvents(feedItems, lo, hi, hubsOf = () => []) {
  const out = [];
  for (const it of Array.isArray(feedItems) ? feedItems : []) {
    if (!it || typeof it.h !== "string" || !okDay(it.dl) || !okHttps(it.u)) continue;
    const ev = { id: "cmt-" + sha(it.u).slice(0, 12), k: "comment", t: clip(it.h, 160), d: it.dl, ad: 1, ...(it.ag ? { o: clip(it.ag, 80) } : {}), ...(it.ty ? { sub: clip(it.ty, 40) } : {}), u: it.u, ...(it.m ? { m: clip(it.m, 300) } : {}), sys: 1 };
    const hb = hubsOf([ev.t, ev.m, ev.o].join(" ")); if (hb.length) ev.hb = hb;
    if (endMs(ev) < lo || startMs(ev) > hi) continue;
    out.push(ev);
  }
  return out;
}
/** Voting and election dates from elections.json ("dates"). */
export function electionEvents(dates, lo, hi, hubsOf = () => []) {
  const out = [];
  for (const it of Array.isArray(dates) ? dates : []) {
    if (!it || typeof it !== "object" || !okId(it.id) || typeof it.t !== "string" || !it.t.trim() || !okDay(it.d) || (it.e && (!okDay(it.e) || it.e < it.d)) || !okHttps(it.u)) continue;
    const ev = { id: "el-" + it.id, k: "election", t: clip(it.t, 120), d: it.d, ...(it.e ? { e: it.e } : {}), ad: 1, ...(it.o ? { o: clip(it.o, 80) } : {}), u: it.u, ...(it.n ? { m: clip(it.n, 300) } : {}), ...(Array.isArray(it.st) && it.st.length ? { st: it.st.filter(x => typeof x === "string" && /^[A-Z]{2}$/.test(x)).slice(0, 60) } : {}), sys: 1 };
    const hb = hubsOf([ev.t, ev.m].join(" ")); if (hb.length) ev.hb = hb;
    if (endMs(ev) < lo || startMs(ev) > hi) continue;
    out.push(ev);
  }
  return out;
}

export function mergeEvents({ own = [], auto = [], sys = [], off = [], now = Date.now(), keepPastDays = 7, aheadDays = 400, max = 800, maxSpanDays = 0, hubsOf = () => [], rename = t => t }) {
  const hide = new Set(off), lo = now - keepPastDays * DAY, hi = now + aheadDays * DAY, seen = new Set(), out = [];
  for (const [ev, mine, ours] of [...own.map(e => [e, true, false]), ...auto.filter(e => !hide.has(e.id)).map(e => [e, false, false]), ...sys.filter(e => !hide.has(e.id)).map(e => [e, false, true])]) {
    const c = ours ? ev : cleanEvent(ev, false); if (!c || !c.id) continue;
    if (endMs(c) < lo || (startMs(c) > hi && c.k !== "election")) continue; // voting dates are listed by the editors, so none is cut off by the look-ahead window
    if (!mine && maxSpanDays > 0 && c.k === "event" && (endMs(c) - startMs(c)) / DAY > maxSpanDays) continue; // a museum exhibition that runs for months is not something to attend on a day
    const key = normTitle(c.t) + dayOf(c); if (seen.has(key)) continue; seen.add(key);
    const hb = hubsOf([c.t, c.o, c.m, c.sub].join(" "));
    const t = mine ? c.t : rename(c.t); // a collected event can carry a new title the owner gave it; the owner's own events are edited directly
    out.push(ours ? (t === c.t ? c : { ...c, t }) : { ...c, t, ...(hb.length ? { hb } : {}), ...(mine ? { own: 1 } : {}) });
  }
  return out.sort((a, b) => startMs(a) - startMs(b) || a.t.localeCompare(b.t)).slice(0, max);
}

export async function main(env = process.env, now = env.EVENTS_NOW ? Date.parse(env.EVENTS_NOW) : Date.now()) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const SRC = env.SOURCES ?? join(root, "sources.json"), OUT = env.EVENTS_OUT ?? join(root, "data/events.json"), CACHE = env.EVENTS_CACHE ?? join(dirname(OUT), "events-cache.json"), ICS = env.EVENTS_ICS ?? join(dirname(OUT), "events.ics");
  const cfgAll = JSON.parse(await readFile(SRC, "utf8")), cfg = cfgAll.events ?? {};
  const ADMIN_DIR = env.ADMIN_DIR || join(root, "data");
  if (env.ADMIN_DIR && !(await stat(ADMIN_DIR).then(x => x.isDirectory(), () => false))) { console.error(`ADMIN_DIR (${ADMIN_DIR}) is not a folder; events are left as they were so the owner's decisions are not skipped.`); return 1; }
  let A = normalizeState(null);
  try { A = normalizeState(JSON.parse(await readFile(join(ADMIN_DIR, "admin.json"), "utf8"))); }
  catch (e) { if (e.code !== "ENOENT") { console.error("admin.json cannot be read (" + e.message + "); events are left as they were."); return 1; } }
  let starterHubs = []; try { starterHubs = JSON.parse(await readFile(env.HUBS ?? join(root, "hubs.json"), "utf8")).hubs ?? []; } catch { /* none */ }
  const hubsOf = hubTagger(hubList(starterHubs, A.settings));
  let cache = { v: 1, hearings: null, grants: null, feeds: {} }; try { const j = JSON.parse(await readFile(CACHE, "utf8")); if (j && typeof j === "object") cache = { v: 1, hearings: j.hearings ?? null, grants: j.grants ?? null, feeds: j.feeds ?? {} }; } catch { /* first run */ }
  const key = env.API_DATA_GOV_KEY || env.CONGRESS_API_KEY || "", force = /^(1|true|yes)$/i.test(env.EVENTS_FORCE ?? "");
  const kinds = cfgAll.kinds ?? {}, advocacy = Object.keys(kinds).filter(n => kinds[n] === "statement").map(normTitle).filter(n => n.length >= 6);
  let community; try { community = new RegExp(cfgAll.communityPattern ?? "(?!)", "i"); } catch { community = /(?!)/; }
  const ctx = { env, cfg, now, key, hubsOf, advocacy, community };
  const due = (st, mins) => force || !st?.at || now - Date.parse(st.at) >= mins * MIN || now < Date.parse(st.at);
  const status = {};
  // hearings
  if (cfg.hearings?.enabled !== false) {
    if (due(cache.hearings, cfg.hearings?.everyMinutes ?? 120) || (!key && !/skipped/.test(cache.hearings?.note ?? ""))) cache.hearings = await collectHearings(ctx, cache.hearings);
    const h = cache.hearings; status.hearings = { ok: !!h?.ok, at: h?.at, n: h?.n ?? 0, ...(h?.note ? { note: h.note } : {}) };
  }
  // grants
  if (cfg.grants?.enabled !== false) {
    if (due(cache.grants, cfg.grants?.everyMinutes ?? 360)) cache.grants = await collectGrants(ctx, cache.grants);
    const g = cache.grants; status.grants = { ok: !!g?.ok, at: g?.at, n: g?.n ?? 0, ...(g?.note ? { note: g.note } : {}) };
  }
  // calendar feeds: the starter ones (minus those the owner stopped following) and the owner's own
  const offF = new Set(A.settings.eventFeedsOff), feeds = [];
  for (const f of cfg.feeds ?? []) { const c = f && cleanFeed(f, false); if (c && !offF.has(c.url) && !feeds.some(x => x.url === c.url)) feeds.push({ ...c, starter: true }); }
  for (const f of A.settings.eventFeeds) if (!feeds.some(x => x.url === f.url)) feeds.push(f);
  const nextFeeds = {}; status.feeds = [];
  for (const f of feeds) {
    let st = cache.feeds[f.url];
    if (due(st, cfg.feedsEveryMinutes ?? 60) || (st && !st.ok && now - Date.parse(st.at) >= 10 * MIN)) st = await collectFeed(ctx, f, st);
    nextFeeds[f.url] = st; status.feeds.push({ name: f.name, url: f.url, ok: !!st?.ok, at: st?.at, n: st?.n ?? 0, ...(st?.note ? { note: st.note } : {}), ...(f.starter ? { starter: 1 } : {}) });
  }
  cache.feeds = nextFeeds;
  const auto = [...Object.values(cache.hearings?.seen ?? {}).map(x => x.ev).filter(Boolean), ...(cache.grants?.events ?? []), ...Object.values(nextFeeds).flatMap(x => x?.events ?? [])];
  // dates the site keeps itself: observances and anniversaries (observances.json), election dates (elections.json) and open comment periods (the Policy tracker in feed.json)
  const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") console.error(`${file}: ${e.message}`); return fallback; } };
  const lo = now - (cfg.keepPastDays ?? 7) * DAY, hi = now + (cfg.aheadDays ?? 400) * DAY;
  const obsJ = await readJson(env.OBSERVANCES ?? join(root, "observances.json"), {}), elJ = await readJson(env.ELECTIONS ?? join(root, "elections.json"), {}), feedJ = await readJson(env.FEED ?? join(dirname(OUT), "feed.json"), {});
  const sysObs = observanceEvents(obsJ.items, lo, hi, hubsOf), sysEl = electionEvents(elJ.dates, lo, Infinity, hubsOf), sysCmt = commentEvents((feedJ.items ?? []).filter(x => x && x.dl), lo, hi, hubsOf);
  status.dates = { observances: sysObs.length, elections: sysEl.length, comments: sysCmt.length };
  const EVN = renameMap(A.settings.names.events); // new titles the owner gave to collected events (by the title they were collected with)
  const events = mergeEvents({ own: A.settings.events, auto, sys: [...sysEl, ...sysCmt, ...sysObs], off: A.settings.eventsOff.map(x => x.id), now, keepPastDays: cfg.keepPastDays ?? 7, aheadDays: cfg.aheadDays ?? 400, max: cfg.max ?? 1200, maxSpanDays: cfg.maxSpanDays ?? 21, hubsOf , rename: EVN.size ? t => renamedTo(EVN, t) : undefined });
  const hidden = auto.filter(e => A.settings.eventsOff.some(x => x.id === e.id)).length;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache));
  await writeFile(OUT, JSON.stringify({ generated: new Date(now).toISOString(), status, events }));
  await writeFile(ICS, eventsIcs(events, now));
  const up = events.filter(e => endMs(e) >= now).length;
  console.log(`Events: ${events.length} listed (${up} upcoming; ${events.filter(e => e.own).length} typed by the owner; ${hidden} hidden by the owner). Observances and anniversaries ${sysObs.length}, election dates ${sysEl.length}, comment deadlines ${sysCmt.length}. Hearings ${status.hearings ? (status.hearings.ok ? "ok" : status.hearings.note) : "off"}, grants ${status.grants ? (status.grants.ok ? "ok" : status.grants.note) : "off"}, ${status.feeds.filter(f => f.ok).length} of ${status.feeds.length} calendar feeds ok.`);
  for (const f of status.feeds) if (!f.ok) console.log(`  calendar feed "${f.name}": ${f.note}`);
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(c => { process.exitCode = c; }, e => { console.error(e); process.exitCode = 1; });
