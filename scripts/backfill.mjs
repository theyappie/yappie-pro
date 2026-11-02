// Backfill: reads each source as far back as "keepFrom" (sources.json), not just as far as its feed reaches.
// Used only when the collector runs with BACKFILL=1 (the update workflow's "backfill" input); a normal run never imports it.
//
// A feed shows its newest 10 to 50 stories, so the way back is different for each kind of site. Each way is one "strategy" below, and a source tries them in order until its oldest story is
// back at the start date: the site's WordPress REST list (100 stories a request, filtered by date), the feed's own paging (?paged=2), Blogger / Substack / Squarespace paging, the numbered
// pages of a listing page, and, for sites that have none of these, Google News slices by date (site:example.com after:2026-03-01 before:2026-03-08). Every strategy produces the same kind of
// record the collector already reads from a feed, so the filters, tagging and de-duplication in fetch.mjs apply unchanged.
//
// A strategy hands over each story as soon as it has it, so a request that fails halfway (or the time budget running out) loses only what was not read yet.
//
// sources.json: "keepFrom" (the first day to keep) and a "backfill" block ({ delayMs, retries, maxPages, googleWindowDays, googleBroadDays, googleCap, deadlineMinutes, terms }).
// A source can carry its own "backfill":
//   false                                      skip this source
//   { "modes": ["feed", "google-site"] }        the strategies to try, in order: wp feed blogger substack squarespace page google google-site (default depends on the kind of source, see autoModes)
//   { "pages": 120 }                            how many pages of a feed or listing page to read at most; "pageParam": "page" or "pagePath": "page/{n}/" say how a listing page is paged
//   { "rest": "https://x.org/wp-json/wp/v2/posts" }   the WordPress list to use instead of working it out from the feed's address
//   { "site": "example.com", "terms": true }    what the Google News fallback searches: the site (a folder is fine) and the words stories must contain ("terms": true is the AAPI words; a string is your own)
//   { "json": "https://x.org/news" }            the Squarespace page to read as JSON; { "origin": "https://x.substack.com" } for Substack
//   { "sliced": { "days": 31, "urls": ["https://x.gov/rss?q=aapi&start_date={from}&end_date={to}"] } }   feeds that take a date range, read one range at a time (the Justice Department)
const DAY = 864e5;
const day = t => new Date(t).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAP = 21 * DAY; // a source whose oldest story is within three weeks of the start date counts as fully read
const hostOfUrl = u => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

// the same story can come back through two routes with small differences in its address (utm_ tags, a trailing slash, http or https, www)
export const normUrl = u => {
  try {
    const x = new URL(String(u));
    const q = [...x.searchParams].filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
    return x.hostname.toLowerCase().replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + (q ? "?" + q : "");
  } catch { return String(u ?? ""); }
};
// Google reads "A OR B" as a group, so the brackets around a single group of words add nothing; they are removed because Google News answers a bracketed search with far fewer stories
export const loosen = q => { const g = q.match(/\([^()]*\)/g); return g && g.length === 1 && /\bOR\b/.test(g[0]) ? q.replace(g[0], g[0].slice(1, -1)) : q; };

