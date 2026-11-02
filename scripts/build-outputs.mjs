// Builds subscription outputs from data/feed.json: RSS per filter, a calendar of comment deadlines (.ics), and data/rss/index.json.
// Usage: node scripts/build-outputs.mjs   (SITE_URL overrides "siteUrl" in sources.json; links in feeds always go to the original story)
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withFeedTaxo } from "./admin.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FEED = process.env.OUT ?? join(ROOT, "data/feed.json");
const tax0 = JSON.parse(await readFile(join(ROOT, "taxonomy.json"), "utf8"));
const cfg = JSON.parse(await readFile(process.env.SOURCES ?? join(ROOT, "sources.json"), "utf8"));
const feed = JSON.parse(await readFile(FEED, "utf8"));
const tax = withFeedTaxo(tax0, feed.taxo); // plus the owner's own topics, communities and News categories (names only)
const SITE = (process.env.SITE_URL ?? cfg.siteUrl ?? "").replace(/\/$/, "");
const items = feed.items ?? [], stamp = new Date(feed.generated ?? Date.now());
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const label = { topic: Object.fromEntries(tax.topics.map(t => [t.k, t.label])), community: Object.fromEntries(tax.communities.map(c => [c.k, c.label])), state: Object.fromEntries(tax.states.map(([k, l]) => [k, l])), kind: tax.kinds };

function rss(title, desc, list) {
  const row = x => `<item><title>${esc(x.h)}</title><link>${esc(x.u)}</link><guid isPermaLink="true">${esc(x.u)}</guid><pubDate>${new Date(x.d).toUTCString()}</pubDate>${[x.t, ...(x.tx ?? [])].map(t => `<category>${esc(label.topic[t] ?? t)}</category>`).join("")}<description>${esc([x.s, x.dl ? "Comments due " + x.dl : "", x.m].filter(Boolean).join(" · "))}</description></item>`;
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(SITE || "https://theyappie.com")}</link><description>${esc(desc)}</description><language>en-us</language><lastBuildDate>${stamp.toUTCString()}</lastBuildDate>${list.slice(0, 50).map(row).join("")}</channel></rss>\n`;
}
const out = new Map(), index = [];
const add = (file, title, desc, list, group) => { if (!list.length) return; out.set(file, rss(title, desc, list)); index.push({ file: "rss/" + file, title, group, count: list.length }); };
const by = (fn) => items.filter(fn);
add("all.xml", "The Yappie Pro: all stories", "Every story in the index, newest first.", items, "all");
for (const t of tax.topics) add(`topic-${slug(t.k)}.xml`, `The Yappie Pro: ${t.label}`, `${t.label} stories.`, by(x => x.t === t.k || x.tx?.includes(t.k)), "topic");
for (const c of tax.communities) add(`community-${slug(c.k)}.xml`, `The Yappie Pro: ${c.label}`, `Stories mentioning ${c.label} communities.`, by(x => x.cm?.includes(c.k)), "community");
for (const [k, l] of tax.states) add(`state-${slug(k)}.xml`, `The Yappie Pro: ${l}`, `Stories mentioning ${l}.`, by(x => x.st?.includes(k)), "state");
for (const [k, l] of Object.entries(tax.kinds)) add(`kind-${slug(k)}.xml`, `The Yappie Pro: ${l}`, `${l} items only.`, by(x => x.k === k), "kind");
const POLK = new Set(tax.policyKinds ?? []);
add("policy.xml", "The Yappie Pro: policy tracker", "Bills, rules, executive actions, hearings and government statements from .gov sources.", by(x => POLK.has(x.k)), "kind");
const dl = by(x => x.dl).sort((a, b) => a.dl.localeCompare(b.dl));
add("deadlines.xml", "The Yappie Pro: comment deadlines", "Federal Register items open for public comment, soonest deadline first.", dl, "deadlines");

const dir = join(ROOT, "data/rss"); await mkdir(dir, { recursive: true });
for (const [f, x] of out) await writeFile(join(dir, f), x);
for (const f of await readdir(dir)) if (f.endsWith(".xml") && !out.has(f)) await unlink(join(dir, f));
await writeFile(join(dir, "index.json"), JSON.stringify(index));

// Calendar of comment deadlines (all-day events). Subscribe to the raw file URL in Outlook / Google Calendar / Apple Calendar.
const fold = l => { const b = Buffer.from(l); if (b.length <= 74) return l; const parts = []; let s = l; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; parts.push(s.slice(0, n)); s = " " + s.slice(n); } parts.push(s); return parts.join("\r\n"); };
const ics = t => String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = d => d.replace(/-/g, ""), next = d => new Date(new Date(d + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10).replace(/-/g, "");
const z = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Yappie Pro//Comment deadlines//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:AAPI comment deadlines"];
for (const x of dl) lines.push("BEGIN:VEVENT", `UID:${x.id}@yappie-pro`, `DTSTAMP:${z}`, `DTSTART;VALUE=DATE:${ymd(x.dl)}`, `DTEND;VALUE=DATE:${next(x.dl)}`, `SUMMARY:${ics("Comments due: " + x.h)}`, `URL:${x.u}`, `DESCRIPTION:${ics([x.ty, x.ag, x.m].filter(Boolean).join(" | ") + "\n" + x.u)}`, "END:VEVENT");
lines.push("END:VCALENDAR");
await writeFile(join(ROOT, "data/deadlines.ics"), lines.map(fold).join("\r\n") + "\r\n");
console.log(`Wrote ${out.size} RSS feeds and ${dl.length} calendar events.`);
