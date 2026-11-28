// Story threads (scripts/threads.mjs): grouping of the same story from different outlets, and its wiring into scripts/fetch.mjs.
// usage: node threads_test.mjs <repo> [feed.json for the speed and invariant checks] [tmp dir]
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, copyFileSync, cpSync, symlinkSync } from "node:fs"; import { createHash } from "node:crypto"; import { execFile } from "node:child_process"; import { promisify } from "node:util";
const run = promisify(execFile);
const REPO = process.argv[2], FEED = process.argv[3] ?? (process.argv[2] + "/data/feed.json"), TMP = process.argv[4] ?? "/tmp/thr_test_tmp";
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const { assignThreads, THREAD_KINDS } = await import(REPO + "/scripts/threads.mjs");
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : (typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); ok.push(!!c); };
const sha7 = s => createHash("sha1").update(s).digest("hex").slice(0, 7);
const DAY = 864e5, T0 = Date.parse("2026-05-01T12:00:00Z");
// mk(id, outlet, headline, days after T0, kind, extra fields)
const mk = (id, s, h, day = 0, k = "news", more = {}) => ({ id, d: new Date(T0 + day * DAY).toISOString(), s, h, k, t: "GENERAL", ...more });
const together = (m, ...ids) => ids.every(i => m.has(i)) && new Set(ids.map(i => m.get(i))).size === 1;
const none = (m, ...ids) => ids.every(i => !m.has(i));

// ---------------------------------------------------------------- (a) the same story from different outlets
{
  const m = assignThreads([
    mk("a1", "Island Gazette", "Former Gov. Maria Santos dies at 88"),
    mk("a2", "Harbor Times", "Maria Santos, the state's first Filipina governor, dies at 88", 1),
    mk("a3", "Valley Radio", "Former governor Maria Santos, 88, has died", 1),
    mk("x1", "Island Gazette", "Council approves new bike lanes along the waterfront", 1),
  ]);
  chk("same story: three differently worded headlines from three outlets form one thread, an unrelated story stays out", together(m, "a1", "a2", "a3") && !m.has("x1"), [...m]);
  chk("thread id: 7 lowercase hex digits taken from the id of the earliest item (sha1)", m.get("a1") === sha7("a1") && /^[0-9a-f]{7}$/.test(m.get("a1")), m.get("a1"));
}
{
  const m = assignThreads([
    mk("b1", "Seattle Weekly", "Why Bellevue's transit levy matters to working families - Seattle Weekly"),
    mk("b2", "Eastside Voice", "Opinion: Why Bellevue's transit levy matters to working families", 1),
    mk("b3", "Puget Wire", "WATCH: Why Bellevue's transit levy matters to working families | Puget Wire", 2),
  ]);
  chk("boilerplate: an outlet name after ' - ' or ' | ' and a prefix such as 'Opinion:' or 'WATCH:' do not matter", together(m, "b1", "b2", "b3"), [...m]);
  const g = assignThreads([
    mk("g1", "Pacific Daily News", "Guam EPA gets draft plan for Andersen dieldrin investigation", 0, "news", { ph: "guampdn.com" }),
    mk("g2", "The Guam Daily Post", "Draft plan for Andersen dieldrin investigation now with Guam EPA", 1),
  ]);
  chk("a pair from the real feed (Guam EPA and the dieldrin plan) is linked", together(g, "g1", "g2"), [...g]);
  const mixed = assignThreads([mk("k1", "Rights Group", "Group condemns shooting of Daniel Okafor, calls for justice", 0, "statement"), mk("k2", "Metro Daily", "Group condemns shooting of Daniel Okafor and calls for justice", 0, "community"), mk("k3", "State Caucus", "Caucus condemns shooting of Daniel Okafor, calls for justice", 1, "govstmt")]);
  chk("the four kinds news, community, statement and govstmt cluster with each other", together(mixed, "k1", "k2", "k3"), [...mixed]);
  const names = assignThreads([mk("n1", "Nichi Bei", "Dolores Sibonga dies at 95, remembered as trailblazing council member"), mk("n2", "Pacific Citizen", "Dolores Sibonga, trailblazing Seattle council member, dies at 95", 1)]);
  chk("a story with a person's full name and a few other words is linked", together(names, "n1", "n2"), [...names]);
}

