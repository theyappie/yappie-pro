// Admin decisions for The Yappie Pro: what the owner changed by hand in the admin dashboard (tools/admin) and how the collector (scripts/fetch.mjs) applies it.
// Pure functions, no file or network access. The collector and the admin Worker both use this file (the Worker build inlines it), so the rules are written once.
//
// The decisions live in admin.json (see emptyState): edits and retags, hand-written article text, deleted items (with a copy, so they can be restored),
// approvals, items held back, items kept past the usual days, items added by hand, and the approval setting. Items waiting for approval are written to pending.json.
// Both files are kept in a separate PRIVATE repository (see tools/admin/README.md), because this site's own repository is public and published.

export const STATE_FILE = "admin.json", PENDING_FILE = "pending.json";
export const EDIT_FIELDS = ["h", "m", "s", "u", "d", "k", "t", "tx", "cm", "st", "rl", "rt"]; // headline, summary, source, link, date, section, topic, extra topics, communities, states, policy relevancy, research type
export const MAX_EXTRA_TOPICS = 4; // a story has one main topic ("t") and up to this many more ("tx")
export const RESEARCH_TYPES = ["poll", "report", "data", "none"]; // rt: a survey ("poll"), a report, data, or "none" (not a research item); no rt = the site's rules decide
export const LIMITS = { topics: 30, communities: 30, newsKinds: 8, words: 40, sourceKinds: 500, blocked: 200, hubs: 40 };
export const NEWS_BASE_KINDS = ["community", "news"]; // "AAPI Media" and "Mainstream": the News page's two built-in categories
export const BREAKING_LABELS = { breaking: "Breaking", urgent: "Urgent", important: "Important" }; // the red, flashing label an item carries while it is marked
export const BREAKING_HOURS = [2, 6, 12, 24, 48]; // what the dashboard offers; any whole number of hours from 2 to 72 is accepted (the shortest is 2 so the item is on the page for at least an hour even after the few minutes the site needs to update)
export const PURGE_DAYS = 180; // how long a deleted, approved or held record is remembered
export const STATE_MAX_BYTES = 900_000; // the GitHub contents API returns a file inline up to 1 MB

export class AdminError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export const emptySettings = () => ({
  approval: { mode: "off", sources: [], kinds: [] }, // mode: "off" (new items go live), "all" (every new item waits for approval) or "custom" (new items from these sources or sections wait)
  topics: [],      // topics the owner added: { k, label, words } (words: keywords that tag new stories automatically; may be empty)
  communities: [], // communities the owner added: { k, label, words }
  newsKinds: [],   // News page categories the owner added besides AAPI Media and Mainstream: { k, label }
  sourceKinds: {}, // source name -> News page category key ("community" = AAPI Media, "news" = Mainstream, or one of newsKinds)
  blocked: {},     // source name -> when the owner blocked it: all its stories are taken off the site and nothing new is collected from it
  hubs: [],        // topic hubs the owner added besides the starter set in hubs.json: { k, label, blurb, words } (words: the keywords that put a story, policy item or statement in the hub)
  hubsOff: [],     // keys of starter hubs (hubs.json) the owner hid
  builtin: { topics: {}, communities: {}, kinds: {} }, // changes to the built-in ones, by key: { label?: a new name, off?: true (removed), to?: for a removed News category, the category its sources go to }
});
export const emptyState = () => ({
  v: 1, updated: "",
  settings: emptySettings(),
  edits: {},    // id -> { h, m, s, u, d, k, t, tx, cm, st, rl, rt } values that replace the collected ones (null removes an optional field)
  orig: {},     // id -> the values before the first edit, so an edit can be reverted
  article: {},  // id -> { by, img, body, byu } text of an in-portal article written or changed by hand
  approved: {}, // id -> when; an item the owner approved (it goes live even when approval is required)
  held: {},     // id -> when; an item the owner took back to the approval queue
  pinned: {},   // id -> when; an item kept past the usual number of days
  featured: {}, // id -> when; an item shown at the top of its page with a "Featured" label (newest first); it is also kept past the usual number of days
  breaking: {}, // id -> { at, hours, label }; an item the page shows in red with a flashing label for "hours" hours from "at", at the top of its page (then it is an ordinary item again)
  deleted: {},  // id -> { at, item }; removed items are never collected again; "item" is a copy for restoring
  added: [],    // items added by hand, or restored from the trash
});

