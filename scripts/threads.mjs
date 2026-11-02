// Story threads: groups the SAME news story reported by different outlets, so the page can show one timeline.
// Precision matters far more than recall: two different stories in one thread is worse than a missed link, so
// every rule below leans towards "do not link".
//
// assignThreads(items) returns a Map from item id to thread id. Only items that sit in a thread of at least two
// items from at least two different outlets appear in it. Nothing is changed in the items themselves.
//
// How it works, in plain English:
//  1. Only news-like items are looked at (news, community, statement, govstmt); bills, orders and so on never are.
//  2. A headline is cleaned (outlet name, "Opinion:" style labels, recurring column names removed) and cut into
//     words. Filler words, the words that are in nearly every headline of this site (asian, american, guam, hawaii...)
//     and words that are common in the data at hand carry no weight. Rarer words weigh more; names and numbers a bit more.
//  3. Two items from DIFFERENT outlets, at most 5 days apart, are "alike" only when they share at least 3 weighty
//     words and the shared words are most of what both headlines say (weighted Jaccard). A shared summary can help a
//     near miss over the line, never a weak headline match on its own. Two vetoes follow: headlines that name different
//     people, places or numbers are never alike ("clash"; Guam against Hawaii counts too), and when several other
//     outlets have items with all the same shared words (a topic such as a typhoon, not a story) the two headlines
//     must agree much more ("crowd").
//  4. Items are walked oldest first. A new item joins the single best thread it is alike to, and only if it is alike to
//     the thread's first item or to two of its members (so a thread cannot drift away from its beginning by chaining).
//     Threads are never merged with each other, last at most 14 days from their first item and hold at most 40 items.
//  5. The thread id is the first 7 hex digits of sha1(id of the thread's earliest item), so it stays the same when
//     later items join.
import { createHash } from "node:crypto";

export const THREAD_KINDS = new Set(["news", "community", "statement", "govstmt"]);

// Settings (all can be overridden through assignThreads(items, { ...settings })).
export const DEFAULTS = {
  windowDays: 5,        // two items can only be linked when their dates are at most this far apart
  spanDays: 14,         // a thread never reaches over more than this many days from its first item
  maxSize: 40,          // a thread never holds more items than this
  minShared: 3,         // shared weighty words needed for a link at all
  minWords: 0,          // both headlines must have at least this many weighty words (0: no extra rule)
  // Rules for "alike", each [shared words at least, their weight together at least, weighted Jaccard of the two headlines at least]:
  // the more words two headlines share, the less of the rest they have to agree on. Weighted Jaccard = shared weight / weight of all words in either.
  tiers: [[3, 12, 0.5], [4, 16, 0.4], [5, 20, 0.33]],
  rareShared: 2,        // exception: two shared words are enough when both are rare names or numbers...
  rareMaxDf: 6,         // ...("rare" = in at most this many items)...
  rareMinJaccard: 0.7,  // ...and the headlines are otherwise almost the same
  summaryHelp: 0.08,    // a summary that clearly agrees lowers the first rule's Jaccard by this much (the shared words still must reach the first rule)
  summaryMinJaccard: 0.3, // how much two summaries must agree for that help
  summaryMinShared: 4,
  ubiquitousShare: 0.012, // a word in more than this share of all items (and in at least ubiquitousMin items) carries no weight
  ubiquitousMin: 30,
  idfFloorN: 5000,      // idf is computed as if there were at least this many items (keeps small inputs sane)
  crowdMin: 3,          // when this many other outlets have items with all of the shared words (a topic, not a story)...
  crowdJaccard: 0.6,    // ...the two headlines must agree this much (weighted Jaccard)
  nameClash: true,      // two headlines that name different people, places or numbers are never linked (see clash below)
  boost: 1.25,          // weight factor for names (capitalised mid-headline) and numbers
  seriesMinCount: 4,    // a "Label:" that starts this many headlines over at least seriesMinDays days is a column name
  seriesMinDays: 20,
};

