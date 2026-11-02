// The Yappie Pro admin: one Cloudflare Worker that serves the login page, the dashboard and the API behind them.
// Two GitHub repositories are used:
//   the SITE repository (public, published as the website): the feed, taxonomy and sources are read from it, and the update workflow is started in it;
//   the DATA repository (PRIVATE): admin.json (the owner's decisions) is saved to it, and the collector writes pending.json (stories waiting for approval) to it.
// The collector (scripts/fetch.mjs) applies the decisions on its next run.
// This file is the source. The file to paste into Cloudflare is tools/admin/worker.js, built by `node tools/admin/build.mjs`.
import { STATE_FILE, PENDING_FILE, STATE_MAX_BYTES, AdminError, emptyState, validId, taxSets, applyOp } from "../../../scripts/admin.mjs";

const COOKIE = "__Host-yp_admin", SESSION_HOURS = 12, MAX_BODY = 1_500_000;
const LOCK_AFTER = 5, LOCK_MINUTES = 15;
// which repository each file the dashboard reads lives in
const RAW = { feed: ["site", "data/feed.json"], pending: ["data", PENDING_FILE], state: ["data", STATE_FILE], taxonomy: ["site", "taxonomy.json"], sources: ["site", "sources.json"] };
const enc = new TextEncoder(), dec = new TextDecoder();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ small helpers
const b64u = bytes => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const toB64 = text => { const b = enc.encode(text); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const bytesOf = b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const fromB64 = b64 => { const bin = atob(b64.replace(/\s/g, "")), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return dec.decode(u); };
const hmac = async (key, data) => { const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))); };
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const newId = () => "m" + [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");

const SECURITY = {
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow, noarchive",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8", ...extra } });
const fail = (error, status = 400, extra = {}) => json({ ok: false, error }, status, extra);
// The login page also loads the site's fonts from Adobe Fonts (Typekit); `fonts` allows exactly those two hosts for that page only.
const page = (html, nonce, status = 200, { fonts = false, ...extra } = {}) => new Response(html, {
  status, headers: {
    ...SECURITY, "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", ...extra,
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'${fonts ? " https://use.typekit.net https://p.typekit.net" : ""}; font-src ${fonts ? "https://use.typekit.net" : "'none'"}; img-src 'self' https: data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; frame-src about:`,
  },
});
const attr = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ the optional KV store (login limits, sign-out list); without it the same things are kept in memory
const mem = new Map();
const kvGet = async (env, k) => {
  if (env.KV) { try { const v = await env.KV.get(k); return v ? JSON.parse(v) : null; } catch { return null; } }
  const e = mem.get(k); return e && e.x > Date.now() ? e.v : null;
};
const kvPut = async (env, k, v, ttlSeconds) => {
  if (env.KV) { try { await env.KV.put(k, JSON.stringify(v), ttlSeconds ? { expirationTtl: Math.max(60, Math.ceil(ttlSeconds)) } : undefined); } catch { /* best effort */ } return; }
  if (mem.size > 500) for (const [key, e] of mem) if (e.x <= Date.now()) mem.delete(key);
  mem.set(k, { v, x: Date.now() + (ttlSeconds ?? 86400) * 1000 });
};
const kvDel = async (env, k) => { if (env.KV) { try { await env.KV.delete(k); } catch { /* best effort */ } } else mem.delete(k); };

// ------------------------------------------------------------------ the password and the session
const passwordOk = env => typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= 10;
const checkPassword = async (env, given) => { const k = "yappie-admin-login-v1"; return same(await hmac(k, String(given)), await hmac(k, env.ADMIN_PASSWORD)); };
// The signing key comes from the password, so changing ADMIN_PASSWORD signs everybody out.
const signingKey = env => hmac(env.ADMIN_PASSWORD, "yappie-admin-session-v1");