/** A source name as one comparable word: letters and digits in any script, in lower case ("Maui Now", "maui now" and "MauiNow" are one source). */
export const nameKey = v => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** When a breaking mark ends (ms). */
export const breakingEnd = b => Date.parse(b.at) + b.hours * 36e5;
/** Is the item marked as breaking news right now? (an ended mark does not count) */
export const breakingOn = (s, id, now = Date.now()) => { const b = s.breaking?.[id]; return !!b && now < breakingEnd(b); };
const cleanBreaking = (b, at) => {
  const h = Math.round(Number(isObj(b) ? b.hours : NaN)), label = isObj(b) && typeof b.label === "string" && b.label in BREAKING_LABELS ? b.label : "breaking";
  return { at, hours: Number.isFinite(h) ? Math.min(72, Math.max(2, h)) : BREAKING_HOURS[0], label };
};

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
    for (const [type, f] of Object.entries(BFIELD)) {
      const m = raw.settings.builtin?.[f]; if (!isObj(m)) continue;
      for (const [k, v] of Object.entries(m)) {
        if (Object.keys(s.settings.builtin[f]).length >= 100) break;
        if (!KEY_OK[type].test(k) || k.length > KEY_MAX[type] || !isObj(v)) continue;
        const e = {}, label = line(v.label, 40); if (label) e.label = label;
        if (v.off === true) { e.off = true; if (type === "kind" && typeof v.to === "string" && KEY_OK.kind.test(v.to) && v.to.length <= KEY_MAX.kind) e.to = v.to; }
        if (Object.keys(e).length) s.settings.builtin[f][k] = e;
      }
    }
    if (isObj(raw.settings.sourceKinds)) for (const [n, k] of Object.entries(raw.settings.sourceKinds)) { if (Object.keys(s.settings.sourceKinds).length >= LIMITS.sourceKinds) break; const name = line(n, 80); if (name && typeof k === "string" && KEY_OK.kind.test(k) && k.length <= KEY_MAX.kind) s.settings.sourceKinds[name] = k; }
    const hubSeen = new Set();
    for (const e of arr(raw.settings.hubs)) {
      if (!isObj(e) || typeof e.k !== "string" || !HUB_KEY.test(e.k) || e.k.length > HUB_KEY_MAX || hubSeen.has(e.k) || s.settings.hubs.length >= LIMITS.hubs) continue;
      const label = line(e.label, 40); if (!label) continue;
      hubSeen.add(e.k); s.settings.hubs.push({ k: e.k, label, blurb: line(e.blurb, 200), words: cleanWords(e.words) });
    }
    s.settings.hubsOff = [...new Set(arr(raw.settings.hubsOff).filter(x => typeof x === "string" && HUB_KEY.test(x) && x.length <= HUB_KEY_MAX))].slice(0, 100);
    if (isObj(raw.settings.blocked)) for (const [n, t] of Object.entries(raw.settings.blocked)) { if (Object.keys(s.settings.blocked).length >= LIMITS.blocked) break; const name = line(n, 80); if (name && nameKey(name)) s.settings.blocked[name] = typeof t === "string" ? t.slice(0, 40) : ""; }
  }
  for (const k of ["edits", "orig", "article", "approved", "held", "pinned", "featured", "deleted"]) if (isObj(raw[k])) for (const [id, v] of Object.entries(raw[k])) if (validId(id) && v != null && (k === "approved" || k === "held" || k === "pinned" || isObj(v) || (k === "featured" && typeof v === "string"))) s[k][id] = v;
  if (isObj(raw.breaking)) for (const [id, b] of Object.entries(raw.breaking)) if (validId(id) && isObj(b) && typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) && Object.keys(s.breaking).length < 500) s.breaking[id] = cleanBreaking(b, b.at);
  s.added = arr(raw.added).filter(x => isObj(x) && validId(x.id) && typeof x.h === "string" && x.h && typeof x.u === "string" && x.u);
  return s;
}

/** Sets of valid values, built from taxonomy.json. The label maps are used to keep the owner's own names apart from the built-in ones. */
export const taxSets = (t, hubs) => ({
  hubs: new Map(arr(hubs?.hubs).filter(h => isObj(h) && typeof h.k === "string" && typeof h.label === "string").map(h => [h.k, h])), // the starter topic hubs (hubs.json)
  topics: new Set(arr(t?.topics).map(x => x.k)), communities: new Set(arr(t?.communities).map(x => x.k)),
  states: new Set(arr(t?.states).map(x => x[0])), kinds: new Set(Object.keys(t?.kinds ?? {})), defaultTopic: t?.default ?? "CULTURE",
  labels: { topic: new Set(arr(t?.topics).map(x => String(x.label).toLowerCase())), community: new Set(arr(t?.communities).map(x => String(x.label).toLowerCase())), kind: new Set(Object.values(t?.kinds ?? {}).map(x => String(x).toLowerCase())) },
  kindLabel: new Map(Object.entries(t?.kinds ?? {})),
  topicLabel: new Map(arr(t?.topics).map(x => [x.k, String(x.label)])), communityLabel: new Map(arr(t?.communities).map(x => [x.k, String(x.label)])),
});

// ---------------------------------------------------------------- the owner's own topics, communities and News categories
const BFIELD = { topic: "topics", community: "communities", kind: "kinds" }; // where each type's changes to the built-in ones are kept (settings.builtin)
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

