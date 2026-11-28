// Tests of the built admin Worker (tools/admin/worker.js): login, sessions, protections and every kind of saved change. usage: node admin_worker_test.mjs <repo> <tmp dir>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startAdmin, makeRepoDir, readJson, listFiles } from "./admin_harness.mjs";

const REPO = process.argv[2], TMP = process.argv[3], DIR = join(TMP, "repo"), DATA = DIR + "-data"; // DIR: the public site repository; DATA: the private data repository
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : String(x).slice(0, 400)); ok.push(!!c); };
const day = n => new Date(Date.now() - n * 864e5).toISOString();
const items = Array.from({ length: 24 }, (_, i) => ({ id: "it" + String(i).padStart(10, "0"), d: day(i / 3), s: i % 3 ? "AsAmNews" : "NextShark", h: "Sample headline number " + i, u: "https://example.org/story-" + i, k: ["community", "news", "statement"][i % 3], t: ["HEALTH", "ELECTIONS", "CULTURE"][i % 3], ...(i % 4 === 0 ? { cm: ["KR"] } : {}), ...(i % 5 === 0 ? { st: ["CA"] } : {}) }));
const pending = [{ id: "pn0000000001", d: day(0.2), s: "Admin News", h: "Waiting story", u: "https://example.org/waiting", k: "news", t: "CULTURE" }];
const id = i => items[i].id;
const seed = (extra = {}) => makeRepoDir(DIR, { repo: REPO, items, pending, ...extra });

let A;
const jar = {};
const call = async (path, { method = "GET", body, cookie, csrf, origin = "same", headers = {}, raw } = {}) => {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (csrf) h["x-csrf"] = csrf;
  if (origin === "same") h.origin = A.url; else if (origin) h.origin = origin;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(A.url + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: "manual" });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, text, j, setCookie: r.headers.getSetCookie?.() ?? [] };
};
const login = async (password = A.env.ADMIN_PASSWORD, extra = {}) => {
  const r = await call("/api/login", { method: "POST", body: { password }, ...extra });
  const c = r.setCookie.find(x => x.startsWith("__Host-yp_admin=")), cookie = c ? c.split(";")[0] : null;
  return { ...r, cookie };
};
const csrfOf = async cookie => (await call("/", { cookie })).text.match(/<meta name="csrf" content="([^"]+)"/)?.[1];
const session = async () => { const l = await login(); const csrf = await csrfOf(l.cookie); return { cookie: l.cookie, csrf }; };
const op = (s, o, args, extra = {}) => call("/api/op", { method: "POST", body: { op: o, args }, cookie: s.cookie, csrf: s.csrf, ...extra });
const state = () => readJson(DATA, "admin.json");

seed();
A = await startAdmin({ repoRoot: REPO, dir: DIR });

// ---------------------------------------------------------------- the login page and what a stranger can reach
{
  const r = await call("/");
  chk("a stranger gets the login page", r.status === 200 && /<form id="f"/.test(r.text) && !/Waiting for approval/.test(r.text) && !/sample headline/i.test(r.text));
  const csp = r.headers.get("content-security-policy") ?? "", nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
  chk("the page is locked down: nonce-only scripts and styles, no framing, no caching, not indexed", nonce && r.text.includes(`nonce="${nonce}"`) && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp) && r.headers.get("x-frame-options") === "DENY" && r.headers.get("cache-control") === "no-store" && /noindex/.test(r.headers.get("x-robots-tag")) && r.headers.get("x-content-type-options") === "nosniff", csp);
  const r2 = await call("/");
  chk("the nonce is different on every page load", r2.headers.get("content-security-policy") !== csp);
  chk("robots.txt asks search engines to stay away", /Disallow: \//.test((await call("/robots.txt")).text));
  const u = await Promise.all(["/api/raw/feed", "/api/raw/state", "/api/raw/commits", "/api/article/it0000000001", "/api/publish"].map(p => call(p)));
  chk("every data route answers 401 without a session", u.every(x => x.status === 401), u.map(x => x.status));
  const p = await call("/api/op", { method: "POST", body: { op: "approve", args: { ids: [id(0)] } }, csrf: "x" });
  chk("a change without a session is refused and nothing is written", p.status === 401 && !state());
  chk("unknown paths are 404", (await call("/admin")).status === 404 && (await call("/data/admin.json")).status === 404 && (await call("/.env")).status === 404);
}