// ---------------------------------------------------------------------------------------------- words
// Filler words and words that tell nothing about a story.
const STOP = new Set(`
a about above across after again against all also am among amid an and any are around as at away back be because been before being below between both but by
can could did do does doing down during each even ever every few for from further get gets got had has have having he her here hers him his how however i if in into is it its
just like make makes may might more most much must my new no nor not now of off on once one only onto or other our out over own per same say says said she should since so some still such
than that the their theirs them then there these they this those through to too under until up upon us very was we well were what when where whether which while who whom whose why will with within without would yet you your
first last next top best big get go going goes gone take takes took taken see sees seen set sets via vs versus yes
news report reports reported update updates updated live watch video videos photo photos opinion letter letters editorial column commentary today tonight yesterday tomorrow week weeks weekend weekly month months year years day days time times
monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december
announce announces announced says according local state states national prepare prepares prepared preparing want wants wanted wanting
rev dr mr mrs ms rep reps sen sens hon prof sgt lt gen capt col
`.split(/\s+/).filter(Boolean));
// Words that are in nearly every headline on a site about Asian American and Pacific Islander communities, so they cannot show that two
// headlines are about the same story. Place names of the home regions (guam, hawaii, maui) are here for the same reason.
const DOMAIN = new Set(`
asian asians american americans aapi aapis aanhpi aanhpis anhpi nhpi api apia pacific islander islanders island islands community communities heritage
guam hawaii hawaiian hawaiians maui cnmi native
`.split(/\s+/).filter(Boolean));
// Labels in front of a headline ("Opinion:", "Live updates:") and section names at its end or start ("| News").
const LABEL = /^(?:opinion|op-?ed|oped|editorial|editorials|our view|commentary|column|analysis|perspective|viewpoint|letters?(?: to the editor)?|guest (?:column|commentary|opinion|view)|watch|watch live|live updates?|live blog|live|live stream|livestream|update|updated|updates?|breaking(?: news)?|just in|developing|exclusive|photos?|photo gallery|gallery|video|videos|podcast|listen|review|obituary|obituaries|in memoriam|news alert|alert|correction|explainer|q&a|fact check|sponsored|press release|statement|news release|pr newswire|the conversation)\s*(?::|\||-|–|—)\s+/i;
const SECTION = new Set("news local local news local sports sports opinion election elections letters to the editor business world life entertainment features feature blog lifestyle politics government education health community crime courts".split(" "));
// A few short forms that headlines use for the same word.
const ALIAS = new Map([["gop", "republican"], ["gov", "governor"], ["govt", "government"], ["dems", "democrat"], ["feds", "federal"]]);
// The home regions of this site. Their names carry no weight as words (they are in nearly every headline), but a Guam story and a Hawaii story are not one story.
const PLACES = new Map([["guam", "guam"], ["cnmi", "cnmi"], ["hawaii", "hawaii"], ["maui", "hawaii"]]);
const norm = s => String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// A name or section in a form that can be compared: lower case, letters and digits only, no leading "the".
const nameKey = s => norm(s).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");

