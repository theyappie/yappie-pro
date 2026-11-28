// The 2026 backfill (scripts/backfill.mjs + "keepFrom" in scripts/fetch.mjs), against a mock server that answers the way each kind of site does:
// WordPress REST (and one that refuses), a paged feed, a feed that ignores paging, Squarespace JSON, Substack's archive, Blogger, numbered listing pages, a feed that takes a date range,
// Google News by date (a site search and a broad search, each with a week or three days that come back full), and the government APIs.
// usage: node collector_backfill_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { createHash } from "node:crypto";
import { FR, EXEC_N, EXEC_I, CG_BILLS, CG_SUMS, REGS, GI_N, GI_I } from "./fixtures.mjs";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const DAY = 864e5, FROM = Date.parse("2026-01-01T00:00:00Z"), SPAN = Math.floor((Date.now() - FROM) / DAY) - 4; // days of 2026 so far, minus a margin
const dayIso = d => new Date(FROM + (d + 0.5) * DAY).toISOString(), dd = d => dayIso(d).slice(0, 10), pubD = iso => new Date(iso).toUTCString();
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const idOf = u => createHash("sha1").update(u).digest("hex").slice(0, 12);
const spread = (n, lo = 2, hi = SPAN) => Array.from({ length: n }, (_, i) => lo + Math.floor(i * (hi - lo) / n)); // n days from lo up to hi, oldest first
const xml = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.join("")}</channel></rss>`;
const it = (title, link, d, desc = "", extra = "") => `<item><title>${esc(title)}</title><link>${link}</link><description>${esc(desc)}</description><pubDate>${pubD(dayIso(d))}</pubDate>${extra}</item>`;

// ---- the stories each fake site holds (numbered so every headline is different)
const HL = (tag, n) => `Fixture bf ${tag} ${n}: Asian American residents weigh in`;
const WP = spread(250).map((d, i) => ({ n: i, d })), WP_OLD = [{ n: 900, iso: "2025-12-20T12:00:00" }];                   // root site: 250 posts in 2026 and one from 2025
const PRESS = spread(60).map((d, i) => ({ n: i, d })), WP2 = spread(120).map((d, i) => ({ n: i, d })), BLK = spread(40).map((d, i) => ({ n: i, d }));
const PAGED = spread(45).map((d, i) => ({ n: i, d })), FLAT = spread(30).map((d, i) => ({ n: i, d })), SQ = spread(60).map((d, i) => ({ n: i, d })), SUB = spread(120).map((d, i) => ({ n: i, d })), BLOG = spread(200).map((d, i) => ({ n: i, d }));
const LIST = spread(50).map((d, i) => ({ n: i, d })), ZLIST = spread(30).map((d, i) => ({ n: i, d }));
const RANGE_A = [...spread(13, 20, 40), ...Array.from({ length: 12 }, (_, i) => 60 + i)].map((d, i) => ({ n: i, d })), RANGE_B = spread(8, 5, SPAN).map((d, i) => ({ n: 100 + i, d }));   // 25 and 8 stories; 12 of the first within 12 days
const OUTLET = [...spread(20, 3, 90), ...Array.from({ length: 120 }, (_, i) => 98 + (i % 7))].map((d, i) => ({ n: i, d, src: "outlet.example", pub: "Search Outlet" })); // 140 stories; 120 in one week (Google returns at most 100)
const FOREIGN = spread(6, 60, 65).map((d, i) => ({ n: 500 + i, d, src: "other.example", pub: "Other Paper" }));                                                  // results that are another publisher's, not the outlet's
const PUBS = [["alpha.example", "Alpha Times"], ["beta.example", "Beta Post"], ["gamma.example", "Gamma Daily"]];
const SEARCH = [...spread(140, 2, SPAN - 1), ...Array.from({ length: 130 }, (_, i) => 150 + (i % 3))].map((d, i) => ({ n: i, d, src: PUBS[i % 3][0], pub: PUBS[i % 3][1] })); // 270 stories; 130 within three days
const hits = { wp: [], rest: [], google: [], paged: [], flat: [], range: [], sq: [], sub: [], blog: [], list: [], zlist: [], fr: [], exec: [], cg: [], regs: [], gi: [] };
const restPosts = (rows, tag, q) => {
  const after = Date.parse((q.get("after") || "1970-01-01T00:00:00") + "Z"), per = +q.get("per_page") || 10, page = +q.get("page") || 1;
  const all = rows.map(r => ({ link: `https://wp.example/${tag}/${r.n}`, title: { rendered: HL(tag, r.n) }, date_gmt: r.iso ?? dayIso(r.d).slice(0, 19), excerpt: { rendered: "<p>Short summary.</p>" } })).filter(p => Date.parse(p.date_gmt + "Z") > after).sort((a, b) => b.date_gmt.localeCompare(a.date_gmt));
  return page > Math.max(1, Math.ceil(all.length / per)) ? null : all.slice((page - 1) * per, page * per);
};
const feedOf = (rows, tag, host, n = 10) => xml([...rows].sort((a, b) => b.d - a.d).slice(0, n).map(r => it(HL(tag, r.n), `https://${host}/${tag}/${r.n}`, r.d, "")));
const title = r => r.src === "outlet.example" ? `Fixture bf outlet ${r.n}: School board votes on the lunch menu` : HL(r.src === "other.example" ? "foreign" : "gsearch", r.n); // the outlet's headlines do not name the communities: the search did
const gnews = (q, rows) => {
  const after = /after:(\d{4}-\d\d-\d\d)/.exec(q)?.[1], before = /before:(\d{4}-\d\d-\d\d)/.exec(q)?.[1], recent = /when:/.test(q); // a normal run asks for "when:7d": the newest few
  return xml(rows.filter(r => (!after || dd(r.d) >= after) && (!before || dd(r.d) < before)).sort((a, b) => b.d - a.d).slice(0, recent ? 3 : 100)
    .map(r => it(`${title(r)} - ${r.pub}`, `https://news.google.com/rss/articles/${r.src}-${r.n}`, r.d, "", `<source url="https://${r.src}">${r.pub}</source>`)));
};
let blocked403 = 0;
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x"), P = u.pathname, sp = u.searchParams, J = (b, c = 200) => { r.writeHead(c, { "content-type": "application/json" }); r.end(JSON.stringify(b)); }, X = b => { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(b); }, N = c => { r.writeHead(c); r.end("{}"); };
  if (P === "/feed/") X(feedOf(WP, "wp", "wp.example"));
  else if (P === "/category/press/feed/") X(feedOf(PRESS, "press", "wp.example", 5));
  else if (P === "/wp-json/wp/v2/categories") J(sp.get("slug") === "press" ? [{ id: 7 }] : []);
  else if (P === "/wp-json/wp/v2/posts") { hits.wp.push(u.search); const rows = restPosts(sp.get("categories") === "7" ? PRESS : [...WP, ...WP_OLD], sp.get("categories") === "7" ? "press" : "wp", sp); rows ? J(rows) : J({ code: "rest_post_invalid_page_number" }, 400); }
  else if (P === "/wp2/posts") { hits.rest.push(u.search); const rows = restPosts(WP2, "wp2", sp); rows ? J(rows) : J({ code: "rest_post_invalid_page_number" }, 400); }
  else if (P === "/blocked/wp-json/posts") { blocked403++; N(403); }
  else if (P === "/blocked/feed.xml") X(feedOf(BLK.map(b => ({ ...b })), "blk", "wp.example", 10).replace(/<\/channel>/, "</channel>") ), hits.paged.push("blk");
  else if (P === "/paged.xml") { const p = +sp.get("paged") || 1; hits.paged.push(p); const rows = [...PAGED].sort((a, b) => b.d - a.d).slice((p - 1) * 10, p * 10); rows.length ? X(xml(rows.map(r => it(HL("paged", r.n), `https://wp.example/paged/${r.n}`, r.d)))) : N(404); }
  else if (P === "/flat.xml") { hits.flat.push(sp.get("paged") || 1); X(feedOf(FLAT, "flat", "wp.example", 10)); }
  else if (P === "/sq/press") { hits.sq.push(u.search); const rows = [...SQ].sort((a, b) => b.d - a.d), off = sp.get("offset") ? +sp.get("offset") : Infinity;
    if (sp.get("format") === "rss") X(feedOf(SQ, "sq", "wp.example", 10)); else { const left = rows.filter(r => Date.parse(dayIso(r.d)) < off), page = left.slice(0, 20); J({ items: page.map(r => ({ title: HL("sq", r.n), fullUrl: `/sq/press/${r.n}`, publishOn: Date.parse(dayIso(r.d)), excerpt: "" })), pagination: left.length > 20 ? { nextPage: true, nextPageOffset: Date.parse(dayIso(page.at(-1).d)) } : {} }); } }
  else if (P === "/substack/feed") X(feedOf(SUB, "sub", "wp.example", 10));
  else if (P === "/api/v1/archive") { hits.sub.push(u.search); const off = +sp.get("offset"), lim = +sp.get("limit"); J([...SUB].sort((a, b) => b.d - a.d).slice(off, off + lim).map(r => ({ canonical_url: `https://wp.example/sub/${r.n}`, title: HL("sub", r.n), post_date: dayIso(r.d), subtitle: "" }))); }
  else if (P === "/feeds/posts/default") { hits.blog.push(u.search); const max = +sp.get("max-results") || 25, st = +sp.get("start-index") || 1; X(xml([...BLOG].sort((a, b) => b.d - a.d).slice(st - 1, st - 1 + max).map(r => it(HL("blog", r.n), `https://wp.example/blog/${r.n}`, r.d)))); }
  else if (P === "/listing") { const p = +sp.get("page") || 1; hits.list.push(p); const rows = [...LIST].sort((a, b) => b.d - a.d).slice((p - 1) * 10, p * 10);
    r.writeHead(200, { "content-type": "text/html" }); r.end(`<html><body><nav><a href="/org/about">About</a></nav><main>${rows.map(x => `<div><a href="/org/story/s${x.n}"><h3>${HL("list", x.n)}</h3><time datetime="${dayIso(x.d)}">x</time></a></div>`).join("")}</main></body></html>`); }
  else if (P === "/zlisting") { const p = +sp.get("page") || 0; hits.zlist.push(p); const rows = [...ZLIST].sort((a, b) => b.d - a.d).slice(p * 10, (p + 1) * 10); // Drupal-style: the first page is ?page=0, the date and summary sit under the headline
    r.writeHead(200, { "content-type": "text/html" }); r.end(`<html><body><main>${rows.map(x => `<article><h3><a href="/org/z/z${x.n}"><span>${HL("zlist", x.n)}</span></a></h3><div class="d">${dayIso(x.d).slice(5, 7)}/${dayIso(x.d).slice(8, 10)}/${dayIso(x.d).slice(0, 4)}</div><div><p>Summary of the story number ${x.n} for readers.</p></div></article>`).join("")}</main></body></html>`); }
  else if (P === "/range/base.xml") X(feedOf(RANGE_A, "range", "wp.example", 5));
  else if (P === "/range/rss") { hits.range.push(u.search); const rows = sp.get("q") === "a" ? RANGE_A : RANGE_B, a = sp.get("start_date"), b = sp.get("end_date"); X(xml(rows.filter(x => dd(x.d) >= a && dd(x.d) <= b).sort((x, y) => y.d - x.d).slice(0, 10).map(x => it(HL("range", x.n), `https://wp.example/range/${x.n}`, x.d)))); }
  else if (P === "/outlet-feed.xml") X(xml([it("Fixture bf outlet recent: Asian American group elects chair", "https://outlet.example/recent", SPAN - 2)]));
  else if (P === "/news.google.com/rss/search") { const qq = sp.get("q") ?? ""; hits.google.push(qq); X(gnews(qq, /site:outlet.example/.test(qq) ? [...OUTLET, ...FOREIGN] : /site:/.test(qq) ? [] : SEARCH)); }
  else if (P === "/gsearch-feed.xml") X(xml([it(`${HL("gsearch", 9999)} - Alpha Times`, "https://news.google.com/rss/articles/recent", SPAN - 1, "", '<source url="https://alpha.example">Alpha Times</source>')]));
  else if (P === "/plain.xml") X(xml([it("Fixture bf plain 1: Asian American club opens", "https://wp.example/plain/1", SPAN - 3), it("Fixture bf plain 2: Asian American club elects", "https://wp.example/plain/2", SPAN - 2)]));
  else if (P === "/fr") { hits.fr.push(u.search); J(sp.get("page") === "1" || !sp.get("page") ? FR : { results: [] }); }
  else if (P === "/fr-exec") { hits.exec.push(u.search); J(/immigration/i.test(sp.get("conditions[term]") ?? "") ? EXEC_I : EXEC_N); }
  else if (P.startsWith("/cg/") || P.startsWith("/regs") || P === "/gi/search") {
    if (q.headers["x-api-key"] !== "TESTKEY") { N(403); return; }
    const send = b => { r.writeHead(200, { "content-type": "application/json", "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "900" }); r.end(JSON.stringify(b)); };
    if (P.startsWith("/regs")) { hits.regs.push(u.search); send(REGS); } else if (P === "/gi/search") { let b = ""; q.on("data", c => b += c); q.on("end", () => { hits.gi.push(b); send(/immigration/i.test(b) ? GI_I : GI_N); }); }
    else { hits.cg.push(P + u.search); send(P === "/cg/bill/119" ? CG_BILLS : P === "/cg/summaries/119" ? CG_SUMS : {}); }
  } else N(404);
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); ok.push(!!c); };
  process.env.TEST_BASE = base; process.env.NODE_OPTIONS = "--import " + new URL("./shim_backfill.mjs", import.meta.url).href;
  const B = base + "/news.google.com/rss/search?q=" + encodeURIComponent('"Asian American" OR AAPI when:7d') + "&hl=en-US&gl=US&ceid=US:en";
  const cfg = {
    keepDays: 30, maxItems: 5, researchMax: 3, policyMax: 2, policyKeepDays: 120, keepFrom: "2026-01-01", backfill: { delayMs: 0, retries: 1, retryMs: 1, maxPages: 60, googleWindowDays: 7, googleBroadDays: 3, googleCap: 90, deadlineMinutes: 5 },
    kinds: {}, renames: {}, excludeHosts: [], excludeNames: [], blockForeignDomains: false, allowHosts: [], gatedHosts: [], routes: [], trustedOutlets: ["Alpha Times", "Beta Post", "Gamma Daily"], communityPattern: "asian american|aapi",
    sources: [
      { name: "WP Site", home: base, feed: base + "/feed/" },
      { name: "WP Press", home: base, feed: base + "/category/press/feed/", kind: "statement" },
      { name: "WP Explicit", home: base, wp: base + "/wp2/posts?per_page=20&_fields=link,title,date_gmt,excerpt" },
      { name: "WP Blocked", home: base, feed: base + "/blocked/feed.xml", backfill: { modes: ["wp", "feed"], rest: base + "/blocked/wp-json/posts" } },
      { name: "Paged Feed", home: base, feed: base + "/paged.xml", backfill: { modes: ["feed"] } },
      { name: "Flat Feed", home: base, feed: base + "/flat.xml", backfill: { modes: ["feed"] } },
      { name: "Squarespace Org", home: base, feed: base + "/sq/press?format=rss", kind: "statement", backfill: { modes: ["squarespace"], json: base + "/sq/press" } },
      { name: "Substack Blog", home: base, feed: base + "/substack/feed", backfill: { modes: ["substack"], origin: base } },
      { name: "Blogger Blog", home: base, feed: base + "/feeds/posts/default?alt=rss&redirect=false" },
      { name: "Listing Org", home: base, page: base + "/listing", link: "^/org/story/[^/]+$", kind: "statement", backfill: { modes: ["page"], pageParam: "page", pages: 40 } },
      { name: "Zero Listing", home: base, page: base + "/zlisting", link: "^/org/z/[^/]+$", kind: "statement", numericDates: true, descAfter: true, backfill: { modes: ["page"], pageParam: "page", pageFrom: 1, pages: 40 } },
      { name: "Range Feed", home: base, feed: base + "/range/base.xml", kind: "statement", backfill: { modes: [], sliced: { days: 31, cap: 10, urls: [base + "/range/rss?q=a&start_date={from}&end_date={to}", base + "/range/rss?q=b&start_date={from}&end_date={to}"] } } },
      { name: "Search Outlet", home: "https://outlet.example", feed: base + "/outlet-feed.xml", filter: true, backfill: { modes: ["google-site"], site: "outlet.example" } },
      { name: "Google Search", home: base, google: true, feed: B },
      { name: "Skipped Source", home: base, feed: base + "/plain.xml", backfill: false },
    ],
  };
  const writeCfg = (c = cfg) => writeFileSync(TMP + "/sources.json", JSON.stringify(c));
  const D = f => TMP + "/data/" + f, readJ = f => { try { return JSON.parse(readFileSync(D(f), "utf8")); } catch { return null; } };
  const go = async (env = {}, dir = TMP) => { try { return { code: 0, log: (await run("node", [REPO + "/scripts/fetch.mjs"], { env: { ...process.env, API_DATA_GOV_KEY: "TESTKEY", SOURCES: dir + "/sources.json", OUT: dir + "/data/feed.json", ...env }, maxBuffer: 1 << 26, timeout: 240000 })).stdout }; } catch (e) { return { code: e.code, log: String(e.stdout) + String(e.stderr) }; } };
  mkdirSync(TMP + "/data/articles", { recursive: true }); writeCfg();
  const items = () => readJ("feed.json").items, by = re => items().filter(i => re.test(i.h)), has = (re, n) => by(re).length === n;
  // ---- stored stories from earlier runs: Search Outlet's from February (older than 30 days, in no feed), one from 2025 (before keepFrom), and a headline that repeats (twice within days, and again months later)
  const stored = (id, s, h, d, extra = {}) => ({ id, d: d + "T12:00:00.000Z", s, h, m: "", u: "https://wp.example/stored/" + id, k: "news", t: "CULTURE", cm: [], st: [], ...extra });
  writeFileSync(D("feed.json"), JSON.stringify({ generated: "2026-10-01T00:00:00Z", items: [
    stored("st000000001", "WP Site", "Fixture bf stored 1: Asian American teachers honored", "2026-02-10"),
    stored("st000000002", "WP Site", "Fixture bf stored 2: Asian American group from 2025", "2025-11-01"),
    stored("st000000003", "WP Site", "Fixture bf repeat: Asian American weekly roundup", "2026-04-01"),
    stored("st000000004", "WP Site", "Fixture bf repeat: Asian American weekly roundup", "2026-04-02"),
    stored("st000000005", "WP Site", "Fixture bf repeat: Asian American weekly roundup", "2026-07-15"),
    ...Array.from({ length: 12 }, (_, i) => stored("stcap" + String(i).padStart(7, "0"), "WP Site", `Fixture bf cap ${i}: Asian American neighbors meet`, "2026-03-" + String(10 + i))),
  ] }));
  // ================================================================ run 1: a normal run (no backfill)
  let r = await go();
  chk("normal run: ends well", r.code === 0, r.log.slice(-400));
  chk("normal run: no backfill report; no REST list, no paging, no search by date", !/Backfill from/.test(r.log) && hits.wp.length === 0 && hits.google.every(q => /when:/.test(q)) && hits.paged.every(p => p === 1 || p === "blk") && hits.flat.every(p => p === 1), JSON.stringify([hits.wp.length, hits.google, hits.paged]));
  chk("keepFrom: a February story that is in no feed stays (older than the 30 days), and none of the 12 stored 'cap' stories is cut by maxItems 5", has(/stored 1:/, 1) && has(/bf cap/, 12), by(/stored 1:|bf cap/).length);
  chk("keepFrom: a story from 2025 (before the start day, older than 30 days) is dropped", has(/group from 2025/, 0));
  chk("a headline that repeats within days is one story; the same headline months later is another", has(/bf repeat/, 2), JSON.stringify(by(/bf repeat/).map(i => i.d.slice(0, 10))));
  chk("a plain run reads each feed's newest stories as before (WP Site feed: 10; the page listing: its first page)", has(/bf wp \d+:/, 10) && has(/bf list/, 10) && has(/bf paged/, 10), JSON.stringify([by(/bf wp \d+:/).length, by(/bf list/).length, by(/bf paged/).length]));
  const n1 = items().length;
  // ================================================================ run 2: the backfill
  for (const k in hits) hits[k] = []; blocked403 = 0;
  r = await go({ BACKFILL: "1" });
  const log2 = r.log;
  chk("backfill run: ends well and prints the report", r.code === 0 && /Backfill from 2026-01-01: 14 sources deepened/.test(log2), log2.slice(-600));
  const line = name => (log2.split("\n").find(l => new RegExp("^\\s+(OK|SHORT)\\s+" + name + ": ").test(l)) ?? "").trim(); // the backfill report's line for a source
  chk("a source typed backfill:false is left alone (not in the report; its newest stories are still read)", line("Skipped Source") === "" && has(/bf plain/, 2) === true);
  chk("WordPress REST (found from the feed's address): all 250 posts of 2026, none from 2025, in pages of 100", has(/bf wp \d+:/, 250) && has(/bf wp 900/, 0) && hits.wp.some(s => /categories/.test(s)) && hits.wp.filter(s => !/categories/.test(s)).length === 3 && hits.wp.some(s => /per_page=100/.test(s) && /after=2026-01-01T00%3A00%3A00/.test(s)), JSON.stringify([by(/bf wp \d+:/).length, hits.wp.length]));
  chk("WordPress REST for a category feed: looked up the category id, all 60 posts", has(/bf press/, 60), by(/bf press/).length);
  chk("WordPress REST given as a source's own 'wp' address: all 120 posts", has(/bf wp2/, 120), by(/bf wp2/).length);
  chk("a REST list that answers 403 falls through to the feed's own paging (the feed here ignores paging, so the 10 it shows stay)", has(/bf blk/, 10) && /wp \+0 failed \(HTTP 403\)/.test(line("WP Blocked")) && blocked403 === 1, line("WP Blocked"));
  chk("paged feed: pages 2 to 5 read, then the 404 stops it: all 45", has(/bf paged/, 45) && Math.max(...hits.paged.filter(p => typeof p === "number")) === 6, JSON.stringify(hits.paged));
  chk("a feed that ignores ?paged= stops at once instead of looping, and the report says it stopped short", has(/bf flat/, 10) && hits.flat.length === 2 && /^SHORT/.test(line("Flat Feed")), JSON.stringify([hits.flat, line("Flat Feed")]));
  chk("Squarespace JSON: all 60 by offset, 3 requests", has(/bf sq/, 60) && hits.sq.filter(s => /format=json/.test(s)).length === 3, JSON.stringify(hits.sq));
  chk("Substack archive: all 120 in 3 requests", has(/bf sub/, 120) && hits.sub.length === 3, JSON.stringify(hits.sub));
  chk("Blogger: published-min and start-index: all 200 in 2 requests", has(/bf blog/, 200) && hits.blog.filter(s => /published-min=2026-01-01/.test(s)).length === 2, JSON.stringify(hits.blog));
  chk("numbered listing pages: all 50", has(/bf list/, 50), by(/bf list/).length);
  chk("a listing numbered from 0 (pageFrom 1): all 30, the second page (?page=1) included, and each story keeps its own summary", has(/bf zlist/, 30) && hits.zlist.includes(1) && items().filter(i => /bf zlist/.test(i.h)).every(i => /^Summary of the story number \d+ for readers\.$/.test(i.m ?? "")), JSON.stringify([by(/bf zlist/).length, hits.zlist, items().find(i => /bf zlist/.test(i.h))?.m]));
  chk("a feed that takes a date range: all 25 + 8 (a month with 12 came back full and was split)", has(/bf range/, 33) && hits.range.some(s => /q=a/.test(s)) && hits.range.length > 20, JSON.stringify([by(/bf range/).length, hits.range.length]));
  const g = hits.google, siteQ = g.filter(q => /site:outlet.example/.test(q)), broadQ = g.filter(q => !/site:/.test(q) && !/when:/.test(q));
  console.log(`(info) Google News searches: ${siteQ.length} for the site, ${broadQ.length} for the broad search`);
  chk("Google News by date for a site: no 'when:', dates on every search, the AAPI words added (it is a 'filter' source), all 140 (the full week was split)", siteQ.length > 0 && siteQ.every(q => !/when:/.test(q) && /after:2026-\d\d-\d\d before:2026-\d\d-\d\d/.test(q) && /Asian American/.test(q)) && has(/bf outlet \d+:/, 140), JSON.stringify([siteQ.length, by(/bf outlet \d+:/).length]));
  chk("Google News for a site: another publisher's results are not that site's stories", has(/bf foreign/, 0));
  chk("Google News stories of an ordinary source keep its name and carry the publisher's address; the title's ' - Publisher' tail is gone", by(/bf outlet \d+:/).every(i => i.s === "Search Outlet" && !/ - Search Outlet/.test(i.h) && /news\.google\.com/.test(i.u)), JSON.stringify(by(/bf outlet 1:/)));
  chk("a story found through Google is shown without its headline naming the communities (the search matched the whole text)", by(/bf outlet \d+:/).length === 140);
  chk("a Google search source: windows of three days with 'when:' replaced; the three busy days (130 stories) were split; all 270", broadQ.length > 0 && broadQ.every(q => !/when:/.test(q) && /after:/.test(q)) && has(/bf gsearch \d+:/, 270), JSON.stringify([broadQ.length, by(/bf gsearch \d+:/).length]));
  chk("a Google search source keeps each story's own publisher", new Set(by(/bf gsearch \d+:/).map(i => i.s)).size === 3 && by(/bf gsearch 1:/)[0]?.s === "Beta Post", JSON.stringify(by(/bf gsearch 1:/)));
  chk("report: sources that reached 2026-01 are OK", ["WP Site", "WP Press", "Paged Feed", "Squarespace Org", "Substack Blog", "Blogger Blog", "Listing Org", "Search Outlet"].every(n => /^OK/.test(line(n))), ["WP Site", "Paged Feed", "Search Outlet"].map(line).join(" | "));
  chk("no story is listed twice (by address, or by headline within days)", new Set(items().map(i => i.u)).size === items().length);
  chk("every backfilled story is dated inside 2026", items().every(i => i.d >= "2026-01-01"));
  const n2 = items().length;
  chk("the feed holds the whole year, far more than maxItems 5 and the old 400-story cap logic would allow", n2 > 1300 && n2 > n1 + 1100, n2);
  // ================================================================ run 3: a normal run after the backfill keeps all of it
  for (const k in hits) hits[k] = [];
  r = await go();
  chk("normal run after the backfill: nothing aged out or capped", r.code === 0 && items().length >= n2 && has(/bf wp \d+:/, 250) && has(/bf outlet \d+:/, 140) && has(/stored 1:/, 1), JSON.stringify([items().length, n2]));
  chk("a normal run does not page, search by date or use the REST lists again", hits.wp.length === 0 && hits.google.every(q => /when:/.test(q)) && hits.sq.every(s => /format=rss/.test(s)) && hits.sub.length === 0 && hits.range.length === 0, JSON.stringify({ wp: hits.wp.length, g: hits.google.length }));
  // ================================================================ BACKFILL_ONLY, and a backfill when the day is already read
  for (const k in hits) hits[k] = [];
  r = await go({ BACKFILL: "1", BACKFILL_ONLY: "^Paged" });
  chk("BACKFILL_ONLY limits the backfill to the sources whose name matches", r.code === 0 && /Backfill from 2026-01-01: 1 sources deepened/.test(r.log) && hits.wp.length === 0 && hits.google.every(q => /when:/.test(q)), r.log.slice(-300));
  r = await go({ BACKFILL: "1" });
  chk("a second full backfill changes nothing (every story is already held)", r.code === 0 && items().length === n2, [items().length, n2]);
  // ================================================================ approval: stories the backfill finds go live; one already waiting stays waiting
  { const T2 = TMP + "_ap", AD = T2 + "/private"; rmSync(T2, { recursive: true, force: true }); mkdirSync(T2 + "/data/articles", { recursive: true }); mkdirSync(AD, { recursive: true });
    const AM = await import(REPO + "/scripts/admin.mjs"), st = AM.emptyState(); st.settings.approval = { mode: "all", sources: [], kinds: [] }; writeFileSync(AD + "/admin.json", JSON.stringify(st));
    writeFileSync(T2 + "/sources.json", JSON.stringify({ ...cfg, sources: [{ name: "Plain Feed", home: base, feed: base + "/plain.xml" }, cfg.sources[0], cfg.sources[2]] }));
    let a = await go({ ADMIN_DIR: AD }, T2);
    const pend = () => { try { return JSON.parse(readFileSync(AD + "/pending.json", "utf8")).items; } catch { return []; } }, live = () => JSON.parse(readFileSync(T2 + "/data/feed.json", "utf8")).items;
    chk("approval 'all': a normal run sends the new stories to the waiting list", a.code === 0 && pend().length >= 12 && live().length === 0, JSON.stringify([pend().length, a.log.slice(-200)]));
    const waiting = pend().length;
    a = await go({ ADMIN_DIR: AD, BACKFILL: "1" }, T2);
    chk("approval 'all': what the backfill finds goes live (the owner asked for the year's record); the 20 + 10 newest, which were already waiting, do not", a.code === 0 && live().filter(i => /bf wp2/.test(i.h)).length === 100 && live().filter(i => /bf wp \d+:/.test(i.h)).length === 240, JSON.stringify([live().filter(i => /bf wp2/.test(i.h)).length, live().filter(i => /bf wp \d+:/.test(i.h)).length, a.log.slice(-200)]));
    chk("approval 'all': stories that were already waiting stay waiting", pend().some(i => /bf plain 1/.test(i.h)) && !live().some(i => /bf plain/.test(i.h)) && pend().length >= waiting, JSON.stringify([pend().length, waiting])); }
  // ================================================================ the government sources: windows start at keepFrom, closed comment periods count
  { const T3 = TMP + "_gov"; rmSync(T3, { recursive: true, force: true }); mkdirSync(T3 + "/data/articles", { recursive: true });
    const gcfg = { ...cfg, sources: [{ name: "Plain Feed", home: base, feed: base + "/plain.xml" }], backfill: { ...cfg.backfill, gov: { apiRequests: 80, frPerTerm: 500, frPages: 3, execPerTerm: 500, congressPages: 5, regsPages: 2, govinfoPages: 3 } },
      federalRegister: { enabled: true, api: base + "/fr", terms: ['"Native Hawaiian"', '"Pacific Islander"'], issueTerms: ["immigration"], skipTitle: "^(Sunshine Act|Notice of (Inventory Completion|Intended Repatriation)|Agency Information Collection Activities)", perTerm: 3, days: 45 },
      executiveActions: { enabled: true, api: base + "/fr-exec", terms: ['"Pacific Islander"'], issueTerms: ["immigration"], skipTitle: "\\b(Day|Week|Month)\\b.*\\b20\\d\\d$", days: 120 },
      regulations: { enabled: true, api: base + "/regs", terms: ['"Native Hawaiian"'], issueTerms: ["immigration"], skipTitle: "^Sunshine Act" },
      govinfo: { enabled: true, api: base + "/gi", days: 60, terms: ['"Native Hawaiian"', '"Pacific Islander"'], issueTerms: ["immigration"] }, apiBudget: { perRun: 50, keepFraction: 0.25 }, congress: { enabled: true, api: base + "/cg", days: 10, maxPages: 2 } };
    writeFileSync(T3 + "/sources.json", JSON.stringify(gcfg));
    for (const k in hits) hits[k] = [];
    let a = await go({}, T3), f = () => JSON.parse(readFileSync(T3 + "/data/feed.json", "utf8")).items;
    const normal = { fr: hits.fr.slice(), exec: hits.exec.slice(), cg: hits.cg.slice(), regs: hits.regs.slice(), gi: hits.gi.slice() };
    const closedFR = /Immigration fee rule with a closed comment period/, closedRegs = /Immigration comment period that already closed/, openNotice = /Immigration benefit fee reporting requirements/;
    chk("government, normal run: windows are the usual days; a closed immigration rule is not listed", a.code === 0 && normal.fr.every(s => /per_page=3/.test(s) && !/2026-01-01/.test(s)) && !f().some(i => closedFR.test(i.h) || closedRegs.test(i.h)) && f().some(i => openNotice.test(i.h)), JSON.stringify(normal.fr[0]));
    for (const k in hits) hits[k] = [];
    rmSync(T3 + "/data/feed.json", { force: true });
    a = await go({ BACKFILL: "1" }, T3);
    chk("government, backfill: Federal Register, executive actions, Congress, Regulations.gov and GovInfo are all asked from 2026-01-01", a.code === 0 && hits.fr.length > 0 && hits.fr.every(s => /conditions%5Bpublication_date%5D%5Bgte%5D=2026-01-01/.test(s) && /per_page=500/.test(s)) && hits.exec.every(s => /2026-01-01/.test(s) && /per_page=500/.test(s)) && hits.cg.every(s => /fromDateTime=2026-01-01T00%3A00%3A00Z/.test(s)) && hits.regs.every(s => /postedDate%5D%5Bge%5D=2026-01-01/.test(s) && /page%5Bsize%5D=250/.test(s)) && hits.gi.every(b => /publishdate:range\(2026-01-01,\)/.test(b)) && hits.cg.length >= 2 && hits.regs.length >= 1 && hits.gi.length >= 1, JSON.stringify({ fr: hits.fr[0], exec: hits.exec[0], cg: hits.cg[0], regs: hits.regs[0], gi: hits.gi[0] }));
    chk("government, backfill: a closed-comment immigration rule (Federal Register) and a closed one on Regulations.gov are listed", f().some(i => closedFR.test(i.h)) && f().some(i => closedRegs.test(i.h)), f().map(i => i.h).join(" | ").slice(0, 400));
    chk("government, backfill: an immigration notice found only through a related-issue word is left out (too many)", !f().some(i => openNotice.test(i.h)));
    chk("government, backfill: the request count is reported against the backfill allowance", /API key requests this run: \d+ of 80 allowed/.test(a.log), a.log.split("\n").find(l => /API key/.test(l)));
    chk("government, backfill: items are policy kinds with their dates in 2026", f().filter(i => ["official", "bill", "order", "hearing"].includes(i.k)).length >= 6 && f().every(i => i.d >= "2026-01-01"), f().map(i => i.k).join(",")); }
  srv.close(); const bad = ok.filter(x => !x).length; console.log(bad ? `BACKFILL TEST: ${bad} FAILED of ${ok.length}` : `BACKFILL TEST: all ${ok.length} passed`); process.exit(bad ? 1 : 0);
});