async function startSession(env, now) {
  const n = b64u(crypto.getRandomValues(new Uint8Array(12))), p = b64u(enc.encode(JSON.stringify({ n, i: now, x: now + SESSION_HOURS * 3600e3 })));
  return `${p}.${b64u(await hmac(await signingKey(env), "s." + p))}`;
}
async function readSession(env, req, now) {
  if (!passwordOk(env)) return null;
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!m) return null;
  const [p, sig] = m.slice(COOKIE.length + 1).split(".");
  if (!p || !sig || p.length > 400) return null;
  let s;
  try {
    const key = await signingKey(env);
    if (!same(await hmac(key, "s." + p), unb64u(sig))) return null;
    s = JSON.parse(dec.decode(unb64u(p)));
    if (typeof s.n !== "string" || typeof s.i !== "number" || typeof s.x !== "number" || s.x <= now || s.i > now + 60e3) return null;
    const auth = await kvGet(env, "auth");
    if (auth && ((auth.epoch && s.i < auth.epoch) || (auth.rev && auth.rev[s.n]))) return null;
    return { ...s, csrf: b64u(await hmac(key, "c." + s.n)) };
  } catch { return null; }
}
const cookieHeader = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function revoke(env, sess, all, now) {
  const auth = (await kvGet(env, "auth")) ?? {}, rev = {};
  for (const [n, x] of Object.entries(auth.rev ?? {})) if (x > now) rev[n] = x;
  if (all) auth.epoch = now; else rev[sess.n] = sess.x;
  await kvPut(env, "auth", { epoch: auth.epoch ?? 0, rev }, SESSION_HOURS * 3600 + 60);
}

// Five wrong passwords from one address lock that address out for 15 minutes.
async function loginAttempt(env, ip, now) {
  const key = "rl:" + ip, rec = (await kvGet(env, key)) ?? { n: 0, first: now, until: 0 };
  if (rec.until > now) return { locked: Math.ceil((rec.until - now) / 1000) };
  return { rec, key };
}
async function loginFailed(env, a, now) {
  const rec = a.rec, fresh = now - rec.first > LOCK_MINUTES * 60e3, n = fresh ? 1 : rec.n + 1, first = fresh ? now : rec.first;
  await kvPut(env, a.key, { n, first, until: n >= LOCK_AFTER ? now + LOCK_MINUTES * 60e3 : 0 }, LOCK_MINUTES * 60 * 2);
  await sleep(600);
  return n >= LOCK_AFTER;
}

// ------------------------------------------------------------------ GitHub
const cfg = env => ({
  repo: env.GITHUB_REPO || "theyappie/yappie-pro", branch: env.GITHUB_BRANCH || "main",
  dataRepo: env.DATA_REPO || "theyappie/yappie-pro-admin", dataBranch: env.DATA_BRANCH || "main",
  workflow: env.WORKFLOW_FILE || "update.yml", site: env.SITE_ORIGIN || "https://pro.theyappie.com",
});
/** Which repository and branch "site" (the public one) or "data" (the private one) means. */
function target(env, w) {
  const c = cfg(env), repo = w === "data" ? c.dataRepo : c.repo;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new AdminError(`${w === "data" ? "DATA_REPO" : "GITHUB_REPO"} must look like owner/name (it is "${String(repo).slice(0, 60)}").`, 500);
  return { repo, branch: w === "data" ? c.dataBranch : c.branch, label: w === "data" ? "the private repository " + repo : "the repository " + repo };
}

