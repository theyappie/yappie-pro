// Admin decisions for The Yappie Pro: what the owner changed by hand in the admin dashboard (tools/admin) and how the collector (scripts/fetch.mjs) applies it.
// Pure functions, no file or network access. The collector and the admin Worker both use this file (the Worker build inlines it), so the rules are written once.
//
// The decisions live in admin.json (see emptyState): edits and retags, hand-written article text, deleted items (with a copy, so they can be restored),
// approvals, items held back, items kept past the usual days, items added by hand, and the approval setting. Items waiting for approval are written to pending.json.
// Both files are kept in a separate PRIVATE repository (see tools/admin/README.md), because this site's own repository is public and published.

export const STATE_FILE = "admin.json", PENDING_FILE = "pending.json";
export const EDIT_FIELDS = ["h", "m", "s", "u", "d", "k", "t", "cm", "st", "rl", "rt"]; // headline, summary, source, link, date, section, topic, communities, states, policy relevancy, research type
export const RESEARCH_TYPES = ["poll", "report", "data", "none"]; // rt: a survey ("poll"), a report, data, or "none" (not a research item); no rt = the site's rules decide
export const LIMITS = { topics: 30, communities: 30, newsKinds: 8, words: 40, sourceKinds: 500 };
export const NEWS_BASE_KINDS = ["community", "news"]; // "AAPI Media" and "Mainstream": the News page's two built-in categories
export const PURGE_DAYS = 180; // how long a deleted, approved or held record is remembered
export const STATE_MAX_BYTES = 900_000; // the GitHub contents API returns a file inline up to 1 MB

export class AdminError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export const emptySettings = () => ({
  approval: { mode: "off", sources: [], kinds: [] }, // mode: "off" (new items go live), "all" (every new item waits for approval) or "custom" (new items from these sources or sections wait)
  topics: [],      // topics the owner added: { k, label, words } (words: keywords that tag new stories automatically; may be empty)
  communities: [], // communities the owner added: { k, label, words }
  newsKinds: [],   // News page categories the owner added besides AAPI Media and Mainstream: { k, label }
  sourceKinds: {}, // source name -> News page category key ("community" = AAPI Media, "news" = Mainstream, or one of newsKinds)
});
export const emptyState = () => ({
  v: 1, updated: "",
  settings: emptySettings(),
  edits: {},    // id -> { h, m, s, u, d, k, t, cm, st, rl, rt } values that replace the collected ones (null removes an optional field)
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
  if (isObj(raw.settings)) {
    const seen = new Set();
    for (const [f, type, max] of [["topics", "topic", LIMITS.topics], ["communities", "community", LIMITS.communities], ["newsKinds", "kind", LIMITS.newsKinds]]) {
      for (const e of arr(raw.settings[f])) {
        if (!isObj(e) || typeof e.k !== "string" || !KEY_OK[type].test(e.k) || e.k.length > KEY_MAX[type] || seen.has(type + e.k) || s.settings[f].length >= max) continue;
        const label = line(e.label, 40); if (!label) continue;
        seen.add(type + e.k); s.settings[f].push(type === "kind" ? { k: e.k, label } : { k: e.k, label, words: cleanWords(e.words) });
      }
    }
    if (isObj(raw.settings.sourceKinds)) for (const [n, k] of Object.entries(raw.settings.sourceKinds)) { if (Object.keys(s.settings.sourceKinds).length >= LIMITS.sourceKinds) break; const name = line(n, 80); if (name && typeof k === "string" && KEY_OK.kind.test(k) && k.length <= KEY_MAX.kind) s.settings.sourceKinds[name] = k; }
  }
  for (const k of ["edits", "orig", "article", "approved", "held", "pinned", "deleted"]) if (isObj(raw[k])) for (const [id, v] of Object.entries(raw[k])) if (validId(id) && v != null && (k === "approved" || k === "held" || k === "pinned" || isObj(v))) s[k][id] = v;
  s.added = arr(raw.added).filter(x => isObj(x) && validId(x.id) && typeof x.h === "string" && x.h && typeof x.u === "string" && x.u);
  return s;
}

/** Sets of valid values, built from taxonomy.json. The label maps are used to keep the owner's own names apart from the built-in ones. */
export const taxSets = t => ({
  topics: new Set(arr(t?.topics).map(x => x.k)), communities: new Set(arr(t?.communities).map(x => x.k)),
  states: new Set(arr(t?.states).map(x => x[0])), kinds: new Set(Object.keys(t?.kinds ?? {})), defaultTopic: t?.default ?? "CULTURE",
  labels: { topic: new Set(arr(t?.topics).map(x => String(x.label).toLowerCase())), community: new Set(arr(t?.communities).map(x => String(x.label).toLowerCase())), kind: new Set(Object.values(t?.kinds ?? {}).map(x => String(x).toLowerCase())) },
  kindLabel: new Map(Object.entries(t?.kinds ?? {})),
});

// ---------------------------------------------------------------- the owner's own topics, communities and News categories
const KEY_OK = { topic: /^[A-Z0-9]+(?: [A-Z0-9]+)*$/, community: /^[A-Z0-9]+$/, kind: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ };
const KEY_MAX = { topic: 30, community: 16, kind: 24 };
const CUSTOM_WEIGHT = 3; // a story that contains one of the owner's keywords is filed under the owner's topic, unless a built-in topic has far more matches
const RESERVED_KINDS = new Set(["open", "poll", "report", "data", "all", "none", "__other"]); // used by the page for its own filters
const keyOf = (type, label) => {
  const l = line(label, 60);
  if (type === "topic") return l.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().slice(0, KEY_MAX.topic).trim();
  if (type === "community") return l.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, KEY_MAX.community);
  return l.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, KEY_MAX.kind).replace(/-+$/, "");
};