// The same outlet can be written in several ways ("Nichi Bei" and "Nichi Bei News", a group and its chapters, a ministry's own page and the same
// page seen through a news search). To be careful all of these count as ONE outlet: names that start with another outlet's name, and items whose
// links lead to the same site. Returns a function row -> outlet key.
function outletResolver(rows) {
  const parent = new Map();
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); for (let c = k; c !== r;) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const add = k => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (x, y) => { const a = find(add(x)), b = find(add(y)); if (a !== b) parent.set(b < a ? a : b, b < a ? b : a); };
  const names = [...new Set(rows.map(r => nameKey(r.s)).filter(Boolean))].sort((a, b) => a.length - b.length);
  for (const k of names) { add("n:" + k); for (const c of names) { if (c.length >= k.length) break; if (c.length >= 3 && k.startsWith(c + " ")) union("n:" + k, "n:" + c); } }
  for (const r of rows) {
    const h = siteOf(r);
    r.site = h;
    if (h) union("n:" + (nameKey(r.s) || "?"), "h:" + h);
  }
  return r => find(add("n:" + (nameKey(r.s) || "?")));
}
// The site an item really comes from: its link, or for a link that goes through a news search the publisher that the collector recorded.
function siteOf(r) {
  let host = "";
  try { host = new URL(r.u).hostname.toLowerCase(); } catch { /* no usable link */ }
  if (host === "news.google.com" || host.endsWith(".google.com") || !host) host = String(r.ph ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  host = host.replace(/^www\d?\./, "");
  if (!host || !host.includes(".")) return "";
  const p = host.split(".");
  if (/^(gov|mil|edu)$/.test(p[p.length - 1])) return host; // government and school sites: every office has its own host
  const n = p.length;
  return n >= 3 && p[n - 1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(p[n - 2]) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

// Cuts the word endings that differ between outlets (plural, -ed, -ing, final e): "charged", "charges" and "charging" all become "charg".
function stem(w) {
  if (w.length > 3 && /^[a-z]+$/.test(w)) {
    if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
    else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  }
  return w;
}

// The words of a headline as a Map: word -> true when it looks like a name or a number, otherwise false. Names are read from capital letters when the
// headline is in sentence case (a capital inside the headline marks a name). A headline in Title Case capitalises everything, so its capitals say
// nothing; the Map then carries `titleCaps` (the words that were capitalised) and `lower` (the words written in lower case) for prepare() to judge.
function words(text, isHeadline) {
  const t = norm(text).replace(/\bk[-\s]pop\b/g, "kpop").replace(/['’‘ʻ`]s\b/g, "").replace(/(\d)(?=(?:m|k|b|bn)\b)/g, "$1 ").replace(/['’‘ʻ`]/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d)\.(?=\d)/g, "$1");
  const form = w => { const a = norm(w).replace(/['’‘ʻ`]/g, ""); return ALIAS.get(a) ?? stem(a); };
  let names = null, titleCaps = null, lower = null;
  if (isHeadline) {
    const raw = String(text).split(/[^\p{L}\p{N}'’ʻ‘`]+/u).filter(Boolean), big = w => /^\p{Lu}/u.test(w);
    const long = raw.filter((w, i) => i > 0 && w.length >= 4 && !STOP.has(norm(w).replace(/['’‘ʻ`]/g, ""))); // the longer words after the first one
    const inside = raw.filter((w, i) => (i > 0 && big(w)) || (/^\p{Lu}{2,}$/u.test(w) && w.length <= 6)).map(form); // capitals inside the headline, and short all-capitals words
    lower = new Set(raw.filter(w => /^\p{Ll}/u.test(w)).map(form));
    if (long.length >= 2 && long.filter(w => !big(w)).length / long.length >= 0.25) names = new Set(inside); // sentence case: at least a quarter of those words are in lower case
    else titleCaps = new Set(inside);
  }
  const out = new Map();
  for (const w0 of t.split(/[^a-z0-9]+/)) {
    const isNum = /^\d+$/.test(w0);
    if (!w0 || (isNum ? w0.length < 2 || (w0.length === 4 && +w0 >= 2019 && +w0 <= 2030) : w0.length < 3)) continue; // a number needs two digits, a year is no evidence
    if (STOP.has(w0) || DOMAIN.has(w0)) continue;
    const w = ALIAS.get(w0) ?? stem(w0);
    if (STOP.has(w) || DOMAIN.has(w) || (!isNum && w.length < 3)) continue;
    out.set(w, isNum || !!names?.has(w));
  }
  out.titleCaps = titleCaps; out.lower = lower;
  return out;
}

// ---------------------------------------------------------------------------------------------- headline cleaning
// Labels such as "Candidate Q&A:" or a columnist's name that start many headlines over weeks are series names, not story words.
function seriesLabels(rows, o) {
  const seen = new Map();
  for (const r of rows) {
    const m = r.h.match(/^([^:|]{3,40}?)\s*:\s+\S/);
    if (!m || m[1].split(/\s+/).length > 5) continue;
    const k = nameKey(m[1]), e = seen.get(k) ?? { n: 0, lo: Infinity, hi: -Infinity };
    e.n++; e.lo = Math.min(e.lo, r.t); e.hi = Math.max(e.hi, r.t); seen.set(k, e);
  }
  const keep = new Set();
  for (const [k, e] of seen) if (e.n >= o.seriesMinCount && (e.hi - e.lo) / 864e5 >= o.seriesMinDays) keep.add(k);
  return keep;
}

// Removes outlet names, domain names, section names and label prefixes from a headline.
function cleanHeadline(h, ctx) {
  let s = String(h ?? "").replace(/\s+/g, " ").trim().replace(/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s*[–—:-]?\s+(?=\S)/, ""); // a press office's date in front ("8/14/26 - ...")
  for (let n = 0; n < 3; n++) { // "OPINION: ..." and "Update: ..." may be stacked
    const m = s.match(LABEL);
    if (m && s.length - m[0].length >= 8) { s = s.slice(m[0].length); continue; }
    const c = s.match(/^([^:]{3,40}?)\s*:\s+(\S.*)$/);
    if (c && ctx.series.has(nameKey(c[1])) && c[2].length >= 8) { s = c[2]; continue; }
    break;
  }
  const parts = s.split(/\s+(?:\||-|–|—|::)\s+/);
  if (parts.length > 1) {
    const isBoiler = p => { const k = nameKey(p); return !k || ctx.outlets.has(k) || SECTION.has(k) || /\.(?:com|org|net|gov|edu|co|io|news)\b/i.test(p) || /\(\.gov\)/i.test(p); };
    const kept = parts.filter(p => !isBoiler(p));
    if (kept.length && kept.length < parts.length) s = kept.join(" ");
  }
  return s;
}

// ---------------------------------------------------------------------------------------------- threads
const sha7 = s => createHash("sha1").update(s).digest("hex").slice(0, 7);
const DAY = 864e5;

// Reads the items worth looking at (oldest first), cleans their headlines and weighs their words; returns the rows and the two tests for "alike".
function prepare(items, o) {
  // 1. the items we look at: news-like kinds with a readable date and a headline, oldest first. The order of the input must not matter, so ties are
  // settled by id (and, for an id that occurs twice, by text); an id counts once.
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0), seenIds = new Set(), all = [];
  for (const x of items ?? []) {
    if (!x || !THREAD_KINDS.has(x.k) || typeof x.h !== "string" || x.id == null) continue;
    const t = Date.parse(x.d);
    if (Number.isFinite(t)) all.push({ id: String(x.id), t, h: x.h, s: String(x.s ?? ""), m: typeof x.m === "string" ? x.m : "", ph: x.ph, u: x.u });
  }
  all.sort((a, b) => a.t - b.t || cmp(a.id, b.id) || cmp(a.h, b.h) || cmp(a.s, b.s));
  const rows = all.filter(r => !seenIds.has(r.id) && seenIds.add(r.id));
  const N = rows.length;

  // 2. outlets, cleaned headlines, words
  const outletOf = outletResolver(rows);
  const outlets = new Set(rows.flatMap(r => [nameKey(r.s), nameKey(r.ph ?? ""), nameKey(String(r.ph ?? "").replace(/\.[a-z.]+$/, ""))]).filter(k => k.length >= 3));
  const ctx = { outlets, series: seriesLabels(rows, o) };
  for (const r of rows) {
    r.o = outletOf(r); r.c = cleanHeadline(r.h, ctx); r.w = words(r.c, true);
    // The words of an outlet's own name (and its initials, "TAAF"): a group that speaks about itself puts its name in the headline, which says nothing about the story.
    const nm = nameKey(r.s).split(" ").filter(Boolean), ini = n => n.map(x => x[0]).join("");
    r.places = new Set(norm(r.c).replace(/['’‘ʻ`]s\b/g, "").replace(/['’‘ʻ`]/g, "").split(/[^a-z0-9]+/).map(w => PLACES.get(w)).filter(Boolean));
    r.own = new Set([...words(r.s, false).keys(), ini(nm), ini(nm.filter(x => x !== "the"))]);
  }
  // A word that is a name in the headlines written in sentence case (capitalised inside the headline) and is never written in lower case anywhere is
  // taken for a name in Title Case headlines too ("Queens", "Oakland"), where capitals alone say nothing.
  const lowerSeen = new Set(), nameSeen = new Set();
  for (const r of rows) { r.w.lower?.forEach(w => lowerSeen.add(w)); for (const [w, isName] of r.w) if (isName) nameSeen.add(w); }
  for (const r of rows) if (r.w.titleCaps) for (const w of r.w.titleCaps) if (r.w.has(w) && nameSeen.has(w) && !lowerSeen.has(w)) r.w.set(w, true);
  const df = new Map();
  for (const r of rows) for (const w of r.w.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const ubiq = Math.max(o.ubiquitousMin, o.ubiquitousShare * N), Neff = Math.max(N, o.idfFloorN);
  const weight = new Map();
  for (const [w, n] of df) weight.set(w, n >= ubiq ? 0 : Math.log((Neff + 1) / (n + 1)));
  for (const r of rows) { // drop the weightless words and give each remaining word its weight (names and numbers weigh a little more)
    let tot = 0;
    r.strong = new Set();
    for (const [w, strong] of [...r.w]) {
      const x = weight.get(w);
      if (!x) { r.w.delete(w); continue; }
      const v = x * (strong ? o.boost : 1);
      r.w.set(w, v); tot += v;
      if (strong) r.strong.add(w);
    }
    r.tot = tot;
  }

  // 3. how alike two items are: a number between 0 and 1 (the weighted Jaccard of the headlines), or null for "not alike"
  const sumWords = r => { if (r.sw === undefined) r.sw = r.m ? words(r.m, false) : new Map(); return r.sw; };
  const summariesAgree = (a, b) => {
    if (!a.m || !b.m) return false;
    const sa = sumWords(a), sb = sumWords(b);
    let k = 0; for (const w of sa.keys()) if (sb.has(w)) k++;
    return k >= o.summaryMinShared && k / (sa.size + sb.size - k) >= o.summaryMinJaccard;
  };
  // How many OTHER outlets, within the time window of `a`, have an item with all of these words: if many do, the words only name a topic (a typhoon, a
  // court ruling) and two items that share just them may be two different stories of that topic, so such a pair has to agree on more.
  const index = new Map();
  rows.forEach((r, i) => { for (const w of r.w.keys()) { let L = index.get(w); if (!L) index.set(w, L = []); L.push(i); } });
  const crowd = (a, b, common) => {
    let best = null; for (const w of common) { const L = index.get(w); if (!best || L.length < best.length) best = L; }
    let lo = 0, hi = best.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[best[mid]].t < a.t - o.windowDays * DAY) lo = mid + 1; else hi = mid; }
    const others = new Set();
    for (let p = lo; p < best.length && rows[best[p]].t <= a.t + o.windowDays * DAY; p++) { const r = rows[best[p]]; if (r.o !== a.o && r.o !== b.o && common.every(w => r.w.has(w))) others.add(r.o); }
    return others.size;
  };
  // Different names or numbers: each headline names things (people, places, counts) that the other lacks, and what they have in common among names
  // and numbers weighs less than that. "Man charged in hate crime in Queens" and "Man charged in hate crime in Oakland" share many words but not a story.
  const clash = (a, b) => {
    let common = 0, onlyA = 0, onlyB = 0;
    for (const w of a.strong) { if (b.w.has(w)) { if (b.strong.has(w)) common += Math.min(a.w.get(w), b.w.get(w)); } else if (!a.own.has(w)) onlyA += a.w.get(w); }
    for (const w of b.strong) if (!a.w.has(w) && !b.own.has(w)) onlyB += b.w.get(w);
    if (o.nameClash && a.places.size && b.places.size && ![...a.places].some(p => b.places.has(p))) return true; // Guam against Hawaii
    return o.nameClash && onlyA > 0 && onlyB > 0 && common < Math.min(onlyA, onlyB);
  };
  const alike = (a, b, common, shared) => {
    const nShared = common.length;
    if (a.w.size < o.minWords || b.w.size < o.minWords) return null; // a headline of two or three words says too little to call it the same story as another
    const jac = shared / (a.tot + b.tot - shared);
    let ok = o.tiers.some(([n, w, j]) => nShared >= n && shared >= w && jac >= j); // more shared words allow a lower Jaccard
    if (!ok) { const [n0, w0, j0] = o.tiers[0]; ok = nShared >= n0 && shared >= w0 && jac >= j0 - o.summaryHelp && summariesAgree(a, b); } // a near miss that the summaries back up
    return ok && !clash(a, b) && !(jac < o.crowdJaccard && crowd(a, b, common) >= o.crowdMin) ? jac : null;
  };
  const rareAlike = (a, b, common) => { // two shared names or numbers that are in only a handful of items, and little else in either headline
    for (const w of common) if (!(a.strong.has(w) && b.strong.has(w)) || df.get(w) > o.rareMaxDf) return null;
    let sh = 0; for (const w of common) sh += Math.min(a.w.get(w), b.w.get(w));
    const jac = sh / (a.tot + b.tot - sh);
    return jac >= o.rareMinJaccard && !clash(a, b) ? jac : null;
  };
  return { rows, N, df, alike, rareAlike, crowd };
}

// Shows how two items compare (for tuning and for a person checking a link); not used by the collector.
// explainer(items, opts) prepares once and returns a function (idA, idB) -> details.
export function explainer(items, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, P = prepare(items, o), byId = new Map(P.rows.map(r => [r.id, r]));
  return (idA, idB) => {
    const a = byId.get(idA), b = byId.get(idB);
    if (!a || !b) return null;
    const common = [...a.w.keys()].filter(w => b.w.has(w)), sh = common.reduce((t, w) => t + Math.min(a.w.get(w), b.w.get(w)), 0);
    const days = Math.abs(a.t - b.t) / DAY, differentOutlets = a.o !== b.o;
    const score = common.length >= o.minShared ? P.alike(a, b, common, sh) : common.length === o.rareShared ? P.rareAlike(a, b, common) : null;
    const lone = (x, y) => [...x.w.keys()].filter(w => !y.w.has(w)).map(w => ({ w, v: +x.w.get(w).toFixed(1), strong: x.strong.has(w), df: P.df.get(w) }));
    return { cleanA: a.c, cleanB: b.c, common, nShared: common.length, sharedWeight: +sh.toFixed(2), maxShared: Math.max(0, ...common.map(w => Math.min(a.w.get(w), b.w.get(w)))),
      jaccard: +(sh / (a.tot + b.tot - sh)).toFixed(3), crowd: common.length ? P.crowd(a, b, common) : 0, loneA: lone(a, b), loneB: lone(b, a), days: +days.toFixed(2), differentOutlets, alike: score !== null && differentOutlets && days <= o.windowDays, score };
  };
}
export const explainPair = (items, idA, idB, opts) => explainer(items, opts)(idA, idB);

export function assignThreads(items, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { rows, N, alike, rareAlike } = prepare(items, o);
  if (N < 2) return new Map();

  // 4. walk through the items oldest first; each joins the best thread it is alike to, or starts its own
  const post = new Map(); // inverted index: word -> the items (oldest first) that have it
  const root = new Int32Array(N), size = new Int32Array(N), first = new Int32Array(N); // root[i] = index of the earliest item of i's thread
  for (let i = 0; i < N; i++) { root[i] = i; size[i] = 1; first[i] = i; }
  const cand = new Map();
  for (let i = 0; i < N; i++) {
    const a = rows[i];
    cand.clear();
    for (const [w, v] of a.w) { // only items that share a word and lie inside the window are looked at
      const L = post.get(w);
      if (!L) continue;
      let lo = 0, hi = L.length; // binary search for the first posting inside the window
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[L[mid]].t < a.t - o.windowDays * DAY) lo = mid + 1; else hi = mid; }
      for (let p = lo; p < L.length; p++) {
        const j = L[p], b = rows[j];
        if (b.o === a.o) continue; // the same outlet is never evidence
        let c = cand.get(j); if (!c) cand.set(j, c = { n: 0, sh: 0, common: [] });
        c.n++; c.sh += Math.min(v, b.w.get(w));
        c.common.push(w);
      }
    }
    const groups = new Map(); // the items alike to this one, grouped by thread
    for (const [j, c] of cand) {
      const b = rows[j];
      const score = c.n >= o.minShared ? alike(a, b, c.common, c.sh) : c.n === o.rareShared ? rareAlike(a, b, c.common) : null;
      if (score === null) continue;
      const r = root[j];
      let g = groups.get(r); if (!g) groups.set(r, g = { n: 0, best: 0, hasFirst: false });
      g.n++; g.best = Math.max(g.best, score); if (j === first[r]) g.hasFirst = true;
    }
    let pick = -1, pickScore = -1;
    for (const [r, g] of groups) {
      if (size[r] >= o.maxSize || a.t - rows[first[r]].t > o.spanDays * DAY) continue;
      if (!g.hasFirst && g.n < 2) continue; // must be alike to the thread's first item or to two of its items
      const sc = g.best + 0.01 * g.n;
      if (sc > pickScore || (sc === pickScore && r < pick)) { pick = r; pickScore = sc; }
    }
    if (pick >= 0) { root[i] = pick; size[pick]++; }
    for (const w of a.w.keys()) { let L = post.get(w); if (!L) post.set(w, L = []); L.push(i); }
  }

  // 5. thread ids from the earliest item; only real threads (two or more outlets) are returned
  const members = new Map();
  for (let i = 0; i < N; i++) { const r = root[i]; let m = members.get(r); if (!m) members.set(r, m = []); m.push(i); }
  const result = new Map(), used = new Set();
  for (const r of [...members.keys()].sort((x, y) => x - y)) {
    const m = members.get(r);
    if (m.length < 2 || new Set(m.map(i => rows[i].o)).size < 2) continue;
    let id = sha7(rows[r].id), n = 0;
    while (used.has(id)) id = sha7(rows[r].id + ":" + ++n); // a clash between two threads is very unlikely; the later thread then takes the next id
    used.add(id);
    for (const i of m) result.set(rows[i].id, id);
  }
  return result;
}
