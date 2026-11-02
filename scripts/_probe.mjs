// TEMPORARY probe 2 (run from Actions). Deleted after use.
import { XMLParser } from "fast-xml-parser";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const UA = { "user-agent": "TheYappiePro/1.0 (open-source news index)" };
const tx = n => (typeof n === "string" || typeof n === "number") ? String(n) : (n?.["#text"] ?? "");
async function get(url, accept, headers = {}) {
  try { const r = await fetch(url, { headers: { ...UA, ...(accept ? { accept } : {}), ...headers }, signal: AbortSignal.timeout(25000) }); const t = await r.text(); return { ok: r.ok, status: r.status, h: r.headers, text: t }; }
  catch (e) { return { ok: false, status: 0, err: String(e.message ?? e).slice(0, 80), text: "" }; }
}
const items = x => { const raw = x.rss?.channel?.item ?? x.feed?.entry ?? x["rdf:RDF"]?.item ?? []; return Array.isArray(raw) ? raw : [raw]; };
const dts = it => new Date(tx(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]));
const day = d => isNaN(d) ? "?" : d.toISOString().slice(0, 10);
async function feedInfo(url) {
  const r = await get(url); if (!r.ok) return { err: r.err ?? "HTTP " + r.status };
  try { const x = parser.parse(r.text); const l = items(x), ds = l.map(dts).filter(d => !isNaN(d)).sort((a, b) => a - b); return { n: l.length, oldest: day(ds[0]), newest: day(ds.at(-1)) }; } catch (e) { return { err: "parse" }; }
}
const log = (...a) => console.log(a.join(" "));
const gq = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const short = r => r.ok ? `${r.status} len=${r.text.length} total=${r.h.get("x-wp-total") ?? "-"}` : `FAIL ${r.status} ${r.err ?? ""} ${r.text.slice(0, 60).replace(/\s+/g, " ")}`;
// 1. Pew REST variants
const P = "https://www.pewresearch.org/wp-json/wp/v2/posts";
for (const q of ["?categories=150&per_page=30&orderby=date&order=desc&_fields=link,title,date_gmt,excerpt", "?categories=150&per_page=30&orderby=date&order=desc&_fields=link,title,date_gmt,excerpt&after=2026-01-01T00:00:00", "?categories=150&per_page=30&_fields=link,title,date_gmt&after=2026-01-01T00:00:00Z", "?categories=150&per_page=30&_fields=link,title,date_gmt&after=2026-01-01", "?categories=150&per_page=30&_fields=id,date_gmt", "?categories=150&per_page=1&_fields=link,title,date_gmt&page=2", "?categories=150&per_page=100&_fields=link,title,date_gmt&page=1", "?categories=150&per_page=30&_fields=link,title,date_gmt&before=2026-06-01T00:00:00"])
  log("[Pew]", q.slice(0, 120), short(await get(P + q, "application/json")));