async function gh(env, path, init = {}, w = "site") {
  if (!env.GITHUB_TOKEN) throw new AdminError("GITHUB_TOKEN is not set on this Worker. Add it under Settings, then Variables and Secrets.", 500);
  const { repo } = target(env, w);
  try {
    return await fetch(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { authorization: "Bearer " + env.GITHUB_TOKEN, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "yappie-pro-admin", ...(init.headers ?? {}) } });
  } catch { throw new AdminError("GitHub could not be reached. Try again in a moment.", 502); }
}
async function ghProblem(env, res, what, w = "site") {
  const t = (await res.text().catch(() => "")).slice(0, 200), T = target(env, w);
  if (res.status === 401) return new AdminError("GitHub did not accept the token. Make a new one and update GITHUB_TOKEN. (" + what + ")", 502);
  if (res.status === 403 || res.status === 429) return new AdminError(/rate limit/i.test(t) ? "GitHub is limiting requests right now. Try again in a minute." : `The GitHub token is not allowed to do that. It needs ${w === "data" ? "Contents read and write" : "Contents and Actions read and write"} on ${T.label}. (${what})`, 502);
  if (res.status === 404) return new AdminError(w === "data"
    ? `GitHub could not find ${what} in ${T.label} (branch ${T.branch}). Check DATA_REPO and DATA_BRANCH, and that the repository has at least one file (a README) so the branch exists.`
    : `GitHub could not find ${what}. Check GITHUB_REPO, GITHUB_BRANCH and that the token can see the repository.`, 502);
  return new AdminError(`GitHub answered ${res.status} (${what}).`, 502);
}
const contentsPath = (env, file, w) => `/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(target(env, w).branch)}`;