// ---------------------------------------------------------------- topic hubs: one page per issue that gathers the news, policy items, statements and research about it
export const HUB_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, HUB_KEY_MAX = 40;
const hubKeyOf = label => line(label, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, HUB_KEY_MAX).replace(/-+$/, "");
/** The hubs in use: the starter hubs (hubs.json) the owner has not hidden, then the owner's own. Each: { k, label, blurb, words, own? }. */
export function hubList(starter, settings) {
  const off = new Set(arr(settings?.hubsOff)), seen = new Set(), out = [];
  for (const h of arr(starter)) {
    if (!isObj(h) || typeof h.k !== "string" || !HUB_KEY.test(h.k) || seen.has(h.k)) continue;
    const label = line(h.label, 40); if (!label) continue;
    seen.add(h.k); if (!off.has(h.k)) out.push({ k: h.k, label, blurb: line(h.blurb, 200), words: cleanWords(h.words, 200) });
  }
  for (const h of arr(settings?.hubs)) if (!seen.has(h.k)) { seen.add(h.k); out.push({ k: h.k, label: h.label, blurb: h.blurb ?? "", words: cleanWords(h.words), own: true }); }
  return out;
}
/** A function that gives the keys of the hubs a story belongs to, from the text it is given (headline, summary). Keywords match as whole words in any capitals. */
export function hubTagger(list) {
  const hubs = arr(list).map(h => ({ k: h.k, re: new RegExp(wordsPattern(h.words), "i") })).filter(h => h.re.source !== "(?!)");
  return (...texts) => { const t = texts.map(x => String(x ?? "")).join(" "); const hit = []; for (const h of hubs) if (h.re.test(t)) hit.push(h.k); return hit.slice(0, 6); };
}
/** What the public page needs to know about the hubs (names and descriptions, never keywords). */
export const feedHubs = list => arr(list).map(h => ({ k: h.k, label: h.label, ...(h.blurb ? { blurb: h.blurb } : {}) }));
function cleanHubs(list, starter, old) {
  if (!Array.isArray(list)) throw new AdminError("The list could not be read.");
  if (list.length > LIMITS.hubs) throw new AdminError(`You can add at most ${LIMITS.hubs} hubs.`);
  const oldKeys = new Set(old.map(o => o.k)), used = new Set(starter.keys()), names = new Set([...starter.values()].map(h => String(h.label).toLowerCase())), out = [];
  for (const it of list) {
    if (!isObj(it)) throw new AdminError("The list could not be read.");
    const label = line(it.label, 40);
    if (!label) throw new AdminError("Every hub needs a name.");
    if (names.has(label.toLowerCase())) throw new AdminError(`There is already a hub called “${label}”. Choose a different name.`);
    const k = typeof it.k === "string" && oldKeys.has(it.k) ? it.k : hubKeyOf(label);
    if (!k || !HUB_KEY.test(k)) throw new AdminError(`The hub name “${label}” needs some letters or numbers (A to Z, 0 to 9).`);
    if (used.has(k)) throw new AdminError(`There is already a hub called “${label}”. Choose a different name.`);
    used.add(k); names.add(label.toLowerCase());
    const words = cleanWords(it.words, Infinity);
    if (!words.length) throw new AdminError(`Add at least one keyword to “${label}”, so stories can be matched to it.`);
    if (words.length > LIMITS.words) throw new AdminError(`“${label}” has more than ${LIMITS.words} keywords.`);
    out.push({ k, label, blurb: line(it.blurb, 200), words });
  }
  return out;
}

/** The News categories in use: AAPI Media ("community") and Mainstream ("news") unless the owner removed them, plus the owner's own. redirect: a removed built-in category -> the category its sources go to. */
export function kindState(settings) {
  const b = settings?.builtin?.kinds ?? {}, custom = arr(settings?.newsKinds).filter(k => !RESERVED_KINDS.has(k.k)).map(k => k.k);
  let off = NEWS_BASE_KINDS.filter(k => b[k]?.off === true);
  if (off.length === NEWS_BASE_KINDS.length && !custom.length) off = []; // the News page always keeps one category
  const active = new Set([...NEWS_BASE_KINDS.filter(k => !off.includes(k)), ...custom]), first = [...active][0];
  return { active, off: new Set(off), redirect: new Map(off.map(k => [k, active.has(b[k].to) ? b[k].to : first])) };
}
/** The News page categories: AAPI Media and Mainstream (unless removed), plus the owner's own. */
export const newsKindKeys = settings => kindState(settings).active;
const bOff = (settings, type) => { const m = settings?.builtin?.[BFIELD[type]] ?? {}; return new Set(Object.keys(m).filter(k => m[k]?.off === true)); };
const bLabel = (settings, type, k) => { const l = settings?.builtin?.[BFIELD[type]]?.[k]?.label; return typeof l === "string" && l ? l : null; };

