// New names (sources) and the Organizations and Numbers tabs in the collector: what the owner sets in the dashboard is applied to stories already stored and to new ones,
// and data/orgs.json is published only while the owner has changes.  usage: node collector_names_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util";
import { rss } from "./fixtures.mjs";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP + "/data/articles", { recursive: true }); mkdirSync(TMP + "/private", { recursive: true });
const REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8")), ORGS = JSON.parse(readFileSync(REPO + "/orgs.json", "utf8"));
const N = n => `https://names.example/n${n}`, T = {
  1: "Fixture names: Korean American voters in Georgia turn out", 2: "Fixture names: Vietnamese American nail salon workers push for safer rules", 3: "Fixture names: Filipino nurses in Texas back new staffing bill",
  4: "Fixture names: Hmong farmers in Minnesota fear ICE detention", 5: "Fixture names: Statement on Asian American census data",
};
let NEWS = rss([1, 2, 3].map(n => [T[n], N(n), "", n + 1])), ORG = rss([[T[5], N(5), "", 1]]);
const srv = http.createServer((q, r) => { const u = new URL(q.url, "http://x"), send = b => { r.writeHead(200, { "content-type": "application/rss+xml" }); r.end(b); }; if (u.pathname === "/rn-news.xml") send(NEWS); else if (u.pathname === "/rn-org.xml") send(ORG); else { r.writeHead(404); r.end(); } }).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600)); ok.push(!!c); };
  process.env.TEST_BASE = base; process.env.NODE_OPTIONS = "--import " + new URL("./shim_fetch.mjs", import.meta.url).href;
  const cfg = { keepDays: 30, maxItems: 400, kinds: { ...REAL.kinds }, renames: {}, excludeHosts: [], excludeNames: [], blockForeignDomains: false, allowHosts: [], gatedHosts: [], routes: [], trustedOutlets: [], communityPattern: REAL.communityPattern, researchMax: 150, siteUrl: "", sources: [
    { name: "Rename News", home: base, feed: base + "/rn-news.xml", kind: "news" }, { name: "Rename Org", home: base, feed: base + "/rn-org.xml", kind: "statement" }] };
  writeFileSync(TMP + "/sources.json", JSON.stringify(cfg));
  const D = f => TMP + "/data/" + f, AF = f => TMP + "/private/" + f, readJ = f => JSON.parse(readFileSync(D(f), "utf8")), state = s => writeFileSync(AF("admin.json"), JSON.stringify({ v: 1, updated: "", settings: { approval: { mode: "off", sources: [], kinds: [] }, ...s } }));
  const go = async (env = {}) => { try { return { code: 0, log: await run("node", [REPO + "/scripts/fetch.mjs"], { env: { ...process.env, SOURCES: TMP + "/sources.json", OUT: D("feed.json"), ADMIN_DIR: TMP + "/private", ...env } }).then(x => x.stdout + x.stderr) }; } catch (e) { return { code: e.code, log: (e.stdout || "") + (e.stderr || "") }; } };
  const by = n => readJ("feed.json").items.find(i => i.u === N(n)), names = () => [...new Set(readJ("feed.json").items.map(i => i.s))].sort(), srcNames = () => readJ("feed.json").sources.map(s => s.name).sort();

  // run 1: no decisions; a stale orgs.json left from earlier is removed
  writeFileSync(D("orgs.json"), '{"orgs":[]}'); state({});
  let r = await go(), F = readJ("feed.json");
  chk("run 1 ends well and the stories have their sources' names", r.code === 0 && [1, 2, 3, 5].every(n => by(n)) && by(1).s === "Rename News" && by(5).s === "Rename Org", r.log.slice(-300));
  chk("no changes to the organizations: the published copy is removed (the page uses the starter list)", !existsSync(D("orgs.json")));
  chk("no new names: feed.json has no source-name table", !F.taxo?.sn, F.taxo);

  // run 2: a source is renamed, an organization added and one hidden, a figure added
  const hid = ORGS.orgs[0].id;
  state({ names: { sources: [{ f: "Rename News", t: "Renamed Daily" }], events: [], hubs: {} },
    orgs: { own: [{ id: "names-test-org", n: "Names Test Org", ab: "", u: "https://names-test.example.org", sc: "local", hq: "Tulsa, OK", st: ["OK"], c: [], is: [], ty: "direct services" }], edit: {}, off: [hid] } });
  r = await go(); F = readJ("feed.json");
  chk("a renamed source: the stories already stored show the new name", r.code === 0 && [1, 2, 3].every(n => by(n).s === "Renamed Daily") && by(5).s === "Rename Org", [names(), r.log.slice(-200)]);
  chk("the list of sources on the page shows the new name too", srcNames().join() === "Rename Org,Renamed Daily", srcNames());
  chk("the page is told the new names (original -> shown)", JSON.stringify(F.taxo?.sn) === '{"Rename News":"Renamed Daily"}', F.taxo);
  { const O = readJ("orgs.json");
    chk("orgs.json is published with the new organization, without the hidden one, in the shape the page reads", O.orgs.length === ORGS.orgs.length && O.orgs.some(o => o.id === "names-test-org" && o.n === "Names Test Org" && typeof o.ab === "string") && !O.orgs.some(o => o.id === hid) && O.orgs[0].id === ORGS.orgs[1].id, O.orgs.length); }
  const stamp = readFileSync(D("feed.json"), "utf8"), ostamp = readFileSync(D("orgs.json"), "utf8");
  r = await go(); chk("a run with nothing new changes nothing", /No changes/.test(r.log) && readFileSync(D("feed.json"), "utf8") === stamp && readFileSync(D("orgs.json"), "utf8") === ostamp, r.log.slice(-200));

  // run 3: a new story from the renamed source; it is renamed again, and a News category set under the original name still applies
  NEWS = rss([1, 2, 3, 4].map(n => [T[n], N(n), "", n + 1]));
  state({ names: { sources: [{ f: "Rename News", t: "Third Name" }, { f: "Renamed Daily", t: "Third Name" }], events: [], hubs: {} }, sourceKinds: { "Rename News": "community" } });
  r = await go(); F = readJ("feed.json");
  chk("renamed again: every earlier name leads to the newest, new stories get it too", [1, 2, 3, 4].every(n => by(n)?.s === "Third Name") && srcNames().join() === "Rename Org,Third Name", [names(), srcNames()]);
  chk("a category the owner set under the original name still applies to the renamed source", [1, 2, 3, 4].every(n => by(n).k === "community"), [1, 2, 3, 4].map(n => by(n).k));
  chk("the page is told every old name leads to the newest", JSON.stringify(F.taxo?.sn) === '{"Rename News":"Third Name","Renamed Daily":"Third Name"}', F.taxo);
  chk("the orgs.json from the earlier run is gone once its changes are (the state above has none)", !existsSync(D("orgs.json")));

  // run 4: blocking the source by its new name takes the stories off the site; blocking it by the original name does the same
  state({ names: { sources: [{ f: "Rename News", t: "Third Name" }, { f: "Renamed Daily", t: "Third Name" }], events: [], hubs: {} }, blocked: { "Third Name": "2026-01-01T00:00:00.000Z" } });
  r = await go(); chk("blocked by the new name: its stories are off the site, the other source stays", !names().includes("Third Name") && names().includes("Rename Org") && r.code === 0, names());
  state({ names: { sources: [{ f: "Rename News", t: "Third Name" }], events: [], hubs: {} }, blocked: { "Rename News": "2026-01-01T00:00:00.000Z" } });
  r = await go(); chk("blocked by the original name: the same", !names().includes("Third Name") && !names().includes("Rename News") && names().includes("Rename Org"), names());

  // run 5: no decisions again; the original name is back everywhere
  state({});
  r = await go(); F = readJ("feed.json");
  chk("without the new names the stories show the source's own name again", [1, 2, 3, 4].every(n => by(n)?.s === "Rename News") && srcNames().join() === "Rename News,Rename Org" && !F.taxo?.sn, [names(), srcNames(), F.taxo]);

  // run 6: a starter list that cannot be read leaves the earlier published copy as it was and the run still ends well
  state({ orgs: { own: [{ id: "names-test-org", n: "Names Test Org", ab: "", u: "https://names-test.example.org", sc: "local", hq: "", st: [], c: [], is: [], ty: "" }], edit: {}, off: [] } });
  r = await go({ ORGS: TMP + "/does-not-exist.json" }); chk("an unreadable starter list does not stop the run", r.code === 0 && /cannot be read/.test(r.log) && !existsSync(D("orgs.json")), r.log.slice(-300));
  r = await go(); chk("with the starter list back, the file is written", r.code === 0 && existsSync(D("orgs.json")) && readJ("orgs.json").orgs.some(o => o.id === "names-test-org"), r.log.slice(-200));
  srv.close(); console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
});
