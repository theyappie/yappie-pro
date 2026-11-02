// TEMPORARY probe (run from Actions): how far back can each source reach? Prints one line per check. Deleted after use.
import { readFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
const cfg = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const UA = { "user-agent": "TheYappiePro/1.0 (open-source news index)" };
const FROM = "2026-01-01";
const tx = n => (typeof n === "string" || typeof n === "number") ? String(n) : (n?.["#text"] ?? "");
async function get(url, accept, ms = 20000) {
  try { const r = await fetch(url, { headers: { ...UA, ...(accept ? { accept } : {}) }, signal: AbortSignal.timeout(ms), redirect: "follow" }); const t = await r.text(); return { ok: r.ok, status: r.status, h: r.headers, text: t }; }
  catch (e) { return { ok: false, status: 0, err: String(e.message ?? e).slice(0, 80), text: "" }; }
}
const items = x => { const raw = x.rss?.channel?.item ?? x.feed?.entry ?? x["rdf:RDF"]?.item ?? []; return Array.isArray(raw) ? raw : [raw]; };
const dts = it => new Date(tx(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]));
const lnk = it => typeof it.link === "string" ? it.link : (it.link?.["@_href"] ?? (Array.isArray(it.link) ? (it.link.find(l => l["@_rel"] === "alternate") ?? it.link[0])?.["@_href"] : "") ?? tx(it.guid));
const day = d => isNaN(d) ? "?" : d.toISOString().slice(0, 10);
async function feedInfo(url) {
  const r = await get(url); if (!r.ok) return { err: r.err ?? "HTTP " + r.status };
  try { const x = parser.parse(r.text); const l = items(x), ds = l.map(dts).filter(d => !isNaN(d)).sort((a, b) => a - b); return { n: l.length, oldest: day(ds[0]), newest: day(ds.at(-1)), first: lnk(l[0]) }; } catch (e) { return { err: "parse " + String(e.message).slice(0, 40) }; }
}
const withParam = (u, k, v) => { const x = new URL(u); x.searchParams.set(k, v); return x.href; };
const googleQ = q => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const out = [];
const log = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };
const jobs = [];
const seenHost = new Set();
for (const s of cfg.sources) {
  const url = s.wp ?? s.feed ?? s.page; if (!url || s.google && !/site(:|%3A)/i.test(url)) { if (!s.google) continue; }
  jobs.push(async () => {
    const tag = `[${s.name}${s.kind ? "/" + s.kind : ""}]`;
    const u = new URL(s.wp ?? s.feed ?? s.page);
    if (s.google) {
      const m = /site(?::|%3A)([^+&%\s)]+)/i.exec(decodeURIComponent(s.feed)); const site = m ? m[1] : null;
      if (!site) { log(tag, "google (no site:)", decodeURIComponent(s.feed).slice(0, 120)); return; }
      for (const [a, b] of [["2026-01-01", "2026-02-01"], ["2026-06-01", "2026-07-01"]]) {
        const r = await feedInfo(googleQ(`site:${site} after:${a} before:${b}`));
        log(tag, `google site:${site} ${a}..${b}`, JSON.stringify(r));
      }
      return;
    }
    if (s.wp) {
      const x = new URL(s.wp); x.searchParams.set("per_page", "1"); x.searchParams.set("after", FROM + "T00:00:00"); x.searchParams.set("_fields", "id,date_gmt");
      const r = await get(x.href, "application/json");
      log(tag, "wp-rest since " + FROM, r.ok ? `total=${r.h.get("x-wp-total")} pages=${r.h.get("x-wp-totalpages")}` : `FAIL ${r.status} ${r.err ?? ""}`, "| " + s.wp.slice(0, 110));
      return;
    }
    if (s.feed) {
      const fi = await feedInfo(s.feed); log(tag, "feed p1", JSON.stringify(fi), "|", s.feed.slice(0, 90));
      const p2 = await feedInfo(withParam(s.feed, "paged", "2")); log(tag, "feed ?paged=2", JSON.stringify(p2), p2.first && p2.first !== fi.first ? "DIFFERENT" : "same/none");
      const key = u.origin; if (!seenHost.has(key)) {
        seenHost.add(key);
        const w = await get(`${u.origin}/wp-json/wp/v2/posts?per_page=1&after=${FROM}T00:00:00&_fields=id,date_gmt`, "application/json");
        log(tag, "wp-rest probe", u.origin, w.ok ? `total=${w.h.get("x-wp-total")} pages=${w.h.get("x-wp-totalpages")}` : `FAIL ${w.status} ${w.err ?? ""}`);
      }
      const host = u.hostname.replace(/^www\./, "");
      const g = await feedInfo(googleQ(`site:${host} after:2026-03-01 before:2026-04-01`)); log(tag, `google site:${host} 2026-03`, JSON.stringify(g));
      return;
    }
    if (s.page) {
      const p1 = await get(s.page); const re = new RegExp(s.link ?? "^$"); const linksOf = html => new Set([...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => { try { return new URL(m[1].replace(/&amp;/g, "&"), s.page).pathname; } catch { return ""; } }).filter(p => re.test(p)));
      const l1 = linksOf(p1.text); log(tag, "page p1", p1.status, "links", l1.size, "|", s.page);
      const tries = [withParam(s.page, "page", "2"), s.page.replace(/\/?$/, "/") + "page/2/", withParam(s.page, "p", "2"), withParam(s.page, "pg", "2"), withParam(s.page, "paged", "2")];
      for (const t of tries) { const r = await get(t); const l = linksOf(r.text); const fresh = [...l].filter(x => !l1.has(x)).length; log(tag, "  try", t.slice(0, 100), r.status, "links", l.size, "new", fresh); }
      const g = await feedInfo(googleQ(`site:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")} after:2026-03-01 before:2026-04-01`)); log(tag, "  google path slice 2026-03", JSON.stringify(g));
    }
  });
}
// Government APIs
jobs.push(async () => {
  for (const t of ['"Asian American"', '"Native Hawaiian"', '"Pacific Islander"', "AAPI", '"Compact of Free Association"', '"Asian Pacific American"']) {
    const q = new URLSearchParams({ per_page: "1", "conditions[term]": t, "conditions[publication_date][gte]": FROM });
    const r = await get("https://www.federalregister.gov/api/v1/documents.json?" + q, "application/json"); let c = "?"; try { c = JSON.parse(r.text).count; } catch {}
    log("[FR]", "since " + FROM, t, "count=" + c);
  }
  for (const t of ["immigration", "citizenship", "refugee", "asylum", "census"]) {
    const q = new URLSearchParams({ per_page: "1", "conditions[term]": t, "conditions[publication_date][gte]": FROM }); q.append("conditions[type][]", "RULE"); q.append("conditions[type][]", "PRORULE");
    const r = await get("https://www.federalregister.gov/api/v1/documents.json?" + q, "application/json"); let c = "?"; try { c = JSON.parse(r.text).count; } catch {}
    log("[FR rules]", "since " + FROM, t, "count=" + c);
  }
  const key = process.env.API_DATA_GOV_KEY || process.env.CONGRESS_API_KEY || "";
  if (key) {
    const h = { "x-api-key": key, accept: "application/json" };
    for (const [name, url] of [["congress bills 119 since " + FROM, `https://api.congress.gov/v3/bill/119?format=json&limit=1&fromDateTime=${FROM}T00:00:00Z`], ["congress summaries 119 since " + FROM, `https://api.congress.gov/v3/summaries/119?format=json&limit=1&fromDateTime=${FROM}T00:00:00Z`]]) {
      try { const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(30000) }); const j = await r.json(); log("[API]", name, "count=" + (j.pagination?.count ?? "?"), "limit-remaining=" + r.headers.get("x-ratelimit-remaining")); } catch (e) { log("[API]", name, "FAIL", String(e.message).slice(0, 60)); }
    }
  } else log("[API]", "no key in this run");
  const dj = await feedInfo("https://www.justice.gov/news/rss?type=press_release&m=1"); log("[DOJ]", "p1", JSON.stringify(dj));
  const dj2 = await feedInfo("https://www.justice.gov/news/rss?type=press_release&m=1&page=2"); log("[DOJ]", "page=2", JSON.stringify(dj2));
  const us = await feedInfo("https://www.uscis.gov/news/rss-feed/23269"); log("[USCIS]", "p1", JSON.stringify(us));
  const us2 = await feedInfo("https://www.uscis.gov/news/rss-feed/23269?page=2"); log("[USCIS]", "page=2", JSON.stringify(us2));
  const wh = await get(`https://www.whitehouse.gov/wp-json/wp/v2/posts?per_page=1&after=${FROM}T00:00:00&_fields=id,date_gmt`, "application/json"); log("[WH]", "wp-rest", wh.ok ? `total=${wh.h.get("x-wp-total")}` : `FAIL ${wh.status}`);
});
let i = 0; const N = 6; await Promise.all(Array.from({ length: N }, async () => { while (i < jobs.length) { const j = jobs[i++]; try { await j(); } catch (e) { log("JOB ERROR", String(e.message).slice(0, 100)); } await new Promise(r => setTimeout(r, 300)); } }));
console.log("PROBE_DONE");