// 2. AsAmNews REST
for (const u of ["https://asamnews.com/wp-json/wp/v2/posts?per_page=2&_fields=link,date_gmt", "https://asamnews.com/wp-json/wp/v2/posts?per_page=2&after=2026-01-01T00:00:00&_fields=link,date_gmt", "https://asamnews.com/wp-json", "https://asamnews.com/?rest_route=/wp/v2/posts&per_page=2&_fields=link,date_gmt", "https://asamnews.com/post-sitemap.xml", "https://asamnews.com/sitemap_index.xml", "https://asamnews.com/sitemap.xml"]) log("[AsAmNews]", u.slice(0, 100), short(await get(u, "application/json")));
for (const u of ["https://www.civilbeat.org/wp-json/wp/v2/posts?per_page=2&_fields=link,date_gmt", "https://www.thejuggernaut.com/wp-json/wp/v2/posts?per_page=2", "https://www.whitehouse.gov/wp-json/wp/v2/posts?per_page=2&_fields=link,date_gmt"]) log("[REST]", u.slice(0, 100), short(await get(u, "application/json")));
// 3. Substack archive
for (const h of ["https://www.therebelyellow.com", "https://redwhiteandbrown.substack.com", "https://www.thejuggernaut.com"]) {
  const r = await get(`${h}/api/v1/archive?sort=new&search=&offset=0&limit=50`, "application/json"); let n = "?", o = "?", f = "?"; try { const j = JSON.parse(r.text); n = j.length; o = j.at(-1)?.post_date; f = Object.keys(j[0] ?? {}).slice(0, 12).join(","); } catch {}
  log("[substack]", h, r.status, "n=" + n, "oldest-on-page", o, f);
  const r2 = await get(`${h}/api/v1/archive?sort=new&search=&offset=50&limit=50`, "application/json"); try { const j = JSON.parse(r2.text); log("[substack]", h, "offset50", r2.status, "n=" + j.length, "oldest", j.at(-1)?.post_date); } catch { log("[substack]", h, "offset50", r2.status); }
}
// 4. Squarespace JSON
for (const u of ["https://www.ocanational.org/press-releases?format=json", "https://jacl.org/statements?format=json"]) {
  const r = await get(u, "application/json"); let info = ""; try { const j = JSON.parse(r.text); const it = j.items ?? []; info = `items=${it.length} pagination=${JSON.stringify(j.pagination ?? null).slice(0, 160)} last=${it.at(-1) ? new Date(it.at(-1).publishOn).toISOString().slice(0, 10) : "-"} firstkeys=${Object.keys(it[0] ?? {}).slice(0, 8)}`; } catch { info = "not json " + r.text.slice(0, 50); }
  log("[squarespace]", u, r.status, info);
}
// 5. Blogger
for (const u of ["https://blog.angryasianman.com/feeds/posts/default?alt=rss&max-results=500&start-index=1&published-min=2026-01-01T00:00:00", "https://blog.angryasianman.com/feeds/posts/default?alt=rss&max-results=500&start-index=26"]) log("[blogger]", u.slice(40, 140), JSON.stringify(await feedInfo(u)));
// 6. White House pages
const re = /href=["'](\/(?:releases|fact-sheets|briefings-statements|remarks|research)\/20\d\d\/\d\d\/[^"'#?]+)/gi;
for (const n of [1, 2, 10, 30, 60]) { const r = await get(`https://www.whitehouse.gov/news/${n > 1 ? "page/" + n + "/" : ""}`); const links = [...new Set([...r.text.matchAll(re)].map(m => m[1]))]; log("[WH page]", n, r.status, "links", links.length, links.slice(-1)[0] ?? ""); }
for (const n of [2, 5]) log("[WH feed paged]", n, JSON.stringify(await feedInfo(`https://www.whitehouse.gov/briefings-statements/feed/?paged=${n}`)));
// 7. Google with terms
const terms = '("Asian American" OR AAPI OR "Pacific Islander" OR "Native Hawaiian")';
for (const [name, q] of [["DOJ Mar", `site:justice.gov ${terms} after:2026-03-01 before:2026-04-01`], ["WH Mar", `site:whitehouse.gov ${terms} after:2026-03-01 before:2026-04-01`], ["MauiNow Mar", `site:mauinow.com ${terms} after:2026-03-01 before:2026-04-01`], ["CivilBeat Mar", `site:civilbeat.org ${terms} after:2026-03-01 before:2026-04-01`], ["broad week", `("Asian American" OR AAPI) after:2026-03-02 before:2026-03-09`], ["broad day", `("Asian American" OR AAPI) after:2026-03-02 before:2026-03-03`], ["broad month", `("Asian American" OR AAPI) after:2026-03-01 before:2026-04-01`], ["PI week", `("Pacific Islander" OR "Native Hawaiian" OR "American Samoa" OR Guam) after:2026-03-02 before:2026-03-09`]])
  log("[google]", name, JSON.stringify(await feedInfo(gq(q))));
// 8. Burst: 40 requests, 4 concurrent
const stat = {}; let k = 0; const t0 = Date.now();
await Promise.all(Array.from({ length: 4 }, async () => { while (k < 40) { const i = k++; const d1 = new Date(Date.UTC(2026, 0, 1 + i * 7)), d2 = new Date(d1.getTime() + 7 * 864e5); const r = await get(gq(`("Asian American" OR AAPI) after:${d1.toISOString().slice(0, 10)} before:${d2.toISOString().slice(0, 10)}`)); stat[r.status] = (stat[r.status] ?? 0) + 1; await new Promise(r => setTimeout(r, 200)); } }));
log("[google burst] 40 weekly slices, 4 parallel:", JSON.stringify(stat), ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log("PROBE_DONE");