// ---------------------------------------------------------------- (b) different stories that share only generic words
{
  const m = assignThreads([
    mk("v1", "Poll Desk", "Asian American voters split on economy, new poll finds"), mk("v2", "Metro Daily", "Asian American voters turn out early in Georgia runoff", 1),
    mk("v3", "Ledger", "Asian American voters in Texas lean Democratic, survey shows", 2), mk("v4", "Courier", "Asian American voters in Nevada lean Republican, survey shows", 2),
    mk("h1", "City Beat", "Man charged with hate crime after attack on Asian woman in Queens", 3), mk("h2", "Bay Post", "Man charged with hate crime after attack on Asian woman in Oakland", 3),
    mk("h3", "Seattle Wire", "Teen arrested in anti-Asian hate crime near Seattle bus stop", 4), mk("h4", "Houston Daily", "Woman attacked in anti-Asian hate crime outside Houston grocery", 4),
    mk("d1", "Island Gazette", "Former Gov. Maria Santos dies at 88", 5), mk("d2", "Harbor Times", "Former Gov. Juan Perez dies at 88", 5),
    mk("s1", "Storm Desk", "Typhoon forecast: Guam braces for heavy rain and storm surge", 6), mk("s2", "Storm Radio", "Typhoon forecast: Hawaii braces for heavy rain and storm surge", 6),
    mk("p1", "Budget Beat", "Senate panel debates budget bill with new spending limits", 7), mk("p2", "Capitol Wire", "House committee debates budget bill with new spending cuts", 7),
  ]);
  chk("generic words: two different 'Asian American voters' stories do not link (also not with the same two words 'survey shows' and 'lean')", none(m, "v1", "v2", "v3", "v4"), [...m]);
  chk("two hate-crime stories in different cities (Queens, Oakland) that read alike do not link; neither do two with only 'anti-Asian hate crime' in common", none(m, "h1", "h2", "h3", "h4"), [...m]);
  chk("a headline that differs only in the person's name (and shares an age) is another story", none(m, "d1", "d2"), [...m]);
  chk("a story about Guam and a story about Hawaii in the same words are not one story (home-region names carry no weight as words, but they still tell places apart)", none(m, "s1", "s2"), [...m]);
  chk("two budget stories that share only a few words ('budget bill', 'debates') do not link", none(m, "p1", "p2"), [...m]);
  const m2 = assignThreads([mk("t1", "A Paper", "Man charged with hate crime after attack on Asian woman in Queens", 0), mk("t2", "B Paper", "Man charged with hate crime after attack on Asian woman in Queens, police say", 1)]);
  chk("the same hate-crime story twice (same city) does link", together(m2, "t1", "t2"), [...m2]);
}

// ---------------------------------------------------------------- (c) one outlet alone is not a thread
{
  const same = assignThreads([mk("o1", "Maui Now", "Council approves new bike lanes along the waterfront"), mk("o2", "Maui Now", "Council approves new bike lanes along the waterfront", 1), mk("o3", "Maui Now", "Council approves waterfront bike lanes", 1)]);
  chk("the same outlet three times does not form a thread", same.size === 0, [...same]);
  const variants = assignThreads([mk("p1", "Nichi Bei", "Council approves new bike lanes along the waterfront"), mk("p2", "Nichi Bei News", "Council approves new bike lanes along the waterfront", 1)]);
  chk("two spellings of one outlet's name count as the same outlet", variants.size === 0, [...variants]);
  const host = assignThreads([mk("q1", "Rep. Jill Tokuda", "Rep. Tokuda introduces resolution honoring Filipino immigration", 0, "statement", { u: "http://tokuda.house.gov/media/press-releases/a" }), mk("q2", "Representative Jill Tokuda (.gov)", "Rep. Tokuda introduces resolution honoring Filipino immigration", 0, "statement", { u: "https://news.google.com/rss/articles/xyz", ph: "tokuda.house.gov" })]);
  chk("one publisher under two names (same web address, also through a news search link) counts as one outlet", host.size === 0, [...host]);
  const withOther = assignThreads([mk("r1", "Maui Now", "Council approves new bike lanes along the waterfront"), mk("r3", "Kauai Now", "Council approves new bike lanes along the waterfront", 1), mk("r4", "Civil Beat", "Council approves waterfront bike lanes", 1), mk("r2", "Maui Now", "Council approves new bike lanes along the waterfront", 2)]);
  chk("once other outlets are in the thread, a repeat from the first outlet that is alike to two of its members can sit in it too", together(withOther, "r1", "r3", "r4", "r2"), [...withOther]);
  const lone = assignThreads([mk("r1", "Maui Now", "Council approves new bike lanes along the waterfront"), mk("r3", "Kauai Now", "Council approves new bike lanes along the waterfront", 1), mk("r2", "Maui Now", "Council approves new bike lanes along the waterfront", 2)]);
  chk("a same-outlet repeat that is alike only to one later member (not to the first item, not to two members) is left out", together(lone, "r1", "r3") && !lone.has("r2"), [...lone]);
}