/** The taxonomy with the owner's changes: built-in topics and communities they removed left out, built-in names they changed, and their own topics, communities and categories added (for the collector's tagger, the RSS builder and the dashboard). */
export function withCustom(tax, settings) {
  const offT = bOff(settings, "topic"), offC = bOff(settings, "community"), ks = kindState(settings);
  const allT = new Set(arr(tax?.topics).map(t => t.k)), allC = new Set(arr(tax?.communities).map(c => c.k));
  const topics = arr(tax?.topics).filter(t => !offT.has(t.k) || t.k === tax.default).map(t => bLabel(settings, "topic", t.k) ? { ...t, label: bLabel(settings, "topic", t.k) } : t);
  const communities = arr(tax?.communities).filter(c => !offC.has(c.k)).map(c => bLabel(settings, "community", c.k) ? { ...c, label: bLabel(settings, "community", c.k) } : c);
  const kinds = {}; for (const [k, l] of Object.entries(tax?.kinds ?? {})) if (!ks.off.has(k)) kinds[k] = NEWS_BASE_KINDS.includes(k) && bLabel(settings, "kind", k) ? bLabel(settings, "kind", k) : l;
  for (const t of arr(settings?.topics)) if (!allT.has(t.k)) { allT.add(t.k); topics.push({ k: t.k, label: t.label, re: wordsPattern(t.words), w: CUSTOM_WEIGHT, custom: true }); }
  for (const c of arr(settings?.communities)) if (!allC.has(c.k)) { allC.add(c.k); communities.push({ k: c.k, label: c.label, re: wordsPattern(c.words), custom: true }); }
  for (const k of arr(settings?.newsKinds)) if (!(k.k in (tax?.kinds ?? {})) && !RESERVED_KINDS.has(k.k)) kinds[k.k] = k.label;
  return { ...tax, topics, communities, kinds };
}
/** The valid values with the owner's changes: their own ones added, the built-in ones they removed left out (off: what was removed). */
export function extendSets(X, settings) {
  const offT = bOff(settings, "topic"), offC = bOff(settings, "community"), ks = kindState(settings);
  const topics = new Set([...X.topics].filter(k => !offT.has(k) || k === X.defaultTopic)), communities = new Set([...X.communities].filter(k => !offC.has(k))), kinds = new Set([...X.kinds].filter(k => !ks.off.has(k))), kindLabel = new Map();
  for (const [k, l] of X.kindLabel) if (!ks.off.has(k)) kindLabel.set(k, NEWS_BASE_KINDS.includes(k) && bLabel(settings, "kind", k) ? bLabel(settings, "kind", k) : l);
  for (const t of arr(settings?.topics)) topics.add(t.k);
  for (const c of arr(settings?.communities)) communities.add(c.k);
  for (const k of arr(settings?.newsKinds)) if (!RESERVED_KINDS.has(k.k)) { kinds.add(k.k); kindLabel.set(k.k, k.label); }
  return { ...X, topics, communities, kinds, kindLabel, off: { topics: new Set([...offT].filter(k => k !== X.defaultTopic)), communities: offC, kinds: ks.redirect } };
}
/** What the public page needs to know about the owner's topics, communities and categories (names only, never keywords): their own ones (t, c, kl), new names for built-in ones (rn) and built-in ones they removed (off). null when there is nothing. tax: taxonomy.json (to keep its catch-all topic). */
export function feedTaxo(settings, tax) {
  const t = arr(settings?.topics).map(x => [x.k, x.label]), c = arr(settings?.communities).map(x => [x.k, x.label]), kl = Object.fromEntries(arr(settings?.newsKinds).filter(k => !RESERVED_KINDS.has(k.k)).map(k => [k.k, k.label]));
  const ks = kindState(settings), offT = [...bOff(settings, "topic")].filter(k => k !== tax?.default).sort(), offC = [...bOff(settings, "community")].sort(), offK = [...ks.off].sort();
  const names = (type, off) => { const m = settings?.builtin?.[BFIELD[type]] ?? {}; return Object.fromEntries(Object.keys(m).filter(k => typeof m[k]?.label === "string" && m[k].label && !off.includes(k) && (type !== "kind" || NEWS_BASE_KINDS.includes(k))).sort().map(k => [k, m[k].label])); };
  const rt = names("topic", offT), rc = names("community", offC), rk = names("kind", offK);
  const rn = { ...(Object.keys(rt).length ? { t: rt } : {}), ...(Object.keys(rc).length ? { c: rc } : {}), ...(Object.keys(rk).length ? { k: rk } : {}) };
  const off = { ...(offT.length ? { t: offT } : {}), ...(offC.length ? { c: offC } : {}), ...(offK.length ? { k: offK } : {}) };
  const o = { ...(t.length ? { t } : {}), ...(c.length ? { c } : {}), ...(Object.keys(kl).length ? { kl } : {}), ...(Object.keys(rn).length ? { rn } : {}), ...(Object.keys(off).length ? { off } : {}) };
  return Object.keys(o).length ? o : null;
}

/** The taxonomy plus what the collector published in feed.json ("taxo"): the owner's own topics, communities and categories, new names, and what they removed. For the programs that read the feed (RSS, daily brief) and the page. */
export function withFeedTaxo(tax, taxo) {
  if (!isObj(taxo)) return tax;
  const pairs = a => arr(a).filter(x => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "string");
  const off = isObj(taxo.off) ? taxo.off : {}, rn = isObj(taxo.rn) ? taxo.rn : {}, offT = new Set(arr(off.t)), offC = new Set(arr(off.c)), offK = new Set(arr(off.k));
  const nm = (m, k) => isObj(m) && typeof m[k] === "string" && m[k] ? m[k] : null;
  const topics = tax.topics.filter(x => !offT.has(x.k) || x.k === tax.default).map(x => nm(rn.t, x.k) ? { ...x, label: nm(rn.t, x.k) } : x), communities = tax.communities.filter(x => !offC.has(x.k)).map(x => nm(rn.c, x.k) ? { ...x, label: nm(rn.c, x.k) } : x);
  const kinds = Object.fromEntries(Object.entries(tax.kinds ?? {}).filter(([k]) => !offK.has(k)).map(([k, l]) => [k, nm(rn.k, k) ?? l]));
  for (const [k, label] of pairs(taxo.t)) if (!topics.some(x => x.k === k)) topics.push({ k, label });
  for (const [k, label] of pairs(taxo.c)) if (!communities.some(x => x.k === k)) communities.push({ k, label });
  if (isObj(taxo.kl)) for (const [k, label] of Object.entries(taxo.kl)) if (typeof label === "string" && !(k in kinds)) kinds[k] = label;
  return { ...tax, topics, communities, kinds };
}

