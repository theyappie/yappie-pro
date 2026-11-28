// Test harness for the admin Worker: the built tools/admin/worker.js runs unchanged, with a fake GitHub (backed by a directory), a fake KV store and a local web server.
import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const realFetch = globalThis.fetch, realSetTimeout = globalThis.setTimeout, realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew; // lets a test move the clock forward
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms ?? 0, 30), ...a); // waits inside the Worker (failed-login delay, update debounce) are shortened

export const sha1 = t => createHash("sha1").update(t).digest("hex");

/** A fake of the parts of the GitHub API the Worker uses. Two repositories: "site" (public, files in dirs.site) and "data" (private, files in dirs.data). */
export const SITE_REPO = "theyappie/yappie-pro", DATA_REPO = "theyappie/yappie-pro-admin";
export function fakeGithub(dirs, opts = {}) {
  const names = { [opts.repo ?? SITE_REPO]: "site", [opts.dataRepo ?? DATA_REPO]: "data" };
  const gh = { dirs, calls: [], commits: [], writes: [], dispatches: 0, auths: [], tokens: null, runs: [{ id: 1, status: "completed", conclusion: "success", updated_at: new Date().toISOString(), html_url: "https://github.example/run/1" }], failPut: 0, forceStatus: 0, onDispatch: null, dataPrivate: true, dataExists: true };
  const file = (w, p) => join(dirs[w], p), shaOf = (w, p) => existsSync(file(w, p)) ? sha1(readFileSync(file(w, p), "utf8")) : null;
  gh.handle = async (url, init = {}) => {
    const u = new URL(url), method = (init.method ?? "GET").toUpperCase(), accept = new Headers(init.headers).get("accept") ?? "";
    const auth = new Headers(init.headers).get("authorization") ?? "";
    gh.calls.push(`${method} ${u.pathname}${u.search}`);
    const R = (status, body, headers = {}) => new Response(typeof body === "string" || body === null ? body : JSON.stringify(body), { status, headers });
    if (gh.forceStatus) return R(gh.forceStatus, { message: "forced" });
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    const w = m && names[m[1]];
    gh.auths.push([auth.replace(/^Bearer /, ""), w ?? "?", method, m ? decodeURIComponent(m[2] ?? "") : u.pathname]);
    // gh.tokens, when set, says what each token may do, as fine-grained tokens do: { "<token>": { data: ["contents"], site: ["actions"] } }. Every valid token may read the public (site) repository's files.
    if (gh.tokens) {
      const may = gh.tokens[auth.replace(/^Bearer /, "")]; if (!may) return R(401, { message: "Bad credentials" });
      const rest0 = m ? decodeURIComponent(m[2] ?? "") : "", need = rest0.startsWith("/actions/") ? "actions" : "contents", has = (may[w] ?? []).includes(need);
      if (w === "data" && !has) return R(404, { message: "Not Found" });                                  // a private repository the token cannot see does not exist for it
      if (w === "site" && !has && (need === "actions" || method !== "GET")) return R(403, { message: "Resource not accessible by personal access token" });
    } else if (auth !== "Bearer " + (opts.token ?? "ghp_test")) return R(401, { message: "Bad credentials" });
    if (!w || (w === "data" && !gh.dataExists)) return R(404, { message: "Not Found" });
    const rest = decodeURIComponent(m[2] ?? "");
    if (rest === "" && method === "GET") return R(200, { full_name: m[1], private: w === "data" ? gh.dataPrivate : false });
    let c;
    if ((c = rest.match(/^\/contents\/(.+)$/))) {
      const p = c[1];
      if (method === "GET") {
        if (!existsSync(file(w, p)) || statSync(file(w, p)).isDirectory()) return R(404, { message: "Not Found" });
        const text = readFileSync(file(w, p), "utf8");
        if (accept.includes("raw")) return R(200, text, { "content-type": "application/vnd.github.raw" });
        return R(200, { sha: sha1(text), content: Buffer.from(text).toString("base64").replace(/(.{60})/g, "$1\n"), encoding: "base64", path: p });
      }
      if (method === "PUT") {
        const b = JSON.parse(init.body);
        if (gh.failPut > 0) { gh.failPut--; return R(409, { message: "is at x but expected y" }); }
        const cur = shaOf(w, p);
        if ((cur ?? undefined) !== (b.sha ?? undefined)) return R(cur ? 409 : 422, { message: "sha mismatch" });
        mkdirSync(dirname(file(w, p)), { recursive: true });
        const text = Buffer.from(b.content, "base64").toString("utf8");
        writeFileSync(file(w, p), text);
        const commit = { sha: sha1(text + gh.commits.length), html_url: "https://github.example/commit/" + gh.commits.length, commit: { message: b.message, author: { date: new Date().toISOString() } }, path: p, repo: w };
        gh.commits.unshift(commit); gh.writes.push({ repo: w, path: p });
        return R(cur ? 200 : 201, { content: { sha: sha1(text) }, commit: { sha: commit.sha } });
      }
    }
    if (rest.startsWith("/commits") && method === "GET") return R(200, gh.commits.filter(x => x.repo === w && x.path === u.searchParams.get("path")).slice(0, 60));
    if (rest.match(/^\/actions\/workflows\/[^/]+\/dispatches$/) && method === "POST") { if (w !== "site") return R(404, { message: "Not Found" }); gh.dispatches++; if (gh.onDispatch) await gh.onDispatch(); return R(204, null); }
    if (rest.match(/^\/actions\/workflows\/[^/]+\/runs$/) && method === "GET") return w === "site" ? R(200, { workflow_runs: gh.runs }) : R(404, { message: "Not Found" });
    return R(404, { message: "Not Found" });
  };
  return gh;
}

