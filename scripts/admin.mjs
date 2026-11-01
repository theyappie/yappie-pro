// Admin decisions for The Yappie Pro: what the owner changed by hand in the admin dashboard (tools/admin) and how the collector (scripts/fetch.mjs) applies it.
// Pure functions, no file or network access. The collector and the admin Worker both use this file (the Worker build inlines it), so the rules are written once.
//
// The decisions live in data/admin.json (see emptyState): edits and retags, hand-written article text, deleted items (with a copy, so they can be restored),
// approvals, items held back, items kept past the usual days, items added by hand, and the approval setting. Items waiting for approval are written to data/pending.json.

export const STATE_FILE = "data/admin.json", PENDING_FILE = "data/pending.json";
export const EDIT_FIELDS = ["h", "m", "s", "u", "d", "k", "t", "cm", "st"]; // headline, summary, source, link, date, section, topic, communities, states
export const PURGE_DAYS = 180; // how long a deleted, approved or held record is remembered
export const STATE_MAX_BYTES = 900_000; // the GitHub contents API returns a file inline up to 1 MB

export class AdminError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export const emptyState = () => ({
  v: 1, updated: "",
  settings: { approval: { mode: "off", sources: [], kinds: [] } }, // mode: "off" (new items go live), "all" (every new item waits for approval) or "custom" (new items from these sources or sections wait)
  edits: {},    // id -> { h, m, s, u, d, k, t, cm, st } values that replace the collected ones (null removes an optional field)
  orig: {},     // id -> the values before the first edit, so an edit can be reverted
  article: {},  // id -> { by, img, body, byu } text of an in-portal article written or changed by hand
  approved: {}, // id -> when; an item the owner approved (it goes live even when approval is required)
  held: {},     // id -> when; an item the owner took back to the approval queue
  pinned: {},   // id -> when; an item kept past the usual number of days
  deleted: {},  // id -> { at, item }; removed items are never collected again; "item" is a copy for restoring
  added: [],    // items added by hand, or restored from the trash
});

const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
const arr = a => Array.isArray(a) ? a : [];
const ID = /^[A-Za-z0-9_-]{4,40}$/;
export const validId = id => typeof id === "string" && ID.test(id);
const ctl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const str = (v, max) => typeof v === "string" ? v.replace(ctl, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, max) : "";
const line = (v, max) => str(v, max).replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ");

/** The state as the collector and the Worker read it: any file content gives a usable state. */
export function normalizeState(raw) {
  const s = emptyState();
  if (!isObj(raw)) return s;
  s.updated = typeof raw.updated === "string" ? raw.updated : "";
  const a = raw.settings?.approval;
  if (isObj(a)) s.settings.approval = { mode: ["off", "all", "custom"].includes(a.mode) ? a.mode : "off", sources: arr(a.sources).filter(x => typeof x === "string").slice(0, 400), kinds: arr(a.kinds).filter(x => typeof x === "string").slice(0, 20) };
  for (const k of ["edits", "orig", "article", "approved", "held", "pinned", "deleted"]) if (isObj(raw[k])) for (const [id, v] of Object.entries(raw[k])) if (validId(id) && v != null && (k === "approved" || k === "held" || k === "pinned" || isObj(v))) s[k][id] = v;
  s.added = arr(raw.added).filter(x => isObj(x) && validId(x.id) && typeof x.h === "string" && x.h && typeof x.u === "string" && x.u);
  return s;
}

/** Sets of valid values, built from taxonomy.json. */
export const taxSets = t => ({
  topics: new Set(arr(t?.topics).map(x => x.k)), communities: new Set(arr(t?.communities).map(x => x.k)),
  states: new Set(arr(t?.states).map(x => x[0])), kinds: new Set(Object.keys(t?.kinds ?? {})), defaultTopic: t?.default ?? "CULTURE",
});

// ---------------------------------------------------------------- cleaning what the owner types

