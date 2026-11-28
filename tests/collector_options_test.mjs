// The per-source options added for state commissions and general government feeds: official, communityOnly, dropTitle, dropLink, noQuery, numericDates.
// usage: node collector_options_test.mjs <repo> <tmp dir>   (a local mock server; no real network)
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, cpSync, symlinkSync } from "node:fs"; import { execFile } from "node:child_process";
import { resolve } from "node:path"; const REPO = resolve(process.argv[2]), TMP = resolve(process.argv[3]); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data", { recursive: true });
for (const f of ["scripts", "taxonomy.json", "hubs.json", "package.json", "elections.json", "numbers.json", "observances.json", "orgs.json"]) { try { cpSync(REPO + "/" + f, TMP + "/" + f, { recursive: true }); } catch {} }
symlinkSync(REPO + "/node_modules", TMP + "/node_modules");
const res = []; const chk = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " " + String(x).slice(0, 400))); res.push(!!ok); };
const day = d => new Date(Date.now() - d * 864e5), rfc = d => day(d).toUTCString(), mdy = d => { const x = day(d); return `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}/${x.getUTCFullYear()}`; };
const item = (t, l, d) => `<item><title>${t}</title><link>${l}</link><pubDate>${rfc(d)}</pubDate><description>${t}.</description></item>`;
let base = "";
const feed = tag => ( `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
${item("Commission statement on Asian American students", base + "/" + tag + "/a/one?utm_source=rss&amp;utm_medium=rss&amp;id=7", 2)}
${item("Full Commission Meeting on Asian American affairs", base + "/" + tag + "/a/meeting", 3)}
${item("Lunar New Year photos for Asian American families", base + "/" + tag + "/photo-album/lny", 4)}
${item("Public charge rule: immigration changes explained", base + "/" + tag + "/a/charge", 5)}
</channel></rss>`);
const page = () => `<html><body><ul>
<li><h2><a href="/about/news/2026/numeric-one">Applications open for the Asian American commission</a></h2><strong>${mdy(6)}</strong><div>Body text about Asian American communities.</div></li>
<li><h2><a href="/about/news/2026/numeric-two">Pacific Islander listening session</a></h2><strong>${mdy(9)}</strong><div>More text.</div></li>
</ul></body></html>`;
const MONTH = d => day(d).toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase() + " " + day(d).getUTCDate() + ", " + day(d).getUTCFullYear();
// a card listing (Wix): the date and the headline sit above a "READ MORE" button, and the next card's date follows the button
const cards = () => `<html><body><div role="list">
<div role="listitem"><p>${MONTH(3)}</p><h2>APIAHF WELCOMES NEW BOARD MEMBERS AND THE FY2026 BUDGET</h2><a href="/press-release/board-members">READ MORE</a></div>
<div role="listitem"><p>${MONTH(8)}</p><h2>Statement on a Medicaid vote</h2><a href="/press-release/medicaid-vote">READ MORE</a></div>
<div role="listitem"><h2>A card with no date</h2><a href="/press-release/no-date">READ MORE</a></div>
<div role="listitem"><p>${MONTH(11)}</p><h2>Last card</h2><a href="/press-release/last-card">READ MORE</a></div>
</div></body></html>`;
// a press-release list (Drupal): thumbnail link, headline link, date, then the publisher's short summary; only the summary says who it is about
const gcards = () => `<html><body><div>
<article><a href="/pressreleases/grants-announced"><img src="/x.jpg" alt=""></a><h3><a href="/pressreleases/grants-announced"><span>Interior announces new grants</span></a></h3><div class="date">${mdy(2)}</div><div><p>The grants support Native Hawaiian organizations that preserve language and culture.</p></div></article>
<article><a href="/pressreleases/lease-sale"><img src="/y.jpg" alt=""></a><h3><a href="/pressreleases/lease-sale"><span>Interior schedules a lease sale</span></a></h3><div class="date">${mdy(3)}</div><div><p>The sale offers offshore tracts for oil and gas leasing next spring.</p></div></article>
</div></body></html>`;
// a court blog: the description is empty and only the post text (content:encoded) says what the story is about
const bodyItem = (t, l, d, body) => `<item><title>${t}</title><link>${l}</link><pubDate>${rfc(d)}</pubDate><description></description><content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item>`;
const bodyFeed = tag => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>x</title>
${bodyItem("Justices to hear a citizenship case", base + "/" + tag + "/a/citizenship", 2, "The Supreme Court will decide whether birthright citizenship reaches children of Asian American immigrants.")}
${bodyItem("Justices to hear a zoning case", base + "/" + tag + "/a/zoning", 3, "The Supreme Court will hear a dispute over a shrine and a neighboring couple.")}
</channel></rss>`;
// a governor's release that writes the community as "Asian Pacific American"
const apaFeed = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
${item("Governor appoints executive director of the Commission on Asian Pacific American Affairs", base + "/apa/a/director", 2)}
${item("Governor proclaims Asian and Pacific Islander Heritage Month", base + "/apa/a/heritage", 3)}
${item("Governor creates a new fraud prevention officer", base + "/apa/a/fraud", 4)}
</channel></rss>`;
// a territory's press list: the release number and the date are part of the headline; a typographic entity is written out
const stripFeed = tag => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
${item("PR001-10272026 - Governor Pulaali&amp;rsquo;i joins Asian American and Pacific Islander leaders - 10/27/2026", base + "/" + tag + "/a/one", 2)}
</channel></rss>`;
// a listing that keeps a commented-out second copy of each story link, with the date only after the commented copy (New Jersey)
const commentPage = tag => `<html><body><table><tr><td><h3><a href="/news/2026/${tag}-one">Governor announces an Asian American grant</a></h3><p>Short description of the grant program for communities.</p><!--<p><a href="/news/2026/${tag}-one">Read More</a></p>--></td><td><span>${mdy(4)}</span></td></tr>
<tr><td><h3><a href="/news/2026/${tag}-two">Governor signs a Pacific Islander bill</a></h3><p>Short description of the bill for island communities.</p><!--<p><a href="/news/2026/${tag}-two">Read More</a></p>--></td><td><span>${mdy(7)}</span></td></tr></table></body></html>`;
let flakyCalls = 0;
// a multistate coalition release lists Hawaii; only the second one names a community
const cpFeed = tag => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
${item("Attorney General joins a coalition of states including Hawaii and Oregon", base + "/" + tag + "/a/coalition", 2)}
${item("Attorney General statement for Asian American and Pacific Islander Heritage Month", base + "/" + tag + "/a/heritage", 3)}
</channel></rss>`;
const srv = http.createServer((q, r) => {
  if (/^\/feed\/(no)?cp/.test(q.url)) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(cpFeed(q.url.split("/")[2].replace(".xml", ""))); return; }
  if (q.url.startsWith("/feed/flaky")) { if (flakyCalls++ === 0) { q.socket.destroy(); return; } r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(feed("flaky")); return; }
  if (/^\/feed\/(no)?strip/.test(q.url)) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(stripFeed(q.url.split("/")[2].replace(".xml", ""))); }
  else if (q.url.startsWith("/comment.html") || q.url.startsWith("/nocomment.html")) { r.writeHead(200, { "content-type": "text/html" }); r.end(commentPage(q.url.includes("nocomment") ? "n" : "c")); }
  else if (/^\/feed\/(no)?bodytext/.test(q.url)) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(bodyFeed(q.url.split("/")[2].replace(".xml", ""))); }
  else if (q.url.startsWith("/feed/apa")) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(apaFeed()); }
  else if (q.url.startsWith("/feed/")) { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(feed(q.url.split("/")[2].replace(".xml", ""))); }
  else if (q.url.startsWith("/gcards.html")) { r.writeHead(200, { "content-type": "text/html" }); r.end(gcards()); }
  else if (q.url.startsWith("/cards.html")) { r.writeHead(200, { "content-type": "text/html" }); r.end(cards()); }
  else if (q.url.startsWith("/listing.html")) { r.writeHead(200, { "content-type": "text/html" }); r.end(page()); }
  else { r.writeHead(404); r.end(); }
}).listen(0, "127.0.0.1", () => {
  base = "http://127.0.0.1:" + srv.address().port;
  const mk = (name, o) => ({ name, home: base, kind: "govstmt", ...o });
  const cfg = JSON.parse(readFileSync(REPO + "/sources.json", "utf8"));
  const OPT = { dropTitle: "\\bmeetings?\\b", dropLink: "/photo-album/" };
  cfg.sources = [
    mk("Opt Official", { feed: base + "/feed/official.xml", official: true, noQuery: true, ...OPT }),
    mk("Opt NotOfficial", { feed: base + "/feed/notofficial.xml", ...OPT }),
    mk("Opt CommunityOnly", { feed: base + "/feed/communityonly.xml", official: true, filter: true, communityOnly: true, noQuery: true, ...OPT }),
    mk("Opt MatchGov", { feed: base + "/feed/matchgov.xml", official: true, filter: true, match: "\\bpublic charge\\b", noQuery: true }),
    mk("Opt Plain", { feed: base + "/feed/plain.xml", official: true }),
    mk("Opt Numeric", { page: base + "/listing.html", link: "^/about/news/20\\d\\d/[^/]+/?$", official: true, numericDates: true }),
    mk("Opt Cards", { page: base + "/cards.html", link: "^/press-release/[^/]+$", kind: "statement", before: true }),
    mk("Opt DescAfter", { page: base + "/gcards.html", link: "^/pressreleases/[^/]+$", official: true, filter: true, numericDates: true, descAfter: true }),
    mk("Opt NoDescAfter", { page: base + "/gcards.html", link: "^/pressreleases/[^/]+$", official: true, filter: true, numericDates: true }),
    mk("Opt NoCards", { page: base + "/cards.html", link: "^/press-release/[^/]+$", kind: "statement" }),
    mk("Opt BodyText", { feed: base + "/feed/bodytext.xml", kind: "news", filter: true, bodyText: true, match: "\\b(asian americans?|birthright citizenship)\\b" }),
    mk("Opt NoBodyText", { feed: base + "/feed/nobodytext.xml", kind: "news", filter: true, match: "\\b(asian americans?|birthright citizenship)\\b" }),
    mk("Opt Apa", { feed: base + "/feed/apa.xml", official: true, filter: true, communityOnly: true, noQuery: true }),
    mk("Opt Strip", { feed: base + "/feed/strip.xml", official: true, titleStrip: "^PR\\d+-\\d{8}\\s*-\\s*|\\s*-\\s*\\d{1,2}/\\d{1,2}/20\\d\\d$" }),
    mk("Opt NoStrip", { feed: base + "/feed/nostrip.xml", official: true }),
    mk("Opt Comment", { page: base + "/comment.html", link: "^/news/2026/[^/]+$", official: true, numericDates: true, skipComments: true }),
    mk("Opt NoComment", { page: base + "/nocomment.html", link: "^/news/2026/[^/]+$", official: true, numericDates: true }),
    mk("Opt Flaky", { feed: base + "/feed/flaky.xml", official: true, filter: true, communityOnly: true, noQuery: true }),
    mk("Opt Dead", { feed: "http://127.0.0.1:39117/dead.xml", official: true }),
    mk("Opt Cp", { feed: base + "/feed/cp.xml", official: true, filter: true, communityOnly: true, match: "communityPattern", noQuery: true }),
    mk("Opt NoCp", { feed: base + "/feed/nocp.xml", official: true, filter: true, communityOnly: true, noQuery: true }),
    mk("Opt NoNumeric", { page: base + "/listing.html", link: "^/about/news/20\\d\\d/[^/]+/?$", official: true }),
  ];
  for (const k of ["federalRegister", "executiveActions", "regulations", "govinfo", "congress", "openStates", "events"]) if (cfg[k]) cfg[k].enabled = false;
  delete cfg.keepFrom; cfg.backfill = cfg.backfill;
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg));
  execFile("node", ["scripts/fetch.mjs"], { cwd: TMP, env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: TMP + "/data/feed.json", NO_PROXY: "127.0.0.1,localhost", NODE_OPTIONS: "" }, timeout: 120000 }, (err, so, se) => {
    srv.close();
    let f; try { f = JSON.parse(readFileSync(TMP + "/data/feed.json", "utf8")); } catch (e) { console.log("FAIL no feed written", err?.message, so.slice(-600), se.slice(-600)); process.exit(1); }
    const by = n => f.items.filter(i => i.s === n), hs = n => by(n).map(i => i.h);
    const A = by("Opt Official");
    chk("official: a government source on a non-.gov address is kept (and marked of:1)", A.length === 2 && A.every(i => i.of === 1 && i.k === "govstmt"), JSON.stringify(A.map(i => [i.h, i.u, i.of])));
    chk("dropTitle: the meeting notice is left out", !hs("Opt Official").some(h => /Meeting/.test(h)), hs("Opt Official"));
    chk("dropLink: the photo album is left out", !hs("Opt Official").some(h => /photos/.test(h)), hs("Opt Official"));
    chk("noQuery: the link has no tracking parameters", A.every(i => !/[?#]/.test(i.u)) && A.some(i => i.u === base + "/official/a/one"), A.map(i => i.u));
    chk("the related-issue item is kept as a related issue (rl i)", A.some(i => /Public charge/.test(i.h) && i.rl === "i"), A.map(i => [i.h, i.rl]));
    chk("without official, a non-.gov source gives nothing", by("Opt NotOfficial").length === 0, hs("Opt NotOfficial"));
    const C = by("Opt CommunityOnly");
    chk("communityOnly: only the item that names the communities", C.length === 1 && /Asian American students/.test(C[0].h) && C[0].rl === "n", JSON.stringify(C.map(i => [i.h, i.rl])));
    const MG = by("Opt MatchGov");
    chk("match on a government source: only items that also match its own pattern are kept (the Asian American ones are not, the public charge one is)", MG.length === 1 && /Public charge/.test(MG[0].h), JSON.stringify(MG.map(i => [i.h, i.rl])));
    const P = by("Opt Plain");
    chk("without the drop options all four items come through", P.length === 4, hs("Opt Plain"));
    chk("without noQuery the link keeps its parameters, except the tracking labels (utm_...)", P.some(i => i.u === base + "/plain/a/one?id=7") && P.every(i => !/utm_/.test(i.u)), P.map(i => i.u));
    const N = by("Opt Numeric");
    chk("numericDates: 09/23/2026-style dates on a listing page are read", N.length === 2 && N.every(i => /^\d{4}-\d\d-\d\d/.test(i.d)), JSON.stringify(N.map(i => [i.h, i.d])));
    chk("the dates read are the dates on the page", N.length === 2 && N.some(i => i.d.slice(0, 10) === day(6).toISOString().slice(0, 10)) && N.some(i => i.d.slice(0, 10) === day(9).toISOString().slice(0, 10)), JSON.stringify(N.map(i => i.d)));
    chk("without numericDates such a listing gives nothing (as before)", by("Opt NoNumeric").length === 0, hs("Opt NoNumeric"));
    const K = by("Opt Cards"), ks = h => K.find(i => i.u === base + "/press-release/" + h);
    chk("before: a card listing is read, each card's own headline and date (the date above it, not the next card's)", K.length === 3 && ks("board-members") && ks("medicaid-vote") && ks("last-card") && ks("board-members").d.slice(0, 10) === day(3).toISOString().slice(0, 10) && ks("medicaid-vote").d.slice(0, 10) === day(8).toISOString().slice(0, 10) && ks("last-card").d.slice(0, 10) === day(11).toISOString().slice(0, 10), JSON.stringify(K.map(i => [i.h, i.d])));
    chk("before: a card with no date of its own is left out, not given the next card's date", !ks("no-date"), JSON.stringify(K.map(i => i.h)));
    chk("an all-capitals headline gets ordinary capitalisation, acronyms and numbers kept", ks("board-members")?.h === "APIAHF Welcomes New Board Members and the FY2026 Budget" && ks("medicaid-vote")?.h === "Statement on a Medicaid vote", JSON.stringify(K.map(i => i.h)));
    chk("without before the same listing reads the button text, never the card headlines (as before)", by("Opt NoCards").every(i => i.h === "READ MORE"), hs("Opt NoCards"));
    const DA = by("Opt DescAfter");
    chk("descAfter: a release whose summary (under the headline) names the communities is kept with that summary; the unrelated one is not", DA.length === 1 && /new grants/.test(DA[0].h) && DA[0].rl === "n" && /Native Hawaiian organizations/.test(DA[0].m ?? ""), JSON.stringify(DA.map(i => [i.h, i.rl, i.m])));
    chk("without descAfter the same filtered list gives nothing (the headline names no one)", by("Opt NoDescAfter").length === 0, hs("Opt NoDescAfter"));
    const BT = by("Opt BodyText");
    chk("bodyText: with an empty description the post text is read, so a story whose text names the topic is kept and the other is not", BT.length === 1 && /citizenship/.test(BT[0].h), hs("Opt BodyText"));
    chk("without bodyText an empty description means only the headline is tested (as before)", by("Opt NoBodyText").length === 0 && by("Opt BodyText").length === 1, hs("Opt NoBodyText"));
    const AP = by("Opt Apa");
    chk("\"Asian Pacific American\" and \"Asian and Pacific Islander\" count as naming the communities (communityOnly keeps them, rl n)", AP.length === 2 && AP.every(i => i.rl === "n") && AP.some(i => /Asian Pacific American Affairs/.test(i.h)) && AP.some(i => /Pacific Islander Heritage/.test(i.h)), JSON.stringify(AP.map(i => [i.h, i.rl])));
    chk("an unrelated release of the same feed is still left out", !AP.some(i => /fraud/.test(i.h)), hs("Opt Apa"));
    const ST = by("Opt Strip");
    chk("titleStrip: the release number and date are removed from the headline, and a typographic entity is decoded", ST.length === 1 && ST[0].h === "Governor Pulaali’i joins Asian American and Pacific Islander leaders", JSON.stringify(hs("Opt Strip")));
    chk("without titleStrip the headline keeps them (as before)", /^PR001-10272026/.test(by("Opt NoStrip")[0]?.h ?? ""), hs("Opt NoStrip"));
    const CM = by("Opt Comment");
    chk("skipComments: the headline link gets the date that follows the commented-out copy, and the commented copy is ignored", CM.length === 2 && CM.every(i => /^Governor /.test(i.h)) && CM.some(i => i.d.slice(0, 10) === day(4).toISOString().slice(0, 10)), JSON.stringify(CM.map(i => [i.h, i.d])));
    chk("without skipComments the headline link has no date and the commented copy is read as \"Read More\" (as before)", by("Opt NoComment").length > 0 && by("Opt NoComment").every(i => i.h === "Read More"), hs("Opt NoComment"));
    chk("a connection that drops once is tried again and the source is read", by("Opt Flaky").length >= 1 && /OK\s+Opt Flaky/.test(so), so.split("\n").filter(l => /Flaky/.test(l)));
    chk("a source that cannot be reached says why (the error code)", /FAIL Opt Dead: fetch failed \(ECONNREFUSED\)/.test(so), so.split("\n").filter(l => /Dead/.test(l)));
    chk("match communityPattern: a release that lists Hawaii among coalition states is left out, the one naming the communities is kept", by("Opt Cp").length === 1 && /Heritage Month/.test(by("Opt Cp")[0].h), JSON.stringify(hs("Opt Cp")));
    chk("without it the Hawaii-only release is taken for an AAPI release (as before)", by("Opt NoCp").length === 2, JSON.stringify(hs("Opt NoCp")));
    console.log(res.filter(Boolean).length + "/" + res.length + " passed"); process.exit(res.every(Boolean) ? 0 : 1);
  });
});
