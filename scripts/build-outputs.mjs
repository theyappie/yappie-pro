// Builds what is made from data/feed.json: the page's own copies of the feed (data/latest.json and data/archive/), RSS per filter, a calendar of comment deadlines (.ics), and data/rss/index.json.
// Usage: node scripts/build-outputs.mjs   (SITE_URL overrides "siteUrl" in sources.json; links in feeds always go to the original story)
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withFeedTaxo } from "./admin.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FEED = process.env.OUT ?? join(ROOT, "data/feed.json");
const tax0 = JSON.parse(await readFile(join(ROOT, "taxonomy.json"), "utf8"));
const cfg = JSON.parse(await readFile(process.env.SOURCES ?? join(ROOT, "sources.json"), "utf8"));
const feed = JSON.parse(await readFile(FEED, "utf8"));
const tax = withFeedTaxo(tax0, feed.taxo); // plus the owner's own topics, communities and News categories (names only)
const SITE = (process.env.SITE_URL || cfg.siteUrl || "").replace(/\/$/, ""), RSS_MAX = cfg.rssMax ?? 50; // "rssMax": how many of the newest stories each RSS feed lists
const items = feed.items ?? [], stamp = new Date(feed.generated ?? Date.now());
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = s => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const label = { topic: Object.fromEntries(tax.topics.map(t => [t.k, t.label])), community: Object.fromEntries(tax.communities.map(c => [c.k, c.label])), state: Object.fromEntries(tax.states.map(([k, l]) => [k, l])), kind: tax.kinds };

// A feed's lastBuildDate is the date of its newest story, not the time of this run, so a file whose stories did not change is byte for byte the same and is not committed again (each commit adds to the repository's size for good).
const built = list => { const t = list.slice(0, RSS_MAX).reduce((m, x) => Math.max(m, Date.parse(x.d) || 0), 0); return t ? new Date(t) : stamp; };
function rss(title, desc, list) {
  const row = x => `<item><title>${esc(x.h)}</title><link>${esc(x.u)}</link><guid isPermaLink="true">${esc(x.u)}</guid><pubDate>${new Date(x.d).toUTCString()}</pubDate>${[x.t, ...(x.tx ?? [])].map(t => `<category>${esc(label.topic[t] ?? t)}</category>`).join("")}<description>${esc([x.s, x.dl ? "Comments due " + x.dl : "", x.m].filter(Boolean).join(" · "))}</description></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(SITE || "https://theyappie.com")}</link><description>${esc(desc)}</description><language>en-us</language><lastBuildDate>${built(list).toUTCString()}</lastBuildDate>${list.slice(0, RSS_MAX).map(row).join("")}</channel></rss>\n`;
}
const out = new Map(), index = [];
const add = (file, title, desc, list, group) => { if (!list.length) return; out.set(file, rss(title, desc, list)); index.push({ file: "rss/" + file, title, group, count: list.length }); };
// A caucus's press release on a .gov address is stored twice: as a statement (Advocacy) and as a government statement (Policy). A feed that mixes the two kinds (all stories, a topic, a community, a state)
// lists it once, as the statement; the feeds of one kind ("kind-govstmt.xml", "policy.xml") still have their own copy.
const stmtLinks = new Set(items.filter(x => x.k === "statement").map(x => x.u)), once = list => list.filter(x => !(x.k === "govstmt" && stmtLinks.has(x.u)));
const by = (fn) => items.filter(fn);
add("all.xml", "The Yappie Pro: all stories", "Every story in the index, newest first.", once(items), "all");
for (const t of tax.topics) add(`topic-${slug(t.k)}.xml`, `The Yappie Pro: ${t.label}`, `${t.label} stories.`, once(by(x => x.t === t.k || x.tx?.includes(t.k))), "topic");
for (const c of tax.communities) add(`community-${slug(c.k)}.xml`, `The Yappie Pro: ${c.label}`, `Stories mentioning ${c.label} communities.`, once(by(x => x.cm?.includes(c.k))), "community");
for (const [k, l] of tax.states) add(`state-${slug(k)}.xml`, `The Yappie Pro: ${l}`, `Stories mentioning ${l}.`, once(by(x => x.st?.includes(k))), "state");
for (const [k, l] of Object.entries(tax.kinds)) add(`kind-${slug(k)}.xml`, `The Yappie Pro: ${l}`, `${l} items only.`, by(x => x.k === k), "kind");
const POLK = new Set(tax.policyKinds ?? []);

