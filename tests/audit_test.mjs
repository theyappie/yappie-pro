// Regression tests for the November 2026 audit of the collector (scripts/fetch.mjs). No network: fetch is replaced by canned answers (audit14/agentB/t/stub.mjs).
// usage: node audit_test.mjs <repo> <tmp dir>
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3];
const STUB = new URL("./stub.mjs", import.meta.url).pathname;
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0;
const chk = (name, ok, info) => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || info === undefined ? "" : " " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 700)}`); };
const now = Date.now(), ago = h => new Date(now - h * 36e5), rfc = d => d.toUTCString();
const item = (t, link, hoursAgo, extra = "") => `<item><title>${t}</title><link>${link}</link>${hoursAgo === null ? "" : `<pubDate>${rfc(ago(hoursAgo))}</pubDate>`}${extra}</item>`;
const rss = (...items) => `<rss version="2.0"><channel><title>x</title>${items.join("")}</channel></rss>`;
const gitem = (t, n, pub, site, hoursAgo = 2) => `<item><title>${t} - ${pub}</title><link>https://news.google.com/rss/articles/${n}?oc=5</link><pubDate>${rfc(ago(hoursAgo))}</pubDate><source url="${site}">${pub}</source></item>`;
const BASE = { keepDays: 30, maxItems: 400, keepFrom: "2026-01-01", blockForeignDomains: true, communityPattern: "\\b(asian[- ]?americans?|aapi|pacific islanders?|native hawaiians?|hmong)\\b" };
const G = { name: "Google News: AAPI", home: "https://news.google.com", feed: "https://news.google.com/rss/search?q=aapi", google: true };
let caseNo = 0;
async function go(name, cfg, routes, o = {}) {
  const d = join(TMP, o.dir ?? `${++caseNo}-${name}`); mkdirSync(join(d, "data"), { recursive: true });
  writeFileSync(join(d, "cfg.json"), JSON.stringify({ ...BASE, ...cfg })); writeFileSync(join(d, "routes.json"), JSON.stringify(routes));
  for (const f of ["nohubs.json"]) writeFileSync(join(d, f), '{"hubs":[]}'); writeFileSync(join(d, "noorgs.json"), '{"orgs":[]}');
  if (o.feed !== undefined) writeFileSync(join(d, "data/feed.json"), typeof o.feed === "string" ? o.feed : JSON.stringify(o.feed));
  if (o.admin) writeFileSync(join(d, "data/admin.json"), JSON.stringify(o.admin));
  const env = { ...process.env, SOURCES: join(d, "cfg.json"), OUT: join(d, "data/feed.json"), STUB_ROUTES: join(d, "routes.json"), HUBS: join(d, "nohubs.json"), ORGS: join(d, "noorgs.json"), ADMIN_DIR: "", API_DATA_GOV_KEY: "", CONGRESS_API_KEY: "", OPENSTATES_API_KEY: "", HOST_GAP_MS: "0", ...(o.env ?? {}) }; // no pause between requests to one site, except in the case that tests the pause
  const t0 = Date.now(); let code = 0, out = "";
  try { const r = await run("node", ["--import", STUB, join(REPO, "scripts/fetch.mjs")], { env, timeout: o.timeout ?? 120000, maxBuffer: 64e6 }); out = r.stdout + r.stderr; } catch (e) { code = e.code ?? 1; out = (e.stdout ?? "") + (e.stderr ?? "") + (e.killed ? "\nKILLED (timeout)" : ""); }
  let feed = null, raw = ""; try { raw = readFileSync(join(d, "data/feed.json"), "utf8"); feed = JSON.parse(raw); } catch { /* none or unreadable */ }
  return { d, code, out, feed, raw, ms: Date.now() - t0, items: feed?.items ?? [] };
}
const stored = (id, s, h, u, hoursAgo, extra = {}) => ({ id, d: ago(hoursAgo).toISOString(), s, h, u, k: "news", t: "CULTURE", ...extra });
const feedOf = (items, sources = []) => ({ generated: ago(0.2).toISOString(), sources, items });

