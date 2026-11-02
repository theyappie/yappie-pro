// Daily brief: writes data/digest/latest.html + latest.txt from data/feed.json and (optionally) emails it.
// Env: DIGEST_HOURS (default 36) · DIGEST_TOPICS (e.g. "IMMIGRATION,ELECTIONS") · SITE_URL
//      To send: SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465), DIGEST_FROM, DIGEST_TO (comma-separated; sent as BCC)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTransport } from "nodemailer";
import { cluster } from "./cluster.mjs";
import { withFeedTaxo } from "./admin.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const tax0 = JSON.parse(await readFile(join(ROOT, "taxonomy.json"), "utf8"));
const cfg = JSON.parse(await readFile(process.env.SOURCES ?? join(ROOT, "sources.json"), "utf8"));
const feed = JSON.parse(await readFile(process.env.OUT ?? join(ROOT, "data/feed.json"), "utf8"));
const tax = withFeedTaxo(tax0, feed.taxo); // plus the owner's own topics and communities (names only)
const NOW = new Date(process.env.DIGEST_NOW ?? Date.now()), HOURS = +(process.env.DIGEST_HOURS ?? 36);
const SITE = (process.env.SITE_URL ?? cfg.siteUrl ?? "").replace(/\/$/, "");
const only = (process.env.DIGEST_TOPICS ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const TL = Object.fromEntries(tax.topics.map(t => [t.k, t.label])), CL = Object.fromEntries(tax.communities.map(c => [c.k, c.label])), SL = Object.fromEntries(tax.states.map(([k, l]) => [k, l]));
const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const safe = u => /^https?:\/\//.test(u) ? esc(u) : "#";
const day = d => new Date(d + (d.length > 10 ? "" : "T12:00:00Z")).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const long = new Date(NOW).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });

const all = feed.items ?? [], fresh = all.filter(x => NOW - new Date(x.d) <= HOURS * 36e5 && NOW - new Date(x.d) > -864e5 && (!only.length || only.includes(x.t) || (x.tx ?? []).some(t => only.includes(t))));
const todayIso = NOW.toISOString().slice(0, 10), horizon = new Date(NOW.getTime() + 21 * 864e5).toISOString().slice(0, 10);
const deadlines = all.filter(x => x.dl && x.dl >= todayIso && x.dl <= horizon).sort((a, b) => a.dl.localeCompare(b.dl));
const POLICY = new Set(tax.policyKinds ?? []), groups = cluster(fresh, x => POLICY.has(x.k)), outletsOf = new Map(); groups.forEach(g => g.items.forEach(x => outletsOf.set(x, g.outlets)));
const multi = groups.filter(g => g.outlets.length > 1).sort((a, b) => b.outlets.length - a.outlets.length).slice(0, 5);
const tags = x => [...(x.cm ?? []).map(k => CL[k]), ...(x.st ?? []).map(k => SL[k])].filter(Boolean).join(", ");
const KIND = { statement: "Statement", research: "Research", bill: "Bill", statebill: "State bill", official: "Rule or notice", order: "Executive action", govstmt: "Government statement", hearing: "Hearing or report", community: "", news: "" };
const kindTag = x => POLICY.has(x.k) ? ([x.ty, x.ag === x.s ? "" : x.ag].filter(Boolean).join(" · ") || KIND[x.k]) : (KIND[x.k] ?? "");
const line = x => ({ h: x.h, u: x.u, meta: [x.s, kindTag(x), day(x.d), tags(x), (x.bl ?? []).map(b => b.n).join(", ")].filter(Boolean).join(" · "), cov: (outletsOf.get(x)?.length ?? 1) > 1 ? ` (also covered by ${outletsOf.get(x).length - 1} other outlet${outletsOf.get(x).length > 2 ? "s" : ""})` : "" });

const sections = [];
if (deadlines.length) sections.push({ title: "Comment deadlines in the next 3 weeks", rows: deadlines.map(x => ({ h: x.h, u: x.u, meta: `Due ${day(x.dl)} · ${[x.ty, x.ag].filter(Boolean).join(" · ")}`, cov: "" })) });
if (multi.length) sections.push({ title: "Covered by several outlets", rows: multi.map(g => line(g.items[0])).map((r, i) => ({ ...r, cov: ` — ${multi[i].outlets.length} outlets: ${multi[i].outlets.join(", ")}` })) });
for (const t of tax.topics) { const l = fresh.filter(x => x.t === t.k); if (l.length) sections.push({ title: t.label, rows: l.map(line) }); }

const subject = `AAPI brief — ${long}` + (fresh.length ? ` (${fresh.length} new)` : "");
const base = SITE ? `<p style="margin:0 0 14px;color:#555">Open the full portal: <a href="${esc(SITE)}">${esc(SITE)}</a></p>` : "";
const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#faf9f5;color:#111525;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="max-width:640px;margin:0 auto"><h1 style="font-size:20px;margin:0 0 4px">AAPI brief</h1><p style="margin:0 0 14px;color:#555">${esc(long)} · ${fresh.length} new stories in the last ${HOURS} hours${only.length ? " · " + only.map(k => TL[k] ?? k).join(", ") : ""}</p>${base}`
  + (sections.length ? sections.map(s => `<h2 style="font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:1px solid #dee2e6">${esc(s.title)}</h2>` + s.rows.map(r => `<p style="margin:8px 0"><a href="${safe(r.u)}" style="color:#0a67f1;font-weight:600;text-decoration:none">${esc(r.h)}</a><br><span style="font-size:13px;color:#5e5e5e">${esc(r.meta)}${esc(r.cov)}</span></p>`).join("")).join("") : `<p>No new stories in this window.</p>`)
  + `<p style="margin-top:28px;font-size:12px;color:#777">Headlines link to the original outlets. Topics, communities and states are assigned by keyword rules and can be wrong; check the source before citing.</p></div></body></html>`;
const text = `AAPI brief — ${long}\n${fresh.length} new stories in the last ${HOURS} hours\n` + (SITE ? SITE + "\n" : "") + sections.map(s => `\n== ${s.title} ==\n` + s.rows.map(r => `- ${r.h}\n  ${r.meta}${r.cov}\n  ${r.u}`).join("\n")).join("\n") + "\n";

const dir = join(ROOT, "data/digest"); await mkdir(dir, { recursive: true });
await writeFile(join(dir, "latest.html"), html); await writeFile(join(dir, "latest.txt"), text);
console.log(`Digest: ${fresh.length} new, ${deadlines.length} deadlines, ${sections.length} sections → data/digest/latest.html`);

const { SMTP_URL, DIGEST_FROM, DIGEST_TO } = process.env;
if (!SMTP_URL || !DIGEST_FROM || !DIGEST_TO) { console.log("Not emailed (set SMTP_URL, DIGEST_FROM and DIGEST_TO to send)."); process.exit(0); }
if (!fresh.length && !deadlines.length && !process.env.DIGEST_SEND_EMPTY) { console.log("Nothing new; not emailed."); process.exit(0); }
const tr = createTransport(SMTP_URL === "json" ? { jsonTransport: true } : SMTP_URL);
const info = await tr.sendMail({ from: DIGEST_FROM, to: DIGEST_FROM, bcc: DIGEST_TO.split(",").map(s => s.trim()).filter(Boolean), subject, html, text });
console.log(SMTP_URL === "json" ? "DRY RUN message:\n" + info.message : "Sent: " + info.messageId);