// The page's copies of the feed. data/feed.json holds every story since "keepFrom" (several megabytes), and a visitor used to download all of it before seeing a single headline.
// data/latest.json is what the page needs first: the last "latestDays" days (14), every bill, rule, order and hearing (the Policy tracker lists those in full), research, and whatever is featured or marked breaking.
// Everything else is in data/archive/<year>-<month>.json, which the page reads afterwards, in the background. "older" in latest.json lists those files with a short fingerprint of each,
// so the page asks for a month again only when something in it changed. The cut between the two moves once a day (at midnight UTC), not on every run, so a month's file changes at most daily.
const DATA = dirname(FEED), LATEST_DAYS = Number.isFinite(cfg.latestDays) && cfg.latestDays >= 1 ? cfg.latestDays : 14;
const cut = new Date(Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate()) - LATEST_DAYS * 864e5).toISOString(), nowIso = stamp.toISOString();
const first = x => String(x.d) >= cut || (POLK.has(x.k) && x.k !== "govstmt") || x.k === "research" || !!x.v || !!x.fe || (typeof x.bu === "string" && x.bu > nowIso); // "v": a story that is read on this site (a link to it must open at once)
const latest = [], months = new Map();
for (const x of items) { if (first(x)) { latest.push(x); continue; } const m = /^\d{4}-\d{2}/.exec(String(x.d))?.[0] ?? "0000-00"; if (!months.has(m)) months.set(m, []); months.get(m).push(x); }
const sameAs = async (file, text) => { try { return (await readFile(file, "utf8")) === text; } catch { return false; } };
const adir = join(DATA, "archive"), older = [];
await mkdir(adir, { recursive: true });
for (const [m, list] of [...months].sort((a, b) => b[0].localeCompare(a[0]))) {
  const text = JSON.stringify({ items: list }), file = join(adir, m + ".json");
  if (!(await sameAs(file, text))) await writeFile(file, text);
  older.push({ m, n: list.length, v: createHash("sha1").update(text).digest("hex").slice(0, 10) });
}
for (const f of await readdir(adir)) if (f.endsWith(".json") && !months.has(f.slice(0, -5))) await unlink(join(adir, f));
// latest.json is the file every open page asks for again every ten minutes. It changes only when what a reader sees changes: the stories, or the list of sources (their names, sites and kinds).
// Whether each source's last read worked is left out (it flips on most runs; feed.json has it), and "generated" stays what it was while nothing else differs. In the 24 hours to 21 Nov 2026, 13:20 UTC,
// 137 runs changed this file, and so made every open page download it again; in 76 of them not one story was different.
{ const file = join(DATA, "latest.json"), rows = (Array.isArray(feed.sources) ? feed.sources : []).filter(s => s && typeof s === "object").map(({ name, home, kind }) => ({ name, home, kind }));
  const make = generated => JSON.stringify({ ...feed, generated, sources: rows, items: latest, older });
  let before = "", was; try { before = await readFile(file, "utf8"); was = JSON.parse(before).generated; } catch { /* no file yet, or one that cannot be read: it is written anew */ }
  if (!(typeof was === "string" && was && make(was) === before)) await writeFile(file, make(feed.generated)); }

add("policy.xml", "The Yappie Pro: policy tracker", "Bills, rules, executive actions, hearings and government statements from .gov sources.", by(x => POLK.has(x.k)), "kind");
// A deadline is an Eastern-time day (comment periods close at 11:59 p.m. Eastern), and it must be a real day: one item with a date like 2026-13-45 used to stop this whole step.
const isDay = s => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(stamp);
const dl = by(x => isDay(x.dl) && x.dl >= todayET).sort((a, b) => a.dl.localeCompare(b.dl) || String(a.id).localeCompare(String(b.id))); // only what is still open: the year's closed comment periods stay on the Policy page but are not a to-do list
add("deadlines.xml", "The Yappie Pro: comment deadlines", "Federal Register items open for public comment, soonest deadline first.", dl, "deadlines");

const dir = join(DATA, "rss"); await mkdir(dir, { recursive: true }); // next to the feed file, like everything else this step writes
for (const [f, x] of out) if (!(await sameAs(join(dir, f), x))) await writeFile(join(dir, f), x);
for (const f of await readdir(dir)) if (f.endsWith(".xml") && !out.has(f)) await unlink(join(dir, f));
{ const text = JSON.stringify(index); if (!(await sameAs(join(dir, "index.json"), text))) await writeFile(join(dir, "index.json"), text); }

// Calendar of comment deadlines (all-day events). Subscribe to the raw file URL in Outlook / Google Calendar / Apple Calendar.
const halfPair = (s, n) => n > 0 && n < s.length && /[\ud800-\udbff]/.test(s[n - 1]) && /[\udc00-\udfff]/.test(s[n]); // cutting here would split one character (an emoji) into two broken halves
const fold = l => { const b = Buffer.from(l); if (b.length <= 74) return l; const parts = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; if (halfPair(s, n)) n--; parts.push(s.slice(0, n)); s = " " + s.slice(n); } parts.push(s); return parts.join("\r\n"); };
const ics = t => String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = d => d.replace(/-/g, ""), next = d => new Date(new Date(d + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10).replace(/-/g, "");
const zOf = d => new Date(Date.parse(d) || stamp).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); // DTSTAMP is the story's own date, for the same reason
const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Yappie Pro//Comment deadlines//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:AAPI comment deadlines"];
for (const x of dl) lines.push("BEGIN:VEVENT", `UID:${x.id}@yappie-pro`, `DTSTAMP:${zOf(x.d)}`, `DTSTART;VALUE=DATE:${ymd(x.dl)}`, `DTEND;VALUE=DATE:${next(x.dl)}`, `SUMMARY:${ics("Comments due: " + x.h)}`, `URL:${x.u}`, `DESCRIPTION:${ics([x.ty, x.ag, x.m].filter(Boolean).join(" | ") + "\n" + x.u)}`, "END:VEVENT");
lines.push("END:VCALENDAR");
{ const text = lines.map(fold).join("\r\n") + "\r\n", file = join(DATA, "deadlines.ics"); if (!(await sameAs(file, text))) await writeFile(file, text); }
console.log(`Wrote ${out.size} RSS feeds and ${dl.length} calendar events; the page's first file has ${latest.length} of ${items.length} stories, and ${older.length} month files hold the rest.`);