// ---------------------------------------------------------------- (d) stability
{
  const base = [mk("s1", "Island Gazette", "Mayor Linda Park opens new Chinatown night market downtown", 0), mk("s2", "Harbor Times", "New Chinatown night market opens downtown, Mayor Linda Park cuts ribbon", 1)];
  const m1 = assignThreads(base), id1 = m1.get("s1");
  const later = mk("s3", "Valley Radio", "Chinatown night market opens downtown with Mayor Linda Park", 3), unrelated = mk("u1", "Valley Radio", "School board delays vote on lunch menu changes", 4);
  const m2 = assignThreads([...base, later, unrelated]);
  chk("a later item that joins the thread keeps its id, and an unrelated later item changes nothing", id1 && m2.get("s1") === id1 && m2.get("s2") === id1 && m2.get("s3") === id1 && !m2.has("u1"), [id1, [...m2]]);
  const m3 = assignThreads([...base, mk("s0", "Early Bird", "Chinatown night market opens downtown as Mayor Linda Park cuts ribbon", 0.5)]);
  chk("the id comes from the earliest item (an item between the two does not change it)", m3.get("s1") === sha7("s1"), [...m3]);
  const tie = assignThreads([mk("zz", "Island Gazette", "Mayor Linda Park opens new Chinatown night market downtown", 0), mk("aa", "Harbor Times", "New Chinatown night market opens downtown, Mayor Linda Park cuts ribbon", 0)]);
  chk("two items with the same time: the smaller id is the earliest, and so gives the thread id", tie.get("aa") === sha7("aa") && tie.get("zz") === sha7("aa"), [...tie]);
}

// ---------------------------------------------------------------- (e) time window and span
{
  const H = "Governor signs landmark water rights settlement with tribal nations";
  const at = (id, o, day) => mk(id, o, H, day);
  chk("window: two items exactly 5 days apart link, 5.5 days apart do not",
    assignThreads([at("w1", "A", 0), at("w2", "B", 5)]).size === 2 && assignThreads([at("w1", "A", 0), at("w2", "B", 5.5)]).size === 0);
  // days 0,2,4,...,16, each from another outlet: the thread may not reach over more than 14 days
  const days = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18], m = assignThreads(days.map((d, i) => at("c" + i, "Outlet " + i, d)), { ubiquitousMin: 1000 });
  const ids = [...m.keys()], spans = [...new Set(m.values())].map(t => { const mem = ids.filter(i => m.get(i) === t).map(i => days[+i.slice(1)]); return Math.max(...mem) - Math.min(...mem); });
  chk("span: items every 2 days from different outlets join one thread up to day 14 (8 items), and no thread reaches over more than 14 days", together(m, ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => "c" + i)) && spans.every(s => s <= 14), { ids, spans });
  chk("span: the item on day 16 is not in the day-0 thread", !(m.has("c8") && m.get("c8") === m.get("c0")), [...m]);
  const slow = assignThreads([0, 4, 8, 12].map((d, i) => at("l" + i, "Slow " + i, d)), { ubiquitousMin: 1000 });
  chk("no chaining: items 4 days apart only link in pairs (day 8 is alike to day 4 only, which is neither the first item nor one of two members)", slow.size === 4 && together(slow, "l0", "l1") && together(slow, "l2", "l3") && slow.get("l0") !== slow.get("l2"), [...slow]);
}
{
  const many = Array.from({ length: 55 }, (_, i) => mk("m" + String(i).padStart(2, "0"), "Outlet " + i, "Typhoon Mawar makes landfall with destructive winds across the island", i % 3 === 0 ? 0 : 1));
  const m = assignThreads(many, { ubiquitousMin: 1000 }), sizes = {}; for (const t of m.values()) sizes[t] = (sizes[t] ?? 0) + 1;
  chk("size cap: a story that 55 outlets report is split, no thread has more than 40 items", Math.max(...Object.values(sizes)) === 40 && Object.keys(sizes).length >= 2, sizes);
}