export function makeBackfill({ from, until = new Date(), get, parseFeed, itemDate, itemLink, pageRecords, cfg, only = null, log = console.log }) {
  const B = cfg.backfill ?? {}, delay = B.delayMs ?? 350, maxPagesDefault = B.maxPages ?? 400, retries = B.retries ?? 3;
  const fromTs = from.getTime(), untilTs = until.getTime() + DAY, deadline = Date.now() + (B.deadlineMinutes ?? 100) * 60000;
  const cap = B.googleCap ?? 90, siteDays = B.googleWindowDays ?? 7, broadDays = B.googleBroadDays ?? 3;
  const TERMS = typeof B.terms === "string" ? B.terms : '"Asian American" OR AAPI OR "Pacific Islander" OR "Native Hawaiian"';
  const report = [];

  // requests to one host are spaced out, and a request that fails for a reason that may pass (rate limit, server error, network) is tried again a few times
  const nextAt = new Map();
  const pace = async host => { const t = Math.max(Date.now(), nextAt.get(host) ?? 0); nextAt.set(host, t + delay); const w = t - Date.now(); if (w > 0) await sleep(w); };
  const final = e => (/HTTP [34]\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) || /time budget/.test(e.message); // not found, forbidden, or out of time: asking again will not help
  async function fetchText(url, accept) {
    let host; try { host = new URL(url).host; } catch { host = ""; }
    let last;
    for (let i = 0; i <= retries; i++) {
      if (Date.now() > deadline) throw new Error("time budget used up");
      await pace(host);
      try { return await get(url, accept); }
      catch (e) { last = e; if (final(e)) throw e; await sleep((B.retryMs ?? 1500) * 2 ** i); }
    }
    throw last;
  }
  const feedAt = async url => parseFeed(await fetchText(url));
  const tsOf = r => { const t = itemDate(r).getTime(); return Number.isNaN(t) ? Infinity : t; };
  const oldestOf = recs => recs.reduce((m, r) => Math.min(m, tsOf(r)), Infinity);
  const mergeInto = (into, more) => { const have = new Set(into.map(r => normUrl(itemLink(r)))); let n = 0; for (const r of more) { const k = normUrl(itemLink(r)); if (!k || have.has(k)) continue; have.add(k); into.push(r); n++; } return n; };
  const wpRec = p => ({ title: p.title?.rendered ?? "", link: p.link, description: p.excerpt?.rendered ?? "", pubDate: p.date_gmt ? p.date_gmt + "Z" : p.date });

  // ---------------------------------------------------------------- WordPress REST: 100 stories a request, only those after the start date
  async function wpList(base, sink) {
    const per = 100;
    for (let page = 1; page <= maxPagesDefault; page++) {
      const u = new URL(base);
      u.searchParams.set("per_page", String(per)); u.searchParams.set("page", String(page)); u.searchParams.set("after", from.toISOString().slice(0, 19)); u.searchParams.set("orderby", "date"); u.searchParams.set("order", "desc");
      if (!u.searchParams.has("_fields")) u.searchParams.set("_fields", "link,title,date_gmt,excerpt");
      let j;
      try { j = JSON.parse(await fetchText(u.href, "application/json")); }
      catch (e) { if (page > 1 && /HTTP 400/.test(e.message)) break; throw e instanceof SyntaxError ? new Error("Not valid JSON") : e; } // WordPress answers 400 for a page past the last one
      if (!Array.isArray(j)) throw new Error("Unexpected WordPress response");
      sink.push(...j.map(wpRec));
      if (j.length < per) break;
    }
  }
  // a feed of the whole site (/feed/) or of one category or tag (/category/news/feed/) has a matching REST list; any other address (a custom post type) has not, and is paged as a feed
  const restable = feed => { try { return /^\/(feed|(category|tag)\/[^/]+\/feed)?\/?$/.test(new URL(feed).pathname); } catch { return false; } };
  async function restUrlFor(src) {
    if (src.backfill?.rest) return src.backfill.rest;
    if (!src.feed || src.google || !restable(src.feed)) return "";
    const u = new URL(src.feed), p = u.pathname.replace(/\/+$/, "");
    if (p === "/feed" || p === "") return u.origin + "/wp-json/wp/v2/posts";
    const m = /^\/(category|tag)\/([^/]+)\/feed$/.exec(p), kind = m[1] === "category" ? "categories" : "tags";
    const j = JSON.parse(await fetchText(`${u.origin}/wp-json/wp/v2/${kind}?slug=${encodeURIComponent(m[2])}&_fields=id`, "application/json"));
    if (!Array.isArray(j) || !j[0]?.id) throw new Error(`no ${kind} "${m[2]}"`);
    return `${u.origin}/wp-json/wp/v2/posts?${kind}=${j[0].id}`;
  }
  const wp = async (src, have, sink) => { const u = src.wp ? src.wp : await restUrlFor(src); if (!u) throw new Error("not a WordPress address"); return wpList(u, sink); };

  // ---------------------------------------------------------------- the feed's own paging (WordPress: ?paged=2); stops at the start date, at the end of the pages, or when the site ignores the parameter
  async function feedPaged(src, have, sink) {
    const param = src.backfill?.pageParam ?? "paged", maxP = src.backfill?.pages ?? maxPagesDefault, seen = new Set(have.map(r => normUrl(itemLink(r))));
    let floor = oldestOf(have);
    for (let p = 2; p <= maxP && floor > fromTs; p++) {
      const u = new URL(src.feed); u.searchParams.set(param, String(p));
      let list;
      try { list = await feedAt(u.href); } catch (e) { if (p === 2 && !/HTTP (400|404)/.test(e.message)) throw e; break; } // past the last page (404), or a page that cannot be read: what was read is used
      const fresh = list.filter(r => !seen.has(normUrl(itemLink(r))));
      if (!fresh.length) break; // empty, or the same page again: the site does not page
      for (const r of fresh) seen.add(normUrl(itemLink(r)));
      sink.push(...fresh); floor = Math.min(floor, oldestOf(fresh));
    }
  }

  // ---------------------------------------------------------------- Blogger: feeds/posts/default takes published-min and start-index
  async function blogger(src, have, sink) {
    const per = 150;
    for (let start = 1; start < 20000; start += per) {
      const u = new URL(src.feed); u.searchParams.set("max-results", String(per)); u.searchParams.set("start-index", String(start)); u.searchParams.set("published-min", day(fromTs) + "T00:00:00");
      const list = await feedAt(u.href); sink.push(...list);
      if (list.length < per) break;
    }
  }

  // ---------------------------------------------------------------- Substack: /api/v1/archive lists the posts, newest first
  async function substack(src, have, sink) {
    const origin = new URL(src.backfill?.origin ?? src.feed ?? src.home).origin;
    for (let off = 0; off < 5000; off += 50) {
      const j = JSON.parse(await fetchText(`${origin}/api/v1/archive?sort=new&search=&offset=${off}&limit=50`, "application/json"));
      if (!Array.isArray(j)) throw new Error("Unexpected Substack response");
      for (const p of j) if (p.canonical_url && p.title && p.post_date) sink.push({ title: p.title, link: p.canonical_url, description: p.subtitle ?? p.description ?? "", pubDate: p.post_date });
      if (j.length < 50 || Math.min(...j.map(p => Date.parse(p.post_date)).filter(Number.isFinite)) < fromTs) break;
    }
  }

  // ---------------------------------------------------------------- Squarespace: ?format=json lists 20 items and says where the next page starts (offset)
  async function squarespace(src, have, sink) {
    const base = new URL(src.backfill?.json ?? src.feed ?? src.page); base.searchParams.delete("format"); base.searchParams.delete("offset");
    let offset = "";
    for (let n = 0; n < maxPagesDefault; n++) {
      const u = new URL(base); u.searchParams.set("format", "json"); if (offset) u.searchParams.set("offset", String(offset));
      const j = JSON.parse(await fetchText(u.href, "application/json")), items = j.items ?? [];
      for (const it of items) { const t = it.publishOn ?? it.addedOn; if (it.title && it.fullUrl && t) sink.push({ title: it.title, link: new URL(it.fullUrl, base).href, description: it.excerpt ?? "", pubDate: new Date(t).toISOString() }); }
      if (!j.pagination?.nextPage || !items.length || Math.min(...items.map(it => it.publishOn ?? it.addedOn).filter(Number.isFinite)) < fromTs) break;
      offset = j.pagination.nextPageOffset;
    }
  }

  // ---------------------------------------------------------------- a listing page's numbered pages (?page=2 or /page/2/); the page's own reader finds the stories and their dates
  async function pagePaged(src, have, sink) {
    const bf = src.backfill ?? {}, maxP = bf.pages ?? 60, seen = new Set(have.map(r => normUrl(itemLink(r))));
    for (let p = 2; p <= maxP; p++) {
      const u = new URL(src.page);
      if (bf.pagePath) u.pathname = u.pathname.replace(/\/?$/, "/") + bf.pagePath.replace("{n}", p); else u.searchParams.set(bf.pageParam ?? "page", String(p));
      let html; try { html = await fetchText(u.href, "text/html"); } catch (e) { if (p === 2) throw e; break; }
      const recs = pageRecords(html, src), fresh = recs.filter(r => !seen.has(normUrl(itemLink(r))));
      if (!recs.length || !fresh.length) break; // no story with a date inside the period, or the same page again
      for (const r of fresh) seen.add(normUrl(itemLink(r)));
      sink.push(...fresh);
    }
  }

  // ---------------------------------------------------------------- Google News by date: the search's own words, with "when:30d" replaced by a window
  // Google answers at most 100 stories a search, so a window that comes back nearly full is split in two until it is a single day.
  const stripWhen = q => q.replace(/\s*\bwhen:\d+[hdmy]\b/gi, "").replace(/\s+/g, " ").trim();
  const googleAt = (feedUrl, q) => { const u = new URL(feedUrl); u.searchParams.set("q", q); return u.href; };
  const sliceMemo = new Map(); // two sources searching the same words over the same days ask Google once
  async function googleSlice(feedUrl, q0, a, b, sink, st) {
    const key = q0 + "|" + day(a) + "|" + day(b);
    let list = sliceMemo.get(key);
    if (!list) {
      try { list = await feedAt(googleAt(feedUrl, `${q0} after:${day(a)} before:${day(b)}`)); st.fail = 0; sliceMemo.set(key, list); }
      catch (e) { st.errors++; st.fail++; if (st.fail >= 8 || /time budget/.test(e.message)) throw new Error(`Google News stopped answering (${String(e.message).slice(0, 40)})`); return; } // one window that cannot be read is skipped; a run of them stops the search
    }
    if (list.length >= cap && b - a > DAY) { const mid = a + Math.max(1, Math.floor((b - a) / 2 / DAY)) * DAY; await googleSlice(feedUrl, q0, a, mid, sink, st); await googleSlice(feedUrl, q0, mid, b, sink, st); return; }
    if (list.length >= cap) st.capped++; // a single day with 100 stories or more: the rest are not reachable this way
    sink.push(...list);
  }
  async function googleRange(feedUrl, q0, lo, hi, step, sink, keep) {
    const st = { fail: 0, errors: 0, capped: 0 }, tmp = [];
    sink.st = st; // read by run(), so the report can say how many days were full or unread (not a shared variable: sources run side by side)
    try { for (let a = lo; a < hi; a += step) await googleSlice(feedUrl, q0, a, Math.min(a + step, hi), tmp, st); }
    finally { sink.push(...(keep ? tmp.filter(keep) : tmp)); }
  }
  const sameSite = host => r => { const h = hostOfUrl(r.source?.["@_url"] ?? ""); return !h || !host || h === host || h.endsWith("." + host) || host.endsWith("." + h); }; // a result from another publisher is not this site's story
  const GOOGLE = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en";
  async function google(src, have, sink) { // the source is a Google search, so the collector already treats its items as Google's
    const q = loosen(stripWhen(new URL(src.feed).searchParams.get("q") ?? "")), site = /\bsite:([^\s)"]+)/i.exec(q)?.[1];
    await googleRange(src.feed, q, fromTs, untilTs, (src.backfill?.windowDays ?? (site ? siteDays : broadDays)) * DAY, sink, site ? sameSite(hostOfUrl(site.split("/")[0])) : null);
  }
  async function googleSite(src, have, sink) { // a site without a feed that reaches far enough: Google News finds its stories
    const bf = src.backfill ?? {}, site = bf.site ?? hostOfUrl(src.home || src.feed || src.page || src.wp);
    if (!site) throw new Error("no site to search");
    const terms = bf.terms === undefined ? !!src.filter : bf.terms, words = typeof terms === "string" ? terms : terms ? TERMS : "";
    const reach = Math.min(untilTs, oldestOf(have) + DAY); // only the part that is still missing
    if (reach <= fromTs + GAP) return;
    const mine = []; // marked as Google's, so the collector reads the publisher and address from the result
    try { await googleRange(GOOGLE, `site:${site}` + (words ? " " + words : ""), fromTs, reach, (bf.windowDays ?? siteDays) * DAY, mine, sameSite(hostOfUrl(site.split("/")[0]))); }
    finally { sink.st = mine.st; sink.push(...mine.map(r => ({ ...r, _g: 1 }))); }
  }

  // ---------------------------------------------------------------- feeds that take a date range, read one range at a time and split when a range comes back full
  async function sliced(src, have, sink) {
    const S = src.backfill.sliced, step = (S.days ?? 31) * DAY, full = S.cap ?? 10, st = { capped: 0, errors: 0 };
    sink.st = st;
    const one = async (tpl, a, b) => {
      let list;
      try { list = await feedAt(tpl.replace("{from}", day(a)).replace("{to}", day(b))); } catch (e) { if (/time budget/.test(e.message)) throw e; st.errors++; return; }
      if (list.length >= full && b - a > DAY) { const mid = a + Math.max(1, Math.floor((b - a) / 2 / DAY)) * DAY; await one(tpl, a, mid); await one(tpl, mid, b); return; }
      if (list.length >= full) st.capped++;
      sink.push(...list);
    };
    for (const tpl of S.urls ?? []) for (let a = fromTs; a < untilTs; a += step) await one(tpl, a, Math.min(a + step, untilTs));
  }

  const STRATEGY = { wp, feed: feedPaged, blogger, substack, squarespace, page: pagePaged, google, "google-site": googleSite };
  const autoModes = src => {
    if (src.google) return ["google"];
    if (src.wp) return ["wp"];
    if (src.feed) return /\/feeds\/posts\/default/.test(src.feed) ? ["blogger"] : restable(src.feed) ? ["wp", "feed"] : ["feed"];
    if (src.page) return src.backfill?.pageParam || src.backfill?.pagePath ? ["page"] : [];
    return [];
  };
  const modesOf = src => src.backfill?.modes ?? [...autoModes(src), ...(src.backfill?.site ? ["google-site"] : [])];

  const applies = src => src.backfill !== false && (!only || only.test(src.name)) && (modesOf(src).length > 0 || !!src.backfill?.sliced);
  async function run(src, base) {
    const recs = [...base], tried = [], bad = e => ` failed (${String(e.message ?? e).slice(0, 70)})`;
    let reach = oldestOf(recs);
    for (const m of modesOf(src)) {
      if (reach <= fromTs + GAP && m !== "google") break; // already back to the start
      const fn = STRATEGY[m];
      if (!fn) { tried.push(`${m}: unknown`); continue; }
      const sink = []; let err = "";
      try { await fn(src, recs, sink); } catch (e) { err = bad(e); }
      const added = mergeInto(recs, sink), st = sink.st;
      tried.push(`${m} +${added}${err}${st?.capped ? `, ${st.capped} full days` : ""}${st?.errors ? `, ${st.errors} windows unread` : ""}`);
      reach = oldestOf(recs);
    }
    if (src.backfill?.sliced) {
      const sink = []; let err = "";
      try { await sliced(src, recs, sink); } catch (e) { err = bad(e); }
      const st = sink.st;
      tried.push(`ranges +${mergeInto(recs, sink)}${err}${st?.capped ? `, ${st.capped} full ranges` : ""}${st?.errors ? `, ${st.errors} ranges unread` : ""}`);
      reach = oldestOf(recs);
    }
    report.push({ name: src.name, n: recs.length, base: base.length, reach: Number.isFinite(reach) ? day(reach) : "-", how: tried.join("; ") });
    return recs;
  }
  const memo = new Map(); // a listing read by two sources (CAPAC is in News and in Policy) is deepened once
  const deep = (src, base) => {
    const key = JSON.stringify([src.feed, src.page, src.wp, !!src.google, src.backfill ?? null]);
    if (!memo.has(key)) memo.set(key, run(src, base));
    return memo.get(key).then(r => r.slice());
  };

  return {
    applies, deep, report, modesOf,
    print() { // one line per source, so the run log shows where each stopped
      log(`Backfill from ${day(fromTs)}: ${report.length} sources deepened.`);
      for (const r of [...report].sort((a, b) => a.name.localeCompare(b.name))) log(`  ${r.reach <= day(fromTs + GAP) ? "OK   " : "SHORT"} ${r.name}: ${r.base} -> ${r.n} stories, oldest ${r.reach} [${r.how}]`);
    },
  };
}
