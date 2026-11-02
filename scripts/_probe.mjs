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

const wk = ["2026-03-02", "2026-03-09"];
for (const [name, q] of [
  ["a no-parens OR", `"Asian American" OR AAPI after:${wk[0]} before:${wk[1]}`],
  ["b parens OR", `("Asian American" OR AAPI) after:${wk[0]} before:${wk[1]}`],
  ["c quoted only", `"Asian American" after:${wk[0]} before:${wk[1]}`],
  ["d AAPI only", `AAPI after:${wk[0]} before:${wk[1]}`],
  ["e Asian Americans", `"Asian Americans" after:${wk[0]} before:${wk[1]}`],
  ["f Asian American unquoted", `Asian American after:${wk[0]} before:${wk[1]}`],
  ["g when7d baseline", `"Asian American" OR AAPI when:7d`],
  ["h last week via dates", `"Asian American" OR AAPI after:2026-10-26 before:2026-11-02`],
  ["i last week via dates, parens", `("Asian American" OR AAPI) after:2026-10-26 before:2026-11-02`],
  ["j day", `"Asian American" OR AAPI after:2026-03-03 before:2026-03-04`],
  ["k PI no-parens", `"Pacific Islander" OR "Native Hawaiian" OR "American Samoa" OR Guam after:${wk[0]} before:${wk[1]}`],
  ["l anti-Asian week", `"anti-Asian" OR "Stop AAPI Hate" after:${wk[0]} before:${wk[1]}`],
  ["m immigration week", `"Asian American" (immigration OR ICE OR deportation) after:${wk[0]} before:${wk[1]}`],
  ["n site AP + terms Mar", `site:apnews.com ("Asian American" OR "Asian Americans" OR AAPI) after:2026-03-01 before:2026-04-01`],
  ["o site NYT + terms Mar", `site:nytimes.com ("Asian American" OR "Asian Americans" OR AAPI) after:2026-03-01 before:2026-04-01`],
  ["p site NYT no terms Mar", `site:nytimes.com after:2026-03-01 before:2026-04-01`],
]) log("[google]", name, JSON.stringify(await feedInfo(gq(q))));
// White House feeds
for (const u of ["https://www.whitehouse.gov/feed/", "https://www.whitehouse.gov/feed/?paged=3", "https://www.whitehouse.gov/news/feed/", "https://www.whitehouse.gov/presidential-actions/feed/", "https://www.whitehouse.gov/briefings-statements/feed/?paged=12", "https://www.whitehouse.gov/briefings-statements/feed/?paged=14"]) log("[WH]", u.replace("https://www.whitehouse.gov", ""), JSON.stringify(await feedInfo(u)));
const wh = await get("https://www.whitehouse.gov/news/"); log("[WH html]", wh.status, "len", wh.text.length, "hrefs sample:", [...wh.text.matchAll(/href=["']([^"']*\/20\d\d\/\d\d\/[^"']+)/g)].slice(0, 3).map(m => m[1]).join(" | "), "time tags:", (wh.text.match(/<time/g) ?? []).length);
// HTML listings: new-link counts and the last date seen
const timeOf = html => [...html.matchAll(/<time\b[^>]*datetime=["']([^"']+)/gi)].map(m => m[1].slice(0, 10)).sort();
async function listing(name, base, link, pages, join = "?page=") {
  const re = new RegExp(link); const seen = new Set();
  for (const n of pages) { const r = await get(n === 1 ? base : base + join + n); const ls = [...new Set([...r.text.matchAll(/href=["']([^"']+)["']/gi)].map(m => { try { return new URL(m[1].replace(/&amp;/g, "&"), base).pathname; } catch { return ""; } }).filter(p => re.test(p)))]; const fresh = ls.filter(x => !seen.has(x)); ls.forEach(x => seen.add(x)); const t = timeOf(r.text); log("[" + name + "]", "page", n, r.status, "links", ls.length, "new", fresh.length, "dates", t[0] ?? "-", "..", t.at(-1) ?? "-"); }
}
await listing("HuffPost", "https://www.huffpost.com/voices/asian-voices", "^/entry/[^/]+_n_[0-9a-f]{24}$", [1, 2, 3, 6, 12]);
await listing("AAJC", "https://www.advancingjustice-aajc.org/news-media/press-releases", "^/press-release/[^/]+$", [1, 2, 3, 6, 12, 20]);
await listing("CAPAC", "https://capac.house.gov/press-releases", "^/press-release/[^/]+$", [1, 2, 3, 6, 12, 20]);
await listing("TAAF", "https://taaf.org/newsroom/press-releases", "^/news/[^/]+$", [1]);
const taaf = await get("https://taaf.org/newsroom/press-releases"); const tl = timeOf(taaf.text); log("[TAAF]", "dates on page", tl.length, tl[0], "..", tl.at(-1), "date-like text:", (taaf.text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, 2026/g) ?? []).length);
// DOJ variants
for (const u of ["https://www.justice.gov/news/rss?type=press_release&m=1&search_api_fulltext=Asian+American", "https://www.justice.gov/news/rss?type=press_release&m=1&keys=Asian+American", "https://www.justice.gov/news/rss?type=press_release&m=1&page=3", "https://www.justice.gov/news/rss?type=press_release&m=1&start_date=2026-03-01&end_date=2026-03-31", "https://www.justice.gov/crt/rss", "https://www.justice.gov/news/rss?type=press_release&component=2306&m=1"]) log("[DOJ]", u.replace("https://www.justice.gov", ""), JSON.stringify(await feedInfo(u)));
console.log("PROBE_DONE");