// ---------------------------------------------------------------- (f) kinds
{
  const H = "Congress passes resolution recognizing Pacific Islander Heritage Month";
  const m = assignThreads(["bill", "official", "statebill", "research", "order", "hearing"].map((k, i) => mk("k" + i, "Source " + i, H, 0, k)));
  chk("kinds bill, official, statebill, research, order and hearing are never clustered (even six outlets, same headline)", m.size === 0, [...m]);
  const m2 = assignThreads([mk("n1", "Outlet One", H, 0, "news"), mk("b1", "Outlet Two", H, 0, "bill"), mk("o1", "Outlet Three", H, 0, "hearing")]);
  chk("a news item never joins a bill or a hearing with the same headline", m2.size === 0, [...m2]);
  chk("THREAD_KINDS is exactly news, community, statement, govstmt", [...THREAD_KINDS].sort().join() === "community,govstmt,news,statement");
}

// ---------------------------------------------------------------- (g) determinism, no changes to the input, odd input
{
  const items = [
    mk("e1", "Island Gazette", "Former Gov. Maria Santos dies at 88"), mk("e2", "Harbor Times", "Maria Santos, the state's first Filipina governor, dies at 88", 1), mk("e3", "Valley Radio", "Former governor Maria Santos, 88, has died", 1),
    mk("f1", "Seattle Weekly", "Why Bellevue's transit levy matters to working families"), mk("f2", "Eastside Voice", "Opinion: Why Bellevue's transit levy matters to working families", 1),
    mk("g1", "A", "Man charged with hate crime after attack on Asian woman in Queens", 2), mk("g2", "B", "Man charged with hate crime after attack on Asian woman in Queens", 2), mk("g3", "C", "Man charged with hate crime after attack on Asian woman in Oakland", 2),
    mk("z1", "A", "Council approves new bike lanes along the waterfront", 3), mk("z2", "A", "Council approves new bike lanes along the waterfront", 3), mk("z3", "B", "Council approves new bike lanes along the waterfront", 3),
  ];
  const frozen = JSON.stringify(items), base = [...assignThreads(items)].sort(), rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  let same = true; for (let i = 0; i < 12; i++) { const sh = [...items].sort(() => rnd() - 0.5); same &&= JSON.stringify([...assignThreads(sh)].sort()) === JSON.stringify(base); }
  chk("determinism: the same items in 12 different orders give the same result", same && base.length >= 5, base);
  chk("the items are not changed (no field added, none removed)", JSON.stringify(items) === frozen);
  chk("the result is a Map from item id to thread id; items without a thread are not in it", assignThreads(items) instanceof Map && ![...assignThreads(items).keys()].some(i => i === "g3"));
  const dupId = assignThreads([mk("d1", "A", "Council approves new bike lanes along the waterfront"), mk("d1", "B", "Council approves new bike lanes along the waterfront", 1)]);
  chk("an id that occurs twice counts once (never a thread of one item with itself)", dupId.size === 0, [...dupId]);
  const odd = assignThreads([null, undefined, {}, { id: "x", k: "news" }, { id: "y", k: "news", h: "Fine headline about something", d: "not a date", s: "A" }, mk("o1", "A", ""), mk("o2", "B", "")]);
  chk("odd items (null, no headline, no date, empty headline) are skipped without an error", odd instanceof Map && odd.size === 0);
  chk("empty input and no input give an empty Map", assignThreads([]).size === 0 && assignThreads().size === 0 && assignThreads(null).size === 0);
  const nonLatin = assignThreads([mk("j1", "朝日新聞", "ハワイ州知事が会見"), mk("j2", "毎日新聞", "ハワイ州知事が会見", 1)]);
  chk("headlines without Latin letters give no thread (and no error)", nonLatin.size === 0);
}

