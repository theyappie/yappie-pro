// How the collector (scripts/fetch.mjs) applies the owner's decisions from the admin dashboard (data/admin.json, data/pending.json).
// Runs the real collector several times against a mock server, writing the decisions between the runs the way the admin Worker does.
// usage: node collector_admin_test.mjs <repo> <tmp dir> [private]   ("private": admin.json and pending.json live in a separate folder (ADMIN_DIR), as in the real site)
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { createHash } from "node:crypto";
import { yappiePage, today, rss, FEEDS } from "./fixtures.mjs";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data/articles", { recursive: true });
const PRIV = process.argv[4] === "private", AD = PRIV ? TMP + "/private" : TMP + "/data"; mkdirSync(AD, { recursive: true });
const REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), idOf = u => createHash("sha1").update(u).digest("hex").slice(0, 12);
const hrs = n => new Date(today.getTime() - n * 36e5).toISOString(), days = n => new Date(today.getTime() - n * 864e5).toISOString();
const N = n => `https://adm.example/n${n}`, T = {
  1: "Fixture admin: Korean American voters in Georgia turn out", 2: "Fixture admin: Vietnamese American nail salon workers push for safer rules", 3: "Fixture admin: Filipino nurses in Texas back new hospital staffing bill",
  4: "Fixture admin: Hmong farmers in Minnesota fear ICE detention", 5: "Fixture admin: Chinese American students in California sue over admissions", 6: "Fixture admin: Samoan leaders in Hawaii ask Congress about deep sea mining",
};
let NEWS = rss([1, 2, 3, 4].map(n => [T[n], N(n), "", n + 1])), ORG = rss([["Fixture admin: statement on Asian American census data", "https://adm-org.example/s1", "", 1]]);
const HITS = { news: 0 }, srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x"), send = (b, t = "application/rss+xml") => { r.writeHead(200, { "content-type": t }); r.end(b); };
  if (u.pathname.startsWith("/yp/")) send(yappiePage(u.pathname.slice(4)), "text/html");
  else if (u.pathname === "/adm-news.xml") { HITS.news++; send(NEWS); } else if (u.pathname === "/adm-org.xml") send(ORG); else if (u.pathname === "/yappie.xml") send(FEEDS["/yappie.xml"]);
  else { r.writeHead(404); r.end(); }
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); ok.push(!!c); };
  process.env.TEST_BASE = base; process.env.NODE_OPTIONS = "--import " + new URL("./shim_fetch.mjs", import.meta.url).href;
  const cfg = { keepDays: 30, maxItems: 400, kinds: { ...REAL.kinds }, renames: {}, excludeHosts: [], excludeNames: [], blockForeignDomains: false, allowHosts: [], gatedHosts: [], routes: [], trustedOutlets: [], communityPattern: REAL.communityPattern, researchMax: 150, siteUrl: "", sources: [
    { name: "Admin News", home: base, feed: base + "/adm-news.xml", kind: "news" }, { name: "Admin Org", home: base, feed: base + "/adm-org.xml", kind: "statement" },
    { ...REAL.sources.find(x => x.name === "The Yappie"), feed: base + "/yappie.xml", pages: 1 }] };
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg));
  const D = f => TMP + "/data/" + f, readJ = f => { try { return JSON.parse(readFileSync(D(f), "utf8")); } catch { return null; } }, AF = f => AD + "/" + f, state = o => writeFileSync(AF("admin.json"), JSON.stringify(o));
  const go = async (env = {}) => { try { return { code: 0, log: (await run("node", [REPO + "/scripts/fetch.mjs"], { env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: D("feed.json"), ...(PRIV ? { ADMIN_DIR: AD } : {}), ...env } })).stdout }; } catch (e) { return { code: e.code, log: e.stdout + e.stderr }; } };
  const feed = () => readJ("feed.json").items, byId = id => feed().find(i => i.id === id), pend = () => { try { return JSON.parse(readFileSync(AF("pending.json"), "utf8")).items ?? []; } catch { return []; } }, pendById = id => pend().find(i => i.id === id), art = id => readJ("articles/" + id + ".json");
  const id = n => idOf(N(n)), YP = n => idOf(`https://yp.example/${n}/`), MAN = "m0123456789ab", at = new Date().toISOString();
  const S = (o = {}) => ({ v: 1, updated: at, settings: { approval: { mode: "off", sources: [], kinds: [] } }, edits: {}, orig: {}, article: {}, approved: {}, held: {}, pinned: {}, deleted: {}, added: [], ...o });

  // stored items from an earlier run: two 40 days old (one will be kept permanently), and two recent ones
  const st = (i, o) => ({ id: i, d: days(5), s: "Admin News", h: "Fixture admin: stored " + i, u: "https://adm.example/" + i, k: "news", t: "CULTURE", ...o });
  writeFileSync(D("feed.json"), JSON.stringify({ generated: days(1), items: [st("sold000pin1", { d: days(40) }), st("sold000pln2", { d: days(40) }), st("sdel0000001"), st("slive000001")] }));

  // ---- run 1: deleted, edited, kept permanently, added by hand, article text written by hand
  const snap = { id: id(4), d: hrs(5), s: "Admin News", h: T[4], u: N(4), k: "news", t: "IMMIGRATION" };
  state(S({
    deleted: { [id(2)]: { at, item: { ...snap, id: id(2), h: T[2], u: N(2) } }, sdel0000001: { at } },
    edits: { [id(1)]: { h: "Edited: Korean voters in Georgia", t: "ELECTIONS", cm: ["KR"], st: ["GA"], k: "community", m: "Edited summary" } }, orig: { [id(1)]: { h: T[1], t: "CULTURE", cm: null, st: null, k: "news", m: null } },
    pinned: { sold000pin1: at, [MAN]: at },
    added: [{ id: MAN, d: hrs(3), s: "The Yappie Pro", h: "Added by hand", m: "Written in the dashboard.", u: "https://theyappie.com/added", k: "community", t: "HEALTH", cm: ["VN"], v: 1 }],
    article: { [MAN]: { by: "Staff", img: "", byu: "", body: "<p>Hand-written text.</p>" }, [YP(2)]: { by: "Edited Author", byu: "https://yp.example/author/edited/", body: "<p>Rewritten in the dashboard.</p>" } },
  }));
  let r = await go(); let f = feed();
  chk("run 1 ends well and the feed has items", r.code === 0 && f.length > 8, r.log.slice(-300));
  chk("deleted: a fresh item is gone, and so is a stored one (and neither comes back)", !byId(id(2)) && !byId("sdel0000001") && !!byId(id(3)) && !!byId("slive000001"));
  { const e = byId(id(1)); chk("edited: the owner's headline, topic, communities, states, section and summary replace the collected ones", e && e.h === "Edited: Korean voters in Georgia" && e.t === "ELECTIONS" && e.cm?.[0] === "KR" && e.st?.[0] === "GA" && e.k === "community" && e.m === "Edited summary", JSON.stringify(e)); }
  chk("kept permanently: a 40-day-old item stays when pinned, and an unpinned one of the same age ages out", !!byId("sold000pin1") && !byId("sold000pln2"));
  { const m = byId(MAN), a = art(MAN); chk("added by hand: the item is in the feed as an article, with its text in its own article file", m && m.v === 1 && m.h === "Added by hand" && m.k === "community" && a && a.body === "<p>Hand-written text.</p>" && a.by === "Staff", JSON.stringify([m, a])); }
  { const y = byId(YP(2)), a = art(YP(2)); chk("article text written by hand replaces the collected text, with its author and author link as given; other articles are untouched", y && a && a.body === "<p>Rewritten in the dashboard.</p>" && a.by === "Edited Author" && a.byu === "https://yp.example/author/edited/" && /First paragraph/.test(art(YP(1))?.body ?? ""), JSON.stringify(a)); }
  chk("no waiting list yet, and a feed with no duplicate ids", !existsSync(AF("pending.json")) && new Set(f.map(i => i.id)).size === f.length);

  // ---- run 2: approval needed for one source; new items arrive
  NEWS = rss([1, 2, 3, 4, 5].map(n => [T[n], N(n), "", n + 1])); ORG = rss([["Fixture admin: statement on Asian American census data", "https://adm-org.example/s1", "", 1], ["Fixture admin: second statement on Asian American voters", "https://adm-org.example/s2", "", 1]]);
  const S2 = o => S({ ...JSON.parse(readFileSync(AF("admin.json"), "utf8")), settings: { approval: { mode: "custom", sources: ["Admin News"], kinds: [] } }, ...o });
  state(S2()); r = await go(); f = feed();
  chk("approval (custom, one source): a new item from that source waits in data/pending.json and is not in the feed", !byId(id(5)) && pendById(id(5))?.h === T[5] && pendById(id(5)).s === "Admin News", JSON.stringify(pend().map(i => i.h)));
  chk("approval: items that were live stay live, and a new item from another source goes live", !!byId(id(3)) && !!byId(id(1)) && !pendById(id(3)) && f.some(i => i.u === "https://adm-org.example/s2"));
  chk("approval: the deleted item stays deleted and the hand-added item is untouched", !byId(id(2)) && !!byId(MAN));

  // ---- run 3: approve the waiting item, take two live items back to the queue (one of them an article)
  state(S2({ approved: { ...JSON.parse(readFileSync(AF("admin.json"), "utf8")).approved, [id(5)]: at, [MAN]: at }, held: { [id(3)]: at, [YP(2)]: at } })); r = await go();
  chk("approve: the waiting item is now live and no longer waiting", !!byId(id(5)) && !pendById(id(5)));
  chk("unpublish: items taken back are out of the feed and waiting", !byId(id(3)) && !!pendById(id(3)) && !byId(YP(2)) && !!pendById(YP(2)));
  { const p = pendById(YP(2)); chk("unpublish: an article waits with its text inside the waiting list, and its public article file is removed", p?.v === 1 && p.art?.body === "<p>Rewritten in the dashboard.</p>" && p.art.by === "Edited Author" && !existsSync(D("articles/" + YP(2) + ".json")), JSON.stringify(p)?.slice(0, 300)); }

  if (PRIV) {
    const { execFileSync } = await import("node:child_process");
    const found = (() => { try { return execFileSync("grep", ["-rl", "Rewritten in the dashboard", TMP + "/data"]).toString().trim(); } catch { return ""; } })();
    chk("private mode: the waiting article's text is not anywhere in the published data folder", found === "", found);
    chk("private mode: no admin.json or pending.json in the published data folder", !existsSync(D("admin.json")) && !existsSync(D("pending.json")));
  }

  // ---- run 4: approve them again
  { const s = JSON.parse(readFileSync(AF("admin.json"), "utf8")); state({ ...s, held: {}, approved: { ...s.approved, [id(3)]: at, [YP(2)]: at } }); }
  r = await go();
  chk("approve again: both are live, the article file is back with the hand-written text, and nothing is waiting", !!byId(id(3)) && art(YP(2))?.body === "<p>Rewritten in the dashboard.</p>" && pend().length === 0 && existsSync(AF("pending.json")));

  // ---- run 5: nothing changed
  const before = readFileSync(D("feed.json"), "utf8"); r = await go();
  chk("nothing changed: the collector says so and leaves the feed alone", /No changes/.test(r.log) && readFileSync(D("feed.json"), "utf8") === before, r.log.slice(-200));

  // ---- run 6: restore from the trash when the source no longer lists the story
  NEWS = rss([1, 3, 5].map(n => [T[n], N(n), "", n + 1]));
  { const s = JSON.parse(readFileSync(AF("admin.json"), "utf8")); state({ ...s, deleted: { ...s.deleted, [id(4)]: { at, item: snap } } }); }
  r = await go(); chk("deleted: an item deleted in the dashboard is not in the feed", !byId(id(4)));
  { const s = JSON.parse(readFileSync(AF("admin.json"), "utf8")); delete s.deleted[id(4)]; state({ ...s, added: [...s.added, snap], approved: { ...s.approved, [id(4)]: at } }); }
  r = await go(); chk("restore: the saved copy is back in the feed although the source no longer lists it", byId(id(4))?.h === T[4]);

  // ---- run 7: the source changes the headline of an edited story
  NEWS = rss([[ "Fixture admin: Korean American voters in Georgia - a new headline from the publisher", N(1), "", 2], ...[3, 5].map(n => [T[n], N(n), "", n + 1])]);
  r = await go(); chk("edits survive: when the publisher changes the headline, the owner's edit is still what is shown, and the story is listed once", byId(id(1))?.h === "Edited: Korean voters in Georgia" && feed().filter(i => i.u === N(1)).length === 1, JSON.stringify(feed().filter(i => i.u === N(1))));
  r = await go({ RETAG: "1" }); chk("edits survive a full re-tag (RETAG=1): the owner's topic and communities stay", byId(id(1))?.t === "ELECTIONS" && byId(id(1)).cm?.[0] === "KR" && byId(id(1)).st?.[0] === "GA");

  // ---- run 8: every new item needs approval; a section chosen in "custom"
  NEWS = rss([[ "Fixture admin: Korean American voters in Georgia - a new headline from the publisher", N(1), "", 2], ...[3, 5].map(n => [T[n], N(n), "", n + 1]), [T[6], N(6), "", 1]]);
  { const s = JSON.parse(readFileSync(AF("admin.json"), "utf8")); state({ ...s, settings: { approval: { mode: "all", sources: [], kinds: [] } } }); }
  r = await go(); chk("approval (all): a new item from any source waits, the old ones stay live", !byId(id(6)) && !!pendById(id(6)) && !!byId(id(1)) && !!byId(id(5)));
  { const s = JSON.parse(readFileSync(AF("admin.json"), "utf8")); state({ ...s, settings: { approval: { mode: "off", sources: [], kinds: [] } } }); }
  r = await go(); chk("approval turned off: items already waiting keep waiting until approved", !byId(id(6)) && !!pendById(id(6)));

  // ---- run 9: a source the owner blocked
  { const cur = JSON.parse(readFileSync(AF("admin.json"), "utf8")), hand = { id: "m0blocked001", d: hrs(2), s: "Admin News", h: "Fixture admin: added by hand from a blocked source", u: "https://adm.example/hand", k: "news", t: "HEALTH" };
    const was = feed().filter(i => i.s === "Admin News").length, yp2 = byId(YP(2)) ? 1 : 0, org = feed().filter(i => i.s === "Admin Org").length;
    state({ ...cur, settings: { ...cur.settings, blocked: { "admin   NEWS": at } }, added: [...cur.added, hand], pinned: { ...cur.pinned, [hand.id]: at }, approved: { ...cur.approved, [hand.id]: at }, edits: { ...cur.edits, [YP(2)]: { ...(cur.edits?.[YP(2)] ?? {}), s: "Admin News" } } });
    const hits0 = HITS.news; r = await go(); f = feed();
    chk("blocked source: before blocking there were stories from it to remove", was >= 3 && org >= 1, was + " / " + org);
    chk("blocked source: none of its stories are in the feed, stored or fresh, and the name matches in any capitals and spacing", f.every(i => i.s !== "Admin News"), f.filter(i => i.s === "Admin News").map(i => i.h).join(" | "));
    chk("blocked source: a story that was waiting for approval is gone too", pend().every(i => i.s !== "Admin News"), JSON.stringify(pend().map(i => i.s)));
    chk("blocked source: its feed is not even asked for, and the log says so without naming it (the log is public, the owner's choice is not)", HITS.news === hits0 && /Skipped \(blocked in the admin dashboard\): 1 source\./.test(r.log) && !/blocked in the admin dashboard\)[^\n]*Admin News/.test(r.log), HITS.news + " vs " + hits0 + " | " + (r.log.match(/Skipped \(blocked[^\n]*/) ?? [""])[0]);
    chk("blocked source: a story added by hand under that source name is gone, and so is one whose source was edited to it", !byId(hand.id) && !byId(YP(2)), JSON.stringify(f.filter(i => i.id === hand.id || i.id === YP(2))));
    chk("blocked source: other sources are untouched, the hand-added Yappie Pro story included", f.filter(i => i.s === "Admin Org").length === org && !!byId(MAN) && f.some(i => i.s === "The Yappie"), "org " + f.filter(i => i.s === "Admin Org").length);
    chk("blocked source: the run keeps going and does not say anything failed", r.code === 0 && !/FAIL/.test(r.log), r.log.slice(-200));
    const cur2 = JSON.parse(readFileSync(AF("admin.json"), "utf8")); delete cur2.settings.blocked; delete cur2.edits[YP(2)].s; state(cur2);
    r = await go(); f = feed();
    chk("unblocked: the source is collected again from the next run", HITS.news > hits0 && !!byId(id(3)) && !!byId(id(5)) && f.filter(i => i.s === "Admin News").length >= 2, f.filter(i => i.s === "Admin News").length + " stories");
    chk("unblocked: the story edited back is in the feed again, and the hand-added one returns", !!byId(YP(2)) && !!byId(hand.id));
  }

  // ---- featured items and breaking news
  {
    const cur = JSON.parse(readFileSync(AF("admin.json"), "utf8")), cf = readJ("feed.json"), oldIt = i => st(i, { d: days(45) }), ago = h => new Date(Date.now() - h * 36e5).toISOString();
    cf.items.push(oldIt("sfeat000001"), oldIt("sbrk0000001"), oldIt("sbrk0000002"), oldIt("splain00001")); writeFileSync(D("feed.json"), JSON.stringify(cf));
    cur.featured = { sfeat000001: ago(1), [id(3)]: ago(2) };
    cur.breaking = { sbrk0000001: { at: ago(1), hours: 6, label: "urgent" }, sbrk0000002: { at: ago(30), hours: 6, label: "breaking" }, [id(5)]: { at: ago(0.5), hours: 2, label: "important" } }; state(cur);
    r = await go(); f = feed();
    chk("featured: a 45-day-old item stays (it would otherwise age out after 30 days) and carries its featured time", r.code === 0 && byId("sfeat000001")?.fe === cur.featured.sfeat000001 && !byId("splain00001"), JSON.stringify(byId("sfeat000001")));
    chk("featured: a fresh item carries its featured time too", byId(id(3))?.fe === cur.featured[id(3)], JSON.stringify(byId(id(3))));
    { const b = byId("sbrk0000001"); chk("breaking: a 45-day-old item with a running mark stays, with start, end and label", b && b.bt === cur.breaking.sbrk0000001.at && b.bu === new Date(Date.parse(b.bt) + 6 * 36e5).toISOString() && b.bk === "urgent", JSON.stringify(b)); }
    { const b = byId(id(5)); chk("breaking: a fresh item carries its mark (label, 2 hours)", b && b.bk === "important" && Date.parse(b.bu) - Date.parse(b.bt) === 2 * 36e5, JSON.stringify(b)); }
    chk("breaking: an old item whose mark ended is not kept past the usual days", !byId("sbrk0000002"));
    chk("featured and breaking: items without a mark carry none of these fields", f.filter(i => ![id(3), id(5), "sfeat000001", "sbrk0000001"].includes(i.id)).every(i => !("fe" in i) && !("bu" in i) && !("bt" in i) && !("bk" in i)));
    const cur3 = JSON.parse(readFileSync(AF("admin.json"), "utf8")); cur3.featured = {}; delete cur3.breaking.sbrk0000001; delete cur3.breaking[id(5)]; state(cur3);
    r = await go(); f = feed();
    chk("unfeatured and unmarked: the old items age out again, and the fresh ones lose their fields", !byId("sfeat000001") && !byId("sbrk0000001") && !("fe" in byId(id(3))) && !("bu" in byId(id(5))) && !("bk" in byId(id(5))), JSON.stringify([byId(id(3)), byId(id(5))]));
  }

  // ---- bad decisions file
  const keep = readFileSync(D("feed.json"), "utf8"); writeFileSync(AF("admin.json"), '{"note":"PRIVATE-MARKER-9431" not json');
  r = await go(); chk("a damaged decisions file stops the run and keeps the previous data (nothing the owner deleted comes back)", r.code === 1 && /admin\.json cannot be read/.test(r.log) && readFileSync(D("feed.json"), "utf8") === keep, r.log.slice(-200));
  chk("... and the public log says what kind of problem it is without quoting the private file", /admin\.json cannot be read \(it is not valid JSON\)/.test(r.log) && !/PRIVATE-MARKER|not json/.test(r.log), r.log.slice(-300));
  { const goodAdmin = '{"v":1}', pf = AF("pending.json"), had = existsSync(pf) ? readFileSync(pf, "utf8") : null; writeFileSync(AF("admin.json"), goodAdmin); writeFileSync(pf, '{"items":[{"h":"WAITING-STORY-7712"} oops');
    const r2 = await go(); chk("a damaged waiting list stops the run too, and is not quoted either", r2.code === 1 && /pending\.json cannot be read \(it is not valid JSON\)/.test(r2.log) && !/WAITING-STORY|oops/.test(r2.log) && readFileSync(D("feed.json"), "utf8") === keep, r2.log.slice(-300));
    if (had === null) rmSync(pf, { force: true }); else writeFileSync(pf, had); }
  writeFileSync(AF("admin.json"), JSON.stringify({ v: 1, edits: 7, added: "x", deleted: [] })); r = await go();
  chk("a decisions file with wrong types is read as 'no decisions', not a crash", r.code === 0, r.log.slice(-200));
  if (PRIV) {
    const keep = readFileSync(D("feed.json"), "utf8");
    r = await go({ ADMIN_DIR: TMP + "/does-not-exist" });
    chk("an ADMIN_DIR that is not a folder stops the run (the owner's decisions are never silently skipped)", r.code === 1 && /not a folder/.test(r.log) && readFileSync(D("feed.json"), "utf8") === keep, r.log.slice(-200));
    mkdirSync(TMP + "/empty-private", { recursive: true });
    r = await go({ ADMIN_DIR: TMP + "/empty-private" });
    chk("an empty ADMIN_DIR (a new private repository) means no decisions yet, and the run works", r.code === 0, r.log.slice(-200));
  }
  srv.close(); console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
});