/** The name of every built-in topic, community or News page category as the owner sees it (a name they gave it, or the original). entries: settings.builtin for that type. */
function effLabels(type, BX, entries) {
  const base = type === "topic" ? BX.topicLabel : type === "community" ? BX.communityLabel : BX.kindLabel;
  return new Map([...base].map(([k, l]) => { const own = (type !== "kind" || NEWS_BASE_KINDS.includes(k)) && isObj(entries?.[k]) ? line(entries[k].label, 40) : ""; return [k, own || String(l)]; }));
}

/** Validates a whole list of the owner's own entries; returns the cleaned list. old: the entries before, whose keys stay as they are. eff: effLabels(...) of the built-in ones. */
function cleanCustom(type, list, X, old, eff) {
  const noun = { topic: "topic", community: "community", kind: "category" }[type], max = LIMITS[{ topic: "topics", community: "communities", kind: "newsKinds" }[type]];
  if (!Array.isArray(list)) throw new AdminError("The list could not be read.");
  if (list.length > max) throw new AdminError(`You can add at most ${max} ${noun === "community" ? "communities" : noun + "s"}.`);
  const baseKeys = type === "topic" ? X.topics : type === "community" ? X.communities : X.kinds, oldKeys = new Set(old.map(o => o.k));
  const used = new Set(baseKeys), names = new Set([...eff.values()].map(l => l.toLowerCase())), out = [];
  for (const it of list) {
    if (!isObj(it)) throw new AdminError("The list could not be read.");
    const label = line(it.label, 40);
    if (!label) throw new AdminError(`Every ${noun} needs a name.`);
    const k = typeof it.k === "string" && oldKeys.has(it.k) ? it.k : keyOf(type, label);
    if (!k || !KEY_OK[type].test(k)) throw new AdminError(`The ${noun} name “${label}” needs some letters or numbers (A to Z, 0 to 9).`);
    if (names.has(label.toLowerCase()) || (type === "kind" && RESERVED_KINDS.has(k))) throw new AdminError(`There is already a ${noun} called “${label}”. Choose a different name.`);
    if (used.has(k)) throw new AdminError(eff.has(k) ? `“${label}” is too close to the built-in ${noun} now called “${eff.get(k)}”. Choose a different name.` : `There is already a ${noun} called “${label}”. Choose a different name.`);
    used.add(k); names.add(label.toLowerCase());
    if (type === "kind") { out.push({ k, label }); continue; }
    const all = cleanWords(it.words, Infinity);
    if (all.length > LIMITS.words) throw new AdminError(`“${label}” has more than ${LIMITS.words} keywords.`);
    out.push({ k, label, words: all });
  }
  return out;
}

/**
 * Validates the owner's changes to the built-in topics, communities or News categories: { KEY: { label?, off?, to? } } (label: a new name; off: removed; to: for a removed category, where its sources go).
 * custom: the owner's own entries of that type, as they will be. Returns the cleaned map; an entry that changes nothing is left out.
 */
