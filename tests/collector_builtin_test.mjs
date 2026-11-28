// How the collector (scripts/fetch.mjs) applies the owner's changes to the built-in topics, communities and News categories (renamed, removed, restored) and extra topics on a story.
// Runs the real collector several times against a mock server, writing admin.json between the runs the way the admin Worker does.
// usage: node collector_builtin_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { createHash } from "node:crypto";
import { rss } from "./fixtures.mjs";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data/articles", { recursive: true }); mkdirSync(TMP + "/private", { recursive: true });
const A = await import(REPO + "/scripts/admin.mjs"), TAX = JSON.parse(readFileSync(REPO + "/taxonomy.json", "utf8")), X = A.taxSets(TAX);
const REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), idOf = u => createHash("sha1").update(u).digest("hex").slice(0, 12);
const U = n => `https://cust.example/n${n}`, H = {
  1: "Fixture custom: Bhutanese families settle in Columbus, Ohio", 2: "Fixture custom: Section 8 housing voucher waitlist reopens for Asian American families", 3: "Fixture custom: Asian American seniors host a cooking class",
  4: "Fixture custom: Korean American students rally on campus", 5: "Fixture custom: Vietnamese American shop owners open a second store", 6: "Fixture custom: Filipino nurses hold a job fair in Texas",
};
let ALPHA = rss([1, 2, 3].map(n => [H[n], U(n), "", n + 1])), BETA = rss([[H[4], U(4), "", 5]]), GAMMA = rss([[H[6], U(6), "", 6]]);
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x"), send = b => { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(b); };
  if (u.pathname === "/alpha.xml") send(ALPHA); else if (u.pathname === "/beta.xml") send(BETA); else if (u.pathname === "/gamma.xml") send(GAMMA); else { r.writeHead(404); r.end(); }
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); ok.push(!!c); };
  process.env.TEST_BASE = base; process.env.NODE_OPTIONS = "--import " + new URL("./shim_fetch.mjs", import.meta.url).href;
  // Alpha Weekly is AAPI Media by the "kinds" list; Beta Daily is typed "news" in its own entry; Gamma Voice is typed "community" in its own entry only
  const cfg = { keepDays: 30, maxItems: 400, kinds: { ...REAL.kinds, "Alpha Weekly": "community" }, renames: {}, excludeHosts: [], excludeNames: [], blockForeignDomains: false, allowHosts: [], gatedHosts: [], routes: [], trustedOutlets: [], communityPattern: REAL.communityPattern, researchMax: 150, siteUrl: "", sources: [
    { name: "Alpha Weekly", home: base, feed: base + "/alpha.xml" }, { name: "Beta Daily", home: base, feed: base + "/beta.xml", kind: "news" }, { name: "Gamma Voice", home: base, feed: base + "/gamma.xml", kind: "community" }] };
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg));
  const AD = TMP + "/private", D = f => TMP + "/data/" + f, readJ = f => { try { return JSON.parse(readFileSync(D(f), "utf8")); } catch { return null; } };
  const go = async () => { try { return { code: 0, log: (await run("node", [REPO + "/scripts/fetch.mjs"], { env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: D("feed.json"), ADMIN_DIR: AD } })).stdout }; } catch (e) { return { code: e.code, log: e.stdout + e.stderr }; } };
  const feedAll = () => readJ("feed.json"), feed = () => feedAll().items, byId = id => feed().find(i => i.id === id), id = n => idOf(U(n));
  const pend = () => { try { return JSON.parse(readFileSync(AD + "/pending.json", "utf8")).items ?? []; } catch { return []; } };
  let cur = A.emptyState();
  const save = f => { const s = A.normalizeState(JSON.parse(JSON.stringify(cur))); f(s); cur = s; writeFileSync(AD + "/admin.json", JSON.stringify(s)); return s; };
  const withSettings = (o, extra = f => {}) => save(s => { Object.assign(s.settings, o); extra(s); });
  const op = (o, a) => { cur = A.applyOp(cur, o, a, { X }).state; writeFileSync(AD + "/admin.json", JSON.stringify(cur)); return cur; };
  const at = new Date().toISOString();
  // a stored item from an earlier run: Beta Daily's, in the usual News category
  writeFileSync(D("feed.json"), JSON.stringify({ generated: at, items: [{ id: "sbeta000001", d: new Date(Date.now() - 864e5).toISOString(), s: "Beta Daily", h: "Fixture custom: stored story from Beta Daily", u: "https://cust.example/stored", k: "news", t: "CULTURE" }] }));

  // ---- run 1: nothing changed
  writeFileSync(AD + "/admin.json", JSON.stringify(cur));
  let r = await go(), b = {};
  for (const n of [1, 2, 3, 4, 5, 6]) b[n] = byId(id(n));
  chk("run 1: ends well, and the feed has no 'taxo'", r.code === 0 && feed().length >= 6 && !("taxo" in feedAll()), r.log.slice(-300));
  chk("baseline: the housing-voucher story is under Housing, and the Korean story has the Korean community", b[2].t === "HOUSING" && (b[4].cm || []).includes("KR"), JSON.stringify([b[2].t, b[4].cm]));

  // ---- run 2: Housing and the Korean community removed, Education renamed
  op("topics", { list: [], builtin: { HOUSING: { off: true }, EDUCATION: { label: "Schools" } } });
  op("communities", { list: [], builtin: { KR: { off: true }, VN: { label: "Vietnamese American" } } });
  r = await go();
  chk("run 2: ends well", r.code === 0, r.log.slice(-300));
  chk("removed topic: no story is filed under it any more (a stored story too); it moved to another topic", feed().every(i => i.t !== "HOUSING") && byId(id(2)).t !== "HOUSING" && !!byId(id(2)).t, JSON.stringify(byId(id(2))));
  chk("removed community: it is taken off every story, the other tags stay", feed().every(i => !(i.cm || []).includes("KR")) && (b[6].cm || []).includes("PH") && (byId(id(6)).cm || []).includes("PH"), JSON.stringify(byId(id(4)).cm));
  { const t = feedAll().taxo; chk("taxo: the feed says what was removed and renamed (names only)", JSON.stringify(t) === '{"rn":{"t":{"EDUCATION":"Schools"},"c":{"VN":"Vietnamese American"}},"off":{"t":["HOUSING"],"c":["KR"]}}', JSON.stringify(t)); }
  chk("stories that were not touched keep their topic", byId(id(3)).t === b[3].t && byId(id(6)).t === b[6].t);
  r = await go();
  chk("an unchanged run after that says 'No changes.'", /No changes/.test(r.log), r.log.slice(-200));

  // ---- run 3: a rename alone rewrites the feed
  op("topics", { list: [], builtin: { HOUSING: { off: true }, EDUCATION: { label: "School news" } } });
  r = await go();
  chk("renaming a built-in topic rewrites the feed (the name is in 'taxo'); stories keep their topic", !/No changes/.test(r.log) && feedAll().taxo.rn.t.EDUCATION === "School news" && byId(id(3)).t === b[3].t, r.log.slice(-200));

  // ---- run 4: both restored: stories that fit them come back
  op("topics", { list: [], builtin: { EDUCATION: { label: "School news" } } });
  op("communities", { list: [], builtin: { VN: { label: "Vietnamese American" } } });
  r = await go();
  chk("restored topic: the story that fits it is under it again", byId(id(2)).t === "HOUSING", JSON.stringify(byId(id(2))));
  chk("restored community: it is back on the story that fits it", (byId(id(4)).cm || []).includes("KR"), JSON.stringify(byId(id(4)).cm));
  chk("taxo after restoring: only the new names are left", JSON.stringify(feedAll().taxo) === '{"rn":{"t":{"EDUCATION":"School news"},"c":{"VN":"Vietnamese American"}}}', JSON.stringify(feedAll().taxo));
  op("topics", { list: [], builtin: {} }); op("communities", { list: [], builtin: {} });
  r = await go();
  chk("back to nothing changed: 'taxo' is gone from the feed", r.code === 0 && !("taxo" in feedAll()), r.log.slice(-200));

  // ---- run 5: the AAPI Media category removed; its sources go to Mainstream
  chk("baseline: Alpha Weekly and Gamma Voice are AAPI Media, Beta Daily is Mainstream", byId(id(1)).k === "community" && byId(id(6)).k === "community" && byId(id(4)).k === "news");
  op("newsKinds", { list: [], builtin: { community: { off: true, to: "news" } } });
  r = await go();
  chk("removed category: every story of its sources (stored ones too, and a source typed in its own entry) goes to the chosen category", r.code === 0 && feed().every(i => i.k !== "community") && byId(id(1)).k === "news" && byId(id(6)).k === "news", JSON.stringify(feed().map(i => [i.s, i.k])));
  chk("removed category: taxo says so", JSON.stringify(feedAll().taxo) === '{"off":{"k":["community"]}}', JSON.stringify(feedAll().taxo));
  op("newsKinds", { list: [{ label: "Faith media" }], builtin: { community: { off: true, to: "faith-media" }, news: { label: "General news" } } });
  op("sourceKinds", { sources: ["Beta Daily"], kind: "faith-media" });
  r = await go();
  chk("removed category pointing at one of the owner's own categories; a renamed Mainstream", byId(id(1)).k === "faith-media" && byId(id(6)).k === "faith-media" && byId(id(4)).k === "faith-media" && JSON.stringify(feedAll().taxo) === '{"kl":{"faith-media":"Faith media"},"rn":{"k":{"news":"General news"}},"off":{"k":["community"]}}', JSON.stringify([feedAll().taxo, feed().map(i => [i.s, i.k])]));
  op("sourceKinds", { sources: ["Beta Daily"], kind: null });
  op("newsKinds", { list: [], builtin: {} });
  r = await go();
  chk("restored category: the sources are back in it", byId(id(1)).k === "community" && byId(id(6)).k === "community" && byId(id(4)).k === "news" && !("taxo" in feedAll()), JSON.stringify(feed().map(i => [i.s, i.k])));

  // ---- run 6: extra topics
  op("edit", { id: id(1), patch: { t: "IMMIGRATION", tx: ["EDUCATION", "HEALTH"] }, orig: { t: b[1].t } });
  r = await go();
  chk("extra topics: the story has its main topic and the extra ones in the feed", byId(id(1)).t === "IMMIGRATION" && JSON.stringify(byId(id(1)).tx) === '["EDUCATION","HEALTH"]', JSON.stringify(byId(id(1))));
  chk("extra topics: other stories have none", feed().filter(i => i.id !== id(1) && i.tx).length === 0);
  r = await go();
  chk("extra topics: an unchanged run says 'No changes.' and keeps them", /No changes/.test(r.log) && JSON.stringify(byId(id(1)).tx) === '["EDUCATION","HEALTH"]');
  op("topics", { list: [], builtin: { EDUCATION: { off: true } } });
  r = await go();
  chk("extra topics: when one of them is removed it leaves the story", JSON.stringify(byId(id(1)).tx) === '["HEALTH"]' && byId(id(1)).t === "IMMIGRATION", JSON.stringify(byId(id(1))));
  op("topics", { list: [], builtin: {} });
  r = await go();
  chk("extra topics: an edit that used the removed topic is gone for good (restoring does not bring it back)", JSON.stringify(byId(id(1)).tx) === '["HEALTH"]', JSON.stringify(byId(id(1))));
  op("revert", { id: id(1) });
  r = await go();
  chk("extra topics: reverting to collected takes them off", byId(id(1)).tx === undefined && byId(id(1)).t === b[1].t, JSON.stringify(byId(id(1))));

  // ---- the keywords of the owner's own topics stay private, built-in changes publish names only
  chk("nothing is written that should be private", !/words|keyword/i.test(readFileSync(D("feed.json"), "utf8")));
  console.log(ok.every(Boolean) ? "ALL PASS " + ok.length : "SOME FAILED");
  srv.close(); process.exit(ok.every(Boolean) ? 0 : 1);
});