/** Keywords as the owner typed them (a list, or text separated by commas or new lines): trimmed, no duplicates. */
export function cleanWords(w, max = LIMITS.words) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(w) ? w : typeof w === "string" ? w.split(/[,;\n]+/) : []) {
    const v = line(x, 60), k = v.toLowerCase();
    if (v.length < 2 || !/[\p{L}\p{N}]/u.test(v) || seen.has(k)) continue;
    seen.add(k); out.push(v);
  }
  return out.slice(0, max);
}
/** A pattern for the collector's tagger: any of the words or phrases as whole words (a plural ending is allowed), in any capitals. Words are escaped, so nothing typed can act as a pattern. */
export const wordsPattern = words => {
  const alts = cleanWords(words).map(w => w.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return alts.length ? `(?<![A-Za-z0-9])(?:${alts.join("|")})(?:s|es)?(?![A-Za-z0-9])` : "(?!)"; // "(?!)" never matches: a topic without keywords is only given by hand
};

/** The taxonomy with the owner's own topics, communities and categories added (for the collector's tagger, the RSS builder and the dashboard). */
export function withCustom(tax, settings) {
  const topics = [...arr(tax?.topics)], communities = [...arr(tax?.communities)], kinds = { ...(tax?.kinds ?? {}) };
  const tk = new Set(topics.map(t => t.k)), ck = new Set(communities.map(c => c.k));
  for (const t of arr(settings?.topics)) if (!tk.has(t.k)) { tk.add(t.k); topics.push({ k: t.k, label: t.label, re: wordsPattern(t.words), w: CUSTOM_WEIGHT, custom: true }); }
  for (const c of arr(settings?.communities)) if (!ck.has(c.k)) { ck.add(c.k); communities.push({ k: c.k, label: c.label, re: wordsPattern(c.words), custom: true }); }
  for (const k of arr(settings?.newsKinds)) if (!(k.k in kinds) && !RESERVED_KINDS.has(k.k)) kinds[k.k] = k.label;
  return { ...tax, topics, communities, kinds };
}
/** The valid values with the owner's own ones added. */
export function extendSets(X, settings) {
  const topics = new Set(X.topics), communities = new Set(X.communities), kinds = new Set(X.kinds), kindLabel = new Map(X.kindLabel);
  for (const t of arr(settings?.topics)) topics.add(t.k);
  for (const c of arr(settings?.communities)) communities.add(c.k);
  for (const k of arr(settings?.newsKinds)) if (!RESERVED_KINDS.has(k.k)) { kinds.add(k.k); kindLabel.set(k.k, k.label); }
  return { ...X, topics, communities, kinds, kindLabel };
}
/** The News page categories: AAPI Media and Mainstream, plus the owner's own. */
export const newsKindKeys = settings => new Set([...NEWS_BASE_KINDS, ...arr(settings?.newsKinds).map(k => k.k)]);
/** What the public page needs to know about the owner's own topics, communities and categories (labels only, never keywords), or null when there are none. */
export function feedTaxo(settings) {
  const t = arr(settings?.topics).map(x => [x.k, x.label]), c = arr(settings?.communities).map(x => [x.k, x.label]), kl = Object.fromEntries(arr(settings?.newsKinds).filter(k => !RESERVED_KINDS.has(k.k)).map(k => [k.k, k.label]));
  return t.length || c.length || Object.keys(kl).length ? { ...(t.length ? { t } : {}), ...(c.length ? { c } : {}), ...(Object.keys(kl).length ? { kl } : {}) } : null;
}

/** The taxonomy plus the names of the owner's own topics, communities and categories, as the collector publishes them in feed.json ("taxo"). For the programs that read the feed (RSS, daily brief) and the page. */
export function withFeedTaxo(tax, taxo) {
  if (!isObj(taxo)) return tax;
  const pairs = a => arr(a).filter(x => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string");
  const topics = [...tax.topics], communities = [...tax.communities], kinds = { ...tax.kinds };
  for (const [k, label] of pairs(taxo.t)) if (!topics.some(x => x.k === k)) topics.push({ k, label });
  for (const [k, label] of pairs(taxo.c)) if (!communities.some(x => x.k === k)) communities.push({ k, label });
  if (isObj(taxo.kl)) for (const [k, label] of Object.entries(taxo.kl)) if (typeof label === "string" && !(k in kinds)) kinds[k] = label;
  return { ...tax, topics, communities, kinds };
}

/** Validates a whole list of the owner's own entries; returns the cleaned list. old: the entries before, whose keys stay as they are. */
function cleanCustom(type, list, X, old) {
  const noun = { topic: "topic", community: "community", kind: "category" }[type], max = LIMITS[{ topic: "topics", community: "communities", kind: "newsKinds" }[type]];
  if (!Array.isArray(list)) throw new AdminError("The list could not be read.");
  if (list.length > max) throw new AdminError(`You can add at most ${max} ${noun === "community" ? "communities" : noun + "s"}.`);
  const baseKeys = type === "topic" ? X.topics : type === "community" ? X.communities : X.kinds, oldKeys = new Set(old.map(o => o.k));
  const used = new Set(baseKeys), names = new Set(X.labels?.[type] ?? []), out = [];
  for (const it of list) {
    if (!isObj(it)) throw new AdminError("The list could not be read.");
    const label = line(it.label, 40);
    if (!label) throw new AdminError(`Every ${noun} needs a name.`);
    const k = typeof it.k === "string" && oldKeys.has(it.k) ? it.k : keyOf(type, label);
    if (!k || !KEY_OK[type].test(k)) throw new AdminError(`The ${noun} name “${label}” needs some letters or numbers (A to Z, 0 to 9).`);
    if (used.has(k) || names.has(label.toLowerCase()) || (type === "kind" && RESERVED_KINDS.has(k))) throw new AdminError(`There is already a ${noun} called “${label}”. Choose a different name.`);
    used.add(k); names.add(label.toLowerCase());
    if (type === "kind") { out.push({ k, label }); continue; }
    const all = cleanWords(it.words, Infinity);
    if (all.length > LIMITS.words) throw new AdminError(`“${label}” has more than ${LIMITS.words} keywords.`);
    out.push({ k, label, words: all });
  }
  return out;
}

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
  if ("rl" in p) { p.rl === "n" || p.rl === "i" ? f.rl = p.rl : errors.push("Choose “Impacts AAPIs” or “Related issue”."); }
  if ("rt" in p) { p.rt === null || p.rt === "" ? f.rt = null : RESEARCH_TYPES.includes(p.rt) ? f.rt = p.rt : errors.push("Choose Report, Survey or Data."); }
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
  if (RESEARCH_TYPES.includes(it.rt)) o.rt = it.rt;
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
const plural = (n, w) => `${n} ${n === 1 ? w : w === "community" ? "communities" : w === "category" ? "categories" : w + "s"}`;

/** Forgets old records. */
export function purge(s, now = Date.now()) {
  const old = t => now - Date.parse(t) > PURGE_DAYS * 864e5;
  for (const k of ["approved", "held"]) for (const [id, t] of Object.entries(s[k])) if (old(t)) delete s[k][id];
  for (const [id, d] of Object.entries(s.deleted)) if (old(d.at)) { delete s.deleted[id]; s.added = s.added.filter(x => x.id !== id); }
  s.added = s.added.filter(x => s.pinned[x.id] || !old(x.d)); // an item restored or added without "keep" ages out like any other
  return s;
}

/** After the owner removes a topic, community or category of their own: forget it wherever it was used by hand, so nothing points at something that no longer exists. */
function dropKeys(s, type, gone, X) {
  const G = new Set(gone), field = type === "topic" ? "t" : type === "community" ? "cm" : "k";
  const fixEdit = o => { // a record of hand changes: a change that used the removed value is dropped (the collected value is used again)
    if (!isObj(o) || !(field in o)) return;
    if (field === "cm") { if (!Array.isArray(o.cm)) return; const a = o.cm.filter(c => !G.has(c)); if (a.length) o.cm = a; else delete o.cm; }
    else if (G.has(o[field])) delete o[field];
  };
  for (const k of ["edits", "orig"]) for (const [id, o] of Object.entries(s[k])) { fixEdit(o); if (!Object.keys(o).length) delete s[k][id]; }
  for (const [id, o] of Object.entries(s.orig)) { for (const f of Object.keys(o)) if (!(f in (s.edits[id] ?? {}))) delete o[f]; if (!Object.keys(o).length) delete s.orig[id]; } // nothing left to revert on an item whose hand changes were dropped
  const fixItem = it => { // a whole item kept by hand
    if (!isObj(it)) return;
    if (field === "cm") { if (Array.isArray(it.cm)) { const a = it.cm.filter(c => !G.has(c)); if (a.length) it.cm = a; else delete it.cm; } }
    else if (G.has(it[field])) it[field] = field === "t" ? X.defaultTopic : "news";
  };
  for (const it of s.added) fixItem(it);
  for (const d of Object.values(s.deleted)) fixItem(d.item);
  if (type === "kind") {
    for (const [n, k] of Object.entries(s.settings.sourceKinds)) if (G.has(k)) delete s.settings.sourceKinds[n];
    s.settings.approval.kinds = s.settings.approval.kinds.filter(k => !G.has(k));
  }
}

/**
 * Applies one dashboard action to a copy of the state. ops:
 *  approve {ids} · unpublish {ids} · delete {ids, items?} · restore {ids} · pin {ids} · unpin {ids}
 *  edit {id, patch, orig?, article?} · editMany {edits:[{id, patch, orig?}]} · revert {id} · add {item, article?, pin?} · settings {approval}
 *  topics {list:[{k?, label, words}]} · communities {list} · newsKinds {list:[{k?, label}]}  (the owner's own: the whole list is sent)
 *  sourceKinds {sources:[name], kind: key | null}  (which News page category a source belongs to; null = back to the usual one)
 * ctx: { X: taxSets(...) of taxonomy.json, now?: ms, inPlace?: true }. Returns { state, summary, ids, id? }. Throws AdminError for a request that is not allowed.
 */
export function applyOp(state, op, args, ctx) {
  const s = ctx.inPlace ? normalizeState(state) : clone(normalizeState(state)), at = nowIso(ctx), out = { ids: [] };
  const BX = ctx.X, X = extendSets(BX, s.settings); // BX: the built-in values only (to keep the owner's own names apart from them); X: with the owner's own topics, communities and categories // inPlace: the caller gives up its copy of the state (the Worker, which has just parsed it), which saves copying a large object
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
        for (const f of Object.keys(fields)) if (!(f in o)) { if (f in was) o[f] = was[f]; else if (["m", "cm", "st", "rl", "rt"].includes(f) && !(isObj(e.orig) && f in e.orig && e.orig[f])) o[f] = null; }
        if (fields.rt === null) { delete o.rt; if (s.edits[e.id]) delete s.edits[e.id].rt; delete fields.rt; } // "automatic" again: nothing to remember
        if (!Object.keys(o).length) delete s.orig[e.id];
        if (Object.keys(fields).length) s.edits[e.id] = { ...(s.edits[e.id] ?? {}), ...fields };
        if (s.edits[e.id] && !Object.keys(s.edits[e.id]).length) delete s.edits[e.id];
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
    case "topics": case "communities": case "newsKinds": {
      const type = { topics: "topic", communities: "community", newsKinds: "kind" }[op], old = s.settings[op], noun = { topic: "topic", community: "community", kind: "category" }[type];
      const list = cleanCustom(type, args?.list, BX, old), now = new Set(list.map(x => x.k)), before = new Map(old.map(x => [x.k, x]));
      const added = list.filter(x => !before.has(x.k)), gone = old.filter(x => !now.has(x.k)), changed = list.filter(x => before.has(x.k) && JSON.stringify(before.get(x.k)) !== JSON.stringify(x));
      if (!added.length && !gone.length && !changed.length) throw new AdminError("Nothing to change.");
      s.settings[op] = list;
      if (gone.length) dropKeys(s, type, gone.map(x => x.k), BX);
      const one = (n, x, verb) => n === 1 ? `${verb} the ${noun} “${x[0].label}”` : `${verb} ${plural(n, noun)}`;
      out.summary = [added.length && one(added.length, added, "Added"), gone.length && one(gone.length, gone, "Removed"), changed.length && one(changed.length, changed, "Changed")].filter(Boolean).join(", ").replace(/^(.)/, c => c.toUpperCase()); break;
    }
    case "sourceKinds": {
      const names = uniq(arr(args?.sources).map(x => line(x, 80)).filter(Boolean)).slice(0, LIMITS.sourceKinds);
      if (!names.length) throw new AdminError("Select at least one source.");
      if (args?.kind === null || args?.kind === "") { for (const n of names) delete s.settings.sourceKinds[n]; out.summary = `Put ${plural(names.length, "source")} back in the usual category`; break; }
      if (typeof args?.kind !== "string" || !newsKindKeys(s.settings).has(args.kind) || !X.kinds.has(args.kind)) throw new AdminError("Unknown category.");
      for (const n of names) s.settings.sourceKinds[n] = args.kind;
      if (Object.keys(s.settings.sourceKinds).length > LIMITS.sourceKinds) throw new AdminError(`At most ${LIMITS.sourceKinds} sources can have their own category.`);
      out.summary = `Moved ${plural(names.length, "source")} to ${X.kindLabel.get(args.kind) ?? (args.kind === "community" ? "AAPI Media" : args.kind === "news" ? "Mainstream" : args.kind)}`; break;
    }
    default: throw new AdminError("Unknown action.", 404);
  }
  purge(s, ctx.now ?? Date.now()); s.updated = at;
  return { state: s, ...out };
}
