// Election results: reads the Associated Press race calls someone has entered (a published Google Sheet, and/or the file results-calls.csv) and writes data/results.json for the /results page.
// Usage: node scripts/results.mjs        Settings: "results": { "csv": "<published-sheet CSV address>" } in sources.json; RESULTS_CSV_URL overrides it. Nothing is needed for the page to work: with no calls every candidate shows "Awaiting AP call".
// The sheet needs the columns: id, call, time, link (extra columns are ignored; the template lists name, state and office to make entering easy).
//   call: won | lost | runoff | recount (blank or "pending" = no call yet).   time: when AP called it, e.g. 2026-11-03 21:41 ET (ET by default; CT, MT, PT, AKT, HT, UTC or an ISO time with Z also work).   link: an apnews.com address (optional).
// Safety: unknown ids, calls it does not understand, times that are in the future or before polls opened, and a second winner in a one-seat race are skipped and reported; an unreadable sheet leaves the published file as it was.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROOT ?? fileURLToPath(new URL("..", import.meta.url));
const UA = "TheYappiePro/1.0 (open-source news index)";
const OPENED = Date.parse("2026-11-03T00:00:00-05:00"); // nothing can be called before election day
const warn = m => console.warn(`::warning::results: ${m}`);

/** A CSV file as rows of cells (quotes, doubled quotes, CRLF and a leading byte-order mark are handled). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false; text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

const CALL = { won: "won", win: "won", w: "won", winner: "won", x: "won", lost: "lost", lose: "lost", l: "lost", loss: "lost", loser: "lost", runoff: "runoff", "run-off": "runoff", r: "runoff", "advances to runoff": "runoff", recount: "recount" };
const PENDING = new Set(["", "pending", "tbd", "-", "n/a", "none", "awaiting", "not called"]);
const ZONES = { ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles", AKT: "America/Anchorage", HT: "Pacific/Honolulu", UTC: "UTC", GMT: "UTC", Z: "UTC" };
const FIXED = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10, HAST: -10 };

const offsetAt = (zone, ms) => { // how far the zone's clock is ahead of UTC at this moment, in ms
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
};

/** When AP called a race, as an ISO UTC time; "" when blank; null when it cannot be read. */
export function parseTime(raw) {
  const s = String(raw ?? "").trim(); if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.000Z$/, "Z"); }
  const m = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*([A-Za-z]{1,4})?$/.exec(s);
  if (!m) return null;
  const y = +(m[1] ?? m[6]), mo = +(m[2] ?? m[4]), d = +(m[3] ?? m[5]); let h = +m[7]; const mi = +m[8], se = +(m[9] ?? 0), ap = m[10]?.toLowerCase(), z = (m[11] ?? "ET").toUpperCase();
  if (ap) { if (h < 1 || h > 12) return null; h = h % 12 + (ap === "pm" ? 12 : 0); }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, se); if (new Date(wall).getUTCMonth() !== mo - 1) return null; // 31 November and the like
  let utc;
  if (z in FIXED) utc = wall - FIXED[z] * 36e5;
  else if (z in ZONES) { utc = wall - offsetAt(ZONES[z], wall); utc = wall - offsetAt(ZONES[z], utc); }
  else return null;
  return new Date(utc).toISOString().replace(/\.000Z$/, "Z");
}

const apLink = u => { try { const x = new URL(String(u).trim()); return x.protocol === "https:" && /(^|\.)(apnews\.com|ap\.org)$/i.test(x.hostname) ? x.href : ""; } catch { return ""; } };