export function cleanUrl(v, { httpsOnly = false } = {}) {
  let u; try { u = new URL(String(v ?? "").trim()); } catch { return ""; }
  if (!(u.protocol === "https:" || (!httpsOnly && u.protocol === "http:")) || !u.hostname || u.username || u.password) return "";
  return u.href.length <= 1000 ? u.href : "";
}
export function cleanDate(v, now = Date.now()) {
  const t = Date.parse(v);
  if (isNaN(t) || t > now + 2 * 864e5 || t < Date.parse("2000-01-01")) return "";
  return new Date(t).toISOString();
}
const uniq = a => [...new Set(a)];

/** Validates changes to an item. Returns { fields, errors }; only the fields given are checked. */
export function cleanPatch(p, X, now = Date.now()) {
  const f = {}, errors = [];
  if (!isObj(p)) return { fields: f, errors: ["No changes were sent."] };
  if ("h" in p) { const v = line(p.h, 300); v ? f.h = v : errors.push("The headline cannot be empty."); }
  if ("m" in p) { const v = str(p.m, 700); f.m = v || null; }
  if ("s" in p) { const v = line(p.s, 80); v ? f.s = v : errors.push("The source name cannot be empty."); }
  if ("u" in p) { const v = cleanUrl(p.u); v ? f.u = v : errors.push("The link must be a full web address starting with https:// or http://."); }
  if ("d" in p) { const v = cleanDate(p.d, now); v ? f.d = v : errors.push("The date is not valid (it cannot be more than 2 days ahead)."); }
  if ("k" in p) { X.kinds.has(p.k) ? f.k = p.k : errors.push("Unknown section."); }
  if ("t" in p) { X.topics.has(p.t) ? f.t = p.t : errors.push("Unknown topic."); }
  if ("cm" in p) { const a = uniq(arr(p.cm)); a.every(c => X.communities.has(c)) ? f.cm = a.length ? a : null : errors.push("Unknown community."); }
  if ("st" in p) { const a = uniq(arr(p.st)); a.every(c => X.states.has(c)) ? f.st = a.length ? a : null : errors.push("Unknown state."); }
  return { fields: f, errors };
}