function cleanBuiltin(type, raw, BX, custom) {
  const noun = { topic: "topic", community: "community", kind: "category" }[type];
  if (!isObj(raw)) throw new AdminError("The list could not be read.");
  const base = type === "topic" ? BX.topicLabel : type === "community" ? BX.communityLabel : new Map(NEWS_BASE_KINDS.filter(k => BX.kindLabel.has(k)).map(k => [k, BX.kindLabel.get(k)]));
  for (const k of Object.keys(raw)) if (!base.has(k)) throw new AdminError(`Unknown ${noun}.`);
  const taken = new Set(custom.map(c => c.label.toLowerCase())), shown = new Map(), out = {};
  if (type === "kind") for (const [k, l] of BX.kindLabel) if (!base.has(k)) taken.add(String(l).toLowerCase()); // Statements, Research and the Policy sections
  for (const [k, orig] of base) {
    const v = isObj(raw[k]) ? raw[k] : {}, label = line(v.label, 40), e = {};
    if (label && label !== orig) e.label = label;
    if (v.off === true) {
      if (type === "topic" && k === BX.defaultTopic) throw new AdminError(`“${e.label ?? orig}” is where stories that match no other topic are filed, so it cannot be removed. You can rename it.`);
      e.off = true;
    }
    const name = (e.label ?? orig).toLowerCase();
    if (taken.has(name) || shown.has(name)) throw new AdminError(`There is already a ${noun} called “${e.label ?? orig}”. Choose a different name.`);
    shown.set(name, k);
    if (e.label || e.off) out[k] = e;
  }
  if (type === "kind") {
    const targets = new Set([...base.keys()].filter(k => !out[k]?.off).concat(custom.map(c => c.k)));
    for (const k of Object.keys(out)) if (out[k].off) {
      if (!targets.size) throw new AdminError("The News page needs at least one category.");
      const to = raw[k].to, name = out[k].label ?? base.get(k);
      if (typeof to !== "string" || !targets.has(to)) throw new AdminError(`Choose where the sources of “${name}” go.`);
      out[k].to = to;
    }
  }
  return out;
}
const canonBuiltin = m => JSON.stringify(Object.keys(m).sort().map(k => [k, m[k].label ?? null, m[k].off === true, m[k].to ?? null]));

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
  if ("tx" in p) { const a = uniq(arr(p.tx)).filter(k => k !== f.t); a.every(c => X.topics.has(c)) ? a.length > MAX_EXTRA_TOPICS ? errors.push(`A story can have at most ${MAX_EXTRA_TOPICS} extra topics besides its main one.`) : f.tx = a.length ? a : null : errors.push("Unknown topic."); }
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
  const kk = it.k ?? "news", tt = it.t ?? X.defaultTopic, off = X.off; // a topic, community or category the owner has since removed (on a copy made just before): the usual replacement
  const { fields, errors } = cleanPatch({ h: it.h, s: it.s, u: it.u, d: it.d ?? new Date(now).toISOString(), k: off?.kinds?.get(kk) ?? kk, t: off?.topics?.has(tt) ? X.defaultTopic : tt, ...("m" in it ? { m: it.m } : {}), ...("cm" in it ? { cm: off && Array.isArray(it.cm) ? it.cm.filter(c => !off.communities.has(c)) : it.cm } : {}), ...("st" in it ? { st: it.st } : {}) }, X, now);
  if (errors.length) throw new AdminError(errors[0]);
  const o = { id: it.id, d: fields.d, s: fields.s, h: fields.h, ...(fields.m ? { m: fields.m } : {}), u: fields.u, k: fields.k, t: fields.t, ...(fields.cm ? { cm: fields.cm } : {}), ...(fields.st ? { st: fields.st } : {}) };
  if ("tx" in it) { const r = cleanPatch({ t: o.t, tx: Array.isArray(it.tx) ? it.tx.filter(k => !off?.topics?.has(k)) : it.tx }, X, now); if (r.errors.length) throw new AdminError(r.errors[0]); if (r.fields.tx) o.tx = r.fields.tx; }
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
  if (Array.isArray(o.tx)) { const a = o.tx.filter(k => k !== o.t); if (a.length !== o.tx.length) { if (o === it) o = { ...it }; if (a.length) o.tx = a; else delete o.tx; } } // the main topic is not repeated among the extra ones
  const fe = s.featured?.[it.id]; // "fe": when the owner featured it (the page shows these first, newest first); an old "fe" the owner has since taken away is dropped
  if (typeof fe === "string" && fe) { if (o.fe !== fe) { if (o === it) o = { ...it }; o.fe = fe; } } else if ("fe" in o) { if (o === it) o = { ...it }; delete o.fe; }
  const b = s.breaking?.[it.id]; // "bt" / "bu" / "bk": when the item was marked, when the mark ends, and its label (the page shows the item in red with a flashing label until "bu")
  if (b) { const bu = new Date(breakingEnd(b)).toISOString(); if (o.bt !== b.at || o.bu !== bu || o.bk !== b.label) { if (o === it) o = { ...it }; o.bt = b.at; o.bu = bu; o.bk = b.label; } } else if ("bu" in o || "bt" in o || "bk" in o) { if (o === it) o = { ...it }; delete o.bt; delete o.bu; delete o.bk; }
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
  for (const [id, d] of Object.entries(s.deleted)) if (old(d.at)) { delete s.deleted[id]; delete s.featured[id]; s.added = s.added.filter(x => x.id !== id); }
  for (const [id, b] of Object.entries(s.breaking)) if (now - breakingEnd(b) > 7 * 864e5) delete s.breaking[id]; // a mark that ended a week ago
  s.added = s.added.filter(x => s.pinned[x.id] || !old(x.d)); // an item restored or added without "keep" ages out like any other
  return s;
}

