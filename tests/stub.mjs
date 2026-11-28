// Test preload: replaces global fetch with canned local responses (no network). Routes: { "<url>" | "<prefix>*": { status?, headers?, body?, file?, delay? } }
import { readFileSync } from "node:fs";
const load = () => JSON.parse(readFileSync(process.env.STUB_ROUTES, "utf8"));
const log = [];
globalThis.__fetchLog = log;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const routes = load();
  log.push(url);
  if (process.env.STUB_LOG) console.error("[stub] " + (init.method ?? "GET") + " " + url.slice(0, 160));
  const r = routes[url] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && url.startsWith(k.slice(0, -1)))?.[1];
  if (!r) { const e = new TypeError("fetch failed"); e.cause = { code: "ENOTFOUND" }; throw e; }
  if (r.delay) await new Promise(res => setTimeout(res, r.delay));
  const body = r.file ? readFileSync(r.file) : (r.body ?? "");
  return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
};
