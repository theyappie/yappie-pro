// How the collector (scripts/fetch.mjs) uses the owner's own topics, communities and News categories, the category chosen for each source, and the Policy relevancy / Research type choices.
// Runs the real collector several times against a mock server, writing admin.json between the runs the way the admin Worker does.
// usage: node collector_custom_test.mjs <repo> <tmp dir>
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

  // ---- run 1: no settings of the owner's own
  writeFileSync(AD + "/admin.json", JSON.stringify(cur));
  let r = await go(); let f = feed(), base1 = {};
  chk("run 1: ends well; no 'taxo' in the feed when nothing custom exists", r.code === 0 && f.length >= 6 && !("taxo" in feedAll()), r.log.slice(-300));
  chk("run 1: sources keep their usual categories (Alpha community, Beta news, Gamma community)", byId(id(1)).k === "community" && byId(id(4)).k === "news" && byId(id(6)).k === "community" && byId("sbeta000001").k === "news", JSON.stringify(f.map(i => [i.s, i.k])));
  for (const n of [1, 2, 3]) base1[n] = byId(id(n));
  chk("run 1: the house topic and community rules give the usual tags", base1[2].t !== "HOUSING VOUCHERS" && !(base1[1].cm || []).includes("BHUTANESE"));
  r = await go();
  chk("an unchanged second run says 'No changes.'", r.code === 0 && /No changes/.test(r.log), r.log.slice(-200));

  // ---- run 2: the owner's own topic, community and category; Beta Daily moved into the category
  op("topics", { list: [{ label: "Housing vouchers", words: "section 8, housing voucher" }] });
  op("communities", { list: [{ label: "Bhutanese", words: ["Bhutanese"] }] });
  op("newsKinds", { list: [{ label: "Faith media" }] });
  op("sourceKinds", { sources: ["Beta Daily"], kind: "faith-media" });
  r = await go(); f = feed();
  chk("run 2: ends well", r.code === 0, r.log.slice(-300));
  chk("topics: a story that mentions the owner's keyword is filed under the owner's topic (a story already stored too)", byId(id(2)).t === "HOUSING VOUCHERS", JSON.stringify(byId(id(2))));
  chk("topics: other stories keep the topic they had", byId(id(3)).t === base1[3].t && byId(id(1)).t === base1[1].t);
  chk("communities: the owner's community is added, and the built-in ones stay", (byId(id(1)).cm || []).includes("BHUTANESE") && (base1[1].cm || []).every(c => byId(id(1)).cm.includes(c)), JSON.stringify(byId(id(1)).cm));
  chk("communities: a story without the keyword is not given it", !(byId(id(3)).cm || []).includes("BHUTANESE"));
  chk("source category: every story of Beta Daily, new and stored, moves to the owner's category", byId(id(4)).k === "faith-media" && byId("sbeta000001").k === "faith-media", JSON.stringify([byId(id(4)).k, byId("sbeta000001").k]));
  chk("source category: other sources are not touched, even Gamma Voice, whose type is only in its own entry", byId(id(1)).k === "community" && byId(id(6)).k === "community");
  { const t = feedAll().taxo; chk("taxo: the feed names the owner's topic, community and category", t && JSON.stringify(t) === '{"t":[["HOUSING VOUCHERS","Housing vouchers"]],"c":[["BHUTANESE","Bhutanese"]],"kl":{"faith-media":"Faith media"}}', JSON.stringify(t)); }
  chk("taxo: keywords are never in the public feed", !/section 8|housing voucher"|words/i.test(readFileSync(D("feed.json"), "utf8").replace(/Section 8 housing voucher waitlist/, "")), "");
  r = await go();
  chk("an unchanged run after that says 'No changes.'", /No changes/.test(r.log), r.log.slice(-200));

  // ---- run 3: only a label changes: the feed is rewritten although no story changed
  op("topics", { list: [{ k: "HOUSING VOUCHERS", label: "Housing help", words: ["section 8", "housing voucher"] }] });
  r = await go();
  chk("renaming a topic rewrites the feed (the label is in 'taxo'), and the stories keep their topic", !/No changes/.test(r.log) && feedAll().taxo.t[0][1] === "Housing help" && byId(id(2)).t === "HOUSING VOUCHERS", r.log.slice(-200));

  // ---- run 4: the owner's choice for a source is removed: the usual category comes back (for Beta Daily, typed "news" in its own entry)
  op("sourceKinds", { sources: ["Beta Daily"], kind: null });
  r = await go();
  chk("source category removed: stories go back to the source's usual category (new and stored)", byId(id(4)).k === "news" && byId("sbeta000001").k === "news", JSON.stringify([byId(id(4)).k, byId("sbeta000001").k]));

  // ---- run 5: a source moved to AAPI Media / Mainstream, and a story the owner moved by hand keeps its own choice
  op("sourceKinds", { sources: ["Alpha Weekly"], kind: "news" });
  op("edit", { id: id(3), patch: { k: "faith-media" } });
  r = await go();
  chk("Alpha Weekly moved to Mainstream: its stories follow", byId(id(1)).k === "news" && byId(id(2)).k === "news");
  chk("a story moved by hand keeps its own category, whatever its source says", byId(id(3)).k === "faith-media", JSON.stringify(byId(id(3))));
  op("sourceKinds", { sources: ["Alpha Weekly"], kind: null });

  // ---- run 6: approval waits on the owner's category
  op("sourceKinds", { sources: ["Beta Daily"], kind: "faith-media" });
  op("settings", { approval: { mode: "custom", sources: [], kinds: ["faith-media"] } });
  BETA = rss([[H[4], U(4), "", 5], [H[5], U(5), "", 1]]);
  r = await go();
  chk("approval by the owner's category: a new story from a source in that category waits; the one already live stays live", !byId(id(5)) && pend().some(i => i.id === id(5) && i.k === "faith-media") && !!byId(id(4)), JSON.stringify([pend().map(i => [i.id, i.k]), feed().map(i => i.id)]));
  op("settings", { approval: { mode: "off", sources: [], kinds: [] } });
  op("approve", { ids: [id(5)] });
  r = await go();
  chk("approving it publishes it in the owner's category", byId(id(5))?.k === "faith-media", r.log.slice(-200));

  // ---- run 7: removing the category (the Worker also cleans the rest; here the state is made by the Worker's own rules)
  op("newsKinds", { list: [] });
  r = await go();
  chk("category removed: its stories fall back to the source's usual category, and the story moved there by hand to its source's", byId(id(4)).k === "news" && byId(id(5)).k === "news" && byId(id(3)).k === "community" && !("taxo" in feedAll() && feedAll().taxo.kl), JSON.stringify([byId(id(4)).k, byId(id(5)).k, byId(id(3)).k, feedAll().taxo]));
  chk("category removed: nothing keeps an unknown section", feed().every(i => X.kinds.has(i.k)), JSON.stringify([...new Set(feed().map(i => i.k))]));

  // ---- run 8: the damaged case: a state that still names a category that does not exist
  { const s = A.normalizeState(JSON.parse(JSON.stringify(cur))); s.settings.sourceKinds["Beta Daily"] = "ghost-kind"; writeFileSync(AD + "/admin.json", JSON.stringify(s));
    writeFileSync(D("feed.json"), JSON.stringify({ ...feedAll(), items: [...feed(), { id: "sghost00001", d: at, s: "Beta Daily", h: "Fixture custom: stored with a removed category", u: "https://cust.example/ghost", k: "ghost-kind", t: "CULTURE" }] }));
    r = await go(); chk("an unknown category in the state or on a stored story never reaches the site", r.code === 0 && byId("sghost00001")?.k === "news" && byId(id(4)).k === "news", r.log.slice(-200)); cur = A.normalizeState(null); writeFileSync(AD + "/admin.json", JSON.stringify(cur)); }

  // ---- run 9: topic and community removed: tags go back to the house rules
  op("topics", { list: [{ label: "Housing help", words: ["section 8"] }] }); op("communities", { list: [{ label: "Bhutanese", words: ["Bhutanese"] }] }); r = await go();
  chk("topic and community added again: stored stories pick them up", byId(id(2)).t.startsWith("HOUSING HELP") && (byId(id(1)).cm || []).includes("BHUTANESE"), JSON.stringify([byId(id(2)).t, byId(id(1)).cm]));
  op("topics", { list: [] }); op("communities", { list: [] });
  r = await go();
  chk("topic and community removed: their tags leave every story and the stories get a built-in topic", byId(id(2)).t === base1[2].t && !(byId(id(1)).cm || []).includes("BHUTANESE") && !("taxo" in feedAll()), JSON.stringify([byId(id(2)).t, byId(id(1)).cm, feedAll().taxo]));
  chk("topic and community removed: the built-in communities are still on the story", (base1[1].cm || []).every(c => (byId(id(1)).cm || []).includes(c)));

  // ---- run 10: Research type and Policy relevancy
  op("edit", { id: id(3), patch: { rt: "data", rl: "i" }, orig: {} });
  r = await go();
  chk("research type and policy relevancy: the owner's choices reach the feed", byId(id(3)).rt === "data" && byId(id(3)).rl === "i", JSON.stringify(byId(id(3))));
  op("edit", { id: id(3), patch: { rt: null } });
  r = await go();
  chk("research type set back to automatic: it leaves the feed", !("rt" in byId(id(3))) && byId(id(3)).rl === "i");
  op("revert", { id: id(3) });
  r = await go();
  chk("reverting an item takes the choices off it again", !("rt" in byId(id(3))) && !("rl" in byId(id(3))), JSON.stringify(byId(id(3))));

  console.log(ok.every(Boolean) ? "ALL PASS " + ok.length : "SOME FAILED");
  srv.close();
});
