// Open States state-bill collector in scripts/fetch.mjs against a mock server. usage: node openstates_test.mjs <repo> <tmp dir>
import http from "node:http"; import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs"; import { execFile } from "node:child_process"; import { promisify } from "node:util"; import { join } from "node:path";
const run = promisify(execFile), REPO = process.argv[2], TMP = process.argv[3]; rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
let bad = 0; const chk = (n, c, x = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(x).slice(0, 600))); if (!c) bad++; };
const bill = (id, ident, title, juris, date, abstract, extra = {}) => ({ id: "ocd-bill/" + id, identifier: ident, title, jurisdiction: { id: "ocd-jurisdiction/" + juris, name: juris, classification: "state" }, session: "2025", from_organization: { name: "Senate" }, latest_action_date: date, latest_action_description: "Referred to committee", updated_at: date + "T10:00:00+00:00", openstates_url: "https://openstates.org/" + juris.toLowerCase().replace(/\W+/g, "-") + "/bills/2025/" + ident.replace(/\s+/g, "") + "/", abstracts: abstract ? [{ abstract, note: "" }] : [], ...extra });
const today = new Date(), day = n => new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);
const B_CA = bill("ca1", "SB 113", "Asian American and Pacific Islander hate crime data collection", "California", day(2), "Requires the state to collect and publish disaggregated hate crime data for Asian American communities. Also does other things.");
const B_NY = bill("ny1", "A 4410", "Relating to school curriculum", "New York", day(3), "Adds Native Hawaiian and Pacific Islander history to the required social studies curriculum.");
const B_TX = bill("tx1", "HB 5", "Language access for Hmong residents in state courts", "Texas", day(4), "");
const B_DC = bill("dc1", "B26-0001", "Asian American Pacific Islander Heritage Commission Act", "District of Columbia", day(1), "Creates a commission.");
const B_NO = bill("oh1", "HB 77", "Transportation budget", "Ohio", day(2), "Appropriates money for roads."); // the search hit the full text only: not listed
const B_JS = bill("xx1", "SB 9", "Asian American <img src=x onerror=1> bill", "Oregon", day(2), "Hmong families.", { openstates_url: "javascript:alert(1)" }); // not an openstates.org address: not listed
let log = [], mode = "ok";
const srv = http.createServer((q, r) => {
  const u = new URL(q.url, "http://x");
  if (u.pathname !== "/bills") { r.writeHead(404); r.end(); return; }
  log.push({ key: q.headers["x-api-key"], url: q.url, q: u.searchParams.get("q"), page: u.searchParams.get("page"), pp: u.searchParams.get("per_page"), since: u.searchParams.get("updated_since"), inc: u.searchParams.getAll("include"), hasKeyParam: u.searchParams.has("apikey") || u.searchParams.has("api_key") });
  if (q.headers["x-api-key"] !== "OSKEY") { r.writeHead(403); r.end("{}"); return; }
  if (mode === "403") { r.writeHead(403); r.end("{}"); return; }
  if (mode === "429" && log.length >= 2) { r.writeHead(429); r.end("{}"); return; }
  if (mode === "422" && Number(u.searchParams.get("per_page")) > 10) { r.writeHead(422); r.end("{}"); return; }
  const term = u.searchParams.get("q"), page = Number(u.searchParams.get("page") ?? 1);
  const res = term === "Asian American" ? (page === 1 ? [B_CA, B_NY] : [B_TX]) : term === "Pacific Islander" ? [B_CA, B_NO, B_JS, B_DC] : [];
  r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ results: res, pagination: { per_page: 2, page, max_page: term === "Asian American" ? 2 : 1, total_items: res.length } }));
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port, REAL = JSON.parse(readFileSync(REPO + "/sources.json", "utf8"));
  const mk = (name, os) => {
    const d = join(TMP, name); mkdirSync(join(d, "data"), { recursive: true });
    const cfg = { ...REAL, sources: [], federalRegister: { ...REAL.federalRegister, enabled: false }, executiveActions: { ...REAL.executiveActions, enabled: false }, congress: { ...REAL.congress, enabled: false }, regulations: { ...REAL.regulations, enabled: false }, govinfo: { ...REAL.govinfo, enabled: false }, openStates: { enabled: true, terms: ["Asian American", "Pacific Islander", "Hmong"], perPage: 2, maxPages: 2, maxRequests: 12, days: 14, everyMinutes: 180, delayMs: 0, ...os } };
    delete cfg.events; writeFileSync(join(d, "sources.json"), JSON.stringify(cfg)); return d;
  };
  const go = async (d, env = {}) => { try { const { stdout } = await run("node", [join(REPO, "scripts/fetch.mjs")], { cwd: REPO, env: { ...process.env, SOURCES: join(d, "sources.json"), OUT: join(d, "data/feed.json"), OPENSTATES_API: base, OPENSTATES_API_KEY: "OSKEY", OPENSTATES_DELAY_MS: "0", API_DATA_GOV_KEY: "", CONGRESS_API_KEY: "", ADMIN_DIR: "", ...env }, timeout: 120000 }); return { code: 0, out: stdout }; } catch (e) { return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") }; } };
  const feed = d => JSON.parse(readFileSync(join(d, "data/feed.json"), "utf8")), st = f => (f.sources ?? []).find(s => s.name === "Open States");
  try {
    // ---- a first run
    let d = mk("a", {}); log = []; let r = await go(d); if (!existsSync(join(d, "data/feed.json"))) { console.log("NO FEED. code", r.code, r.out.slice(-1500), "log", JSON.stringify(log.slice(0,3))); process.exit(2); } let f = feed(d), it = f.items.filter(x => x.k === "statebill");
    chk("the run succeeds", r.code === 0, r.out.slice(-500));
    chk("it lists the state bills that name the communities, once each: SB 113, A 4410, HB 5 and the D.C. bill", it.length === 4 && ["SB 113", "A 4410", "HB 5", "B26-0001"].every(t => it.some(x => x.ty === t)), it.map(x => x.ty));
    chk("a bill found by the full text only (not named in its title or summary) is not listed", !it.some(x => x.ty === "HB 77"));
    chk("a bill whose address is not on openstates.org is not listed", !it.some(x => x.ty === "SB 9") && !JSON.stringify(f).includes("javascript:"));
    const ca = it.find(x => x.ty === "SB 113");
    chk("a state bill carries its kind, source, title, summary, link, state name, state code, latest action and relevance", ca && ca.k === "statebill" && ca.s === "Open States" && ca.h.startsWith("Asian American and Pacific Islander hate crime") && ca.m.includes("disaggregated") && ca.u === B_CA.openstates_url && ca.ag === "California" && JSON.stringify(ca.st) === '["CA"]' && ca.la === "Referred to committee" && ca.rl === "n" && ca.d.startsWith(day(2)), ca);
    chk("a bill from the District of Columbia is tagged DC", JSON.stringify(it.find(x => x.ty === "B26-0001")?.st) === '["DC"]', it.find(x => x.ty === "B26-0001"));
    chk("the bill's topic and communities are tagged like any policy item", ca && typeof ca.t === "string" && ca.t.length > 0 && Array.isArray(ca.cm), ca);
    chk("the source status says OK (the number read is in the run's log, not in the public file)", st(f)?.ok === true && !("count" in st(f)) && st(f).kind === "statebill" && /OK {3}Open States: 4 items/.test(r.out), st(f));
    chk("every request carries the key in the x-api-key header, never in the address", log.length > 0 && log.every(l => l.key === "OSKEY" && !l.hasKeyParam && !l.url.includes("OSKEY")), log);
    chk("each request asks for summaries (include=abstracts) and only recent changes (updated_since as a date 14 days back)", log.every(l => l.inc.join() === "abstracts" && l.since === day(14)), log[0]);
    chk("a second page is asked for only when the first said there is one: 3 requests for 3 terms (2 pages for the first)", log.length === 4 && log.filter(l => l.q === "Asian American").length === 2 && log.filter(l => l.q === "Hmong").length === 1, log.map(l => l.q + ":" + l.page));
    chk("the time of the check is kept", existsSync(join(d, "data/openstates-state.json")) && !!JSON.parse(readFileSync(join(d, "data/openstates-state.json"), "utf8")).at);
    // ---- the next run is too soon
    log = []; r = await go(d); f = feed(d);
    const before2 = JSON.stringify(st(feed(d)));
    chk("a second run straight away makes no requests, says so in its log, keeps the bills it had and leaves the source's public line exactly as it was", log.length === 0 && f.items.filter(x => x.k === "statebill").length === 4 && /Open States: checked \d+ minutes? ago; the next check is in about/.test(r.out) && /WAIT Open States/.test(r.out) && st(f).ok === true && !st(f).note, { n: log.length, note: st(f)?.note, items: f.items.filter(x => x.k === "statebill").length, log: r.out.slice(-300) });
    // ---- three hours later
    const sf = join(d, "data/openstates-state.json"); writeFileSync(sf, JSON.stringify({ at: new Date(Date.now() - 4 * 36e5).toISOString() })); log = []; r = await go(d); f = feed(d);
    chk("after the interval it asks again, without duplicating the bills", log.length === 4 && f.items.filter(x => x.k === "statebill").length === 4, { n: log.length, items: f.items.filter(x => x.k === "statebill").length });
    // ---- no key
    d = mk("b", {}); log = []; r = await go(d, { OPENSTATES_API_KEY: "" }); f = feed(d);
    chk("without a key nothing is asked, and the status says so in plain words", log.length === 0 && /skipped: no API key set \(OPENSTATES_API_KEY\)/.test(st(f)?.note ?? "") && f.items.filter(x => x.k === "statebill").length === 0, { note: st(f)?.note, r: r.out.slice(-300) });
    // ---- budget
    d = mk("c", { maxRequests: 2 }); log = []; r = await go(d); f = feed(d);
    chk("a run never makes more requests than its budget, and says it stopped early", log.length === 2 && /request budget/.test(st(f)?.note ?? ""), { n: log.length, note: st(f)?.note });
    // ---- rate limited
    d = mk("d", {}); log = []; mode = "429"; r = await go(d); f = feed(d); mode = "ok";
    chk("when the service answers 429 the run stops asking, keeps what it had found, and notes it", log.length === 2 && st(f)?.ok === true && /rate limited/.test(st(f)?.note ?? "") && f.items.filter(x => x.k === "statebill").length >= 1, { n: log.length, note: st(f)?.note });
    chk("...and it still records the time, so the next check waits", existsSync(join(d, "data/openstates-state.json")));
    // ---- refused key
    d = mk("e", {}); mode = "403"; log = []; r = await go(d); mode = "ok";
    chk("a refused key is reported as a failed source, and the run does not invent bills", r.code !== 0 && /key was refused/.test(r.out) && !existsSync(join(d, "data/openstates-state.json")), r.out.slice(-400));
    // ---- per_page too big
    d = mk("f", { perPage: 20 }); mode = "422"; log = []; r = await go(d); f = feed(d); mode = "ok";
    chk("if the service refuses the page size it retries with 10 and carries on", f.items.filter(x => x.k === "statebill").length === 4 && log.some(l => l.pp === "20") && log.some(l => l.pp === "10"), log.map(l => l.pp));
    // ---- a bill that was listed and later drops out of the search stays until it ages out
    d = mk("g", {}); await go(d); writeFileSync(join(d, "data/openstates-state.json"), JSON.stringify({ at: new Date(Date.now() - 5 * 36e5).toISOString() }));
    const o = JSON.parse(readFileSync(join(d, "sources.json"), "utf8")); o.openStates.terms = ["Nothing matches this"]; writeFileSync(join(d, "sources.json"), JSON.stringify(o)); await go(d); f = feed(d);
    chk("a bill found earlier stays on the list when a later check no longer returns it", f.items.filter(x => x.k === "statebill").length === 4, f.items.filter(x => x.k === "statebill").length);
  } finally { srv.close(); }
  console.log(bad ? "SOME FAILED" : "ALL PASS"); process.exit(bad ? 1 : 0);
});