/** A file with its sha, or null when it does not exist. */
async function readFile(env, file, w) {
  const r = await gh(env, contentsPath(env, file, w), {}, w);
  if (r.status === 404) return null;
  if (!r.ok) throw await ghProblem(env, r, file, w);
  const j = await r.json();
  if (typeof j.content !== "string") throw new AdminError(`${file} is too large to edit from here.`, 500);
  return { sha: j.sha, text: fromB64(j.content) };
}
async function writeFile(env, file, text, sha, message, w) {
  return gh(env, `/contents/${file.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, content: toB64(text), branch: target(env, w).branch, ...(sha ? { sha } : {}) }) }, w);
}
async function rawFile(env, file, w) { return gh(env, contentsPath(env, file, w), { headers: { accept: "application/vnd.github.raw+json" } }, w); }

// Before anything is read from or saved to the data repository, check that it is not the public site repository and that it really is private.
// (A public repository would publish the waiting stories.) The answer is remembered for 10 minutes.
let dataOkAt = 0;
async function dataGuard(env, now) {
  if (dataOkAt && now - dataOkAt < 600e3 && now >= dataOkAt) return;
  const c = cfg(env), T = target(env, "data");
  if (c.dataRepo.toLowerCase() === c.repo.toLowerCase()) throw new AdminError("DATA_REPO must be a different repository from GITHUB_REPO. The site's repository is public, and the saved decisions and waiting stories must not be.", 500);
  const r = await gh(env, "", {}, "data");
  if (r.status === 404) throw new AdminError(`The private repository ${T.repo} was not found, or the token cannot see it. Create it (with a README) and give the token Contents access to it. See tools/admin/README.md.`, 502);
  if (!r.ok) throw await ghProblem(env, r, "the private repository", "data");
  const j = await r.json().catch(() => ({}));
  if (j.private !== true) throw new AdminError(`${T.repo} is a PUBLIC repository, so nothing was read or saved. Make it private (GitHub, the repository, Settings, Danger Zone, Change visibility), then try again.`, 500);
  dataOkAt = now;
}

let taxCache = { at: 0, X: null };
async function taxonomy(env, now) {
  if (taxCache.X && now - taxCache.at < 600e3) return taxCache.X;
  const r = await rawFile(env, "taxonomy.json", "site");
  if (!r.ok) throw await ghProblem(env, r, "taxonomy.json");
  taxCache = { at: now, X: taxSets(await r.json()) };
  return taxCache.X;
}

async function dispatch(env) {
  const { workflow, branch } = cfg(env);
  const r = await gh(env, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: branch }) });
  if (r.status !== 204) throw await ghProblem(env, r, "the update workflow");
}
let dispatchSeq = 0;
// Several changes in a row start one update: it begins 6 seconds after the last change. If this Worker is stopped before that, the regular 10-minute timer picks the changes up.
function dispatchSoon(env, ctx) {
  const mine = ++dispatchSeq;
  ctx.waitUntil((async () => { await sleep(6000); if (mine === dispatchSeq) try { await dispatch(env); } catch (e) { console.log("dispatch failed:", e.message); } })());
}

/** Applies one dashboard action to admin.json in the private data repository and commits it. Retries when somebody else (the collector never writes this file) saved at the same moment. */
async function runOp(env, op, args, now) {
  await dataGuard(env, now);
  const X = await taxonomy(env, now);
  if (op === "add" && args && !args.id) args.id = newId();
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readFile(env, STATE_FILE, "data");
    let raw = null;
    if (cur) { try { raw = JSON.parse(cur.text); } catch { throw new AdminError(`${STATE_FILE} cannot be read as JSON. Fix or delete that file in ${target(env, "data").label}, then try again.`, 500); } }
    const r = applyOp(raw, op, args, { X, now, inPlace: true });
    const text = JSON.stringify(r.state);
    if (enc.encode(text).length > STATE_MAX_BYTES) throw new AdminError("There are too many saved changes. Delete old items from the trash or revert some edits.", 413);
    const res = await writeFile(env, STATE_FILE, text, cur?.sha, `admin: ${r.summary}\n\n${r.ids.slice(0, 20).join(", ")}${r.ids.length > 20 ? ` and ${r.ids.length - 20} more` : ""}`, "data");
    if (res.ok) return r;
    if (res.status === 409 || res.status === 422) { await sleep(200 * (attempt + 1)); continue; }
    throw await ghProblem(env, res, STATE_FILE, "data");
  }
  throw new AdminError("Another change was saved at the same moment. Please try again.", 409);
}

// ------------------------------------------------------------------ routes
async function bodyJson(req) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new AdminError("That request is too large.", 413);
  const t = await req.text();
  if (t.length > MAX_BODY) throw new AdminError("That request is too large.", 413);
  try { const o = JSON.parse(t || "{}"); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* below */ }
  throw new AdminError("That request could not be read.");
}
const sameOrigin = req => req.headers.get("origin") === new URL(req.url).origin;

async function route(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname.replace(/\/+$/, "") || "/", now = Date.now(), method = req.method;

  if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { ...SECURITY, "content-type": "text/plain" } });

  // The site's own icons (the same files as pro.theyappie.com), public like any favicon: a browser asks for them without being signed in.
  if (Object.hasOwn(ICONS, path)) {
    if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { ...SECURITY, allow: "GET, HEAD" } });
    const [type, b64] = ICONS[path];
    return new Response(method === "HEAD" ? null : bytesOf(b64), { headers: { ...SECURITY, "content-type": type, "cache-control": "public, max-age=86400" } });
  }

  if (path === "/") {
    if (method !== "GET" && method !== "HEAD") return fail("Method not allowed.", 405);
    const nonce = b64u(crypto.getRandomValues(new Uint8Array(16))), sess = await readSession(env, req, now);
    if (!sess) {
      let home = "#"; try { const u = new URL(cfg(env).site); if (u.protocol === "https:" || u.protocol === "http:") home = u.origin; } catch { /* keep # */ }
      return page(UI.login.replaceAll("{{NONCE}}", nonce).replace("{{SITE}}", attr(home)).replace("{{SETUP}}", () => passwordOk(env) ? "" : "The admin password has not been set up yet. Add the ADMIN_PASSWORD secret (at least 10 characters) to this Worker."), nonce, 200, { fonts: true });
    }
    const c = cfg(env), conf = JSON.stringify({ repo: c.repo, branch: c.branch, dataRepo: c.dataRepo, dataBranch: c.dataBranch, site: c.site, workflow: c.workflow, kv: !!env.KV, hours: SESSION_HOURS }).replace(/</g, "\\u003c");
    return page(UI.app.replaceAll("{{NONCE}}", nonce).replace("{{CSRF}}", sess.csrf).replace("{{CFG}}", conf), nonce);
  }

  if (!path.startsWith("/api/")) return new Response("Not found", { status: 404, headers: SECURITY });

  // log in: the only call that works without a session
  if (path === "/api/login") {
    if (method !== "POST") return fail("Method not allowed.", 405);
    if (!sameOrigin(req)) return fail("This request did not come from the admin page.", 403);
    if (!passwordOk(env)) return fail("The admin password has not been set up yet.", 503);
    const ip = req.headers.get("cf-connecting-ip") ?? "unknown", a = await loginAttempt(env, ip, now);
    if (a.locked) return fail(`Too many wrong passwords. Try again in ${Math.ceil(a.locked / 60)} minute${a.locked > 60 ? "s" : ""}.`, 429, { "retry-after": String(a.locked) });
    const body = await bodyJson(req);
    if (typeof body.password !== "string" || body.password.length > 500 || !(await checkPassword(env, body.password))) {
      const locked = await loginFailed(env, a, now);
      return fail(locked ? `Too many wrong passwords. This address is locked out for ${LOCK_MINUTES} minutes.` : "That password is not right.", locked ? 429 : 401);
    }
    await kvDel(env, a.key);
    return json({ ok: true }, 200, { "set-cookie": cookieHeader(await startSession(env, now), SESSION_HOURS * 3600) });
  }

  const sess = await readSession(env, req, now);
  if (!sess) return fail("Please log in again.", 401, { "set-cookie": cookieHeader("", 0) });
  if (method !== "GET") {
    if (!sameOrigin(req) || req.headers.get("x-csrf") !== sess.csrf) return fail("This request did not come from the admin page. Reload the page and try again.", 403);
  }

  if (path === "/api/logout" && method === "POST") { await revoke(env, sess, false, now); return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) }); }
  if (path === "/api/logout-all" && method === "POST") { await revoke(env, sess, true, now); return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) }); }

  let m;
  if (method === "GET" && (m = path.match(/^\/api\/raw\/([a-z]+)$/))) {
    const name = m[1];
    if (name === "commits") {
      await dataGuard(env, now);
      const r = await gh(env, `/commits?path=${encodeURIComponent(STATE_FILE)}&sha=${encodeURIComponent(target(env, "data").branch)}&per_page=60`, {}, "data");
      if (!r.ok) throw await ghProblem(env, r, "the change history", "data");
      return new Response(r.body, { headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" } });
    }
    if (name === "runs") {
      const c = cfg(env), r = await gh(env, `/actions/workflows/${encodeURIComponent(c.workflow)}/runs?branch=${encodeURIComponent(c.branch)}&per_page=2`);
      if (!r.ok) throw await ghProblem(env, r, "the update workflow");
      return new Response(r.body, { headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" } });
    }
    if (!Object.hasOwn(RAW, name)) return fail("Not found.", 404);
    const [w, file] = RAW[name];
    if (w === "data") await dataGuard(env, now);
    const r = await rawFile(env, file, w);
    if (r.status === 404 && name === "pending") return json({ generated: "", items: [] });
    if (r.status === 404 && name === "state") return json(emptyState());
    if (!r.ok) throw await ghProblem(env, r, file, w);
    return new Response(r.body, { headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" } });
  }
  if (method === "GET" && (m = path.match(/^\/api\/article\/([A-Za-z0-9_-]{4,40})$/))) {
    if (!validId(m[1])) return fail("Unknown item.", 404);
    const r = await rawFile(env, `data/articles/${m[1]}.json`);
    if (r.status === 404) return json({});
    if (!r.ok) throw await ghProblem(env, r, "the article");
    return new Response(r.body, { headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" } });
  }

  if (path === "/api/op" && method === "POST") {
    const b = await bodyJson(req);
    if (typeof b.op !== "string" || !b.args || typeof b.args !== "object") return fail("That request could not be read.");
    const r = await runOp(env, b.op, b.args, now);
    dispatchSoon(env, ctx);
    return json({ ok: true, summary: r.summary, ids: r.ids, id: r.id, state: r.state });
  }
  if (path === "/api/publish" && method === "POST") { await dispatch(env); return json({ ok: true }); }

  return fail("Not found.", 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); }
    catch (e) {
      if (e instanceof AdminError) return fail(e.message, e.status);
      console.log("admin error:", e?.stack ?? e);
      return fail("Something went wrong on the server.", 500);
    }
  },
};