/** Rows (with a header) -> { calls: Map(id -> { r, t, u }), problems: [text] }. cand: Map(id -> candidate). */
export function readCalls(rows, cand, now = Date.now()) {
  const problems = [], calls = new Map(); if (!rows.length) return { calls, problems, header: false };
  const key = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const col = (...names) => { const h = rows[0].map(key); for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const ci = col("id"), cc = col("call", "apcall", "result", "apracecall", "racecall"), ct = col("time", "calledat", "timeet", "calltime", "apcalltime"), cl = col("link", "aplink", "apurl", "url");
  if (ci < 0 || cc < 0) return { calls, problems: ["the header row needs at least the columns id and call"], header: false };
  rows.slice(1).forEach((r, n) => {
    const where = `row ${n + 2}`, id = String(r[ci] ?? "").trim(); if (!id) return;
    const word = String(r[cc] ?? "").trim().toLowerCase(); if (PENDING.has(word)) return;
    if (!cand.has(id)) { problems.push(`${where}: unknown id "${id}", skipped`); return; }
    const call = CALL[word]; if (!call) { problems.push(`${where} (${id}): "${r[cc]}" is not won, lost, runoff or recount, skipped`); return; }
    let t = parseTime(r[ct]);
    if (t === null) { problems.push(`${where} (${id}): the time "${r[ct]}" could not be read, skipped (use e.g. 2026-11-03 21:41 ET)`); return; }
    if (t && (Date.parse(t) > now + 10 * 6e4 || Date.parse(t) < OPENED)) { problems.push(`${where} (${id}): the time ${t} is in the future or before election day, skipped`); return; }
    let u = ""; if (cl >= 0 && String(r[cl] ?? "").trim()) { u = apLink(r[cl]); if (!u) problems.push(`${where} (${id}): the link is not an apnews.com address, link dropped`); }
    calls.set(id, { r: call, ...(t ? { t } : {}), ...(u ? { u } : {}) });
  });
  // a one-seat race for Congress or a statewide office has one winner: keep the earliest, report the rest
  const race = id => { const c = cand.get(id); return c.lv + "|" + c.s + "|" + c.o; }, wins = new Map();
  for (const [id, v] of calls) if (v.r === "won") (wins.get(race(id)) ?? wins.set(race(id), []).get(race(id))).push(id);
  for (const [k, ids] of wins) {
    const c = cand.get(ids[0]), seats = c.seats ?? 1; if (ids.length <= seats) continue;
    if (c.lv === "legislature") { problems.push(`${c.o}, ${c.s}: ${ids.length} winners entered (${ids.join(", ")}) for ${seats} seat(s); check the seat count`); continue; }
    ids.sort((a, b) => (calls.get(a).t ?? "~").localeCompare(calls.get(b).t ?? "~") || a.localeCompare(b));
    for (const id of ids.slice(seats)) { calls.delete(id); problems.push(`${c.o}, ${c.s}: two winners entered; kept ${ids[0]}, dropped ${id}`); }
  }
  return { calls, problems, header: true };
}

/** The file the page reads. Deterministic: it changes only when a call changes. */
export function buildDoc(calls) {
  const ids = [...calls.keys()].sort(), out = {};
  for (const id of ids) out[id] = calls.get(id);
  const times = ids.map(i => calls.get(i).t).filter(Boolean).sort();
  return { v: 1, updated: times.at(-1) ?? "", n: ids.length, calls: out };
}

async function fetchSheet(url) {
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) throw new Error("the sheet address must start with https://");
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const t = await r.text();
  if (/^\s*<(!doctype|html)/i.test(t)) throw new Error("the address returned a web page, not CSV (is the sheet published to the web as CSV?)");
  return t;
}

export async function run() {
  const OUT = process.env.OUT ?? join(ROOT, "data/results.json");
  if (!existsSync(join(ROOT, "candidates.json"))) { console.log("results: no candidates.json, nothing to do."); return; }
  const cj = JSON.parse(await readFile(join(ROOT, "candidates.json"), "utf8")), cand = new Map((cj.candidates ?? []).map(c => [c.id, c]));
  const cfg = existsSync(join(ROOT, "sources.json")) ? JSON.parse(await readFile(join(ROOT, "sources.json"), "utf8")) : {};
  const url = (process.env.RESULTS_CSV_URL || cfg.results?.csv || "").trim(), file = join(ROOT, "results-calls.csv");
  let prev = null; try { prev = JSON.parse(await readFile(OUT, "utf8")); } catch { /* none yet */ }
  const merged = new Map(), problems = []; let used = 0, now = () => process.env.RESULTS_NOW ? Date.parse(process.env.RESULTS_NOW) : Date.now(); // RESULTS_NOW is for tests
  const take = (label, text) => { const r = readCalls(parseCsv(text), cand, now()); if (!r.header) { problems.push(`${label}: ${r.problems[0] ?? "empty"}`); return false; } for (const [k, v] of r.calls) merged.set(k, v); problems.push(...r.problems.map(p => `${label}: ${p}`)); used++; return true; };
  if (existsSync(file)) take("results-calls.csv", await readFile(file, "utf8"));
  if (url) {
    let ok = false; try { ok = take("sheet", await fetchSheet(url)); } catch (e) { problems.push("sheet: " + (e.message ?? e)); }
    if (!ok) { problems.forEach(warn); console.log("results: the sheet could not be read, so the published results were left as they are."); if (prev) return; }
  }
  problems.forEach(warn);
  if (prev?.n > 0 && merged.size === 0 && !process.env.RESULTS_ALLOW_EMPTY) { warn(`the sources hold no calls but ${prev.n} are published; left as they are (set RESULTS_ALLOW_EMPTY=1 to clear them)`); return; }
  const text = JSON.stringify(buildDoc(merged));
  let old = ""; try { old = await readFile(OUT, "utf8"); } catch { /* none yet */ }
  if (old === text) { console.log(`results: ${merged.size} calls, no change.`); return; }
  await mkdir(dirname(OUT), { recursive: true }); await writeFile(OUT, text);
  console.log(`results: ${merged.size} calls from ${used} source(s) written to ${OUT}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await run();