export function fakeKV() {
  const m = new Map();
  return { m, async get(k) { const e = m.get(k); if (!e) return null; if (e.x && e.x <= Date.now()) { m.delete(k); return null; } return e.v; }, async put(k, v, o) { m.set(k, { v, x: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); }, async delete(k) { m.delete(k); } };
}

/** Starts the built Worker on a local port. */
export async function startAdmin({ repoRoot, dir, dataDir = dir + "-data", env = {}, ghOpts = {}, port = 0 } = {}) {
  mkdirSync(dataDir, { recursive: true }); if (!existsSync(join(dataDir, "README.md"))) writeFileSync(join(dataDir, "README.md"), "private admin data\n");
  const gh = fakeGithub({ site: dir, data: dataDir }, ghOpts), kv = env.KV === null ? undefined : fakeKV();
  globalThis.fetch = (url, init) => String(url).startsWith("https://api.github.com/") ? gh.handle(String(url), init) : realFetch(url, init);
  const mod = await import(pathToFileURL(join(repoRoot, "tools/admin/worker.js")).href + "?t=" + realNow());
  const E = { ADMIN_PASSWORD: "correct horse battery", GITHUB_TOKEN: "ghp_test", GITHUB_REPO: SITE_REPO, GITHUB_BRANCH: "main", DATA_REPO: DATA_REPO, DATA_BRANCH: "main", WORKFLOW_FILE: "update.yml", SITE_ORIGIN: "https://pro.example", ...(kv ? { KV: kv } : {}), ...env };
  if (E.KV === null) delete E.KV;
  const waiting = [];
  const server = http.createServer(async (rq, rs) => {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = Buffer.concat(chunks);
    const origin = `http://${rq.headers.host}`;
    const headers = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (k !== "host" && v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", "203.0.113.7");
    const req = new Request(origin + rq.url, { method: rq.method, headers, body: ["GET", "HEAD"].includes(rq.method) ? undefined : body });
    const res = await mod.default.fetch(req, E, { waitUntil: p => waiting.push(p) });
    const out = {}; res.headers.forEach((v, k) => { out[k] = v; });
    const sc = res.headers.getSetCookie?.() ?? []; if (sc.length) out["set-cookie"] = sc;
    rs.writeHead(res.status, out); rs.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  const url = `http://localhost:${server.address().port}`;
  return {
    url, gh, kv, env: E, skew: ms => { skew += ms; }, settle: async () => { await Promise.allSettled(waiting.splice(0)); },
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** The public site folder (feed, taxonomy, sources, articles) and the private data folder (pending.json and admin.json). */
export function makeRepoDir(dir, { repo, items, pending = [], state, articles = {}, dataDir = dir + "-data" }) {
  rmSync(dir, { recursive: true, force: true }); rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(join(dir, "data/articles"), { recursive: true }); mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dir, "taxonomy.json"), readFileSync(join(repo, "taxonomy.json")));
  writeFileSync(join(dir, "sources.json"), readFileSync(join(repo, "sources.json")));
  writeFileSync(join(dir, "hubs.json"), readFileSync(join(repo, "hubs.json")));
  for (const f of ["orgs.json"]) writeFileSync(join(dir, f), readFileSync(join(repo, f)));
  writeFileSync(join(dir, "data/feed.json"), JSON.stringify({ generated: new Date().toISOString(), sources: [], items }));
  writeFileSync(join(dataDir, "README.md"), "private admin data\n");
  if (pending.length) writeFileSync(join(dataDir, "pending.json"), JSON.stringify({ generated: new Date().toISOString(), items: pending }));
  if (state) writeFileSync(join(dataDir, "admin.json"), JSON.stringify(state));
  for (const [id, a] of Object.entries(articles)) writeFileSync(join(dir, "data/articles", id + ".json"), JSON.stringify(a));
}
/** Every file under a folder (relative paths). */
export function listFiles(dir, base = dir) { const out = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...listFiles(p, base)); else out.push(p.slice(base.length + 1)); } return out; }
export const readJson = (dir, p) => { try { return JSON.parse(readFileSync(join(dir, p), "utf8")); } catch { return null; } };
export { readdirSync };