// ---------------------------------------------------------------- (h) the real feed
if (existsSync(FEED)) {
  const feed = JSON.parse(readFileSync(FEED, "utf8")), items = feed.items, copy = JSON.stringify(items);
  const t0 = performance.now(), m = assignThreads(items), ms = performance.now() - t0;
  chk(`speed: ${items.length} items in ${ms.toFixed(0)} ms (limit 5000 ms)`, ms < 5000, ms);
  chk("the real feed is not changed", JSON.stringify(items) === copy);
  const byId = new Map(items.map(i => [i.id, i])), th = new Map(); for (const [id, t] of m) (th.get(t) ?? th.set(t, []).get(t)).push(byId.get(id));
  chk("real feed: there are threads, but few items (under 15%) are threaded", th.size >= 50 && m.size > 0 && m.size / items.length < 0.15, [th.size, m.size]);
  const bad = [];
  for (const [t, a] of th) {
    const ds = a.map(i => Date.parse(i.d)), first = [...a].sort((x, y) => Date.parse(x.d) - Date.parse(y.d) || (x.id < y.id ? -1 : 1))[0];
    if (a.length < 2 || a.length > 40) bad.push(["size", t, a.length]);
    if (new Set(a.map(i => i.s)).size < 2) bad.push(["one outlet", t]);
    if ((Math.max(...ds) - Math.min(...ds)) / DAY > 14) bad.push(["span", t]);
    if (a.some(i => !THREAD_KINDS.has(i.k))) bad.push(["kind", t]);
    if (t !== sha7(first.id)) bad.push(["id", t, first.id]);
    if (!/^[0-9a-f]{7}$/.test(t)) bad.push(["format", t]);
    // every member is within 5 days of some other member
    for (const i of a) if (!a.some(j => j !== i && Math.abs(Date.parse(i.d) - Date.parse(j.d)) <= 5 * DAY)) bad.push(["window", t, i.id]);
  }
  chk("real feed: every thread has 2 to 40 items, 2+ outlets, only news kinds, a span of at most 14 days, every item within 5 days of another, and an id that is the sha1 of its earliest item", bad.length === 0, bad.slice(0, 5));
  const rev = assignThreads([...items].reverse()), shuf = assignThreads([...items].sort((a, b) => (a.id < b.id ? 1 : -1)));
  const key = mm => JSON.stringify([...mm].sort());
  chk("real feed: reversed and re-ordered input gives exactly the same threads", key(rev) === key(m) && key(shuf) === key(m));
  // stability: the feed without its newest week keeps (nearly) all thread ids
  const cut = Math.max(...items.map(i => Date.parse(i.d))) - 7 * DAY, old = assignThreads(items.filter(i => Date.parse(i.d) <= cut));
  let kept = 0, changed = 0; for (const [id, t] of old) { if (m.get(id) === t) kept++; else if (m.has(id)) changed++; }
  chk(`real feed: when the newest week is added, ${kept} of ${old.size} thread ids stay and ${changed} change (at least 95% stay, at most 1% change)`, kept / old.size >= 0.95 && changed / old.size <= 0.01, [kept, changed, old.size]);
} else console.log("SKIP real-feed checks (no feed at " + FEED + ")");

