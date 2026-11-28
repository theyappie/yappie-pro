// Topic hubs in the collector: every item is matched to the hubs (starter hubs.json, minus the ones the owner hid, plus the owner's own) on every run.
// usage: node collector_hubs_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, statSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util";
import { rss } from "./fixtures.mjs";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data/articles", { recursive: true }); mkdirSync(TMP + "/private", { recursive: true });
const REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), STARTER = JSON.parse(readFileSync(REPO + "/hubs.json", "utf8"));
const N = n => `https://hub.example/n${n}`, T = {
  1: "Fixture hubs: Court hears birthright citizenship case brought by Asian American families", 2: "Fixture hubs: Vietnamese American seniors in Texas ask for language access at clinics",
  3: "Fixture hubs: Korean American bakery opens a second shop in Georgia", 4: "Fixture hubs: Hmong farmers in Minnesota fear ICE detention and deportation",
  5: "Fixture hubs: Samoan leaders in Hawaii ask Congress about the Compact of Free Association trust fund",
};
let NEWS = rss([1, 2, 3, 4, 5].map(n => [T[n], N(n), n === 3 ? "A second location for the Atlanta baker, who also backs the Census race question." : "", n + 1]));
const srv = http.createServer((q, r) => { const u = new URL(q.url, "http://x"); if (u.pathname === "/hub-news.xml") { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(NEWS); } else { r.writeHead(404); r.end(); } }).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : x); ok.push(!!c); };
  process.env.TEST_BASE = base; process.env.NODE_OPTIONS = "--import " + new URL("./shim_fetch.mjs", import.meta.url).href;
  const cfg = { keepDays: 30, maxItems: 400, kinds: { ...REAL.kinds }, renames: {}, excludeHosts: [], excludeNames: [], blockForeignDomains: false, allowHosts: [], gatedHosts: [], routes: [], trustedOutlets: [], communityPattern: REAL.communityPattern, researchMax: 150, siteUrl: "", sources: [{ name: "Hub News", home: base, feed: base + "/hub-news.xml", kind: "news" }] };
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg)); writeFileSync(TMP + "/hubs.json", JSON.stringify(STARTER));
  const D = f => TMP + "/data/" + f, AF = f => TMP + "/private/" + f, readJ = f => JSON.parse(readFileSync(D(f), "utf8")), state = o => writeFileSync(AF("admin.json"), JSON.stringify({ v: 1, updated: "", ...o }));
  const go = async (env = {}) => { try { return { code: 0, log: (await run("node", [REPO + "/scripts/fetch.mjs"], { env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: D("feed.json"), ADMIN_DIR: TMP + "/private", HUBS: TMP + "/hubs.json", ...env } })).stdout }; } catch (e) { return { code: e.code, log: e.stdout + e.stderr }; } };
  const by = n => readJ("feed.json").items.find(i => i.u === N(n)), hb = n => (by(n) || {}).hb || [];

  // run 1: the starter hubs only
  let r = await go(), F = readJ("feed.json");
  chk("run 1 ends well", r.code === 0 && F.items.length >= 5, r.log.slice(-300));
  chk("birthright citizenship in the headline: that hub", JSON.stringify(hb(1)) === '["birthright-citizenship"]', hb(1));
  chk("a language-access story: that hub", JSON.stringify(hb(2)) === '["language-access"]', hb(2));
  chk("the summary counts too (Census in the summary of an otherwise unrelated story)", JSON.stringify(hb(3)) === '["census-race-categories"]', hb(3));
  chk("ICE detention and deportation: the deportation hub; an unrelated story has no hubs", hb(4).includes("deportation-and-detention") && !("hb" in by(4)) === false && !hb(5).length && !("hb" in by(5)), [hb(4), by(5)]);
  chk("feed.json lists the hubs that have something in them (key, name, description), in the starter order", Array.isArray(F.hubs) && F.hubs.map(h => h.k).join() === "birthright-citizenship,census-race-categories,language-access,deportation-and-detention" && F.hubs.every(h => h.label && h.blurb), F.hubs);
  chk("feed.json never carries the keywords", !/Wong Kim Ark|SPD 15|Section 203|Stop AAPI Hate/.test(readFileSync(D("feed.json"), "utf8")));
  const stamp = readFileSync(D("feed.json"), "utf8"), mt = statSync(D("feed.json")).mtimeMs;
  r = await go(); chk("a run with nothing new changes nothing", /No changes/.test(r.log) && readFileSync(D("feed.json"), "utf8") === stamp && statSync(D("feed.json")).mtimeMs === mt, r.log.slice(-200));

  // run 2: the owner adds a hub of their own (matches an item stored from the earlier run) and edits a headline into a starter hub
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [{ k: "free-association", label: "Compact of Free Association", blurb: "COFA", words: ["Compact of Free Association", "COFA"] }] }, edits: { [require_id(3)]: undefined } });
  function require_id(n) { return readJ("feed.json").items.find(i => i.u === N(n)).id; }
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [{ k: "free-association", label: "Compact of Free Association", blurb: "COFA", words: ["Compact of Free Association", "COFA"] }] }, edits: { [require_id(5)]: { h: T[5] + " and refugees", t: "GOVERNMENT" } } });
  r = await go(); F = readJ("feed.json");
  chk("the owner's hub tags the story that was already stored (no new fetch needed)", hb(5).includes("free-association") && F.hubs.some(h => h.k === "free-association" && h.label === "Compact of Free Association" && h.blurb === "COFA"), [hb(5), F.hubs]);
  chk("an edited headline is matched as edited (refugees)", hb(5).includes("refugees-and-asylum"), hb(5));
  chk("the owner's hub comes after the starter ones in the list", F.hubs[F.hubs.length - 1].k === "free-association" || F.hubs.map(h => h.k).indexOf("free-association") > F.hubs.map(h => h.k).indexOf("language-access"), F.hubs.map(h => h.k));
  chk("still no keywords in feed.json", !/"words"|COFA"\]/.test(readFileSync(D("feed.json"), "utf8")) && !/"words"/.test(readFileSync(D("feed.json"), "utf8")));

  // run 3: the owner hides a starter hub and removes their own
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [], hubsOff: ["language-access"] } });
  r = await go(); F = readJ("feed.json");
  chk("a hidden starter hub disappears from the items and from the list", !hb(2).includes("language-access") && !F.hubs.some(h => h.k === "language-access") && hb(1).includes("birthright-citizenship"), [hb(2), F.hubs.map(h => h.k)]);
  chk("a removed hub of the owner's own disappears too", !hb(5).includes("free-association") && !F.hubs.some(h => h.k === "free-association"));

  // run 4: showing it again brings it back
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [], hubsOff: [] } });
  r = await go(); F = readJ("feed.json");
  chk("showing the hub again tags the stories again", hb(2).includes("language-access") && F.hubs.some(h => h.k === "language-access"));

  // run 5: no starter file: the run still works, only the owner's hubs apply; run 6: a hub nothing matches is not listed
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [{ k: "mine", label: "Mine", blurb: "", words: ["Hmong farmers"] }, { k: "nothing", label: "Nothing", blurb: "", words: ["zebra crossing"] }] } });
  r = await go({ HUBS: TMP + "/does-not-exist.json" }); F = readJ("feed.json");
  chk("without the starter file the collector works and tags with the owner's hubs only", r.code === 0 && JSON.stringify(hb(4)) === '["mine"]' && !hb(1).length && JSON.stringify(F.hubs) === '[{"k":"mine","label":"Mine"}]', [r.log.slice(-200), hb(4), F.hubs]);
  chk("a hub that nothing matches is not listed on the page", !F.hubs.some(h => h.k === "nothing"));
  state({ settings: { approval: { mode: "off", sources: [], kinds: [] }, hubs: [{ k: "nothing", label: "Nothing", blurb: "", words: ["zebra crossing"] }] } });
  r = await go({ HUBS: TMP + "/does-not-exist.json" }); F = readJ("feed.json");
  chk("with no matching hub the feed has no hubs field and no hb fields", !("hubs" in F) && F.items.every(i => !("hb" in i)));

  // run 7: a damaged hubs.json does not stop the run
  writeFileSync(TMP + "/hubs.json", "{ not json"); state({});
  r = await go(); chk("a hubs.json that cannot be read is treated as empty, not a crash", r.code === 0 && !("hubs" in readJ("feed.json")), r.log.slice(-200));
  srv.close(); console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
});