// ---------------------------------------------------------------- 1. a look-alike publisher on a blocked domain does not erase a source
{
  const cfg = { kinds: { "Rafu Shimpo": "community" }, sources: [{ name: "Rafu Shimpo", home: "https://rafu.example", feed: "https://rafu.example/feed" }, G] };
  const old = feedOf([1, 2, 3].map(n => stored("aaaaaaaaaaa" + n, "Rafu Shimpo", `Asian American community story number ${n} from the stored feed`, `https://rafu.example/story-${n}`, 40 + n, { k: "community" })));
  const routes = { "https://rafu.example/feed": { body: rss(item("Asian American festival returns to Little Tokyo this weekend", "https://rafu.example/new-1", 3)) }, [G.feed]: { body: rss(gitem("Asian American readers love this casino", "L1", "Rafu Shimpo", "https://rafu-shimpo.co")) } };
  const r = await go("lookalike-blocked-domain", cfg, routes, { feed: old });
  const mine = r.items.filter(i => i.s === "Rafu Shimpo");
  chk("a publisher with a source's name on a blocked (foreign) domain: the source's stored stories and its new one all stay", r.code === 0 && mine.length === 4 && [1, 2, 3].every(n => mine.some(i => i.id === "aaaaaaaaaaa" + n)), { code: r.code, n: mine.length, tail: r.out.slice(-300) });
  chk("... and the look-alike's own story is not listed at all", !r.items.some(i => /casino/.test(i.h)), r.items.map(i => i.s + ": " + i.h));
  const r2 = await go("lookalike-blocked-domain", cfg, { ...routes, [G.feed]: { body: rss() } }, { dir: `${caseNo}-lookalike-blocked-domain` });
  chk("... and nothing is lost on the run after the look-alike has gone", r2.items.filter(i => i.s === "Rafu Shimpo").length === 4, r2.items.length);
}
// ---------------------------------------------------------------- 2. a look-alike name does not inherit a source's page and trust
{
  const cfg = { kinds: { "Stop AAPI Hate": "statement", "Pew Research Center": "research", "Rafu Shimpo": "community" }, renames: { "AP News": "Associated Press" },
    sources: [{ name: "Rafu Shimpo", home: "https://rafu.example", feed: "https://rafu.example/feed" }, { name: "Stop AAPI Hate", home: "https://stopaapihate.example", feed: "https://stopaapihate.example/feed", kind: "statement" }, { name: "Pew Research Center", home: "https://www.pew.example", feed: "https://www.pew.example/feed", kind: "research" },
      { name: "Associated Press", asName: "Associated Press", home: "https://apnews.example", feed: "https://news.google.com/rss/search?q=site%3Aapnews.example+aapi", google: true }, G] };
  const empty = { body: rss() };
  const routes = { "https://rafu.example/feed": empty, "https://stopaapihate.example/feed": empty, "https://www.pew.example/feed": empty, "https://news.google.com/rss/search?q=site%3Aapnews.example+aapi": { body: rss(gitem("Asian American voters and the midterms", "A1", "AP News", "https://apnews.example")) },
    [G.feed]: { body: rss(gitem("Best crypto casinos reviewed for 2026", "S1", "Stop AAPI Hate", "https://stop-aapi-hate.example"), gitem("New survey: readers prefer our casino partner", "P1", "Pew Research Center", "https://pew-research-center.example"), gitem("Casino night roundup and betting tips", "F1", "Rafu Shimpo", "https://rafu-shimpo.example"),
      gitem("Asian American seniors targeted by casino buses", "F2", "Rafu Shimpo", "https://rafu-shimpo.example"), gitem("Real statement on anti-Asian hate and Asian American safety", "S2", "Stop AAPI Hate", "https://stopaapihate.example"), gitem("Asian Americans and religion: a real report", "P2", "Pew Research Center", "https://pew.example"),
      gitem("Asian American farmers in the valley", "X1", "AP News", "https://apnews.example"), gitem("Asian American chefs to watch", "X2", "AP News", "https://ap-news-wire.example")) } };
  const r = await go("lookalike-name", cfg, routes);
  const by = n => r.items.find(i => i.u.includes("/articles/" + n + "?"));
  chk("a casino headline under an advocacy group's, a research center's or an outlet's name from another site is not published", r.code === 0 && !by("S1") && !by("P1") && !by("F1"), [by("S1"), by("P1"), by("F1")]);
  chk("a story that names the communities from such a site is shown under the site's address as ordinary news, not under the source's name or page", by("F2")?.s === "rafu-shimpo.example" && by("F2").k === "news", by("F2"));
  chk("the real sources' own Google News results keep their name and page (same site, or a subdomain either way)", by("S2")?.s === "Stop AAPI Hate" && by("S2").k === "statement" && by("P2")?.s === "Pew Research Center" && by("P2").k === "research", [by("S2"), by("P2")]);
  chk("a name that sources.json renames to a source's name is checked the same way", by("A1")?.s === "Associated Press" && by("X1")?.s === "Associated Press" && by("X2")?.s === "ap-news-wire.example", [by("A1")?.s, by("X1")?.s, by("X2")?.s]);
  chk("the log says which publishers were shown by address", /Shown by web address[^\n]*:\n(?:  .*\n)*  Rafu Shimpo: rafu-shimpo\.example/.test(r.out), r.out.slice(-600));
}
// ---------------------------------------------------------------- 3. publisher names that every object answers to
{
  const names = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];
  const r = await go("proto-names", { sources: [G], renames: { "Old Name": "New Name" }, kinds: { "New Name": "community" } }, { [G.feed]: { body: rss(...names.map((n, i) => gitem(`Asian American story number ${i} about a parade`, "N" + i, n, `https://site${i}.example`)), gitem("Asian American story from the renamed outlet", "R1", "Old Name", "https://old.example")) } });
  chk("publishers named constructor, toString, valueOf, hasOwnProperty and __proto__ are stored under those names, as text", r.code === 0 && names.every(n => r.items.some(i => i.s === n && typeof i.s === "string" && i.k === "news")), r.items.map(i => i.s));
  chk("... and a real rename still works", r.items.some(i => i.s === "New Name" && i.k === "community"), r.items.map(i => [i.s, i.k]));
}
// ---------------------------------------------------------------- 4. an unreadable feed file stops the run
{
  const cfg = { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }] }, routes = { "https://a.example/feed": { body: rss(item("Asian American story one", "https://a.example/1", 2)) } };
  const good = JSON.stringify(feedOf(Array.from({ length: 30 }, (_, n) => stored("bbbbbbbbbb" + String(n).padStart(2, "0"), "Outlet A", `Stored Asian American story ${n}`, `https://a.example/old-${n}`, 50 + n, n < 3 ? { v: 1 } : {})))), cut = good.slice(0, good.length - 200);
  const d0 = join(TMP, "prep-truncated"); mkdirSync(join(d0, "data/articles"), { recursive: true });
  const r = await go("truncated-feed", cfg, routes, { feed: cut });
  chk("a feed file that is cut short: the run stops with an error and the file is left exactly as it was", r.code === 1 && r.raw === cut && /cannot be read/.test(r.out), { code: r.code, same: r.raw === cut, tail: r.out.slice(-200) });
  const r1 = await go("not-a-feed-object", cfg, routes, { feed: "[1,2,3]" });
  chk("a feed file that is not a feed (no list of items): the run stops too", r1.code === 1 && r1.raw === "[1,2,3]", { code: r1.code, tail: r1.out.slice(-200) });
  const r2 = await go("no-feed-yet", cfg, routes);
  chk("no feed file at all is a first run and works", r2.code === 0 && r2.items.length === 1, { code: r2.code, n: r2.items.length });
}
// ---------------------------------------------------------------- 5. dates
{
  const cfg = { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }, { name: "Advocacy Org", home: "https://org.example", page: "https://org.example/news", link: "^/news/[a-z0-9-]+$", kind: "statement" }] };
  const feedBody = rss(item("Asian American story with no date", "https://a.example/nodate", null), `<item><title>Asian American story from Honolulu</title><link>https://a.example/hst</link><pubDate>Mon, 09 Nov 2026 10:00:00 HST</pubDate></item>`,
    `<item><title>Asian American story from Guam</title><link>https://a.example/chst</link><pubDate>Mon, 09 Nov 2026 10:00:00 ChST</pubDate></item>`, `<item><title>Asian American story from Anchorage</title><link>https://a.example/akst</link><pubDate>Mon, 09 Nov 2026 10:00:00 AKST</pubDate></item>`,
    `<item><title>Asian American story dated next year</title><link>https://a.example/future</link><pubDate>Mon, 15 Feb 2027 10:00:00 GMT</pubDate></item>`);
  const page = `<html><body><ul><li><a href="/news/gala-date"><h3>Asian American gala set for December 5, 2027</h3></a><span>November 9, 2026</span></li><li><a href="/news/plain"><h3>Asian American statement on housing</h3></a><span>November 8, 2026</span></li></ul></body></html>`;
  const routes = { "https://a.example/feed": { body: feedBody }, "https://org.example/news": { body: page, headers: { "content-type": "text/html" } } };
  const a = await go("dates", cfg, routes); await new Promise(r => setTimeout(r, 1500));
  const b = await go("dates", cfg, routes, { dir: `${caseNo}-dates` });
  const d = (r, u) => r.items.find(i => i.u.endsWith(u))?.d;
  chk("a story with no date keeps the time of the run that first saw it", a.code === 0 && d(a, "/nodate") && d(a, "/nodate") === d(b, "/nodate"), [d(a, "/nodate"), d(b, "/nodate")]);
  chk("a story dated in the future is stamped once, not on every run", d(a, "/future") && d(a, "/future") === d(b, "/future") && Date.parse(d(a, "/future")) <= Date.now(), [d(a, "/future"), d(b, "/future")]);
  chk("time zones written as HST, ChST and AKST are read", d(a, "/hst") === "2026-11-09T20:00:00.000Z" && d(a, "/chst") === "2026-11-09T00:00:00.000Z" && d(a, "/akst") === "2026-11-09T19:00:00.000Z", [d(a, "/hst"), d(a, "/chst"), d(a, "/akst")]);
  chk("a listing: a date in a headline that lies ahead is not taken as the day the story was published", d(a, "/news/gala-date")?.startsWith("2026-11-09") && d(a, "/news/plain")?.startsWith("2026-11-08"), [d(a, "/news/gala-date"), d(a, "/news/plain")]);
  chk("the second run with the same answers changes nothing", /No changes\./.test(b.out), b.out.slice(-200));
}
// ---------------------------------------------------------------- 6. one odd item does not lose its source
{
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">1984</title><link href="https://atom.example/1984"/><updated>${ago(3).toISOString()}</updated></entry><entry><title>Asian American book club reads a classic</title><link href="https://atom.example/club"/><updated>${ago(4).toISOString()}</updated></entry></feed>`;
  const cfg = { sources: [{ name: "Atom Outlet", home: "https://atom.example", feed: "https://atom.example/feed" }, G] };
  const routes = { "https://atom.example/feed": { body: atom }, [G.feed]: { body: rss(gitem("Asian American &#x110000; odd entity", "E1", "Entity Times", "https://entity.example"), gitem("Asian American &#99999999999; another", "E2", "Entity Times", "https://entity.example"), gitem("Asian American ordinary story", "E3", "Entity Times", "https://entity.example"), `<item><title>Asian American control \u0008chars &amp;#8; here</title><link>https://news.google.com/rss/articles/E4?oc=5</link><pubDate>${rfc(ago(2))}</pubDate><source url="https://entity.example">Entity Times</source></item>`) } };
  const r = await go("odd-items", cfg, routes);
  chk("an Atom title that is a number does not fail its source", r.code === 0 && r.items.some(i => i.u === "https://atom.example/club") && /OK {3}Atom Outlet: /.test(r.out), r.out.slice(-400));
  chk("a character reference outside Unicode does not fail the search it came in", r.items.filter(i => i.s === "Entity Times").length === 4 && /OK {3}Google News: AAPI: 4 items/.test(r.out), r.items.filter(i => i.s === "Entity Times").map(i => i.h));
  chk("characters that XML does not allow are not stored", !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.raw), "control characters in feed.json");
  // the RSS files built from it are well-formed for those characters
  const bo = await run("node", [join(REPO, "scripts/build-outputs.mjs")], { env: { ...process.env, SOURCES: join(r.d, "cfg.json"), OUT: join(r.d, "data/feed.json") } }).then(() => 0, e => (console.log(String(e.stderr).slice(-300)), 1));
  chk("the outputs step builds from that feed", bo === 0 && existsSync(join(r.d, "data/latest.json")), bo);
}
// ---------------------------------------------------------------- 7. limits: a flood, giant fields, patterns that used to take minutes, a body that never ends
{
  const many = Array.from({ length: 30001 }, (_, n) => item(`Asian American flood story ${n}`, `https://flood.example/s/${n}`, 1 + n / 1000)).join("");
  const cfg = { sources: [{ name: "Small Community Paper", home: "https://flood.example", feed: "https://flood.example/feed" }, { name: "Fine Outlet", home: "https://fine.example", feed: "https://fine.example/feed" }] };
  const fine = { body: rss(item("Asian American story from the fine outlet", "https://fine.example/1", 2)) };
  let r = await go("flood", cfg, { "https://flood.example/feed": { body: rss(many) }, "https://fine.example/feed": fine });
  chk("a source that suddenly lists 30,001 items adds at most 300 in a run", r.code === 0 && r.items.filter(i => i.s === "Small Community Paper").length === 300 && /lists 30001 items; only the first 300 were read/.test(r.out), { n: r.items.length, tail: r.out.slice(-200) });
  const longH = "Asian American " + "very long headline ".repeat(120000), longU = "https://flood.example/" + "a".repeat(800000);
  r = await go("giant-fields", cfg, { "https://flood.example/feed": { body: rss(item(longH, "https://flood.example/long-headline", 2), item("Asian American story with a giant link", longU, 2), item("Asian American normal story", "https://flood.example/normal", 3)) }, "https://fine.example/feed": fine });
  const lh = r.items.find(i => i.u === "https://flood.example/long-headline");
  chk("a 2 MB headline is cut to 300 characters and a 0.8 MB link is left out; the feed file stays small", r.code === 0 && lh && lh.h.length <= 300 && lh.h.endsWith("…") && !r.items.some(i => i.u.length > 2000) && r.items.some(i => i.u === "https://flood.example/normal") && r.raw.length < 5000, { h: lh?.h.length, bytes: r.raw.length });
  r = await go("slow-patterns", { sources: [...cfg.sources, { name: "Listing Org", home: "https://list.example", page: "https://list.example/news", link: "^/news/[a-z0-9-]+$", kind: "statement" }] }, { "https://flood.example/feed": { body: rss(item("Asian American story with a hostile description", "https://flood.example/hostile", 2, `<description>${"&lt;".repeat(400000)}</description>`), item("Asian American story two", "https://flood.example/two", 2, `<description><![CDATA[${"<".repeat(600000)}]]></description>`)) }, "https://fine.example/feed": fine, "https://list.example/news": { body: "<html><body>" + "<a ".repeat(300000) + `<a href="/news/real-one"><h3>Asian American statement that is real</h3></a><time datetime="${ago(5).toISOString()}"></time></body></html>` } }, { timeout: 60000 });
  chk(`descriptions and a listing page made of hundreds of thousands of "<" and "<a" are read in seconds (took ${r.ms} ms)`, r.code === 0 && r.ms < 15000 && r.items.some(i => i.u === "https://flood.example/hostile") && r.items.some(i => i.u === "https://list.example/news/real-one"), { code: r.code, ms: r.ms, tail: r.out.slice(-300) });
  r = await go("huge-body", cfg, { "https://flood.example/feed": { body: "<rss><channel>" + "x".repeat(11e6) }, "https://fine.example/feed": fine });
  chk("an answer larger than 10 MB fails that one source (\"too large\") and the others are read", r.code === 0 && /FAIL Small Community Paper: the page is too large/.test(r.out) && r.items.some(i => i.s === "Fine Outlet"), r.out.slice(-300));
}
// ---------------------------------------------------------------- 8. a stored story is not replaced by another site's copy of its headline
{
  const H = "Asian American veterans honored at national monument dedication ceremony";
  const cfg = { kinds: { "Outlet A": "community" }, sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed", fullText: false }, G] };
  const old = feedOf([stored("cccccccccc01", "Outlet A", H, "https://a.example/veterans", 100, { k: "community", m: "The outlet's own summary of the ceremony, kept since the story was first read." })]);
  const admin = { v: 1, pinned: { cccccccccc01: 1 }, edits: { cccccccccc01: { t: "HEALTH" } } };
  const r = await go("copy-does-not-replace", cfg, { "https://a.example/feed": { body: rss(item("Asian American newer story on the front page", "https://a.example/newer", 2)) }, [G.feed]: { body: rss(gitem(H, "COPY1", "Copy Site", "https://copysite.example", 1)) } }, { feed: old, admin });
  const kept = r.items.find(i => i.id === "cccccccccc01");
  chk("the outlet's own story stays (its link, summary and the owner's topic) after it left the outlet's feed, and the copy is not listed", r.code === 0 && kept?.u === "https://a.example/veterans" && kept.t === "HEALTH" && /own summary/.test(kept.m ?? "") && !r.items.some(i => /COPY1/.test(i.u)), { kept, others: r.items.map(i => i.u) });
  // the reverse: a stored Google News link is replaced by the outlet's own page
  const old2 = feedOf([{ ...stored("dddddddddd01", "Outlet A", H, "https://news.google.com/rss/articles/OLDG?oc=5", 30, { k: "community", ph: "a.example" }) }]);
  const r2 = await go("direct-replaces-google", cfg, { "https://a.example/feed": { body: rss(item(H, "https://a.example/veterans", 2)) }, [G.feed]: { body: rss() } }, { feed: old2 });
  chk("a stored Google News link gives way to the outlet's own page for the same headline", r2.items.filter(i => i.h === H).length === 1 && r2.items.find(i => i.h === H).u === "https://a.example/veterans", r2.items.map(i => i.u));
  // two outlets, one wire headline: whichever answers first, the same one is kept
  const W = "Asian American lawmakers form new caucus in the statehouse today";
  const cfg3 = { sources: [{ name: "Outlet B", home: "https://b.example", feed: "https://b.example/feed" }, { name: "Outlet C", home: "https://c.example", feed: "https://c.example/feed" }] };
  const seenU = [];
  for (const [db, dc] of [[0, 300], [300, 0], [0, 300]]) { const r3 = await go("wire", cfg3, { "https://b.example/feed": { body: rss(item(W, "https://b.example/wire", 3)), delay: db }, "https://c.example/feed": { body: rss(item(W, "https://c.example/wire", 3)), delay: dc } }, { dir: "wire-" + seenU.length }); seenU.push(r3.items.map(i => i.u).join()); }
  chk("two outlets with one wire headline: the same one is kept whichever site answers first", new Set(seenU).size === 1 && seenU[0].split(",").length === 1, seenU);
}
// ---------------------------------------------------------------- 9. when (nearly) every source fails the stored data is kept
{
  const srcs = Array.from({ length: 24 }, (_, n) => ({ name: "Outlet " + n, home: `https://o${n}.example`, feed: `https://o${n}.example/feed` }));
  const old = feedOf([stored("eeeeeeeeee01", "Outlet 0", "Stored Asian American story", "https://o0.example/old", 30)], srcs.map(s => ({ name: s.name, home: s.home, kind: "news", ok: true })));
  const oldText = JSON.stringify(old);
  let r = await go("all-fail", { sources: srcs }, {}, { feed: oldText });
  chk("every source failing: the run fails and the feed file is untouched", r.code === 1 && r.raw === oldText && /24 of the 24 sources asked in this run failed/.test(r.out), r.out.slice(-200));
  r = await go("nearly-all-fail", { sources: srcs }, { "https://o0.example/feed": { body: rss(item("Asian American story from the one working outlet", "https://o0.example/new", 2)) } }, { feed: oldText });
  chk("23 of 24 failing (a lost connection): the same", r.code === 1 && r.raw === oldText, r.out.slice(-200));
  const half = Object.fromEntries(srcs.slice(0, 12).map((s, n) => [s.feed, { body: rss(item(`Asian American story ${n} from outlet ${n}`, `${s.home}/new`, 2)) }]));
  r = await go("half-fail", { sources: srcs }, half, { feed: oldText });
  chk("half failing is an ordinary bad day: the run goes on and marks them", r.code === 0 && r.feed.sources.filter(s => !s.ok).length === 12 && r.items.length === 13, { code: r.code, bad: r.feed?.sources.filter(s => !s.ok).length, n: r.items.length });
  chk("a source's public line has its name, home, kind and state, and no count", r.feed.sources.every(s => !("count" in s) && typeof s.ok === "boolean" && s.name && s.home), r.feed.sources[0]);
}
// ---------------------------------------------------------------- 10. a run in which the filters would remove a large share of the stored items stops
{
  const olds = Array.from({ length: 1000 }, (_, n) => stored("f" + String(n).padStart(11, "0"), n < 600 ? "Big Outlet" : "Other Outlet", `Stored Asian American story number ${n}`, n < 600 ? `https://big.example/s/${n}` : `https://other.example/s/${n}`, 30 + n / 10));
  const cfg = { sources: [{ name: "Other Outlet", home: "https://other.example", feed: "https://other.example/feed" }], excludeHosts: ["big.example"] }, routes = { "https://other.example/feed": { body: rss(item("Asian American new story today", "https://other.example/new", 2)) } }, text = JSON.stringify(feedOf(olds));
  let r = await go("large-removal", cfg, routes, { feed: text });
  chk("a rule that would remove 600 of 1,000 stored items: the run stops and nothing is changed", r.code === 1 && r.raw === text && /would remove 600 of the 1000 stored items/.test(r.out), r.out.slice(-300));
  r = await go("large-removal-allowed", cfg, routes, { feed: text, env: { ALLOW_LARGE_REMOVAL: "1" } });
  chk("... unless the run is started with \"Allow a large removal\"", r.code === 0 && r.items.length === 401, { code: r.code, n: r.items.length });
  r = await go("small-removal", { ...cfg, excludeHosts: ["nothing.example"], excludeNames: [] }, routes, { feed: JSON.stringify(feedOf([...olds.slice(600), ...olds.slice(0, 100).map(o => ({ ...o, u: o.u.replace("big.example", "blocked.example") }))])), env: {} });
  chk("ordinary runs are not affected", r.code === 0 && r.items.length === 501, { code: r.code, n: r.items.length });
  // old items simply ageing out is not a removal by the filters
  const aged = Array.from({ length: 800 }, (_, n) => stored("a" + String(n).padStart(11, "0"), "Other Outlet", `Aged Asian American story number ${n}`, `https://other.example/a/${n}`, 24 * 60 + n));
  r = await go("ageing-out", { sources: cfg.sources, keepFrom: undefined, keepDays: 30 }, routes, { feed: JSON.stringify(feedOf(aged)) });
  chk("stories that are simply too old are dropped as before (800 aged out in one run)", r.code === 0 && r.items.length === 1, { code: r.code, n: r.items.length, tail: r.out.slice(-200) });
}
// ---------------------------------------------------------------- 11. the same rule from both federal sources; deadlines must be real days
{
  const T = "Removing 30-Day Refugee Termination Notice";
  const old = feedOf([{ id: "111111111111", d: "2026-10-14T12:00:00.000Z", s: "Federal Register", h: T, u: "https://www.federalregister.gov/documents/2026/10/14/2026-20956/removing", k: "official", t: "IMMIGRATION", rl: "i", dl: "2026-11-13" },
    { id: "222222222222", d: "2026-10-14T04:00:00.000Z", s: "Regulations.gov", h: T, u: "https://www.regulations.gov/document/USCIS-2026-0397-0001", k: "official", t: "IMMIGRATION", rl: "i", dl: "2026-11-14" },
    { id: "333333333333", d: "2026-10-20T04:00:00.000Z", s: "Regulations.gov", h: "A different notice about Asian American data", u: "https://www.regulations.gov/document/XYZ-2026-0001-0001", k: "official", t: "GOVERNMENT", rl: "n", dl: "2026-13-45" }]);
  const r = await go("fr-regs-duplicate", { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }] }, { "https://a.example/feed": { body: rss(item("Asian American story one", "https://a.example/1", 2)) } }, { feed: old });
  chk("a stored rule listed by both the Federal Register and Regulations.gov is kept once (the Federal Register's entry)", r.code === 0 && r.items.filter(i => i.h === T).length === 1 && r.items.find(i => i.h === T).id === "111111111111", r.items.map(i => i.id));
  chk("a stored deadline that is not a real day is removed from the item (the item stays)", r.items.some(i => i.id === "333333333333" && !("dl" in i)), r.items.find(i => i.id === "333333333333"));
}
// ---------------------------------------------------------------- 12. "every": a slow source waits for its turn and its line stays as it was
{
  const cfg = { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }, { name: "Slow Org", home: "https://slow.example", feed: "https://slow.example/feed", kind: "statement", every: 360 }] };
  const routes = { "https://a.example/feed": { body: rss(item("Asian American story one", "https://a.example/1", 2)) }, "https://slow.example/feed": { body: rss(item("Asian American statement from the slow organization", "https://slow.example/1", 5)) } };
  const a = await go("every", cfg, routes), dir = `${caseNo}-every`;
  const b = await go("every", cfg, routes, { dir, env: { STUB_LOG: "1" } });
  chk("a source with \"every\" is read on the first run and waits on the next; its story and its public line stay; the quiet run writes nothing", a.items.length === 2 && /WAIT Slow Org: read every 360 minutes/.test(b.out) && !/\[stub\] GET https:\/\/slow\.example/.test(b.out) && /No changes\./.test(b.out) && b.raw === a.raw, b.out.slice(-300));
  chk("every run notes its time in data/run.json, also a run that changed nothing", (() => { try { return Date.parse(JSON.parse(readFileSync(join(b.d, "data/run.json"), "utf8")).at) > Date.parse(a.feed.generated); } catch { return false; } })());
  writeFileSync(join(b.d, "data/run.json"), JSON.stringify({ at: new Date(now - 7 * 36e5).toISOString() })); // as if the last run had been seven hours ago
  const c = await go("every", cfg, { ...routes, "https://slow.example/feed": { status: 500, body: "" } }, { dir, env: { BACKFILL: "", STUB_LOG: "1" }, feed: JSON.stringify({ ...a.feed, generated: new Date(now - 7 * 36e5).toISOString() }) });
  chk("when its turn comes it is asked again, and a failure is recorded", /\[stub\] GET https:\/\/slow\.example/.test(c.out) && c.feed.sources.find(s => s.name === "Slow Org").ok === false && c.items.length === 2, c.out.slice(-300));
  // a passing fault (here a 500) is not a refusal: the source is asked again on the next run, up to three runs in a row, and only then waits for its turn
  const slowRow = r => r.feed.sources.find(s => s.name === "Slow Org"), asked = r => /\[stub\] GET https:\/\/slow\.example/.test(r.out), bad = { ...routes, "https://slow.example/feed": { status: 500, body: "" } };
  chk("a server error is counted as a passing fault and the log says the source is asked again", slowRow(c).r === 1 && /FAIL Slow Org: HTTP 500 \(asked again on the next run\)/.test(c.out), [slowRow(c), c.out.slice(-200)]);
  const d2 = await go("every", cfg, bad, { dir, env: { STUB_LOG: "1" } });
  chk("the next run asks it again although its turn has not come", asked(d2) && slowRow(d2).ok === false && slowRow(d2).r === 2, [slowRow(d2), d2.out.slice(-200)]);
  const d3 = await go("every", cfg, bad, { dir, env: { STUB_LOG: "1" } });
  chk("a third failure in a row is the last quick try", asked(d3) && slowRow(d3).r === 3 && !/asked again on the next run/.test(d3.out), [slowRow(d3), d3.out.slice(-200)]);
  const d4 = await go("every", cfg, bad, { dir, env: { STUB_LOG: "1" } });
  chk("after three failures it waits for its turn again, and a run in which nothing else changed writes nothing", !asked(d4) && /WAIT Slow Org: read every 360 minutes \(the last read failed\)/.test(d4.out) && slowRow(d4).r === 3 && /No changes\./.test(d4.out) && d4.raw === d3.raw && d4.items.length === 2, [slowRow(d4), d4.out.slice(-200)]);
  writeFileSync(join(d4.d, "data/run.json"), JSON.stringify({ at: new Date(now - 7 * 36e5).toISOString() })); // as if the last run had been seven hours ago (the feed file's own time too)
  const d5 = await go("every", cfg, routes, { dir, env: { STUB_LOG: "1" }, feed: JSON.stringify({ ...d4.feed, generated: new Date(now - 7 * 36e5).toISOString() }) });
  chk("when it answers again at its next turn the count is gone", asked(d5) && slowRow(d5).ok === true && !("r" in slowRow(d5)) && d5.items.length === 2, [slowRow(d5), d5.out.slice(-200)]);
}
{
  // a refusal (403) is not a passing fault: the source waits for its turn; and a quick try that succeeds clears the count
  const cfg = { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }, { name: "Slow Org", home: "https://slow.example", feed: "https://slow.example/feed", kind: "statement", every: 360 }] };
  const routes = { "https://a.example/feed": { body: rss(item("Asian American story one", "https://a.example/1", 2)) }, "https://slow.example/feed": { body: rss(item("Asian American statement from the slow organization", "https://slow.example/1", 5)) } };
  const slowRow = r => r.feed.sources.find(s => s.name === "Slow Org"), asked = r => /\[stub\] GET https:\/\/slow\.example/.test(r.out), late = r => { writeFileSync(join(r.d, "data/run.json"), JSON.stringify({ at: new Date(now - 7 * 36e5).toISOString() })); return JSON.stringify({ ...r.feed, generated: new Date(now - 7 * 36e5).toISOString() }); }; // as if the last run had been seven hours ago
  const a = await go("every403", cfg, routes), dir = `${caseNo}-every403`;
  const b = await go("every403", cfg, { ...routes, "https://slow.example/feed": { status: 403, body: "no" } }, { dir, env: { STUB_LOG: "1" }, feed: late(a) });
  const c = await go("every403", cfg, { ...routes, "https://slow.example/feed": { status: 403, body: "no" } }, { dir, env: { STUB_LOG: "1" } });
  chk("a refusal (403) is recorded without a count, and the next run does not ask again", asked(b) && slowRow(b).ok === false && !("r" in slowRow(b)) && !/asked again/.test(b.out) && !asked(c) && /WAIT Slow Org: read every 360 minutes \(the last read failed\)/.test(c.out), [slowRow(b), c.out.slice(-200)]);
  const d = await go("every403", cfg, { ...routes, "https://slow.example/feed": { status: 502, body: "" } }, { dir, env: { STUB_LOG: "1" }, feed: late(c) });
  const e = await go("every403", cfg, routes, { dir, env: { STUB_LOG: "1" } });
  chk("a quick try that succeeds puts the source right at once", slowRow(d).r === 1 && asked(e) && slowRow(e).ok === true && !("r" in slowRow(e)), [slowRow(d), slowRow(e)]);
  const f = await go("every403", cfg, routes, { dir, env: { STUB_LOG: "1" } });
  chk("and after that it waits for its turn as usual", !asked(f) && /WAIT Slow Org: read every 360 minutes$/m.test(f.out), f.out.slice(-200));
  const g = await go("every403", cfg, { ...routes, "https://slow.example/feed": { body: "<!doctype html><html><body>Please wait a moment</body></html>" } }, { dir, env: { STUB_LOG: "1" }, feed: late(f) });
  const h = await go("every403", cfg, routes, { dir, env: { STUB_LOG: "1" } });
  chk("an error page sent where the feed should be is a passing fault too: asked again on the next run", /FAIL Slow Org: Not a feed \(asked again on the next run\)/.test(g.out) && slowRow(g).r === 1 && asked(h) && slowRow(h).ok === true && g.items.length === 2 && h.items.length === 2, [slowRow(g), g.out.slice(-160), slowRow(h)]);
}
// ---------------------------------------------------------------- 13. a site that says "too many requests" is left alone for the rest of the run
{
  const srcs = Array.from({ length: 6 }, (_, n) => ({ name: "Search " + n, home: "https://news.google.com", feed: `https://news.google.com/rss/search?q=term${n}`, google: true }));
  const routes = Object.fromEntries(srcs.map(s => [s.feed, { status: 429, body: "slow down" }])); routes["https://a.example/feed"] = { body: rss(item("Asian American story one", "https://a.example/1", 2)) };
  const r = await go("cooling", { sources: [...srcs, { name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }] }, routes, { env: { STUB_LOG: "1" } });
  const asked = (r.out.match(/\[stub\] GET https:\/\/news\.google\.com/g) ?? []).length;
  chk(`after a 429 the site is not asked again in the run (6 searches, ${asked} requests made)`, r.code === 0 && asked <= 2 && /not asked again in this run/.test(r.out), { asked, tail: r.out.slice(-300) });
}
// ---------------------------------------------------------------- 14. an API key is never sent on to another address (real local servers)
{
  const seen = { api: [], other: [] };
  const other = http.createServer((q, s) => { seen.other.push(q.headers["x-api-key"] ?? null); s.writeHead(200, { "content-type": "application/json" }); s.end('{"bills":[],"summaries":[]}'); });
  await new Promise(r => other.listen(0, "127.0.0.1", r));
  const api = http.createServer((q, s) => { seen.api.push(q.url); if (/\/same\//.test(q.url)) { s.writeHead(200, { "content-type": "application/json" }); return s.end('{"bills":[],"summaries":[]}'); }
    if (/\/bill\//.test(q.url)) { s.writeHead(302, { location: `http://127.0.0.1:${other.address().port}/stolen` }); return s.end(); }
    if (/\/summaries\//.test(q.url)) { s.writeHead(307, { location: q.url.replace("/summaries/", "/same/") }); return s.end(); } s.writeHead(404); s.end("{}"); });
  await new Promise(r => api.listen(0, "127.0.0.1", r));
  const d = join(TMP, "redirect"); mkdirSync(join(d, "data"), { recursive: true });
  writeFileSync(join(d, "cfg.json"), JSON.stringify({ ...BASE, sources: [], congress: { enabled: true, days: 10, maxPages: 1 } })); writeFileSync(join(d, "h.json"), '{"hubs":[]}');
  const out = await run("node", [join(REPO, "scripts/fetch.mjs")], { env: { ...process.env, SOURCES: join(d, "cfg.json"), OUT: join(d, "data/feed.json"), HUBS: join(d, "h.json"), ORGS: join(d, "h.json"), ADMIN_DIR: "", API_DATA_GOV_KEY: "SECRETKEY", CONGRESS_API: `http://127.0.0.1:${api.address().port}`, OPENSTATES_API_KEY: "", HTTPS_PROXY: "", HTTP_PROXY: "", https_proxy: "", http_proxy: "", NODE_USE_ENV_PROXY: "" } }).then(r => r.stdout + r.stderr, e => (e.stdout ?? "") + (e.stderr ?? ""));
  chk("a keyed request that is redirected to another site is refused: the other site is never contacted with the key", seen.api.length >= 1 && seen.other.length === 0 && /redirect to another address/.test(out), { api: seen.api, other: seen.other, out: out.slice(-300) });
  api.close(); other.close();
}
// ---------------------------------------------------------------- 15. summaries cut off with a left-over "&hellip;"
{
  const cfg = { sources: [{ name: "Outlet A", home: "https://a.example", feed: "https://a.example/feed" }] };
  const old = feedOf([stored("999999999901", "Outlet A", "Stored Asian American story with a cut-off summary", "https://a.example/old", 30, { m: "This stored summary was cut off by the feed and ends with &hellip;" }), stored("999999999902", "Outlet A", "Stored Asian American story with a whole summary", "https://a.example/old2", 31, { m: "This stored summary is a whole sentence written by the outlet itself." })]);
  const r = await go("hellip", cfg, { "https://a.example/feed": { body: rss(item("Asian American story with an escaped ellipsis", "https://a.example/new", 2, "<description>A new excerpt the feed cut off, long enough to count &amp;hellip;</description>"), item("Asian American story with a fine summary", "https://a.example/new2", 2, "<description>A complete summary that the publisher wrote for this story.</description>")) } }, { feed: old });
  chk("an excerpt that ends in a left-over \"&hellip;\" is not shown as a summary, new or stored; whole summaries stay", r.code === 0 && !r.items.some(i => /hellip/.test(i.m ?? "")) && !r.items.find(i => i.id === "999999999901").m && /whole sentence/.test(r.items.find(i => i.id === "999999999902").m) && /complete summary/i.test(r.items.find(i => i.u.endsWith("/new2")).m), r.items.map(i => i.m));
}
// ---------------------------------------------------------------- requests to one site start a set time apart
{
  const names = ["One", "Two", "Three", "Four", "Five", "Six"];
  const cfg = { sources: [...names.map((n, i) => ({ name: "Paced " + n, home: "https://paced.example", feed: `https://paced.example/feed${i}` })), { name: "Other site", home: "https://other.example", feed: "https://other.example/feed" }] };
  const routes = Object.fromEntries([...names.map((n, i) => [`https://paced.example/feed${i}`, { body: rss(item(`Asian American story number ${i} from the paced site`, `https://paced.example/s${i}`, 2 + i)) }]), ["https://other.example/feed", { body: rss(item("Asian American story from the other site", "https://other.example/s", 3)) }]]);
  const fast = await go("pace0", cfg, routes), slow = await go("pace300", cfg, routes, { env: { HOST_GAP_MS: "300" } });
  chk("six requests to one site start 300 ms apart (the run takes about 1.5 s longer) and all of them are read", slow.code === 0 && slow.items.length === 7 && fast.items.length === 7 && slow.ms - fast.ms >= 1200 && slow.ms - fast.ms < 6000, { fast: fast.ms, slow: slow.ms, n: slow.items.length });
  const bf = await go("pace-backfill", { ...cfg, keepFrom: new Date(now - 20 * 864e5).toISOString().slice(0, 10) }, routes, { env: { HOST_GAP_MS: "300", BACKFILL: "1" } });
  chk("a backfill, which paces its own requests, is not slowed a second time", bf.code === 0 && bf.ms - fast.ms < 1200, { fast: fast.ms, backfill: bf.ms, tail: bf.out.slice(-200) });
}
// ---------------------------------------------------------------- the order of asking: what is read on every run first, then a source whose last read failed
{
  const H = "https://limited.example", src = (name, n, every) => ({ name, home: H, feed: `${H}/feed${n}`, ...(every ? { every, kind: "statement" } : {}) });
  const cfg = { sources: [src("Turn A", 1, 360), src("Turn B", 2, 360), src("Turn C", 3, 360), src("Every run", 4)] }; // in sources.json the one that is read on every run comes last
  const ok = n => ({ body: rss(item(`Asian American story number ${n} from the limited site`, `${H}/s${n}`, 2 + n)) });
  const routes = { [`${H}/feed1`]: ok(1), [`${H}/feed2`]: ok(2), [`${H}/feed3`]: ok(3), [`${H}/feed4`]: ok(4) };
  const late = r => { writeFileSync(join(r.d, "data/run.json"), JSON.stringify({ at: new Date(now - 7 * 36e5).toISOString() })); return JSON.stringify({ ...r.feed, generated: new Date(now - 7 * 36e5).toISOString() }); }; // as if the last run had been seven hours ago
  const order = r => (r.out.match(/\[stub\] GET https:\/\/limited\.example\/feed\d/g) ?? []).map(x => x.slice(-1)).join("");
  const a = await go("order", cfg, routes, { env: { STUB_LOG: "1" } }), dir = `${caseNo}-order`;
  chk("the source that is read on every run is asked first, whatever its place in sources.json", a.code === 0 && order(a) === "4123" && a.items.length === 4, { order: order(a), tail: a.out.slice(-200) });
  const b = await go("order", cfg, { ...routes, [`${H}/feed2`]: { status: 403, body: "no" } }, { dir, env: { STUB_LOG: "1" }, feed: late(a) });
  const c = await go("order", cfg, routes, { dir, env: { STUB_LOG: "1" }, feed: late(b) });
  chk("a source whose last read failed is asked before the others whose turn it is", b.code === 0 && c.code === 0 && order(b) === "4123" && order(c) === "4213", { b: order(b), c: order(c), tail: c.out.slice(-200) });
  chk("the feed's list of sources and the log stay in the order of sources.json", c.feed.sources.map(s => s.name).join() === "Turn A,Turn B,Turn C,Every run" && /OK   Turn A[^\n]*\nOK   Turn B[^\n]*\nOK   Turn C[^\n]*\nOK   Every run/.test(c.out) && c.items.length === 4, { names: c.feed.sources.map(s => s.name), tail: c.out.slice(-300) });
  // a site that answers only the first two requests of a run: the every-run source and the one refused last time get them
  const tight = { ...routes, [`${H}/feed1`]: { status: 429, body: "slow down" }, [`${H}/feed3`]: { status: 429, body: "slow down" } };
  const d = await go("order", cfg, tight, { dir, env: { STUB_LOG: "1" }, feed: late(await go("order", cfg, { ...routes, [`${H}/feed2`]: { status: 403, body: "no" } }, { dir, env: { STUB_LOG: "1" }, feed: late(c) })) });
  const row = (r, n) => r.feed.sources.find(s => s.name === n);
  chk("when a site answers only the first requests of a run, they go to the every-run source and to the one it refused last time", d.code === 0 && order(d).startsWith("42") && row(d, "Every run").ok === true && row(d, "Turn B").ok === true && row(d, "Turn A").ok === false && row(d, "Turn C").ok === false, { order: order(d), rows: d.feed.sources.map(s => [s.name, s.ok, s.error]) });
}
// ---------------------------------------------------------------- a turn that begins while a run is at work is not lost
{
  const P = 20 * 60e3, shiftOf = feed => parseInt(createHash("sha1").update(feed).digest("hex").slice(0, 8), 16) % P;
  const lastTurn = (feed, t) => Math.floor((t + shiftOf(feed)) / P) * P - shiftOf(feed); // the latest moment a turn of this source began (the collector's own rule)
  // an address whose latest turn began between 2 and 15 minutes ago, so that no other turn begins while this test runs
  let feed, B; for (let n = 0; n < 2000; n++) { feed = `https://turn.example/feed${n}`; B = lastTurn(feed, Date.now()); const age = Date.now() - B; if (age > 120e3 && age < 15 * 60e3) break; }
  const cfg = { sources: [{ name: "Turn Org", home: "https://turn.example", feed, kind: "statement", every: 20 }] };
  const routes = { [feed]: { body: rss(item("Asian American community statement on the turn", "https://turn.example/a", 3)) } };
  const a = await go("turns", cfg, routes), dir = `${caseNo}-turns`;
  let note = {}; try { note = JSON.parse(readFileSync(join(a.d, "data/run.json"), "utf8")); } catch { /* reported below */ }
  chk("a run notes when it made its plan and when it finished", a.code === 0 && Date.parse(note.planned) <= Date.parse(note.at) && Date.parse(note.at) - Date.parse(note.planned) < 60e3 && Date.parse(note.at) <= Date.now() && Object.keys(note).sort().join() === "at,planned", note);
  const prev = (planned, at, generated = at - 1000) => { writeFileSync(join(a.d, "data/run.json"), JSON.stringify(planned === null ? { at: new Date(at).toISOString() } : { at: new Date(at).toISOString(), planned: new Date(planned).toISOString() })); return JSON.stringify({ ...a.feed, generated: new Date(generated).toISOString() }); };
  const b = await go("turns", cfg, routes, { dir, feed: prev(B - 30e3, B + 30e3) }); // the last run made its plan 30 s before the turn began and finished 30 s after it
  chk("a turn that began while the last run was at work is taken by the next run", b.code === 0 && /OK   Turn Org/.test(b.out) && !/WAIT Turn Org/.test(b.out), { tail: b.out.slice(-300) });
  const c = await go("turns", cfg, routes, { dir, feed: prev(B + 20e3, B + 40e3) }); // the last run made its plan after the turn began, so it has read the source
  chk("a turn the last run has taken is not taken twice", c.code === 0 && /WAIT Turn Org: read every 20 minutes/.test(c.out), { tail: c.out.slice(-300) });
  const d = await go("turns", cfg, routes, { dir, feed: prev(null, B + 30e3) }); // a note written before this rule has no "planned"
  chk("a note without the time of the plan is counted from its end, as before", d.code === 0 && /WAIT Turn Org/.test(d.out), { tail: d.out.slice(-300) });
  const e = await go("turns", cfg, routes, { dir, feed: prev(B - 30e3, B - 20e3, B + 30e3) }); // a note left by an older run: the feed was written after it
  chk("a note older than the feed is not believed", e.code === 0 && /WAIT Turn Org/.test(e.out), { tail: e.out.slice(-300) });
  const f = await go("turns", cfg, routes, { dir, feed: prev(B + 90e3, B + 30e3) }); // a note whose plan is later than its end is not a real one
  chk("a note whose plan is later than its end is not believed", f.code === 0 && /WAIT Turn Org/.test(f.out), { tail: f.out.slice(-300) });
  // and with the notes the collector writes itself: the run that takes the turn leaves a note, and the run after it waits
  const g = await go("turns", cfg, routes, { dir, feed: prev(B - 30e3, B + 30e3) }), h = await go("turns", cfg, routes, { dir });
  chk("the run after the one that took the turn waits, going by the note that run left", g.code === 0 && h.code === 0 && /OK   Turn Org/.test(g.out) && /WAIT Turn Org: read every 20 minutes/.test(h.out), { g: g.out.slice(-160), h: h.out.slice(-160) });
}
// ---------------------------------------------------------------- what Google News finds that is not a story (a photo's page, an outlet's front page, an archive page)
{
  const sha = t => createHash("sha1").update(t).digest("hex").slice(0, 12);
  const cfg = { trustedOutlets: ["Pacific Daily News", "Hawaii Public Radio", "Nichi Bei"], sources: [G, { name: "Rafu Shimpo", home: "https://rafu.example", feed: "https://rafu.example/feed", kind: "community" }] };
  const junk = ["20261119 lease signing 01.JPG", "IMG_9745.JPG", "DC210139", "P8140295", "240419-N-YQ428-1014", "20261024 early voting", "Pikabestofguam", "Michiya Hanayagi Archives"];
  const real = ["Asian American voters turn out in record numbers in Guam", "2026 Midterm Results: AAPI Wins and Losses", "Lawmakers battle the National Archives", "DC statehood bill names Asian American voters"];
  const routes = { [G.feed]: { body: rss(...junk.map((t, n) => gitem(t, "J" + n, "Pacific Daily News", "https://www.guampdn.com")), gitem("Hawai&apos;i Public Radio", "H1", "Hawaii Public Radio", "https://www.hawaiipublicradio.org"), ...real.map((t, n) => gitem(t, "R" + n, "Pacific Daily News", "https://www.guampdn.com"))) },
    "https://rafu.example/feed": { body: rss(item("Emiko Keimi", "https://rafu.example/obit-1", 3), item("Asian American festival returns to Little Tokyo", "https://rafu.example/fest", 4)) } };
  const old = feedOf([stored("bbbbbbbbbbb1", "Pacific Daily News", "001.jpg", "https://news.google.com/rss/articles/OLD1?oc=5", 50), stored("bbbbbbbbbbb2", "Pacific Daily News", "Asian American students in Guam win the debate title", "https://news.google.com/rss/articles/OLD2?oc=5", 60)]);
  const r = await go("not-a-story", cfg, routes, { feed: old }), heads = r.items.map(i => i.h);
  chk("a photo's file name, a camera's number, an outlet's own name, a one-word title and an archive page that Google News found are not listed", r.code === 0 && junk.every(t => !heads.includes(t)) && !heads.some(h => /^Hawai.i Public Radio$/.test(h)), { heads, tail: r.out.slice(-300) });
  chk("real stories next to them are listed, also one that ends in \"National Archives\" or begins with a year or with letters and a word", real.every(t => heads.includes(t)), { heads });
  chk("a stored one is removed, a stored story stays, and the log says how many were dropped", !r.items.some(i => i.id === "bbbbbbbbbbb1") && r.items.some(i => i.id === "bbbbbbbbbbb2") && /Dropped \(not a story[^\n]*\): 10\b/.test(r.out) && /Stored items removed by the filters in this run: 1 of 2/.test(r.out), { out: (r.out.match(/Dropped \(not a story[^\n]*/) ?? [""])[0], ids: r.items.map(i => i.id).slice(0, 4) });
  chk("a short headline in an outlet's own feed stays (an obituary under the person's name)", heads.includes("Emiko Keimi"), { heads });
}
// ---------------------------------------------------------------- tracking labels in links, and an outlet's name at the end of its own headline
{
  const sha = t => createHash("sha1").update(t).digest("hex").slice(0, 12);
  const given = "https://org.example/2026/11/statement/?utm_source=rss&utm_medium=rss&utm_campaign=statement", plain = "https://org.example/2026/11/statement/";
  const given2 = "https://org.example/p?id=7&utm_source=rss&fbclid=abc&page=2";
  const cfg = { trustedOutlets: ["News18", "Pacific Daily News"], renames: { TAAF: "The Asian American Foundation" }, sources: [{ name: "Org", home: "https://org.example", feed: "https://org.example/feed", kind: "statement" }, G] };
  const routes = { "https://org.example/feed": { body: rss(item("Asian American advocates respond to the census proposal", given.replace(/&/g, "&amp;"), 3), item("Asian American group opens a second office", given2.replace(/&/g, "&amp;"), 4)) },
    [G.feed]: { body: rss(gitem("Nithya Raman defeats Karen Bass | First Asian American mayor of Los Angeles | News18", "S1", "News18", "https://www.news18.example"), gitem("Asian American voters decide the Guam race - guampdn.com", "S2", "Pacific Daily News", "https://www.guampdn.com"), gitem("Asian American Foundation names fellows | TAAF", "S3", "The Asian American Foundation", "https://www.taaf.org"), gitem("Asian American voters back the measure - Opinion", "S4", "Pacific Daily News", "https://www.guampdn.com")) } };
  const old = feedOf([stored(sha(given), "Org", "Asian American advocates respond to the census proposal", given, 3, { k: "statement" })]);
  const r = await go("links", cfg, routes, { feed: old }), a = r.items.find(i => /census proposal/.test(i.h)), b = r.items.find(i => /second office/.test(i.h));
  chk("tracking labels are left out of a story's link, and its other parameters stay", r.code === 0 && a?.u === plain && b?.u === "https://org.example/p?id=7&page=2", { a: a?.u, b: b?.u, tail: r.out.slice(-200) });
  chk("the story keeps the id it had with the labels, so it is there once", a?.id === sha(given) && b?.id === sha(given2) && r.items.filter(i => /census proposal/.test(i.h)).length === 1, { id: a?.id, want: sha(given), n: r.items.filter(i => /census proposal/.test(i.h)).length });
  const heads = r.items.map(i => i.h);
  chk("an outlet's own name or site at the end of its headline is removed (also a name the site shows differently), and other endings stay", heads.includes("Nithya Raman defeats Karen Bass | First Asian American mayor of Los Angeles") && heads.includes("Asian American voters decide the Guam race") && heads.includes("Asian American Foundation names fellows") && heads.includes("Asian American voters back the measure - Opinion"), { heads });
}
// ---------------------------------------------------------------- a web page where the feed should be, a cut-off excerpt with a link after it, a stored headline in capitals
{
  const deep = "<!DOCTYPE html><html><body>" + "<div>".repeat(400) + "Just a moment" + "</div>".repeat(400) + "</body></html>";
  const cfg = { sources: [{ name: "Moved Org", home: "https://moved.example", feed: "https://moved.example/feed", kind: "statement", every: 60 }, { name: "Cut Org", home: "https://cut.example", feed: "https://cut.example/feed", kind: "statement" }] };
  const desc = t => `<description>${t}</description>`;
  const routes = { "https://moved.example/feed": { body: deep, type: "text/html" }, "https://cut.example/feed": { body: rss(
    item("Asian American seniors program expands in Queens", "https://cut.example/a", 3, desc("On October 30th, the director of communications and the organizer spoke about the program,... Read more")),
    item("Asian American youth summit returns this spring", "https://cut.example/b", 4, desc("The summit helps Asian American students continue reading at home over the summer months.")),
    item("Asian American history month events announced", "https://cut.example/c", 5, desc("Congratulations to the … Continue reading &quot;Asian American history month events announced&quot;"))) } };
  const old = feedOf([stored("ccccccccccc1", "Cut Org", "ASIAN AMERICAN LEADERS COMMEMORATE COMPLETION OF THE FIRST HOUSING PROJECT", "https://cut.example/old-1", 60, { k: "statement" }), stored("ccccccccccc2", "Cut Org", "Asian American seniors gather for the harvest festival", "https://cut.example/old-2", 70, { k: "statement", m: "On October 15th, the council celebrated another year of community impact at our Brooklyn... Read more" })], [{ name: "Moved Org", home: "https://moved.example", kind: "statement", ok: true }]);
  old.generated = ago(7).toISOString(); // the last run was seven hours ago, so the source that is read once an hour is due
  const r = await go("not-a-feed", cfg, routes, { feed: old }), row = n => r.feed.sources.find(s => s.name === n), by = h => r.items.find(i => i.h.startsWith(h));
  chk("a web page that the reader of feeds gives up on is \"Not a feed\", and the source is asked again on the next run", r.code === 0 && /FAIL Moved Org: Not a feed \(asked again on the next run\)/.test(r.out) && row("Moved Org")?.ok === false && row("Moved Org")?.r === 1, { row: row("Moved Org"), line: (r.out.match(/FAIL Moved Org[^\n]*/) ?? [""])[0] });
  chk("an excerpt the site cut off and ended with \"Read more\" or \"Continue reading\" is not shown; a sentence with those words is", by("Asian American seniors program")?.m === undefined && by("Asian American history month")?.m === undefined && /continue reading at home/.test(by("Asian American youth summit")?.m ?? ""), { a: by("Asian American seniors program")?.m, b: by("Asian American youth summit")?.m, c: by("Asian American history month")?.m });
  chk("a stored headline in capitals is calmed and a stored cut-off excerpt is dropped, with the same ids", by("Asian American Leaders Commemorate Completion")?.id === "ccccccccccc1" && r.items.find(i => i.id === "ccccccccccc2")?.m === undefined, { h: r.items.find(i => i.id === "ccccccccccc1")?.h, m: r.items.find(i => i.id === "ccccccccccc2")?.m });
}
// ---------------------------------------------------------------- a feed whose excerpt is only a letterhead ("titleOnly"), and a release found twice (the agency's own site and Google News)
{
  const LH = "STATE OF HAWAII KA MOKU AINA O HAWAII JOSH GREEN, M.D. GOVERNOR KE KIAAINA DEPARTMENT OF LAND AND NATURAL RESOURCES RYAN K.P. KANAKAʻOLE CHAIRPERSON [&#8230;]";
  const desc = t => `<description>${t}</description>`, match = "\\b(native hawaiians?|kanaka|hawaiian home lands?)\\b";
  const mk = titleOnly => ({ sources: [{ name: "Gov Office", home: "https://office.example.gov", feed: "https://office.example.gov/feed", kind: "govstmt", filter: true, match, ...(titleOnly ? { titleOnly: true } : {}) }, { name: "Other Office", home: "https://other.example.gov", feed: "https://other.example.gov/feed", kind: "govstmt", filter: true, match }] });
  const routes = { "https://office.example.gov/feed": { body: rss(
    item("DLNR News Release – ARBOR DAY HAWAII 2026", "https://office.example.gov/newsroom/arbor-day", 3, desc(LH)),
    item("Department of Hawaiian Home Lands Director to Not Seek Reappointment", "https://office.example.gov/newsroom/director", 4, desc(LH)),
    item("Native Hawaiian families receive new leases", "https://office.example.gov/newsroom/leases", 5, desc(LH))) },
    "https://other.example.gov/feed": { body: rss(item("Hunting units reopen on Kauai", "https://other.example.gov/newsroom/hunting", 6, desc(LH))) } };
  const g = (id, h, extra = {}) => stored(id, "Gov Office", h, "https://office.example.gov/newsroom/" + id, 30, { k: "govstmt", rl: "n", t: "GOVERNMENT", ...extra });
  const old = feedOf([g("dddddddddd01", "Kauai Hunting Units Reopen for Game Bird Seasons"), g("dddddddddd02", "Native Hawaiian Home Lands transfer approved by the board"), g("dddddddddd03", "Pololu Valley lookout closed for maintenance"), g("dddddddddd04", "Ala Wai Harbor floating dock replacement"),
    stored("dddddddddd05", "Other Office", "Hunting season notice from another office", "https://other.example.gov/newsroom/old", 30, { k: "govstmt", rl: "n", t: "GOVERNMENT" })]);
  const a = await go("letterhead", mk(false), routes, { feed: old }), b = await go("letterhead", mk(true), routes, { feed: old, admin: { pinned: { dddddddddd03: new Date().toISOString() }, edits: { dddddddddd04: { h: "Ala Wai Harbor: the owner's own headline" } } } });
  const has = (r, re) => r.items.find(i => re.test(i.h));
  chk("without the option the letterhead's name lets a hunting notice through, and the word governor files a release under Elections", a.code === 0 && !!has(a, /ARBOR DAY/) && has(a, /new leases/)?.t === "ELECTIONS", { code: a.code, arbor: has(a, /ARBOR DAY/)?.h, t: has(a, /new leases/)?.t, tail: a.out.slice(-300) });
  chk("with \"titleOnly\" a release is kept when its headline meets the source's rule and is not when only the letterhead did", b.code === 0 && !has(b, /ARBOR DAY/) && !!has(b, /Director to Not Seek/) && !!has(b, /new leases/), { code: b.code, heads: b.items.map(i => i.h), tail: b.out.slice(-300) });
  chk("... and its topic comes from the headline, not from the letterhead", has(b, /new leases/)?.t === "GOVERNMENT" && has(b, /Director to Not Seek/)?.t !== "ELECTIONS", { t1: has(b, /new leases/)?.t, t2: has(b, /Director to Not Seek/)?.t });
  chk("a stored release that fails the rule is removed; one that meets it stays; the owner's pin and edit keep theirs; another source is left alone", !b.items.some(i => i.id === "dddddddddd01") && b.items.some(i => i.id === "dddddddddd02") && b.items.some(i => i.id === "dddddddddd03") && b.items.some(i => i.id === "dddddddddd04") && b.items.some(i => i.id === "dddddddddd05") && !!has(b, /Hunting units reopen on Kauai/), { ids: b.items.map(i => i.id + ":" + i.s).slice(0, 12) });
  chk("the log says how many stored ones were dropped for that (the new one that fails the rule never gets this far)", /Dropped \(a release whose headline does not meet its source's own rule[^\n]*\): 1\b/.test(b.out) && /Stored items removed by the filters in this run: 1 of 5/.test(b.out), { line: (b.out.match(/Dropped \(a release whose[^\n]*/) ?? [""])[0], rem: (b.out.match(/Stored items removed[^\n]*/) ?? [""])[0] });
}
{
  const gnews = (t, n, pub, site, hoursAgo = 2) => gitem(t, n, pub, site, hoursAgo);
  const cfg = { sources: [{ name: "Home Lands Agency", home: "https://homelands.example.gov", feed: "https://homelands.example.gov/feed", kind: "govstmt" }, G] };
  const H1 = "Asian American lease program opens for Native Hawaiian families", H2 = "Notice of a public meeting for Asian American residents", H3 = "Asian American Heritage Month proclamation", H4 = "Asian American housing grants announced";
  const routes = { "https://homelands.example.gov/feed": { body: rss(item(H1, "https://homelands.example.gov/2026/11/lease-program", 5), item(H4, "https://www.homelands.example.gov/2026/11/grants", 40)) },
    [G.feed]: { body: rss(
      gnews(H1, "T1", "Home Lands Agency", "https://homelands.example.gov"),          // the same release, Google News's copy of the agency's own page
      gnews(H1, "T2", "Other Agency", "https://other.example.gov"),                    // the same headline from another agency's site
      gnews(H2, "T3", "Home Lands Agency", "https://homelands.example.gov"),          // a different release of the same site
      gnews(H2, "T4", "Home Lands Agency", "https://homelands.example.gov"),          // ... found twice by two searches
      gnews(H3, "T5", "Montgomery County", "https://www.montgomerycountymd.gov"), gnews(H3, "T6", "National Park Service", "https://www.nps.gov"), // the same headline of two agencies: two releases
      gnews(H4, "T7", "Home Lands Agency", "https://www.homelands.example.gov", 30)) } }; // its direct copy is 40 hours old: still the same release, "www." makes no difference
  const old = feedOf([stored("eeeeeeeeee01", "Home Lands Agency", H2, "https://news.google.com/rss/articles/OLD1?oc=5", 20, { k: "govstmt", rl: "n", t: "GOVERNMENT", ph: "homelands.example.gov", g: 1 }),
    stored("eeeeeeeeee02", "Home Lands Agency", "Asian American youth council visit", "https://homelands.example.gov/2026/11/youth", 20, { k: "govstmt", rl: "n", t: "GOVERNMENT" })]);
  const r = await go("own-site-twin", cfg, routes, { feed: old }), by = n => r.items.filter(i => i.u.includes("/articles/" + n + "?")), n = h => r.items.filter(i => i.h === h);
  chk("a Google News copy of a release that the agency's own site also lists is not listed twice", r.code === 0 && n(H1).length === 2 && !!n(H1).find(i => i.u === "https://homelands.example.gov/2026/11/lease-program") && by("T1").length === 0, { n: n(H1).map(i => i.s + " " + i.u.slice(0, 60)), tail: r.out.slice(-300) });
  chk("the same headline from another agency's site is another release and stays", by("T2").length === 1 && by("T2")[0].k === "govstmt", { t2: by("T2") });
  chk("two Google copies of one release of one site are listed once, and the stored copy of it counts (the lower id stays)", n(H2).length === 1, { n: n(H2).map(i => i.id + " " + i.u.slice(0, 70)) });
  chk("two agencies' releases with one headline stay as two", n(H3).length === 2, { n: n(H3).map(i => i.s) });
  chk("\"www.\" and a day or two between the copies make no difference", n(H4).length === 1 && n(H4)[0].u === "https://www.homelands.example.gov/2026/11/grants", { n: n(H4).map(i => i.u) });
  chk("the log says how many were dropped for that", /Dropped \(a Google News copy of a release that is also listed from the agency's own site[^\n]*\): 4\b/.test(r.out), { line: (r.out.match(/Dropped \(a Google News copy[^\n]*/) ?? [""])[0] });
  // a record found only through Google News stays, a pinned one is never dropped
  const r2 = await go("own-site-twin-pin", cfg, routes, { feed: old, admin: { pinned: { eeeeeeeeee01: new Date().toISOString() } } });
  chk("an owner's pin keeps a Google News copy that would otherwise be dropped", r2.items.some(i => i.id === "eeeeeeeeee01"), { ids: r2.items.map(i => i.id) });
}
// ---------------------------------------------------------------- an address that names the year ("{year}"), read for this year, and in January for last year too
{
  const { expandYears } = await import(join(REPO, "scripts/years.mjs"));
  const S = [{ name: "Gov", page: "https://x.example.gov/news/{year}/index.shtml", link: "^/news/{year}/\\d{8}\\.shtml$", home: "https://x.example.gov" }, { name: "Plain", feed: "https://y.example/feed" }];
  const at = d => expandYears(S, Date.parse(d)), pages = r => r.filter(x => x.name === "Gov").map(x => x.page.match(/\/(\d{4})\//)[1]).join("+");
  chk("{year}: in November only this year's page is read, and a source without {year} is left as it was", pages(at("2026-11-26T12:00:00Z")) === "2026" && at("2026-11-26T12:00:00Z").at(-1) === S[1] && at("2026-11-26T12:00:00Z")[0].link === "^/news/2026/\\d{8}\\.shtml$");
  chk("{year}: in January this year's page and last year's are both read (the end of December is still listed on the old one)", pages(at("2027-01-01T00:00:00Z")) === "2027+2026" && pages(at("2027-01-31T23:59:59Z")) === "2027+2026", { a: pages(at("2027-01-01T00:00:00Z")), b: pages(at("2027-01-31T23:59:59Z")) });
  chk("{year}: from 1 February on only the new year's page is read, and the regular expression for its links follows the year", pages(at("2027-02-01T00:00:00Z")) === "2027" && at("2027-02-01T00:00:00Z")[0].link === "^/news/2027/\\d{8}\\.shtml$" && !JSON.stringify(at("2027-02-01T00:00:00Z")).includes("{year}"));
  const yr = new Date().getUTCFullYear(), day = ago(30), ds = `${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}/${day.getUTCFullYear()}`, num = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  const cfg = { sources: [{ name: "Year Office", home: "https://x.example.gov", page: "https://x.example.gov/news/{year}/index.shtml", link: "^/news/{year}/\\d{8}\\.shtml$", kind: "govstmt", numericDates: true }, G] };
  const html = y => `<html><body><ul><li><a href="/news/${y}/${num}.shtml"><h3>Governor announces Asian American small business grants</h3></a> <span>${ds}</span></li></ul></body></html>`;
  const routes = { [`https://x.example.gov/news/${yr}/index.shtml`]: { body: html(yr) }, [G.feed]: { body: rss() } };
  const r = await go("year-page", cfg, routes);
  chk("{year}: the collector reads the page named for the current year, and the story is listed", r.code === 0 && r.items.some(i => i.s === "Year Office" && i.u === `https://x.example.gov/news/${yr}/${num}.shtml`), { code: r.code, items: r.items.map(i => i.s + " " + i.u), tail: r.out.slice(-300) });
  chk("{year}: no request goes to an address that still holds the word {year}", !/\{year\}|%7Byear%7D/i.test(r.out) && !/\{year\}|%7Byear%7D/i.test(r.raw));
}
console.log(fail ? `SOME FAILED (${fail} of ${pass + fail})` : `ALL PASS ${pass}`);
process.exitCode = fail ? 1 : 0;