// ---------------------------------------------------------------- the redesigned login page
{
  const r = await call("/"), csp = r.headers.get("content-security-policy") ?? "";
  chk("the login page shows the Yappie Pro logo inline and links to the public site", /<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+\/=]{500,}" alt="The Yappie Pro"/.test(r.text) && /<a class="logo" href="https:\/\/pro\.example"/.test(r.text) && !/\{\{[A-Z]+\}\}/.test(r.text));
  chk("the login page has a titled card, a labelled password field with a show button, and a submit button", /<h1>Log in<\/h1>/.test(r.text) && /<label for="pw">Password<\/label>/.test(r.text) && /id="show"/.test(r.text) && /id="go" type="submit"/.test(r.text) && /autocomplete="current-password"/.test(r.text));
  chk("it uses the site's fonts and colors (Adobe Fonts kit, Corsario headings, Tablet Gothic text, brand blue)", /use\.typekit\.net\/uug3ias\.css/.test(r.text) && /corsario-variable/.test(r.text) && /tablet-gothic/.test(r.text) && /#0a67f1/i.test(r.text));
  chk("the login page may load fonts from Adobe Fonts, and nothing else from outside", /style-src 'nonce-[^']+' https:\/\/use\.typekit\.net https:\/\/p\.typekit\.net;/.test(csp) && /font-src https:\/\/use\.typekit\.net;/.test(csp) && !/script-src[^;]*typekit/.test(csp) && /connect-src 'self'/.test(csp) && /default-src 'none'/.test(csp), csp);
  const sess = await session(), d = await call("/", { cookie: sess.cookie }), dcsp = d.headers.get("content-security-policy") ?? "";
  chk("the dashboard allows no outside fonts or styles", !/typekit/.test(dcsp) && /font-src 'none'/.test(dcsp) && /style-src 'nonce-[^']+';/.test(dcsp), dcsp);
  chk("the dashboard is told which private repository it saves to", /"dataRepo":"theyappie\/yappie-pro-admin"/.test(d.text));
  const keepFetch = globalThis.fetch; // each startAdmin points the fake GitHub at its own copy; put the main one back afterwards
  const odd = await startAdmin({ repoRoot: REPO, dir: DIR, env: { SITE_ORIGIN: 'javascript:alert(1)' } }), odd2 = await startAdmin({ repoRoot: REPO, dir: DIR, env: { SITE_ORIGIN: 'https://x.example"><script>alert(1)</script>' } });
  const p1 = await fetch(odd.url + "/").then(x => x.text()), p2 = await fetch(odd2.url + "/").then(x => x.text());
  chk("a strange SITE_ORIGIN cannot put anything but a plain web address in the logo link", /<a class="logo" href="#"/.test(p1) && /<a class="logo" href="#"/.test(p2) && !/<script>alert/.test(p2));
  await odd.close(); await odd2.close(); globalThis.fetch = keepFetch;
}

// ---------------------------------------------------------------- logging in
let S;
{
  const bad = await login("wrong password");
  chk("a wrong password is refused with no cookie", bad.status === 401 && !bad.cookie && /not right/.test(bad.j?.error));
  chk("the answer for a wrong password does not say anything about the right one", !/correct horse/.test(bad.text));
  chk("a login from another web page is refused", (await login(undefined, { origin: "https://evil.example" })).status === 403 && (await login(undefined, { origin: null })).status === 403);
  chk("login only accepts POST, and rejects a missing or non-string password", (await call("/api/login")).status === 405 && (await call("/api/login", { method: "POST", raw: "{}" })).status === 401 && (await call("/api/login", { method: "POST", body: { password: { a: 1 } } })).status === 401 && (await call("/api/login", { method: "POST", raw: "not json" })).status === 400);
  const g = await login();
  const flags = g.setCookie.find(x => x.startsWith("__Host-yp_admin=")) ?? "";
  chk("the right password sets a __Host- cookie that is HttpOnly, Secure and SameSite=Strict with no Domain", g.status === 200 && /HttpOnly/.test(flags) && /Secure/.test(flags) && /SameSite=Strict/.test(flags) && /Path=\//.test(flags) && !/Domain=/i.test(flags) && /Max-Age=43200/.test(flags), flags);
  const app = await call("/", { cookie: g.cookie });
  const csp = app.headers.get("content-security-policy") ?? "", nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
  chk("with the cookie the dashboard is served, with a CSRF token and the same strict policy", app.status === 200 && /id="tabs"/.test(app.text) && /<meta name="csrf" content="[\w-]{20,}"/.test(app.text) && nonce && [...app.text.matchAll(/<(?:script|style)[^>]*nonce="([A-Za-z0-9_-]+)"/g)].every(m => m[1] === nonce) && !/\{\{[A-Z]+\}\}/.test(app.text) && !/unsafe-inline/.test(csp), csp);
  chk("the dashboard page carries no data", !/Sample headline/.test(app.text) && !/ghp_/.test(app.text) && !/correct horse/.test(app.text));
  S = { cookie: g.cookie, csrf: await csrfOf(g.cookie) };
  const other = await login();
  chk("the CSRF token belongs to the session", (await csrfOf(other.cookie)) !== S.csrf);
}

// ---------------------------------------------------------------- reading
{
  const feed = await call("/api/raw/feed", { cookie: S.cookie });
  chk("the feed is passed through unchanged", feed.status === 200 && feed.text === readFileSync(join(DIR, "data/feed.json"), "utf8") && /json/.test(feed.headers.get("content-type")));
  chk("pending is read from the private repository", (await call("/api/raw/pending", { cookie: S.cookie })).j?.items?.[0]?.id === "pn0000000001");
  mkdirSync(join(DIR, "data"), { recursive: true }); writeFileSync(join(DIR, "data/pending.json"), JSON.stringify({ items: [{ id: "stale000000001", h: "A stale copy in the public repository" }] }));
  chk("a stale pending.json in the public repository is never read", (await call("/api/raw/pending", { cookie: S.cookie })).j?.items?.[0]?.id === "pn0000000001");
  rmSync(join(DIR, "data/pending.json"));
  chk("a missing state file reads as an empty state", (await call("/api/raw/state", { cookie: S.cookie })).j?.v === 1);
  chk("taxonomy and sources can be read", (await call("/api/raw/taxonomy", { cookie: S.cookie })).j?.topics?.length > 5 && (await call("/api/raw/sources", { cookie: S.cookie })).j?.sources?.length > 10);
  chk("only the listed files can be read", (await call("/api/raw/package", { cookie: S.cookie })).status === 404 && (await call("/api/raw/..%2Fpackage", { cookie: S.cookie })).status === 404);
  chk("an article that does not exist reads as empty; odd ids are not looked up", (await call("/api/article/it0000000001", { cookie: S.cookie })).j?.constructor === Object && (await call("/api/article/..%2F..%2Fsources", { cookie: S.cookie })).status === 404);
}

// ---------------------------------------------------------------- the request protections
{
  const a = { ids: [id(0)] };
  const nocsrf = await call("/api/op", { method: "POST", body: { op: "approve", args: a }, cookie: S.cookie });
  const badcsrf = await op({ cookie: S.cookie, csrf: "AAAA" }, "approve", a);
  const evil = await op(S, "approve", a, { origin: "https://evil.example" });
  const noOrigin = await op(S, "approve", a, { origin: null });
  chk("a change needs the CSRF token and a same-site Origin", nocsrf.status === 403 && badcsrf.status === 403 && evil.status === 403 && noOrigin.status === 403 && !state(), [nocsrf.status, badcsrf.status, evil.status, noOrigin.status]);
  const tok = (await login()).cookie, wrongPair = await op({ cookie: S.cookie, csrf: await csrfOf(tok) }, "approve", a);
  chk("a CSRF token from another session does not work", wrongPair.status === 403);
  chk("logout needs the token too", (await call("/api/logout", { method: "POST", cookie: S.cookie, origin: "same" })).status === 403);
  chk("a body over 1.5 MB is refused", (await op(S, "edit", { id: id(0), article: { body: "x".repeat(1_600_000) } })).status === 413);
  chk("methods other than POST do not change anything", (await call("/api/op", { method: "PUT", body: { op: "approve", args: a }, cookie: S.cookie, csrf: S.csrf })).status === 404 && !state());
}

// ---------------------------------------------------------------- changes
{
  const r = await op(S, "approve", { ids: [id(0), "pn0000000001"] });
  const st = state();
  chk("approve is saved to admin.json in the private repository and the new state is returned", r.status === 200 && r.j.ok && r.j.summary === "Approved 2 items" && st?.approved[id(0)] && st.approved.pn0000000001 && r.j.state.approved.pn0000000001, r.text);
  chk("the commit says what was done", A.gh.commits[0]?.commit.message.startsWith("admin: Approved 2 items") && A.gh.commits[0].path === "admin.json" && A.gh.commits[0].repo === "data", A.gh.commits[0]?.commit.message);
  await A.settle();
  chk("saving starts one site update", A.gh.dispatches === 1, A.gh.dispatches);
  A.gh.dispatches = 0;
  await Promise.all([op(S, "pin", { ids: [id(1)] }), op(S, "pin", { ids: [id(2)] }), op(S, "pin", { ids: [id(12)] })]);
  await A.settle();
  chk("several quick changes start one update (not one each)", A.gh.dispatches >= 1 && A.gh.dispatches <= 2, A.gh.dispatches);
  chk("three changes at the same moment all survive", state().pinned[id(1)] && state().pinned[id(2)] && state().pinned[id(12)]);

  const e = await op(S, "edit", { id: id(3), patch: { h: "  New   headline\nwith break ", t: "HEALTH", cm: ["VN", "VN"], st: ["TX"], k: "news", m: "A summary" }, orig: { h: items[3].h, t: items[3].t, k: items[3].k } });
  const s2 = state();
  chk("edit saves cleaned values and remembers the originals", e.status === 200 && s2.edits[id(3)].h === "New headline with break" && s2.edits[id(3)].cm.length === 1 && s2.edits[id(3)].st[0] === "TX" && s2.orig[id(3)].h === items[3].h && s2.orig[id(3)].m === null, JSON.stringify(s2.edits[id(3)]) + e.text);
  const rv = await op(S, "revert", { id: id(3) });
  chk("revert puts the collected values back as edits", rv.status === 200 && state().edits[id(3)].h === items[3].h && !state().orig[id(3)]);

  for (const [name, args, re] of [["an unknown topic", { id: id(4), patch: { t: "NOPE" } }, /Unknown topic/], ["an unknown community", { id: id(4), patch: { cm: ["XX"] } }, /Unknown community/], ["an unknown state", { id: id(4), patch: { st: ["ZZ"] } }, /Unknown state/], ["an unknown section", { id: id(4), patch: { k: "blog" } }, /Unknown section/], ["a javascript: link", { id: id(4), patch: { u: "javascript:alert(1)" } }, /link must be/], ["an empty headline", { id: id(4), patch: { h: "   " } }, /cannot be empty/], ["a date far ahead", { id: id(4), patch: { d: "2099-01-01" } }, /date is not valid/], ["no changes", { id: id(4), patch: {} }, /Nothing to change/], ["a bad item id", { id: "../x", patch: { h: "a" } }, /Unknown item/]]) {
    const x = await op(S, "edit", args);
    chk(`edit refuses ${name} with a clear message`, x.status === 400 && re.test(x.j?.error), x.text);
  }
  chk("approve with nothing selected is refused", (await op(S, "approve", { ids: [] })).status === 400);
  chk("an unknown action is refused", (await op(S, "format-disk", {})).status === 404);
  chk("a request without an action is refused", (await call("/api/op", { method: "POST", body: { nothing: 1 }, cookie: S.cookie, csrf: S.csrf })).status === 400);

  const d = await op(S, "delete", { ids: [id(5)], items: { [id(5)]: items[5] } });
  chk("delete moves the item to the trash with a copy", d.status === 200 && state().deleted[id(5)].item.h === items[5].h);
  const rs = await op(S, "restore", { ids: [id(5)] });
  chk("restore brings it back, approved", rs.status === 200 && !state().deleted[id(5)] && state().approved[id(5)] && state().added.some(x => x.id === id(5)));

  const ad = await op(S, "add", { item: { h: "My own story", s: "The Yappie", u: "https://theyappie.com/my-own", k: "community", t: "HEALTH", cm: ["PH"] }, article: { by: "Staff Writer", body: '<p onclick="x()">Hello <script>alert(1)</script><a href="javascript:alert(2)">bad</a><img src="x" onerror="alert(3)"> <strong>world</strong></p>' } });
  const newId = ad.j?.id, st3 = state();
  chk("add creates an item with a new m… id, kept permanently and approved", ad.status === 200 && /^m[0-9a-f]{12}$/.test(newId) && st3.added.some(x => x.id === newId && x.v === 1) && st3.pinned[newId] && st3.approved[newId], ad.text);
  const body = st3.article[newId]?.body ?? "";
  chk("the story text is cleaned: no scripts, handlers or javascript: links", /Hello/.test(body) && /<strong>world<\/strong>/.test(body) && !/script|onclick|onerror|javascript:/i.test(body), body);
  chk("an added item needs a headline, a link and a source", (await op(S, "add", { item: { h: "x", s: "y" } })).status === 400 && (await op(S, "add", { item: { s: "y", u: "https://a.example/" } })).status === 400);

  const se = await op(S, "settings", { approval: { mode: "custom", sources: ["NextShark", "NextShark"], kinds: ["statement", "bogus"] } });
  chk("settings are saved (duplicates and unknown sections dropped)", se.status === 200 && state().settings.approval.mode === "custom" && state().settings.approval.sources.length === 1 && state().settings.approval.kinds.join() === "statement", se.text);
  chk("settings refuse an unknown mode", (await op(S, "settings", { approval: { mode: "sometimes" } })).status === 400);

  // the owner's own topics, communities, categories; source categories; policy relevancy and research type
  const tp = await op(S, "topics", { list: [{ label: "Housing vouchers", words: "section 8, housing voucher" }] });
  chk("topics: a new topic is saved to the private repository with the keywords, and the commit says so", tp.status === 200 && state().settings.topics[0].k === "HOUSING VOUCHERS" && state().settings.topics[0].words.length === 2 && A.gh.commits[0].commit.message.startsWith("admin: Added the topic “Housing vouchers”") && A.gh.commits[0].repo === "data", tp.text + A.gh.commits[0]?.commit.message);
  chk("topics: a built-in name, a duplicate and an empty name are refused with a clear message", (await op(S, "topics", { list: [{ label: "Health" }] })).j?.error?.includes("already a topic") && (await op(S, "topics", { list: [{ label: "A" }, { label: "a" }] })).status === 400 && (await op(S, "topics", { list: [{ label: " " }] })).status === 400 && (await op(S, "topics", {})).status === 400);
  const cm = await op(S, "communities", { list: [{ label: "Bhutanese", words: ["Bhutanese"] }] }), nk = await op(S, "newsKinds", { list: [{ label: "Faith media" }] });
  chk("communities and categories are saved too", cm.status === 200 && state().settings.communities[0].k === "BHUTANESE" && nk.status === 200 && state().settings.newsKinds[0].k === "faith-media");
  const sk = await op(S, "sourceKinds", { sources: ["NextShark", "AsAmNews"], kind: "faith-media" });
  chk("source categories are saved", sk.status === 200 && state().settings.sourceKinds.NextShark === "faith-media" && sk.j.summary === "Moved 2 sources to Faith media", sk.text);
  chk("a category that does not exist, or a section that is not a News category, is refused", (await op(S, "sourceKinds", { sources: ["NextShark"], kind: "ghost" })).status === 400 && (await op(S, "sourceKinds", { sources: ["NextShark"], kind: "statement" })).status === 400 && (await op(S, "sourceKinds", { sources: [], kind: "news" })).status === 400);
  const ed = await op(S, "edit", { id: id(1), patch: { t: "HOUSING VOUCHERS", cm: ["BHUTANESE"], k: "faith-media", rt: "report" }, orig: { t: "CULTURE" } });
  chk("edits may use the owner's own topic, community and category, and a research type", ed.status === 200 && state().edits[id(1)].t === "HOUSING VOUCHERS" && state().edits[id(1)].k === "faith-media" && state().edits[id(1)].rt === "report" && state().orig[id(1)].t === "CULTURE", ed.text);
  chk("edits with an unknown research type or policy relevancy are refused", (await op(S, "edit", { id: id(1), patch: { rt: "essay" } })).status === 400 && (await op(S, "edit", { id: id(1), patch: { rl: "x" } })).status === 400);
  const rm = await op(S, "newsKinds", { list: [] });
  chk("removing a category also takes it out of sources and edits", rm.status === 200 && !("NextShark" in state().settings.sourceKinds) && state().edits[id(1)].k === undefined && state().edits[id(1)].t === "HOUSING VOUCHERS", rm.text);
  chk("the dashboard receives the new state, and the public repository got no keywords", rm.j.state.settings.topics[0].words[0] === "section 8" && A.gh.writes.filter(w => w.repo !== "data").every(w => !/section 8/.test(JSON.stringify(w))));
  await op(S, "topics", { list: [] }); await op(S, "communities", { list: [] });

  // the built-in topics, communities and categories: rename, remove, restore; extra topics
  const bt = await op(S, "topics", { list: [], builtin: { HOUSING: { label: "Housing & rent" }, COURTS: { off: true } } });
  chk("built-in topics: renamed and removed from the dashboard; the commit says so", bt.status === 200 && state().settings.builtin.topics.HOUSING.label === "Housing & rent" && state().settings.builtin.topics.COURTS.off === true && /^admin: Removed the topic “Courts & crime”, renamed the topic “Housing” to “Housing & rent”/i.test(A.gh.commits[0].commit.message), A.gh.commits[0].commit.message);
  chk("built-in topics: the catch-all cannot be removed, an unknown one cannot be changed, a clashing name is refused", (await op(S, "topics", { list: [], builtin: { CULTURE: { off: true } } })).j?.error?.includes("cannot be removed") && (await op(S, "topics", { list: [], builtin: { NOPE: { off: true } } })).status === 400 && (await op(S, "topics", { list: [], builtin: { HEALTH: { label: "Education" } } })).status === 400);
  chk("built-in topics: a removed topic can no longer be put on a story, but extra topics can be", (await op(S, "edit", { id: id(2), patch: { t: "COURTS" } })).status === 400 && (await op(S, "edit", { id: id(2), patch: { tx: ["COURTS"] } })).status === 400);
  const tx = await op(S, "edit", { id: id(2), patch: { t: "IMMIGRATION", tx: ["EDUCATION", "HEALTH"] }, orig: { t: "CULTURE" } });
  chk("extra topics are saved with the story edit, and the collected values are remembered", tx.status === 200 && JSON.stringify(state().edits[id(2)].tx) === '["EDUCATION","HEALTH"]' && state().orig[id(2)].tx === null, tx.text);
  chk("extra topics: more than four are refused", (await op(S, "edit", { id: id(2), patch: { tx: ["HEALTH", "HOUSING", "ECONOMY", "EDUCATION", "PACIFIC"] } })).j?.error?.includes("at most 4"));
  const bc = await op(S, "communities", { list: [], builtin: { CN: { off: true }, KR: { label: "Korean American" } } });
  chk("built-in communities: removed and renamed", bc.status === 200 && state().settings.builtin.communities.CN.off === true && state().settings.builtin.communities.KR.label === "Korean American");
  chk("built-in categories: removing one needs a place for its sources; then it works, and its name is free to look up", (await op(S, "newsKinds", { list: [], builtin: { community: { off: true } } })).j?.error?.includes("Choose where the sources of “AAPI Media” go") && (await op(S, "newsKinds", { list: [], builtin: { community: { off: true, to: "news" }, news: { label: "General news" } } })).status === 200 && state().settings.builtin.kinds.community.to === "news");
  chk("built-in categories: a removed one cannot receive sources, a renamed one shows its new name", (await op(S, "sourceKinds", { sources: ["NextShark"], kind: "community" })).status === 400 && (await op(S, "sourceKinds", { sources: ["NextShark"], kind: "news" })).j?.summary === "Moved 1 source to General news");
  await op(S, "sourceKinds", { sources: ["NextShark"], kind: null });
  const rsb = await op(S, "topics", { list: [], builtin: {} }); await op(S, "communities", { list: [], builtin: {} }); await op(S, "newsKinds", { list: [], builtin: {} });
  chk("built-in changes: all can be undone, and the summary says what was restored", rsb.status === 200 && /Restored the topic “Courts & crime”/.test(rsb.j.summary) && Object.keys(state().settings.builtin.topics).length === 0 && Object.keys(state().settings.builtin.kinds).length === 0 && Object.keys(state().settings.builtin.communities).length === 0);
  chk("built-in changes: nothing about them is published by the dashboard (the public repository is only written by the collector)", A.gh.writes.filter(w => w.repo !== "data").every(w => !/builtin/.test(JSON.stringify(w))));
  await op(S, "revert", { id: id(2) });
  await op(S, "topics", { list: [] }); await op(S, "communities", { list: [] });

  const hist = await call("/api/raw/commits", { cookie: S.cookie });
  chk("the change history lists the saved changes", Array.isArray(hist.j) && hist.j.length >= 8 && hist.j.every(c => c.commit.message.startsWith("admin:")), hist.text.slice(0, 200));
  const runs = await call("/api/raw/runs", { cookie: S.cookie });
  chk("the update status can be read", runs.j?.workflow_runs?.[0]?.status === "completed");
  const pb = await call("/api/publish", { method: "POST", cookie: S.cookie, csrf: S.csrf }); chk("Update now starts the workflow right away", pb.status === 200 && A.gh.dispatches >= 1);
}

// ---------------------------------------------------------------- blocked sources, featured items, breaking news (through the Worker)
{
  const s = await session();
  const f = await op(s, "feature", { ids: [id(5), id(6)] });
  chk("feature: saved in the private data, with a summary", f.status === 200 && /Featured 2 items/.test(f.j.summary) && state().featured[id(5)] && state().featured[id(6)], f.text);
  chk("unfeature: removes one", (await op(s, "unfeature", { ids: [id(5)] })).status === 200 && !state().featured[id(5)] && state().featured[id(6)]);
  const b = await op(s, "breaking", { ids: [id(7)], hours: 1, label: "urgent" });
  chk("breaking: saved with the label; one hour is raised to the shortest allowed, 2", b.status === 200 && state().breaking[id(7)]?.label === "urgent" && state().breaking[id(7)].hours === 2 && /Marked 1 item as urgent/.test(b.j.summary), b.text);
  chk("breaking: the start is the server's clock, not something the page can set", (() => { const t = Date.parse(state().breaking[id(7)].at); return Math.abs(Date.now() - t) < 60e3; })());
  const b2 = await op(s, "breaking", { ids: [id(8)], hours: 24, label: "nonsense", at: "2020-01-01T00:00:00Z" });
  chk("breaking: an unknown label becomes Breaking, and a start time sent by the page is ignored", b2.status === 200 && state().breaking[id(8)].label === "breaking" && state().breaking[id(8)].hours === 24 && Date.parse(state().breaking[id(8)].at) > Date.parse("2026-01-01"), state().breaking[id(8)]);
  chk("breaking: at least one id is required", (await op(s, "breaking", { ids: [], hours: 3 })).status === 400);
  chk("unbreaking: ends the mark", (await op(s, "unbreaking", { ids: [id(7)] })).status === 200 && !state().breaking[id(7)] && state().breaking[id(8)]);
  const ad = await op(s, "add", { item: { h: "Added and marked", s: "Test Wire", u: "https://example.org/added-marked", k: "news" }, article: undefined, feature: true, breaking: { hours: 12, label: "important" } });
  const nid = ad.j?.id;
  chk("add: featured and breaking in the same save", ad.status === 200 && state().featured[nid] && state().breaking[nid]?.hours === 12 && state().breaking[nid].label === "important" && state().added.some(x => x.id === nid), ad.text);
  chk("featured and breaking items are forgotten when they are deleted (breaking) or kept in the Trash copy (featured)", (await op(s, "delete", { ids: [nid], items: {} })).status === 200 && !state().breaking[nid] && !!state().deleted[nid]);
  const bl = await op(s, "blockSources", { sources: ["AsAmNews"] });
  chk("blockSources: saved with the time; the summary names the source", bl.status === 200 && state().settings.blocked.AsAmNews && /Blocked “AsAmNews”/.test(bl.j.summary), bl.text);
  const bl2 = await op(s, "blockSources", { sources: ["asamnews"] });
  chk("blocking it again is refused with a clear message and changes nothing", bl2.status === 400 && /already blocked/.test(bl2.j.error) && Object.keys(state().settings.blocked).length === 1, bl2.text);
  chk("unblockSources: removes it; unblocking a source that is not blocked is refused", (await op(s, "unblockSources", { sources: ["AsAmNews"] })).status === 200 && Object.keys(state().settings.blocked).length === 0 && (await op(s, "unblockSources", { sources: ["AsAmNews"] })).status === 400);
  chk("the new operations need the sign-in and the anti-forgery token like every other change", (await call("/api/op", { method: "POST", body: { op: "breaking", args: { ids: [id(9)] } } })).status === 401 && (await op(s, "feature", { ids: [id(9)] }, { csrf: "wrong" })).status === 403 && !state().featured[id(9)]);
  const raw = await call("/api/raw/state", { cookie: s.cookie });
  chk("the dashboard reads them back with the state (featured, breaking, blocked)", raw.status === 200 && raw.j && raw.j.featured && raw.j.breaking && raw.j.settings?.blocked !== undefined, raw.text.slice(0, 200));
}

// ---------------------------------------------------------------- the private data repository
{
  const s = await session(), pubWrites = A.gh.writes.filter(w => w.repo !== "data");
  chk("every change saved so far went to admin.json in the private repository, none to the public one", A.gh.writes.length >= 10 && pubWrites.length === 0 && A.gh.writes.every(w => w.path === "admin.json"), JSON.stringify(A.gh.writes.slice(0, 3)));
  const checks = () => A.gh.calls.filter(c => c === "GET /repos/theyappie/yappie-pro-admin").length;
  const c0 = checks(); await op(s, "pin", { ids: [id(14)] }); await op(s, "pin", { ids: [id(15)] }); await op(s, "unpin", { ids: [id(14)] });
  chk("the check that the data repository is private is not repeated on every save", checks() - c0 <= 1, checks() - c0);

  const w0 = A.gh.writes.length;
  A.gh.dataPrivate = false; A.skew(11 * 60e3);
  const pub = await op(s, "pin", { ids: [id(11)] }), rs = await call("/api/raw/state", { cookie: s.cookie }), rp = await call("/api/raw/pending", { cookie: s.cookie }), rc = await call("/api/raw/commits", { cookie: s.cookie });
  chk("if the data repository is public, saving and reading it are refused and nothing is written", [pub, rs, rp, rc].every(x => x.status === 500 && /PUBLIC/.test(x.j?.error)) && A.gh.writes.length === w0 && !state().pinned[id(11)], [pub.text, rs.text]);
  chk("the public site's own files still load while the data repository is refused", (await call("/api/raw/feed", { cookie: s.cookie })).status === 200);
  A.gh.dataPrivate = true; A.skew(11 * 60e3);
  chk("once it is private again, saving works", (await op(s, "pin", { ids: [id(11)] })).status === 200 && state().pinned[id(11)]);

  A.gh.dataExists = false; A.skew(11 * 60e3);
  const nf = await op(s, "pin", { ids: [id(13)] }), nfr = await call("/api/raw/pending", { cookie: s.cookie });
  chk("a data repository that is missing, or that the token cannot see, says so", nf.status === 502 && /private repository theyappie\/yappie-pro-admin was not found/.test(nf.j.error) && nfr.status === 502, nf.text);
  A.gh.dataExists = true; A.skew(11 * 60e3);

  const keep = A.env.DATA_REPO;
  A.env.DATA_REPO = A.env.GITHUB_REPO; A.skew(11 * 60e3);
  const same = await op(s, "pin", { ids: [id(13)] });
  chk("DATA_REPO must not be the public site repository", same.status === 500 && /different repository/.test(same.j.error) && A.gh.writes.length === w0 + 1, same.text);
  A.env.DATA_REPO = "no spaces/allowed here"; A.skew(11 * 60e3);
  const bad = await op(s, "pin", { ids: [id(13)] });
  chk("a DATA_REPO that is not owner/name is explained", bad.status === 500 && /DATA_REPO must look like owner\/name/.test(bad.j.error), bad.text);
  A.env.DATA_REPO = keep; A.skew(11 * 60e3);
  chk("and with the right name everything works again", (await op(s, "pin", { ids: [id(13)] })).status === 200);

  const hist = await call("/api/raw/commits", { cookie: s.cookie });
  chk("the change history is read from the private repository", hist.status === 200 && Array.isArray(hist.j) && hist.j.length > 0 && A.gh.calls.some(c => c.startsWith("GET /repos/theyappie/yappie-pro-admin/commits")) && !A.gh.calls.some(c => c.startsWith("GET /repos/theyappie/yappie-pro/commits")));
  chk("workflow runs and updates are started in the public site repository only", A.gh.calls.filter(c => c.includes("/actions/")).every(c => c.includes("/repos/theyappie/yappie-pro/")), A.gh.calls.filter(c => c.includes("/actions/")).slice(0, 3));
}

// ---------------------------------------------------------------- storing problems with GitHub
{
  A.gh.failPut = 2;
  const r = await op(S, "pin", { ids: [id(7)] });
  chk("a save that collides with another one is tried again", r.status === 200 && state().pinned[id(7)]);
  A.gh.failPut = 9;
  const r2 = await op(S, "pin", { ids: [id(8)] });
  chk("after four collisions it says so and nothing is half-saved", r2.status === 409 && /same moment/.test(r2.j.error) && !state().pinned[id(8)], r2.text);
  A.gh.failPut = 0;

  const good = readFileSync(join(DATA, "admin.json"), "utf8");
  writeFileSync(join(DATA, "admin.json"), "{ not json");
  const c = await op(S, "pin", { ids: [id(9)] });
  chk("a damaged admin.json is reported, not overwritten", c.status === 500 && /cannot be read as JSON/.test(c.j.error) && readFileSync(join(DATA, "admin.json"), "utf8") === "{ not json", c.text);
  writeFileSync(join(DATA, "admin.json"), good);

  const big = JSON.parse(good); for (let i = 0; i < 13; i++) big.article["a" + String(i).padStart(11, "0")] = { by: "x", body: "<p>" + "word ".repeat(15000) + "</p>" };
  writeFileSync(join(DATA, "admin.json"), JSON.stringify(big));
  const big2 = await op(S, "pin", { ids: [id(9)] });
  chk("a decisions file that has grown too large is refused with advice", big2.status === 413 && /too many saved changes/.test(big2.j.error), big2.text);
  writeFileSync(join(DATA, "admin.json"), good);

  A.gh.forceStatus = 403; const f403 = await call("/api/raw/feed", { cookie: S.cookie });
  A.gh.forceStatus = 429; const f429 = await call("/api/raw/feed", { cookie: S.cookie });
  A.gh.forceStatus = 500; const f500 = await call("/api/raw/feed", { cookie: S.cookie });
  A.gh.forceStatus = 0;
  chk("GitHub refusing the token or limiting requests gives plain-language errors", f403.status === 502 && /not allowed/.test(f403.j.error) && f429.status === 502 && f500.status === 502 && /500/.test(f500.j.error), [f403.text, f429.text, f500.text]);
  const savedTok = A.env.GITHUB_TOKEN; A.env.GITHUB_TOKEN = "ghp_old"; const f401 = await call("/api/raw/feed", { cookie: S.cookie }); A.env.GITHUB_TOKEN = savedTok;
  chk("a rejected GitHub token says to make a new one", f401.status === 502 && /new one/.test(f401.j.error) && !/ghp_/.test(f401.text), f401.text);
  delete A.env.GITHUB_TOKEN; const f0 = await call("/api/raw/feed", { cookie: S.cookie }); A.env.GITHUB_TOKEN = savedTok;
  chk("a missing GITHUB_TOKEN says so", f0.status === 500 && /GITHUB_TOKEN is not set/.test(f0.j.error), f0.text);
  // Two narrow tokens instead of one broad one: GITHUB_TOKEN can only reach the private repository, DISPATCH_TOKEN can only start runs in the public one.
  {
    A.gh.tokens = { data_tok: { data: ["contents"] }, start_tok: { site: ["actions"] }, [savedTok]: { data: ["contents"], site: ["contents", "actions"] } };
    A.env.GITHUB_TOKEN = "data_tok"; A.env.DISPATCH_TOKEN = "start_tok"; A.gh.auths.length = 0; const d0 = A.gh.dispatches;
    const rf = await call("/api/raw/feed", { cookie: S.cookie }), rs = await call("/api/raw/state", { cookie: S.cookie }), rr = await call("/api/raw/runs", { cookie: S.cookie }), rp = await call("/api/publish", { method: "POST", cookie: S.cookie, csrf: S.csrf });
    const act = A.gh.auths.filter(x => x[3].startsWith("/actions/")), other = A.gh.auths.filter(x => !x[3].startsWith("/actions/"));
    chk("with two narrow tokens the dashboard reads the site's files, the private data and the run status, and starts an update", rf.status === 200 && rs.status === 200 && rr.status === 200 && rp.status === 200 && A.gh.dispatches === d0 + 1, [rf.status, rs.status, rr.status, rp.status, rp.text]);
    chk("requests about the update carry DISPATCH_TOKEN and every other request carries GITHUB_TOKEN", act.length >= 2 && act.every(x => x[0] === "start_tok" && x[1] === "site") && other.length >= 2 && other.every(x => x[0] === "data_tok"), A.gh.auths);
    chk("nothing is ever written to the public repository's files", !A.gh.auths.some(x => x[1] === "site" && x[2] !== "GET" && !x[3].startsWith("/actions/")), A.gh.auths.filter(x => x[2] !== "GET"));
    delete A.env.DISPATCH_TOKEN; const np = await call("/api/publish", { method: "POST", cookie: S.cookie, csrf: S.csrf });
    chk("a token for the private repository alone cannot start an update, and the message says what to add", np.status === 502 && /DISPATCH_TOKEN/.test(np.j.error) && /Actions read and write/.test(np.j.error) && !/data_tok|start_tok/.test(np.text), np.text);
    A.env.DISPATCH_TOKEN = "wrong_tok"; const wp = await call("/api/publish", { method: "POST", cookie: S.cookie, csrf: S.csrf });
    chk("a DISPATCH_TOKEN that GitHub does not accept is named in the message", wp.status === 502 && /update DISPATCH_TOKEN/.test(wp.j.error) && !/wrong_tok/.test(wp.text), wp.text);
    A.env.DISPATCH_TOKEN = "data_tok"; const xp = await call("/api/publish", { method: "POST", cookie: S.cookie, csrf: S.csrf });
    chk("a DISPATCH_TOKEN without the right access is named too", xp.status === 502 && /DISPATCH_TOKEN is not allowed to start the update/.test(xp.j.error), xp.text);
    delete A.env.DISPATCH_TOKEN; A.env.GITHUB_TOKEN = savedTok; A.gh.tokens = null;
  }
  const savedRepo = A.env.GITHUB_REPO; A.env.GITHUB_REPO = "nobody/nothing"; const f404 = await call("/api/raw/feed", { cookie: S.cookie }); A.env.GITHUB_REPO = savedRepo;
  chk("a wrong repository name says so", f404.status === 502 && /GITHUB_REPO/.test(f404.j.error), f404.text);
  chk("the token never appears in an answer", ![f403, f429, f500, f401, f0, f404].some(x => x.text.includes("ghp_")));
}

// ---------------------------------------------------------------- sign-out and expiry
{
  const s1 = await session(), s2 = await session();
  const lo = await call("/api/logout", { method: "POST", cookie: s1.cookie, csrf: s1.csrf });
  chk("logging out clears the cookie", lo.status === 200 && lo.setCookie.some(c => /__Host-yp_admin=;/.test(c) && /Max-Age=0/.test(c)));
  chk("a logged-out cookie stops working, even if somebody kept a copy", (await call("/api/raw/state", { cookie: s1.cookie })).status === 401 && (await call("/api/raw/state", { cookie: s2.cookie })).status === 200);
  const all = await call("/api/logout-all", { method: "POST", cookie: s2.cookie, csrf: s2.csrf });
  const s3 = await session();
  chk("“log out everywhere” ends every older session, and a new login still works", all.status === 200 && (await call("/api/raw/state", { cookie: s2.cookie })).status === 401 && (await call("/api/raw/state", { cookie: s3.cookie })).status === 200);
  const tampered = s3.cookie.replace(/\.([\w-]+)$/, (m, g) => "." + g.slice(0, -2) + (g.endsWith("AA") ? "BB" : "AA"));
  const [pl] = s3.cookie.split("=")[1].split("."), forged = "__Host-yp_admin=" + Buffer.from(JSON.stringify({ n: "x", i: Date.now(), x: Date.now() + 1e9 })).toString("base64url") + "." + s3.cookie.split(".")[1];
  chk("a cookie with a changed signature or a forged body is refused", (await call("/api/raw/state", { cookie: tampered })).status === 401 && (await call("/api/raw/state", { cookie: forged })).status === 401 && (await call("/api/raw/state", { cookie: "__Host-yp_admin=garbage" })).status === 401 && (await call("/api/raw/state", { cookie: "__Host-yp_admin=" + "a".repeat(500) + ".b" })).status === 401);
  const s4 = await session(); A.skew(13 * 3600e3);
  chk("a session ends after 12 hours", (await call("/api/raw/state", { cookie: s4.cookie })).status === 401);
  A.skew(-13 * 3600e3);
  const s5 = await session(); const oldPw = A.env.ADMIN_PASSWORD; A.env.ADMIN_PASSWORD = "a different long password";
  chk("changing ADMIN_PASSWORD signs everybody out", (await call("/api/raw/state", { cookie: s5.cookie })).status === 401 && (await login(oldPw)).status === 401 && (await login("a different long password")).status === 200);
  A.env.ADMIN_PASSWORD = oldPw;
}

// ---------------------------------------------------------------- guessing passwords
{
  const ipA = { headers: { "cf-connecting-ip": "198.51.100.1" } }, ipB = { headers: { "cf-connecting-ip": "198.51.100.2" } };
  let last; for (let i = 0; i < 5; i++) last = await login("guess " + i, ipA);
  chk("the fifth wrong password locks that address", last.status === 429 && /locked out/.test(last.j.error), last.text);
  const withRight = await login(undefined, ipA);
  chk("while locked, even the right password is refused", withRight.status === 429 && !withRight.cookie && Number(withRight.headers.get("retry-after")) > 0, withRight.text);
  chk("other addresses are not affected", (await login(undefined, ipB)).status === 200);
  A.skew(16 * 60e3);
  chk("the lock ends after 15 minutes", (await login(undefined, ipA)).status === 200);
  A.skew(-16 * 60e3);
  for (let i = 0; i < 3; i++) await login("nope", ipB);
  await login(undefined, ipB);
  let l2; for (let i = 0; i < 4; i++) l2 = await login("nope", ipB);
  chk("a correct login resets the count of wrong ones", l2.status === 401);
}

// ---------------------------------------------------------------- setup problems
{
  const short = await startAdmin({ repoRoot: REPO, dir: DIR, env: { ADMIN_PASSWORD: "short" } });
  const page = await fetch(short.url + "/").then(r => r.text());
  const r = await fetch(short.url + "/api/login", { method: "POST", headers: { origin: short.url, "content-type": "application/json" }, body: JSON.stringify({ password: "short" }) });
  chk("a password under 10 characters is not accepted, and the login page says it is not set up", /has not been set up/.test(page) && r.status === 503);
  await short.close();
  const none = await startAdmin({ repoRoot: REPO, dir: DIR, env: { ADMIN_PASSWORD: undefined } });
  const r2 = await fetch(none.url + "/api/login", { method: "POST", headers: { origin: none.url, "content-type": "application/json" }, body: JSON.stringify({ password: "undefined" }) });
  const r3 = await fetch(none.url + "/api/raw/feed", { headers: { cookie: "__Host-yp_admin=a.b" } });
  chk("with no ADMIN_PASSWORD nobody can log in or get in", r2.status === 503 && r3.status === 401);
  await none.close();
}

// ---------------------------------------------------------------- without a KV store
{
  const nk = await startAdmin({ repoRoot: REPO, dir: DIR, env: { KV: null } });
  const save = A; A = nk;
  const s = await session();
  chk("without KV, login and changes work", (await op(s, "pin", { ids: [id(10)] })).status === 200);
  let last; for (let i = 0; i < 5; i++) last = await login("bad", { headers: { "cf-connecting-ip": "198.51.100.9" } });
  chk("without KV, the lockout still works (in memory)", last.status === 429);
  await call("/api/logout", { method: "POST", cookie: s.cookie, csrf: s.csrf });
  chk("without KV, logging out still ends the session", (await call("/api/raw/state", { cookie: s.cookie })).status === 401);
  await nk.close(); A = save;
}

// ---------------------------------------------------------------- the site's icons (the same files as pro.theyappie.com), public like any favicon
{
  for (const [p, type] of [["/favicon.ico", "image/x-icon"], ["/favicon-32.png", "image/png"], ["/apple-touch-icon.png", "image/png"]]) {
    const r = await fetch(A.url + p), buf = Buffer.from(await r.arrayBuffer());
    chk(`icon ${p}: served without signing in, as ${type}, exactly the site's file`, r.status === 200 && r.headers.get("content-type") === type && buf.equals(readFileSync(join(REPO, p.slice(1)))) && /public/.test(r.headers.get("cache-control") || "") && r.headers.get("x-content-type-options") === "nosniff", r.status + " " + r.headers.get("content-type"));
  }
  const hd = await fetch(A.url + "/favicon.ico", { method: "HEAD" }), po = await fetch(A.url + "/favicon.ico", { method: "POST", body: "x" }), un = await fetch(A.url + "/favicon.png");
  chk("icons: HEAD works, other methods are refused, and other icon names are not served", hd.status === 200 && (await hd.text()) === "" && po.status === 405 && un.status === 404);
  const lg = await (await fetch(A.url + "/")).text();
  chk("the login page names the same icons as the site", /<link rel="icon" href="\/favicon\.ico" sizes="48x48"><link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png"><link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/.test(lg) && !/rel="icon" href="data:/.test(lg));
  const S2 = await login(), pg = (await call("/", { cookie: S2.cookie })).text;
  chk("the dashboard names the same icons too, and the page policy lets the browser load them", /<link rel="icon" href="\/favicon\.ico" sizes="48x48">/.test(pg) && /img-src 'self' https: data:/.test((await call("/", { cookie: S2.cookie })).headers.get("content-security-policy") || ""));
}

// ---------------------------------------------------------------- nothing private is published
{
  const pubFiles = listFiles(DIR);
  chk("the public repository has no admin.json or pending.json", !pubFiles.some(f => /(^|\/)(admin|pending)\.json$/.test(f)), pubFiles.join());
  chk("nothing that was only waiting for approval appears anywhere in the public repository", !pubFiles.some(f => /Waiting story|pn0000000001/.test(readFileSync(join(DIR, f), "utf8"))));
  chk("the private repository holds admin.json and pending.json", existsSync(join(DATA, "admin.json")) && existsSync(join(DATA, "pending.json")));
}

await A.close();
console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED", ok.filter(Boolean).length + "/" + ok.length);
process.exit(ok.every(Boolean) ? 0 : 1);
