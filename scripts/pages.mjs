// Finishes the page after index.html was edited. Usage: node scripts/pages.mjs <folder with index.html>   (or: bash scripts/pages.sh <folder>)
//  1. Writes the page's content security policy into index.html. The policy lists the page's own scripts by fingerprint, so the browser runs those and nothing else: a script that reached the page some other way
//     (through a story's text, say) does not run, and the page can read data only from this site and from theyappie.com. The fingerprints change whenever a script changes, which is why this step exists.
//  2. Makes the copies each address needs (each with its own title, description and canonical address; see 3 below). GitHub Pages serves policy.html at /policy, so every page address gets its own copy of the app, and 404.html answers every other address with the same app.
//     events.html and elections.html are older addresses that now lead to the Calendar and Policy pages.
// The update workflow runs this on every update, so an index.html changed on GitHub directly is put right within minutes. It writes a file only when the file would change.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PAGES = ["news", "policy", "advocacy", "research", "hubs", "calendar", "events", "thread", "elections", "orgs", "saved", "404"];
const dir = process.argv[2] ?? ".", file = join(dir, "index.html");
if (!existsSync(file)) { console.error(`no index.html in ${dir}`); process.exit(1); }
const html = readFileSync(file, "utf8");
// every script the browser runs (a <script type="application/json"> block is data, not a script)
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\btype\s*=\s*["']?application\/(?:ld\+)?json/i.test(m[1]));
if (scripts.some(m => /\bsrc\s*=/i.test(m[1]))) { console.error("index.html loads a script from a file; add its address to the policy in scripts/pages.mjs first."); process.exit(1); }
// a browser reads every line ending as a plain line feed before it takes the fingerprint, so do the same (a file saved with Windows line endings would otherwise get fingerprints that match nothing, and a blank page)
const prints = [...new Set(scripts.map(m => `'sha256-${createHash("sha256").update(m[2].replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`))];
const policy = [
  "default-src 'none'",
  `script-src ${prints.join(" ")}`,
  "style-src 'unsafe-inline' https://use.typekit.net https://p.typekit.net", // the page's own styles, and the Adobe Fonts stylesheet
  "font-src https://use.typekit.net",
  "img-src 'self' data: https:", // the pictures inside The Yappie's articles come from other sites
  "connect-src 'self' https://theyappie.com", // the data files, and an article's text from theyappie.com when it is not stored here
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const slot = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
if (!slot.test(html)) { console.error('index.html has no <meta http-equiv="Content-Security-Policy" content="..."> tag to fill in.'); process.exit(1); }
const out = html.replace(slot, `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
// ---- 3. What a search engine, a link preview or an AI tool sees without running the page's scripts ----
// Each copy gets its own title, description and canonical address, and its section's newest headlines inside <noscript> (the page's scripts build the real lists; a reader with JavaScript never sees this block).
// index.html itself is left as written: it is the file people edit, and the headlines change every update. Its <noscript> links to the sections, whose copies carry the lists.
// Nothing here touches a <script>, so the security policy above stays valid.
const SITE = "https://pro.theyappie.com", NAME = "The Yappie Pro";
const META = {
  news: ["News", "news", "The newest stories from AAPI media and mainstream outlets, sorted by topic, community and state, updated every 10 minutes."],
  policy: ["Policy tracker", "policy", "Federal and state bills, rules, executive actions, comment deadlines and government statements that affect AAPI communities."],
  advocacy: ["Advocacy statements", "advocacy", "Statements and press releases from AAPI advocacy organizations, in one list."],
  research: ["Research", "research", "New surveys, reports and data about AAPI communities."],
  hubs: ["Issues", "hubs", "One page per issue: the stories, policy items and statements about each, and which groups have weighed in."],
  calendar: ["Calendar", "calendar", "Hearings, comment deadlines, funding deadlines, voting dates and community events."],
  events: ["Calendar", "calendar", null], elections: ["Calendar", "calendar", null],
  orgs: ["Organizations", "orgs", "A directory of AAPI advocacy, research and community organizations, with their latest statements."],
  thread: ["Story timeline", null, null], saved: ["Saved stories", null, null], 404: ["Page not found", null, null],
};
const readJ = f => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return null; } };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const okU = u => typeof u === "string" && /^https?:\/\/[^\s"<>\\]+$/i.test(u);
const PK = new Set(["bill", "statebill", "ballot", "official", "order", "govstmt", "hearing"]);
const KINDS = { news: x => x.k === "news" || x.k === "community", policy: x => PK.has(x.k), advocacy: x => x.k === "statement", research: x => x.k === "research" };
let latest, events, orgs;
function listFor(p) {
  const li = (h, u, extra) => `<li>${u ? `<a href="${esc(u)}">${esc(h)}</a>` : esc(h)}${extra ? ` <small>${esc(extra)}</small>` : ""}</li>`;
  if (KINDS[p]) {
    latest ??= readJ("data/latest.json");
    const a = (latest?.items ?? []).filter(x => x && typeof x.h === "string" && okU(x.u) && KINDS[p](x)).slice(0, 30);
    return a.length ? `<h2>Latest</h2><ul>${a.map(x => li(x.h, x.u, [x.s, String(x.d ?? "").slice(0, 10)].filter(Boolean).join(", "))).join("")}</ul>` : "";
  }
  if (p === "hubs") {
    latest ??= readJ("data/latest.json");
    const a = (latest?.hubs ?? []).filter(h => h && typeof h.k === "string" && typeof h.label === "string");
    return a.length ? `<h2>Issues</h2><ul>${a.map(h => li(h.label, `${SITE}/hubs?h=${encodeURIComponent(h.k)}`, h.blurb)).join("")}</ul>` : "";
  }
  if (p === "calendar" || p === "events" || p === "elections") {
    events ??= readJ("data/events.json");
    const today = new Date().toISOString().slice(0, 10);
    const a = (events?.events ?? []).filter(e => e && typeof e.t === "string" && String(e.e || e.d || "") >= today).sort((x, y) => String(x.d).localeCompare(String(y.d))).slice(0, 30);
    return a.length ? `<h2>Coming up</h2><ul>${a.map(e => li(e.t, okU(e.u) ? e.u : "", [String(e.d ?? "").slice(0, 10), e.o].filter(Boolean).join(", "))).join("")}</ul>` : "";
  }
  if (p === "orgs") {
    orgs ??= readJ("data/orgs.json");
    const a = (orgs?.orgs ?? []).filter(o => o && typeof o.n === "string" && typeof o.id === "string");
    return a.length ? `<h2>Organizations</h2><ul>${a.map(o => li(o.n, `${SITE}/orgs?og=${encodeURIComponent(o.id)}`, o.ab)).join("")}</ul>` : "";
  }
  return "";
}
function pageCopy(p, html) {
  const [label, path, desc] = META[p] ?? [null, null, null];
  if (!label) return html;
  const title = `${label} | ${NAME}`;
  let h = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  if (desc) h = h.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  // the canonical address: the section's own (the Calendar's older addresses point to it); none on a page that is not one address (a timeline, saved stories, the not-found page), which also stays out of search results
  h = h.replace(/<link rel="canonical" href="[^"]*">/, path ? `<link rel="canonical" href="${SITE}/${path}">` : `<meta name="robots" content="noindex">`);
  const list = listFor(p);
  if (list) h = h.replace(/(<noscript><div[^>]*>)([\s\S]*?)(<\/div><\/noscript>)/, (m, a, b, c) => `${a}${b}<h1 style="font-size:18px;margin-top:20px">${esc(label)}</h1>${list}${c}`);
  return h;
}
// the sitemap: the sections, every issue page and every organization page
function sitemap() {
  latest ??= readJ("data/latest.json"); orgs ??= readJ("data/orgs.json");
  if (!latest) return "";
  const urls = ["", "news", "policy", "advocacy", "research", "hubs", "calendar", "orgs"].map(p => `${SITE}/${p}`)
    .concat((latest.hubs ?? []).filter(h => typeof h?.k === "string").map(h => `${SITE}/hubs?h=${encodeURIComponent(h.k)}`))
    .concat((orgs?.orgs ?? []).filter(o => typeof o?.id === "string").map(o => `${SITE}/orgs?og=${encodeURIComponent(o.id)}`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

// ---- writing the files ----
let wrote = 0;
const put = (f, text) => { if (existsSync(f) && readFileSync(f, "utf8") === text) return; writeFileSync(f, text); wrote++; };
put(file, out);
for (const p of PAGES) put(join(dir, p + ".html"), pageCopy(p, out));
const sm = sitemap(); if (sm) put(join(dir, "sitemap.xml"), sm);
console.log(wrote ? `Pages: ${wrote} file${wrote > 1 ? "s" : ""} updated (${prints.length} scripts in the policy).` : "Pages: nothing to update.");