/** After the owner removes a topic, community or category (their own, or a built-in one): forget it wherever it was used by hand, so nothing points at something that no longer exists. fallback(key): what an item added by hand that used it gets instead. */
function dropKeys(s, type, gone, fallback) {
  const G = new Set(gone), field = type === "topic" ? "t" : type === "community" ? "cm" : "k";
  const fixEdit = o => { // a record of hand changes: a change that used the removed value is dropped (the collected value is used again)
    if (isObj(o) && type === "topic" && Array.isArray(o.tx)) { const a = o.tx.filter(c => !G.has(c)); if (a.length) o.tx = a; else delete o.tx; }
    if (!isObj(o) || !(field in o)) return;
    if (field === "cm") { if (!Array.isArray(o.cm)) return; const a = o.cm.filter(c => !G.has(c)); if (a.length) o.cm = a; else delete o.cm; }
    else if (G.has(o[field])) delete o[field];
  };
  for (const k of ["edits", "orig"]) for (const [id, o] of Object.entries(s[k])) { fixEdit(o); if (!Object.keys(o).length) delete s[k][id]; }
  for (const [id, o] of Object.entries(s.orig)) { for (const f of Object.keys(o)) if (!(f in (s.edits[id] ?? {}))) delete o[f]; if (!Object.keys(o).length) delete s.orig[id]; } // nothing left to revert on an item whose hand changes were dropped
  const fixItem = it => { // a whole item kept by hand
    if (!isObj(it)) return;
    if (type === "topic" && Array.isArray(it.tx)) { const a = it.tx.filter(c => !G.has(c)); if (a.length) it.tx = a; else delete it.tx; }
    if (field === "cm") { if (Array.isArray(it.cm)) { const a = it.cm.filter(c => !G.has(c)); if (a.length) it.cm = a; else delete it.cm; } }
    else if (G.has(it[field])) it[field] = fallback(it[field]);
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
 *  approve {ids} · unpublish {ids} · delete {ids, items?} · restore {ids} · pin {ids} · unpin {ids} · feature {ids} · unfeature {ids}
 *  breaking {ids, hours?, label?} · unbreaking {ids}  (red, flashing, at the top of its page for "hours" hours; label: breaking, urgent or important)
 *  edit {id, patch, orig?, article?} · editMany {edits:[{id, patch, orig?}]} · revert {id} · add {item, article?, pin?, feature?, breaking?: {hours?, label?}} · settings {approval}
 *  topics {list:[{k?, label, words}]} · communities {list} · newsKinds {list:[{k?, label}]}  (the owner's own: the whole list is sent)
 *  hubs {list:[{k?, label, blurb?, words}], off:[starter hub keys]}  (topic hubs: the owner's own, the whole list is sent; off: hubs from hubs.json they hid)
 *  sourceKinds {sources:[name], kind: key | null}  (which News page category a source belongs to; null = back to the usual one)
 *  blockSources {sources:[name]} · unblockSources {sources:[name]}  (a blocked source: all its stories are taken off the site, and nothing new is collected from it)
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
    case "feature": needIds(); for (const id of ids) if (!s.featured[id]) s.featured[id] = at; out.summary = `Featured ${plural(ids.length, "item")} at the top of ${ids.length === 1 ? "its page" : "their pages"}`; break;
    case "unfeature": needIds(); for (const id of ids) delete s.featured[id]; out.summary = `Removed ${plural(ids.length, "item")} from Featured`; break;
    case "breaking": {
      needIds(); const b = cleanBreaking(args, at);
      for (const id of ids) s.breaking[id] = b;
      if (Object.keys(s.breaking).length > 500) throw new AdminError("At most 500 items can be marked at once.");
      out.summary = `Marked ${plural(ids.length, "item")} as ${b.label}, shown in red at the top for ${b.hours} hours`; break;
    }
    case "unbreaking": needIds(); for (const id of ids) delete s.breaking[id]; out.summary = `Ended the ${ids.length === 1 ? "breaking mark" : "breaking marks"} on ${plural(ids.length, "item")}`; break;
    case "delete": {
      needIds();
      for (const id of ids) {
        delete s.breaking[id];
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
        for (const f of Object.keys(fields)) if (!(f in o)) { if (f in was) o[f] = was[f]; else if (["m", "tx", "cm", "st", "rl", "rt"].includes(f) && !(isObj(e.orig) && f in e.orig && e.orig[f])) o[f] = null; }
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
      if (args.feature === true) s.featured[id] = at;
      if (isObj(args.breaking)) s.breaking[id] = cleanBreaking(args.breaking, at);
      out.ids = [id]; out.id = id; out.summary = isObj(args.breaking) ? `Added an item marked as ${s.breaking[id].label}` : "Added an item"; break;
    }
    case "settings": {
      const a = args?.approval; if (!isObj(a) || !["off", "all", "custom"].includes(a.mode)) throw new AdminError("Choose an approval mode.");
      const sources = uniq(arr(a.sources).filter(x => typeof x === "string").map(x => line(x, 80)).filter(Boolean)).slice(0, 400), kinds = uniq(arr(a.kinds).filter(k => X.kinds.has(k)));
      s.settings.approval = { mode: a.mode, sources: a.mode === "custom" ? sources : [], kinds: a.mode === "custom" ? kinds : [] };
      out.summary = a.mode === "off" ? "New items go live without approval" : a.mode === "all" ? "Every new item waits for approval" : `New items from ${plural(sources.length, "source")} and ${plural(kinds.length, "section")} wait for approval`; break;
    }
    case "topics": case "communities": case "newsKinds": {
      const type = { topics: "topic", communities: "community", newsKinds: "kind" }[op], f = BFIELD[type], old = s.settings[op], oldB = s.settings.builtin[f], noun = { topic: "topic", community: "community", kind: "category" }[type];
      const rawB = args?.builtin === undefined ? oldB : args.builtin; // the changes to the built-in ones (omitted: they stay as they are)
      const list = args?.list === undefined ? old : cleanCustom(type, args.list, BX, old, effLabels(type, BX, isObj(rawB) ? rawB : {}));
      const newB = cleanBuiltin(type, rawB, BX, list), now = new Set(list.map(x => x.k)), before = new Map(old.map(x => [x.k, x]));
      const added = list.filter(x => !before.has(x.k)), gone = old.filter(x => !now.has(x.k)), changed = list.filter(x => before.has(x.k) && JSON.stringify(before.get(x.k)) !== JSON.stringify(x));
      const offBefore = new Set(Object.keys(oldB).filter(k => oldB[k].off)), offAfter = new Set(Object.keys(newB).filter(k => newB[k].off));
      const removed = [...offAfter].filter(k => !offBefore.has(k)), restored = [...offBefore].filter(k => !offAfter.has(k));
      const nameBefore = effLabels(type, BX, oldB), nameAfter = effLabels(type, BX, newB), renamed = [...nameAfter.keys()].filter(k => !offAfter.has(k) && !offBefore.has(k) && nameBefore.get(k) !== nameAfter.get(k));
      if (!added.length && !gone.length && !changed.length && canonBuiltin(oldB) === canonBuiltin(newB)) throw new AdminError("Nothing to change.");
      s.settings[op] = list; s.settings.builtin[f] = newB;
      const goneKeys = [...gone.map(x => x.k), ...removed];
      if (goneKeys.length) { const ks = kindState(s.settings); dropKeys(s, type, goneKeys, k => type === "topic" ? BX.defaultTopic : ks.redirect.get(k) ?? (ks.active.has("news") ? "news" : [...ks.active][0])); }
      const one = (n, x, verb) => n === 1 ? `${verb} the ${noun} “${x[0].label ?? x[0]}”` : `${verb} ${plural(n, noun)}`, nm = k => nameAfter.get(k) ?? k, nmOld = k => nameBefore.get(k) ?? k;
      out.summary = [added.length && one(added.length, added, "Added"), gone.length && one(gone.length, gone, "Removed"), removed.length && one(removed.length, removed.map(k => ({ label: nmOld(k) })), "Removed"), restored.length && one(restored.length, restored.map(k => ({ label: nm(k) })), "Restored"),
        renamed.length && (renamed.length === 1 ? `Renamed the ${noun} “${nmOld(renamed[0])}” to “${nm(renamed[0])}”` : `Renamed ${plural(renamed.length, noun)}`), changed.length && one(changed.length, changed, "Changed")]
        .filter(Boolean).join(", ").replace(/^(.)/, c => c.toUpperCase()) || `Changed where the sources of a removed ${noun} go`; break;
    }
    case "hubs": {
      const old = s.settings.hubs, starter = BX.hubs ?? new Map(), list = args?.list === undefined ? old : cleanHubs(args.list, starter, old);
      const offOld = s.settings.hubsOff, off = args?.off === undefined ? offOld : [...new Set(arr(args.off).filter(k => typeof k === "string" && HUB_KEY.test(k) && k.length <= HUB_KEY_MAX))].slice(0, 100);
      const before = new Map(old.map(x => [x.k, x])), nowK = new Set(list.map(x => x.k));
      const added = list.filter(x => !before.has(x.k)), gone = old.filter(x => !nowK.has(x.k)), changed = list.filter(x => before.has(x.k) && JSON.stringify(before.get(x.k)) !== JSON.stringify(x));
      const hid = off.filter(k => !offOld.includes(k)), shown = offOld.filter(k => !off.includes(k));
      if (!added.length && !gone.length && !changed.length && !hid.length && !shown.length) throw new AdminError("Nothing to change.");
      s.settings.hubs = list; s.settings.hubsOff = off;
      const nm = k => starter.get(k)?.label ?? k, one = (xs, verb, f = x => x.label) => xs.length === 1 ? `${verb} the hub “${f(xs[0])}”` : `${verb} ${plural(xs.length, "hub")}`;
      out.summary = [added.length && one(added, "Added"), gone.length && one(gone, "Removed"), changed.length && one(changed, "Changed"), hid.length && one(hid, "Hid", nm), shown.length && one(shown, "Showed", nm)].filter(Boolean).join(", ").replace(/^(.)/, c => c.toUpperCase()); break;
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
    case "blockSources": {
      const all = arr(args?.sources).map(x => line(x, 80)).filter(x => nameKey(x)), names = all.filter((n, i) => all.findIndex(m => nameKey(m) === nameKey(n)) === i);
      if (!names.length) throw new AdminError("Choose a source to block.");
      const have = new Set(Object.keys(s.settings.blocked).map(nameKey)), fresh = names.filter(n => !have.has(nameKey(n)));
      if (!fresh.length) throw new AdminError(names.length === 1 ? "That source is already blocked." : "Those sources are already blocked.");
      if (Object.keys(s.settings.blocked).length + fresh.length > LIMITS.blocked) throw new AdminError(`At most ${LIMITS.blocked} sources can be blocked.`);
      for (const n of fresh) s.settings.blocked[n] = at;
      out.summary = fresh.length === 1 ? `Blocked “${fresh[0]}” and removed its stories` : `Blocked ${plural(fresh.length, "source")} and removed their stories`; break;
    }
    case "unblockSources": {
      const keys = new Set(arr(args?.sources).map(x => nameKey(line(x, 80))).filter(Boolean)), gone = Object.keys(s.settings.blocked).filter(n => keys.has(nameKey(n)));
      if (!gone.length) throw new AdminError("Those sources are not blocked.");
      for (const n of gone) delete s.settings.blocked[n];
      out.summary = gone.length === 1 ? `Unblocked “${gone[0]}”` : `Unblocked ${plural(gone.length, "source")}`; break;
    }
    default: throw new AdminError("Unknown action.", 404);
  }
  purge(s, ctx.now ?? Date.now()); s.updated = at;
  return { state: s, ...out };
}