const OK_TAGS = new Set(["p", "br", "a", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "h2", "h3", "h4", "h5", "figure", "figcaption", "img", "hr", "span", "div", "sup", "sub", "code", "pre", "table", "thead", "tbody", "tr", "th", "td"]);
const VOID = new Set(["br", "img", "hr"]);
const ATTRS = { a: ["href", "title"], img: ["src", "alt", "width", "height", "title"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] };
const escText = t => t.replace(/&(?!#?[a-zA-Z0-9]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = t => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NAMED = { colon: ":", tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")" };
const safeHref = (v, imgOnly) => {
  const d = String(v).replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32)).replace(/&#(\d+);?/g, (_, n) => String.fromCodePoint(+n || 32)).replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
  const c = d.replace(/[\u0000- \u007F-\u009F]+/g, "");
  return (imgOnly ? /^https?:\/\//i : /^(?:https?:\/\/|mailto:|tel:|#|\/(?!\/))/i).test(c) ? c : "";
};
/** An allow-list HTML cleaner for article text: known tags only, links and pictures with safe addresses only, no scripts, styles or event handlers. */
export function sanitizeHtml(html, max = 80000) {
  let s = String(html ?? "").replace(ctl, "").slice(0, max * 2);
  const BAD = "script|style|iframe|object|embed|form|noscript|template|svg|math|link|meta|base|textarea|select|button|input|frame|frameset|applet";
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(new RegExp(`<(${BAD})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "").replace(new RegExp(`<\\/?(?:${BAD})\\b[^>]*>`, "gi"), "");
  const out = [], stack = []; let last = 0;
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
    out.push(escText(s.slice(last, m.index))); last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (!OK_TAGS.has(tag)) continue;
    if (m[1]) { if (!VOID.has(tag)) { const i = stack.lastIndexOf(tag); if (i >= 0) while (stack.length > i) out.push("</" + stack.pop() + ">"); } continue; }
    let attrs = "";
    for (const a of m[3].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = a[1].toLowerCase(), raw = a[2] ?? a[3] ?? a[4] ?? "";
      if (name === "class") { const c = raw.replace(/[^\w\- ]/g, "").trim().slice(0, 100); if (c) attrs += ` class="${c}"`; continue; }
      if (!(ATTRS[tag] ?? []).includes(name)) continue;
      if (name === "href" || name === "src") { const v = safeHref(raw, name === "src"); if (v) attrs += ` ${name}="${escAttr(v)}"`; continue; }
      attrs += ` ${name}="${escAttr(raw.slice(0, 300))}"`;
    }
    if (tag === "a" && /\shref="https?:/i.test(attrs)) attrs += ' target="_blank" rel="noopener noreferrer"';
    out.push(`<${tag}${attrs}>`);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(tag);
  }
  out.push(escText(s.slice(last)));
  while (stack.length) out.push("</" + stack.pop() + ">");
  return out.join("").slice(0, max);
}

/** Article text fields (only the ones sent are returned). */
export function cleanArticle(a) {
  const o = {};
  if (!isObj(a)) return o;
  if ("by" in a) o.by = line(a.by, 120);
  if ("img" in a) o.img = a.img ? cleanUrl(a.img, { httpsOnly: true }) : "";
  if ("byu" in a) o.byu = a.byu ? cleanUrl(a.byu) : "";
  if ("body" in a) o.body = sanitizeHtml(a.body);
  return o;
}

/** A whole item (a copy kept for restoring, or an item added by hand): known fields only. */
export function cleanItem(it, X, now = Date.now()) {
  if (!isObj(it)) throw new AdminError("The item is missing.");
  const { fields, errors } = cleanPatch({ h: it.h, s: it.s, u: it.u, d: it.d ?? new Date(now).toISOString(), k: it.k ?? "news", t: it.t ?? X.defaultTopic, ...("m" in it ? { m: it.m } : {}), ...("cm" in it ? { cm: it.cm } : {}), ...("st" in it ? { st: it.st } : {}) }, X, now);
  if (errors.length) throw new AdminError(errors[0]);
  const o = { id: it.id, d: fields.d, s: fields.s, h: fields.h, ...(fields.m ? { m: fields.m } : {}), u: fields.u, k: fields.k, t: fields.t, ...(fields.cm ? { cm: fields.cm } : {}), ...(fields.st ? { st: fields.st } : {}) };
  if (it.rl === "n" || it.rl === "i") o.rl = it.rl;
  for (const [k, n] of [["ty", 120], ["ag", 40], ["la", 80], ["ph", 120]]) if (typeof it[k] === "string" && it[k]) o[k] = line(it[k], n);
  if (typeof it.dl === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.dl)) o.dl = it.dl;
  if (Array.isArray(it.bl)) { const b = it.bl.filter(x => isObj(x) && typeof x.n === "string" && typeof x.u === "string" && cleanUrl(x.u)).slice(0, 10).map(x => ({ ...(x.id ? { id: line(x.id, 40) } : {}), n: line(x.n, 60), u: cleanUrl(x.u) })); if (b.length) o.bl = b; }
  if (it.v === 1) o.v = 1;
  return o;
}

// ---------------------------------------------------------------- what the collector does with the decisions

export const needsApproval = (s, it) => { const a = s.settings.approval; return a.mode === "all" || (a.mode === "custom" && (a.sources.includes(it.s) || a.kinds.includes(it.k))); };

/** The item with the owner's edits on top of the collected values. */
export function applyEdits(it, s) {
  const e = s.edits[it.id];
  let o = it;
  if (e) { o = { ...it }; for (const f of EDIT_FIELDS) if (f in e) { if (e[f] === null) delete o[f]; else o[f] = e[f]; } }
  if (s.article[it.id]?.body) o = o === it ? { ...it, v: 1 } : (o.v = 1, o);
  return o;
}

/** "live" or "pending" for an item that passed every other rule. was: where the item was after the previous run. */
export function placeOf(s, it, was) {
  if (s.approved[it.id]) return "live";
  if (s.held[it.id]) return "pending";
  if (was.pending) return "pending";
  if (was.live) return "live";
  return needsApproval(s, it) ? "pending" : "live";
}

// ---------------------------------------------------------------- what the dashboard changes

const clone = o => structuredClone(o);
const idsOf = a => uniq(arr(a).filter(validId)).slice(0, 2000);
const nowIso = ctx => new Date(ctx.now ?? Date.now()).toISOString();
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Forgets old records. */
export function purge(s, now = Date.now()) {
  const old = t => now - Date.parse(t) > PURGE_DAYS * 864e5;
  for (const k of ["approved", "held"]) for (const [id, t] of Object.entries(s[k])) if (old(t)) delete s[k][id];
  for (const [id, d] of Object.entries(s.deleted)) if (old(d.at)) { delete s.deleted[id]; s.added = s.added.filter(x => x.id !== id); }
  s.added = s.added.filter(x => s.pinned[x.id] || !old(x.d)); // an item restored or added without "keep" ages out like any other
  return s;
}

/**
 * Applies one dashboard action to a copy of the state. ops:
 *  approve {ids} · unpublish {ids} · delete {ids, items?} · restore {ids} · pin {ids} · unpin {ids}
 *  edit {id, patch, orig?, article?} · editMany {edits:[{id, patch, orig?}]} · revert {id} · add {item, article?, pin?} · settings {approval}
 * ctx: { X: taxSets(...), now?: ms, inPlace?: true }. Returns { state, summary, ids, id? }. Throws AdminError for a request that is not allowed.
 */
export function applyOp(state, op, args, ctx) {
  const s = ctx.inPlace ? normalizeState(state) : clone(normalizeState(state)), X = ctx.X, at = nowIso(ctx), out = { ids: [] }; // inPlace: the caller gives up its copy of the state (the Worker, which has just parsed it), which saves copying a large object
  const ids = idsOf(args?.ids);
  const needIds = () => { if (!ids.length) throw new AdminError("Select at least one item."); out.ids = ids; };
  switch (op) {
    case "approve": needIds(); for (const id of ids) { s.approved[id] = at; delete s.held[id]; } out.summary = `Approved ${plural(ids.length, "item")}`; break;
    case "unpublish": needIds(); for (const id of ids) { s.held[id] = at; delete s.approved[id]; } out.summary = `Moved ${plural(ids.length, "item")} back to the approval queue`; break;
    case "pin": needIds(); for (const id of ids) s.pinned[id] = at; out.summary = `Kept ${plural(ids.length, "item")} permanently`; break;
    case "unpin": needIds(); for (const id of ids) delete s.pinned[id]; out.summary = `Stopped keeping ${plural(ids.length, "item")} permanently`; break;
    case "delete": {
      needIds();
      for (const id of ids) {
        const snap = isObj(args.items) && isObj(args.items[id]) ? args.items[id] : s.added.find(x => x.id === id);
        let item; if (snap) { try { item = cleanItem({ ...snap, id }, X, ctx.now); } catch { item = undefined; } }
        s.deleted[id] = { at, ...(item ? { item } : {}) }; delete s.approved[id]; delete s.held[id];
      }
      out.summary = `Deleted ${plural(ids.length, "item")}`; break;
    }
    case "restore": {
      needIds(); let n = 0;
      for (const id of ids) {
        const t = s.deleted[id]; if (!t) continue; n++; delete s.deleted[id]; s.approved[id] = at;
        if (t.item && !s.added.some(x => x.id === id)) s.added.push(t.item);
      }
      if (!n) throw new AdminError("Those items are not in the trash."); out.summary = `Restored ${plural(n, "item")}`; break;
    }
    case "edit": case "editMany": {
      const list = op === "edit" ? [{ id: args?.id, patch: args?.patch, orig: args?.orig, article: args?.article }] : arr(args?.edits).slice(0, 2000);
      if (!list.length) throw new AdminError("Nothing to change.");
      for (const e of list) {
        if (!validId(e?.id)) throw new AdminError("Unknown item.");
        const { fields, errors } = e.patch === undefined && e.article !== undefined ? { fields: {}, errors: [] } : cleanPatch(e.patch, X, ctx.now);
        if (errors.length) throw new AdminError(errors[0]);
        const art = e.article !== undefined ? cleanArticle(e.article) : {};
        if (!Object.keys(fields).length && !Object.keys(art).length) throw new AdminError("Nothing to change.");
        // the values before the first edit, so it can be reverted; a field that had no value goes back to none (only summary, communities and states can be empty)
        const o = (s.orig[e.id] ??= {}), was = isObj(e.orig) ? cleanPatch(Object.fromEntries(Object.entries(e.orig).filter(([f]) => f in fields)), X, ctx.now).fields : {};
        for (const f of Object.keys(fields)) if (!(f in o)) { if (f in was) o[f] = was[f]; else if (["m", "cm", "st"].includes(f) && !(isObj(e.orig) && f in e.orig && e.orig[f])) o[f] = null; }
        if (!Object.keys(o).length) delete s.orig[e.id];
        if (Object.keys(fields).length) s.edits[e.id] = { ...(s.edits[e.id] ?? {}), ...fields };
        if (Object.keys(art).length) {
          if ("by" in art && !("byu" in art)) art.byu = ""; // a new author name does not keep the old author's page link
          s.article[e.id] = { ...(s.article[e.id] ?? {}), ...art };
        }
      }
      out.ids = list.map(e => e.id); out.id = out.ids[0];
      out.summary = op === "edit" ? "Edited an item" : `Changed tags on ${plural(list.length, "item")}`; break;
    }
    case "revert": {
      const id = args?.id; if (!validId(id) || !s.orig[id]) throw new AdminError("This item has nothing to revert.");
      s.edits[id] = { ...(s.edits[id] ?? {}), ...s.orig[id] }; delete s.orig[id]; out.ids = [id]; out.id = id; out.summary = "Reverted an item to its collected values"; break;
    }
    case "add": {
      const id = args?.id; if (!validId(id)) throw new AdminError("An item id is required.");
      if (s.added.some(x => x.id === id)) throw new AdminError("That item already exists.");
      const item = cleanItem({ ...args.item, id }, X, ctx.now), art = args.article !== undefined ? cleanArticle(args.article) : {};
      if (art.body) { item.v = 1; s.article[id] = { by: "", img: "", byu: "", ...art }; }
      s.added.push(item); if (args.pin !== false) s.pinned[id] = at; s.approved[id] = at;
      out.ids = [id]; out.id = id; out.summary = "Added an item"; break;
    }
    case "settings": {
      const a = args?.approval; if (!isObj(a) || !["off", "all", "custom"].includes(a.mode)) throw new AdminError("Choose an approval mode.");
      const sources = uniq(arr(a.sources).filter(x => typeof x === "string").map(x => line(x, 80)).filter(Boolean)).slice(0, 400), kinds = uniq(arr(a.kinds).filter(k => X.kinds.has(k)));
      s.settings.approval = { mode: a.mode, sources: a.mode === "custom" ? sources : [], kinds: a.mode === "custom" ? kinds : [] };
      out.summary = a.mode === "off" ? "New items go live without approval" : a.mode === "all" ? "Every new item waits for approval" : `New items from ${plural(sources.length, "source")} and ${plural(kinds.length, "section")} wait for approval`; break;
    }
    default: throw new AdminError("Unknown action.", 404);
  }
  purge(s, ctx.now ?? Date.now()); s.updated = at;
  return { state: s, ...out };
}