// ---------------------------------------------------------------- the collector: wiring, a stale id, a broken clustering module
{
  const REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), now = Date.now();
  const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map(i => `<item><title>${i[0]}</title><link>${i[1]}</link><pubDate>${new Date(now - (i[2] ?? 1) * 36e5).toUTCString()}</pubDate><description>${i[3] ?? ""}</description></item>`).join("")}</channel></rss>`;
  const FEEDS = {
    "/a.xml": rss([["Asian American groups sue over new Texas land law that bans Chinese buyers", "http://a.example/1", 3], ["Asian American students win national robotics title in Houston", "http://a.example/2", 5]]),
    "/b.xml": rss([["Texas land law banning Chinese buyers is challenged in court by Asian American groups", "http://b.example/1", 2], ["Asian American chef opens third restaurant in Portland", "http://b.example/2", 4]]),
  };
  const srv = http.createServer((q, r) => { const b = FEEDS[new URL(q.url, "http://x").pathname]; if (b) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(b); } else { r.writeHead(404); r.end(); } });
  await new Promise(res => srv.listen(0, "127.0.0.1", res));
  const base = "http://127.0.0.1:" + srv.address().port;
  const cfg = { keepDays: 30, maxItems: 400, kinds: {}, renames: REAL.renames, excludeHosts: REAL.excludeHosts, excludeNames: REAL.excludeNames, blockForeignDomains: false, allowHosts: REAL.allowHosts, gatedHosts: REAL.gatedHosts, researchMax: REAL.researchMax, routes: REAL.routes, trustedOutlets: REAL.trustedOutlets, communityPattern: REAL.communityPattern, usOutlets: REAL.usOutlets, pacificNations: REAL.pacificNations, usTie: REAL.usTie, usTieCase: REAL.usTieCase, travelPlaces: REAL.travelPlaces, travelWords: REAL.travelWords, siteUrl: "", sources: [{ name: "Alpha News", home: base, feed: base + "/a.xml" }, { name: "Beta Times", home: base, feed: base + "/b.xml" }] };
  const go = async (dir, scripts, outName = "data/feed.json", pre) => {
    mkdirSync(dir + "/data", { recursive: true }); writeFileSync(dir + "/sources.json", JSON.stringify(cfg)); if (pre) writeFileSync(dir + "/" + outName, JSON.stringify(pre));
    const r = await run("node", [scripts + "/fetch.mjs"], { env: { ...process.env, SOURCES: dir + "/sources.json", OUT: dir + "/" + outName } });
    return { log: r.stdout, err: r.stderr, feed: JSON.parse(readFileSync(dir + "/" + outName, "utf8")) };
  };
  const a = await go(TMP + "/w1", REPO + "/scripts"), by = h => a.feed.items.find(i => i.h.startsWith(h));
  const t1 = by("Asian American groups sue over new Texas"), t2 = by("Texas land law banning");
  chk("collector: the two outlets' reports of the Texas land law share a thread id (7 hex digits), the other stories have no 'th' field at all", t1?.th && t1.th === t2?.th && /^[0-9a-f]{7}$/.test(t1.th) && a.feed.items.filter(i => "th" in i).length === 2, a.feed.items.map(i => [i.s, i.h.slice(0, 30), i.th]));
  chk("collector: no new top-level key in feed.json (still generated, sources, items and the usual optional ones)", Object.keys(a.feed).every(k => ["generated", "sources", "taxo", "hubs", "items"].includes(k)), Object.keys(a.feed));
  const a2 = await go(TMP + "/w1", REPO + "/scripts", "data/feed.json"); // second run on the same folder: nothing new, so no rewrite
  chk("collector: a second run with the same stories says 'No changes' (the thread ids are stable)", /No changes/.test(a2.log), a2.log.slice(-200));
  // a thread id left over from an earlier run is not trusted: a stored story from the last run (no longer in any feed) that carries one loses it
  const oldItem = { ...a.feed.items.find(i => i.h.startsWith("Asian American chef")), id: "0123456789ab", h: "Asian American nonprofit opens food pantry in Fresno", u: "http://old.example/1", s: "Gamma Gazette", th: "abcdef0" };
  const stale = [...JSON.parse(JSON.stringify(a.feed.items)), oldItem];
  const s = await go(TMP + "/w2", REPO + "/scripts", "data/feed.json", { generated: "2026-01-01T00:00:00Z", sources: [], items: stale });
  const kept = s.feed.items.find(i => i.id === "0123456789ab");
  chk("collector: a story kept from the last run with an old, wrong 'th' is stored without it, and the real thread is recomputed", kept && !("th" in kept) && s.feed.items.find(i => i.h.startsWith("Asian American groups sue")).th === t1.th, s.feed.items.map(i => [i.h.slice(0, 25), i.th]));
  // a broken clustering module must never stop a run
  cpSync(REPO + "/scripts", TMP + "/broken/scripts", { recursive: true }); symlinkSync(REPO + "/node_modules", TMP + "/broken/node_modules"); for (const f of ["taxonomy.json", "hubs.json", "orgs.json", "package.json"]) copyFileSync(REPO + "/" + f, TMP + "/broken/" + f);
  writeFileSync(TMP + "/broken/scripts/threads.mjs", 'export function assignThreads() { throw new Error("boom"); }\n');
  const bk = await go(TMP + "/w3", TMP + "/broken/scripts", "data/feed.json", { generated: "2026-01-01T00:00:00Z", sources: [], items: stale });
  chk("collector: when the clustering code throws, the run still finishes, writes the feed, says so, and no story keeps a 'th' (not even an old one)", bk.feed.items.length === 5 && !bk.feed.items.some(i => "th" in i) && /Story threads skipped: boom/.test(bk.err + bk.log), bk.err.slice(-200));
  writeFileSync(TMP + "/broken/scripts/threads.mjs", "export const x = ;\n"); // a syntax error
  const bk2 = await go(TMP + "/w4", TMP + "/broken/scripts");
  chk("collector: even a syntax error in the clustering module only costs the threads", bk2.feed.items.length === 4 && !bk2.feed.items.some(i => "th" in i) && /Story threads skipped/.test(bk2.err + bk2.log));
  srv.close();
}

console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
