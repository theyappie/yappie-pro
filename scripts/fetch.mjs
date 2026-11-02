// The Yappie Pro — feed collector (Node 20+). Usage: node scripts/fetch.mjs
import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { makeTagger, TAXO_PATH } from "./tag.mjs";
import { makeEnglishCheck } from "./lang.mjs";
import { normalizeState, applyEdits, placeOf, withCustom, newsKindKeys, kindState, feedTaxo } from "./admin.mjs";

const CFG = process.env.SOURCES ?? fileURLToPath(new URL("../sources.json", import.meta.url));
const OUT = process.env.OUT ?? fileURLToPath(new URL("../data/feed.json", import.meta.url));
const cfg = JSON.parse(await readFile(CFG, "utf8"));
const BLOCK = new Set((cfg.excludeHosts ?? []).map(h => h.toLowerCase())); // sites that are never shown, with their subdomains, e.g. "medium.com"
const hostOf = v => { try { return new URL(String(v)).hostname.toLowerCase(); } catch { return ""; } };
// A site on a country domain outside the U.S. (.ca, .ch, .uz, .co.uk, .com.au, ...) is never shown. The U.S. and its territories (.us .gu .as .mp .vi .pr .um) count as U.S.; "allowHosts" lists exceptions.
const US_TLDS = new Set(["us", "gu", "as", "mp", "vi", "pr", "um"]), ALLOW = (cfg.allowHosts ?? []).map(h => h.toLowerCase());
const hostForeign = h => {
  h = String(h ?? "").toLowerCase().replace(/\.$/, "");
  if (!h || cfg.blockForeignDomains === false || ALLOW.some(d => h === d || h.endsWith("." + d))) return false;
  const tld = h.split(".").pop();
  return /^[a-z]{2}$/.test(tld) ? !US_TLDS.has(tld) : tld.startsWith("xn--");
};
const hostBlocked = h => !!h && ([...BLOCK].some(d => h === d || h.endsWith("." + d)) || hostForeign(h));
// Google News gives a publisher's name, not its address, so names are matched too: the ones in "excludeNames" and each blocked site's own name ("hoodline.com" also blocks a publisher called "Hoodline").
const normName = v => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); // letters and digits in any script, so a publisher named in Arabic or Korean can be blocked too
const noTld = v => String(v ?? "").trim().replace(/\.(com|org|net|co|ca|vn|in|io|info|tv|us)$/i, "");
const BLOCK_NAMES = new Set([...(cfg.excludeNames ?? []), ...BLOCK].flatMap(n => [normName(n), normName(noTld(n))]).filter(Boolean));
// A publisher shown by name only (Google News) is matched to its web address too: each Google story carries it ("ph"), and stored stories learn it from the same publisher's other stories.
const PUB_HOSTS = new Map();
const pubHosts = o => o.ph ? [o.ph] : PUB_HOSTS.get(normName(o.s)) ?? [];
const learnHost = (name, host) => { const k = normName(name), a = PUB_HOSTS.get(k) ?? []; if (k && host && !a.includes(host)) PUB_HOSTS.set(k, [...a, host]); };
const learnHosts = list => { for (const o of list) if (o.ph && o.s) learnHost(o.s, o.ph); };
const nameForeign = n => { const t = String(n ?? "").trim().toLowerCase(); return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) && hostForeign(t); }; // a publisher named by its web address, e.g. "UzDaily.uz"
const nameBlocked = n => [normName(n), normName(noTld(n))].some(k => k && BLOCK_NAMES.has(k)) || nameForeign(n);
const pubBlocked = o => { const a = pubHosts(o); return a.length > 0 && a.every(h => hostBlocked(h)); };
const blocked = o => hostBlocked(hostOf(o.u)) || pubBlocked(o) || nameBlocked(o.s);
const KEEP_MS = (cfg.keepDays ?? 30) * 864e5, MAX = cfg.maxItems ?? 400;
// A source can keep its stories longer than everyone else with its own "keepDays" (a research center publishes a few reports a year). Research stories are counted apart from the news cap ("researchMax"), so a busy news week never pushes a report out.
const KEEP_BY = new Map(cfg.sources.filter(x => x.keepDays).map(x => [normName(x.asName ?? x.name), x.keepDays * 864e5]));
// "keepSince": "YYYY-MM-DD" keeps every story a source published on or after that day (UTC) however old it gets, and those stories do not count against the news cap ("maxItems"). Stories before that day follow the usual rule.
const SINCE = new Map(cfg.sources.filter(x => x.keepSince).map(x => [normName(x.asName ?? x.name), Date.parse(x.keepSince + "T00:00:00Z")]).filter(([, t]) => !isNaN(t)));
const keepOf = o => { const n = normName(o.s), base = KEEP_BY.get(n) ?? KEEP_MS, since = SINCE.get(n); return since ? Math.max(base, Date.now() - since) : base; };
const held = o => { const t = SINCE.get(normName(o.s)); return t !== undefined && Date.parse(o.d) >= t; };
const RES_MAX = cfg.researchMax ?? 150;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

// Relevance filter for general-interest outlets (sources with "filter": true)
// "aanhpi" stays in this pattern only so that official documents and outlets that use that spelling are still recognised; nothing shows or searches for it.
const AAPI = /\b(asian[- ]americans?|aapi|aanhpi|nhpi|pacific islanders?|native hawaiians?|hawai\S*|guam|chamorro|samoa\w*|micronesia\w*|marshallese|cofa|palau|tongan|fijian|filipino|chinese americans?|korean americans?|japanese americans?|hmong|cambodian|laotian|south asian|indian americans?|sikh|stop aapi hate|anti-asian|chinatown|little tokyo|koreatown|japantown|little saigon|manilatown|nisei|sansei|yonsei|issei|nikkei|jacl|manzanar|tule lake|heart mountain)\b/i;

// Tags (topic, communities, states, bills) come from taxonomy.json, which the page and the PHP collector read too.
// The owner's decisions from the admin dashboard (admin.json: edits, deleted and approved items, items added by hand, topics, communities and News categories of their own; see scripts/admin.mjs) and the items waiting for approval (pending.json).
// They are private, so on the real site they live in a separate private repository that the update job checks out; ADMIN_DIR is that folder. Without ADMIN_DIR they sit next to feed.json (for a local run).
// They are read first because the owner's own topics and communities are part of the tagger.
const ADMIN_DIR = process.env.ADMIN_DIR || dirname(OUT);
if (process.env.ADMIN_DIR && !(await stat(ADMIN_DIR).then(x => x.isDirectory(), () => false))) { console.error(`ADMIN_DIR (${ADMIN_DIR}) is not a folder; stopping so the owner's decisions are not skipped.`); process.exit(1); }
let A = normalizeState(null), oldPending = [];
try { A = normalizeState(JSON.parse(await readFile(join(ADMIN_DIR, "admin.json"), "utf8"))); }
catch (e) { if (e.code !== "ENOENT") { console.error("admin.json cannot be read (" + e.message + "); keeping the previous data so the owner's decisions are not lost."); process.exit(1); } } // no file: no decisions yet
try { oldPending = JSON.parse(await readFile(join(ADMIN_DIR, "pending.json"), "utf8")).items ?? []; } catch { /* nothing waiting */ }
const TAXO_BASE = JSON.parse(await readFile(TAXO_PATH, "utf8")), TAXO = withCustom(TAXO_BASE, A.settings); // TAXO: taxonomy.json plus the owner's own topics (with their keywords), communities and categories
const TG = makeTagger(TAXO);
const isEnglish = makeEnglishCheck(TAXO_BASE); // English-language stories only
const CUSTOM_TOPICS = new Set(A.settings.topics.map(t => t.k)), CUSTOM_CM = new Set(A.settings.communities.map(c => c.k)), VALID_CM = new Set(TAXO.communities.map(c => c.k));
// Policy tracker: only .gov sources. An item either names AAPI communities ("n") or touches a related issue ("i").
const POLICY = TG.policyKinds, ISSUE = TG.issue, isPolicy = k => POLICY.has(k);
const isGov = u => /(^|\.)gov$/.test(hostOf(u));
const relOf = s => AAPI.test(s) ? "n" : ISSUE.test(s) ? "i" : "";
const GOV_UA = { "user-agent": "TheYappiePro/1.0 (open-source policy index)", accept: "application/json" };

// One free api.data.gov key serves Congress.gov, GovInfo and Regulations.gov. Each allows about 1,000 or more requests an hour per key, the response headers say how many are left,
// and this job runs about every 10 minutes (up to 6 runs an hour). A run therefore makes at most apiBudget.perRun key requests and stops early when a host reports that less than apiBudget.keepFraction of its hourly allowance is left.
const API_KEY = process.env.API_DATA_GOV_KEY || process.env.CONGRESS_API_KEY || "";
const NO_KEY = "skipped: no API key set (API_DATA_GOV_KEY)";
const LIM = { left: cfg.apiBudget?.perRun ?? 150, keep: cfg.apiBudget?.keepFraction ?? 0.25, hosts: new Map(), stopped: "" };
const canAsk = url => {
  const h = LIM.hosts.get(hostOf(url));
  if (LIM.left <= 0) LIM.stopped ||= "stopped early: this run's request budget is used up";
  else if (h && h.remaining < h.limit * LIM.keep) LIM.stopped ||= `stopped early: ${hostOf(url)} reports ${h.remaining} of ${h.limit} requests left this hour`;
  return !LIM.stopped;
};
async function keyed(url, init = {}) { // the key travels in a header, and neither the URL nor the key is ever printed
  LIM.left--;
  const res = await fetch(url, { ...init, headers: { ...GOV_UA, ...(init.headers ?? {}), "x-api-key": API_KEY }, signal: AbortSignal.timeout(30000) });
  const limit = Number(res.headers.get("x-ratelimit-limit")), remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (limit > 0 && Number.isFinite(remaining)) LIM.hosts.set(hostOf(url), { limit, remaining });
  if (res.status === 429) { LIM.left = 0; LIM.stopped ||= "stopped early: rate limited (HTTP 429)"; throw new Error("rate limited (HTTP 429)"); }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
const FR_DOCS = new Set(); // Federal Register document numbers already listed, so Regulations.gov does not list them twice
const skippedLang = [];
const classify = s => TG.topic(s);
const VALID = TG.valid;
const kindOf = name => cfg.kinds?.[name] ?? "news";
// Stories must affect Asian American, Native Hawaiian and/or Pacific Islander communities in the U.S.
// Items about events abroad (places below) with no U.S.-community term are skipped; skipped headlines are logged.
const ABROAD = /\b(japan\w*|korea\w*|china|taiwan\w*|india|philippines|vietnam\w*|okinawa|beijing|tokyo|seoul|asean|thailand|indonesia|malaysia|myanmar|pakistan|bangladesh|nepal|sri lanka|hong kong|singapore|cambodia)\b/i;
const abroadOnly = s => ABROAD.test(s) && !AAPI.test(s) && !COMMUNITY.test(s); // COMMUNITY (below) also knows "Vietnamese Americans", "Taiwanese Americans" and the other community names that contain a place name
// Statements come from U.S. AAPI advocacy organizations, so a statement about a place abroad (for example deportations to Cambodia) is still about U.S. communities and is kept.
const isOrg = k => k === "statement";
const skipped = [];
// Where a story belongs. A story that links to a .gov address moves from News to the Policy page. "routes" in sources.json send a named site or publisher to another page (Asian Law Caucus to Advocacy).
const govHost = h => /(^|\.)gov$/.test(h ?? "");
const govItem = o => govHost(hostOf(o.u)) || pubHosts(o).some(govHost);
const NEWS_KINDS = newsKindKeys(A.settings), KIND_OFF = kindState(A.settings).redirect; // the News page's categories in use: AAPI Media ("community"), Mainstream ("news") unless the owner removed them, and the owner's own. KIND_OFF: a removed one -> the category its sources go to
const BASE_KINDS = new Set(Object.keys(TAXO_BASE.kinds ?? {}));
const SRC_KIND = new Map(Object.entries(A.settings.sourceKinds).filter(([, k]) => NEWS_KINDS.has(k)).map(([n, k]) => [normName(n), k])); // the owner's choice of category for a source (dashboard)
// The category of a News story follows its source: the owner's choice if there is one, otherwise sources.json ("kinds"). Statements, Research and the Policy kinds are not News categories and stay as they are.
const EXPLICIT = new Map(cfg.sources.filter(x => x.kind).flatMap(x => [x.name, x.asName].filter(Boolean).map(n => [normName(n), x.kind]))); // a source typed in sources.json ("kind") keeps that type
const withSourceKind = o => {
  const inNews = NEWS_KINDS.has(o.k) || KIND_OFF.has(o.k), isNews = k => NEWS_KINDS.has(k) || KIND_OFF.has(k);
  if (!inNews && BASE_KINDS.has(o.k)) return o;
  const base = EXPLICIT.get(normName(o.s)) ?? kindOf(o.s), pick = SRC_KIND.get(normName(o.s)) ?? (isNews(base) ? base : inNews ? o.k : "news"); // a category the owner has since removed falls back to the source's usual one
  const want = KIND_OFF.get(pick) ?? pick; // a built-in category the owner removed: its sources go to the category they chose
  return want === o.k ? o : { ...o, k: want };
};
const inList = (h, list) => !!h && list.some(d => h === d || h.endsWith("." + d));
const ROUTES = (cfg.routes ?? []).map(r => { const hosts = (r.hosts ?? []).map(h => h.toLowerCase()); return { kind: r.kind, hosts, names: new Set([...(r.names ?? []), ...hosts].flatMap(n => [normName(n), normName(noTld(n))]).filter(Boolean)) }; });
const routeOf = o => ROUTES.find(r => inList(hostOf(o.u), r.hosts) || pubHosts(o).some(h => inList(h, r.hosts)) || r.names.has(normName(o.s)) || r.names.has(normName(noTld(o.s))))?.kind;
const reroute = o => {
  const rk = routeOf(o);
  if (rk) return rk === o.k ? o : { ...o, k: rk };
  return NEWS_KINDS.has(o.k) && govItem(o) ? { ...o, k: "govstmt", rl: o.rl || relOf(o.h + " " + (o.m ?? "")) || "n" } : o;
};
// A story that Google News found with a broad search can share only a word with the communities (a Guam soccer score, a stock ticker), so it is shown only when its headline names the communities (communityPattern) or its publisher is trusted: every source above plus "trustedOutlets".
const COMMUNITY = new RegExp(cfg.communityPattern ?? AAPI.source, "i");
const TRUSTED = new Set([...cfg.sources.filter(x => !(x.google && !/site(:|%3A)/i.test(x.feed ?? ""))).flatMap(x => [x.name, x.asName]), ...(cfg.trustedOutlets ?? [])].map(normName).filter(Boolean));
// A site that is allowed back through allowHosts but only for some of its stories ("gatedHosts"): its story is kept when it matches "require" (or names the communities, with "community": true) and does not match "deny" (rnz.co.nz: Pacific Islander stories, no sports; independent.co.uk: stories about the communities).
// The site is matched by its address, by the address Google News reports for its publisher, or by its name. A story that passes its gate skips the headline test below, because the gate is stricter.
const GATES = (cfg.gatedHosts ?? []).map(g => { const hosts = (g.hosts ?? []).map(h => h.toLowerCase()); return { hosts, names: new Set([...(g.names ?? []), ...hosts].flatMap(n => [normName(n), normName(noTld(n))]).filter(Boolean)), require: g.require ? new RegExp(g.require, "i") : null, community: !!g.community, deny: g.deny ? new RegExp(g.deny, "i") : null }; });
const gateOf = o => GATES.find(g => inList(hostOf(o.u), g.hosts) || pubHosts(o).some(h => inList(h, g.hosts)) || g.names.has(normName(o.s)) || g.names.has(normName(noTld(o.s))));
// A gate lets a story through when it matches "require" or, if the gate sets "community": true, when it names the communities (communityPattern); a gate with neither lets every story through. "deny" always drops.
const gateFails = o => { const g = gateOf(o); if (!g) return false; const t = o.h + " " + (o.m ?? ""); const pass = (!g.require && !g.community) || (g.require && g.require.test(t)) || (g.community && COMMUNITY.test(t)); return !pass || !!(g.deny && g.deny.test(t)); };
const offTopic = o => !isPolicy(o.k) && !isOrg(o.k) && hostOf(o.u) === "news.google.com" && !TRUSTED.has(normName(o.s)) && !gateOf(o) && !COMMUNITY.test(o.h + " " + (o.m ?? ""));

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const tx = n => (typeof n === "string" || typeof n === "number") ? String(n) : (n?.["#text"] ?? "");
const clean = s => tx(s).replace(/<[^>]*>/g, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENT[n]).replace(/\s+/g, " ").trim();
// Show only a publisher-written dek/excerpt from the feed. Never generated or rewritten.
// Auto-trimmed body excerpts ("… [...]", "appeared first on") and long text are dropped.
const dek = (s, title) => {
  let c = clean(s);
  // WordPress feeds add "The post <title> appeared first on <site>." after the excerpt; that footer is removed and the excerpt in front of it is kept.
  const f = c.search(/appeared first on/i);
  if (f > 0) { const j = c.lastIndexOf("The post ", f); if (j >= 0) c = c.slice(0, j).trim(); }
  if (c.length < 25 || c.length > 280) return "";
  if (/(…|\.\.\.)\s*\]?\s*$/.test(c) || /appeared first on/i.test(c)) return "";
  if (c.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) return "";
  return c;
};
const safeUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const linkOf = it => {
  const l = it.link;
  if (Array.isArray(l)) { const a = l.find(x => x["@_rel"] === "alternate") ?? l[0]; return a?.["@_href"] ?? tx(a); }
  return typeof l === "string" ? l : (l?.["@_href"] ?? tx(l));
};

// Full text is kept only for sources marked "fullText": true in sources.json (use it for content you own or have rights to).
const cleanBody = html => String(html).replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1>/gi, "")
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "").trim().slice(0, 80000);
const heroOf = (it, body) => {
  const pick = n => Array.isArray(n) ? n[0] : n;
  const u = pick(it["media:content"])?.["@_url"] ?? pick(it["media:thumbnail"])?.["@_url"] ?? pick(it.enclosure)?.["@_url"] ?? /<img[^>]+src=["']([^"']+)["']/i.exec(body)?.[1];
  const s = safeUrl(u ?? "");
  return s.startsWith("https://") ? s : "";
};

// A WordPress feed repeats the featured image at the top of the body, often as another size of the same file (photo-1024x683.jpg and photo-scaled.jpg).
// The reader already shows the lead photo above the story, so a copy at the top of the body is removed. A different photo is a real figure and stays.
const photoKey = u => { try { return new URL(u).pathname.toLowerCase().replace(/-(?:\d+x\d+|scaled|rotated)(?=\.\w+$)/, ""); } catch { return ""; } };
const LEAD = /^\s*(<figure\b[^>]*>[\s\S]*?<\/figure>|<p\b[^>]*>\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*>\s*(?:<\/a>\s*)?<\/p>|<img\b[^>]*>)\s*(?:<br\s*\/?>\s*)*/i;
const dropLeadPhoto = (body, hero) => {
  const m = LEAD.exec(body ?? "");
  const img = m && /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(m[1]);
  if (!img) return body;
  if (hero && photoKey(safeUrl(img[1])) !== photoKey(hero)) return body;
  const cap = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(m[1]);
  return (cap && clean(cap[1]) ? m[1].replace(img[0], "") : "") + body.slice(m[0].length);
};

// WordPress adds "The post <title> appeared first on <site>." as the last paragraph of a feed's full text. It is not part of the story, so it is removed.
// Only the final paragraph is touched; a sentence that happens to start with "The post" earlier in the story stays.
const dropFooter = body => String(body ?? "").replace(/\s*<p\b[^>]*>\s*(?:<(?:em|i|strong|b|span)\b[^>]*>\s*)*The post\b(?:(?!<\/p>)[\s\S])*?\bappeared first on\b(?:(?!<\/p>)[\s\S])*?<\/p>\s*$/i, "");
const tidyBody = (body, hero) => dropFooter(dropLeadPhoto(body, hero));

async function getText(url, accept) {
  const res = await fetch(url, { headers: { "user-agent": "TheYappiePro/1.0 (open-source news index)", ...(accept ? { accept } : {}) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}
// The author of a full-text story (The Yappie) links to the author's page on the publisher's own site, e.g. theyappie.com/author/shawnachen/. The address cannot be worked out from the name, so it is read from the story's own page:
// the link to /author/<name>/ on the story's site whose text is the author's name (or the only author link on the page). Returns the address, "" when the page names no author page, undefined when the page could not be read (tried again next run).
async function authorPage(storyUrl, name) {
  let html, origin; try { origin = new URL(storyUrl).origin; html = await getText(storyUrl, "text/html"); } catch { return undefined; }
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1].replace(/&amp;/g, "&"), origin); } catch { continue; }
    if (u.origin !== origin || !/^\/author\/[^/]+\/?$/.test(u.pathname)) continue;
    links.push({ href: u.origin + u.pathname.replace(/\/?$/, "/"), text: clean(m[2]).replace(/^by\s+/i, "").toLowerCase() });
  }
  const want = String(name).trim().toLowerCase(), named = links.find(l => l.text === want), pages = [...new Set(links.map(l => l.href))];
  return (named ?? (pages.length === 1 ? { href: pages[0] } : null))?.href ?? "";
}
// A source is read one of four ways: an RSS/Atom "feed", a WordPress REST list ("wp"), the organization's own listing page ("page" plus a "link" pattern for its story links), or a listing page whose stories are JSON in a <script> tag ("page" plus "embedded").
// All three produce the same kind of record, so the filtering and tagging below is shared.
const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DATE_RE = new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2}),?\\s+(20\\d\\d)\\b`, "i");
function pageRecords(html, src) {
  const want = new RegExp(src.link), hits = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
    let u; try { u = new URL(String(href).replace(/&amp;/g, "&"), src.page); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !want.test(u.pathname)) continue;
    if (src.attr && !new RegExp(src.attr).test(m[1])) continue; // "attr": only links whose own attributes match, to read one block of a busy page (HuffPost: the section's own list, not its "More from HuffPost" ad module)
    u.search = ""; u.hash = "";
    hits.push({ href: u.href, inner: m[2], at: m.index, end: m.index + m[0].length });
  }
  const keepMs = (isPolicy(src.kind) ? (cfg.policyKeepDays ?? 120) : (cfg.keepDays ?? 30)) * 864e5, found = new Map();
  hits.forEach((h, i) => {
    // The title is inside the link. The date is inside it too, or just after it and before the next story link.
    const after = html.slice(h.end, Math.min(h.end + 800, hits[i + 1]?.at ?? Infinity));
    const title = clean(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(h.inner)?.[1] ?? /<(div|span|p|strong)\b[^>]*class=["'][^"']*(?:title|heading)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(h.inner)?.[2] ?? h.inner).replace(/\s*[↗→»›]+\s*$/, "");
    let d = new Date(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i.exec(h.inner + after)?.[1] ?? "");
    if (isNaN(d)) for (const where of [h.inner, after]) { const x = DATE_RE.exec(clean(where)); if (x) { d = new Date(`${x[1].slice(0, 3)} ${x[2]}, ${x[3]} 12:00:00 UTC`); break; } }
    // some listings show no dates at all; "idDate" names the part of the link that is a Mongo-style id (HuffPost: ..._n_<24 hex>), whose first 8 hex digits are the creation time in epoch seconds
    if (isNaN(d) && src.idDate) { const x = new RegExp(src.idDate).exec(h.href); if (x) d = new Date(parseInt(x[1].slice(0, 8), 16) * 1e3); }
    const dk = [...h.inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(x => clean(x[1])).find(x => x.length >= 25) ?? ""; // the publisher's own summary, only when it sits inside the link
    // menus link to the same pages without a date, so a link counts once it has a title and a date
    if (title && !isNaN(d) && !found.has(h.href)) found.set(h.href, { title, d, dek: dk });
  });
  return [...found].filter(([, r]) => Date.now() - r.d < keepMs).sort((a, b) => b[1].d - a[1].d).slice(0, 60)
    .map(([link, r]) => ({ title: r.title, link, description: r.dek, pubDate: r.d.toISOString() }));
}
// Some listing pages (Next.js sites such as scmp.com) ship their stories as JSON inside a <script> tag instead of as links in the HTML.
// "embedded" names the three fields to read ({ "title": ..., "link": ..., "date": ... }); any object that has all three is a story. Dates may be ISO text or epoch seconds/milliseconds.
function embeddedRecords(html, src) {
  const e = src.embedded, found = new Map(), keepMs = (cfg.keepDays ?? 30) * 864e5;
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (typeof o[e.title] === "string" && typeof o[e.link] === "string" && o[e.date] != null && o[e.date] !== "") {
      let u; try { u = new URL(o[e.link], src.page); } catch { u = null; }
      const n = Number(o[e.date]), d = Number.isNaN(n) ? new Date(o[e.date]) : new Date(n > 1e11 ? n : n * 1e3), title = clean(o[e.title]);
      if (u && /^https?:$/.test(u.protocol) && title && !isNaN(d)) { u.search = ""; u.hash = ""; if (!found.has(u.href)) found.set(u.href, { title, d }); }
    }
    Object.values(o).forEach(walk);
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/json/i.test(m[1]) && !/__NEXT_DATA__/.test(m[1])) continue;
    try { walk(JSON.parse(m[2])); } catch { /* not the data we want */ }
  }
  return [...found].filter(([, r]) => Date.now() - r.d < keepMs && r.d - Date.now() < 864e5).sort((a, b) => b[1].d - a[1].d).slice(0, 60)
    .map(([link, r]) => ({ title: r.title, link, description: "", pubDate: r.d.toISOString() }));
}
const pageText = new Map(); // two sources can read the same listing (CAPAC is in News and in Policy), so it is fetched once per run
async function records(src) {
  if (src.wp) {
    let j; try { j = JSON.parse(await getText(src.wp, "application/json")); } catch (e) { throw e instanceof SyntaxError ? new Error("Not valid JSON") : e; }
    if (!Array.isArray(j)) throw new Error("Unexpected WordPress response");
    return j.map(p => ({ title: p.title?.rendered ?? "", link: p.link, description: p.excerpt?.rendered ?? "", pubDate: p.date_gmt ? p.date_gmt + "Z" : p.date }));
  }
  if (src.page) {
    if (!pageText.has(src.page)) pageText.set(src.page, getText(src.page, "text/html"));
    return src.embedded ? embeddedRecords(await pageText.get(src.page), src) : pageRecords(await pageText.get(src.page), src);
  }
  let list = await feedItems(src.feed), last = list;
  // "pages": a WordPress feed lists 10 stories a page (feed/?paged=2). The next pages are read, up to this many in all, until a page reaches back past the days the source's stories are kept (a story that is new always sits on page 1).
  const floor = Date.now() - keepOf({ s: src.asName ?? src.name });
  for (let p = 2; p <= (src.pages ?? 1) && last.length; p++) {
    if (Math.min(...last.map(it => dateOf(it).getTime()).filter(t => !isNaN(t))) < floor) break;
    const u = new URL(src.feed); u.searchParams.set("paged", p);
    try { last = await feedItems(u.href); } catch { break; } // past the last page, or a page that cannot be read: the pages read so far are used
    list = list.concat(last);
  }
  const seenLink = new Set();
  return list.filter(it => { const l = linkOf(it); if (seenLink.has(l)) return false; seenLink.add(l); return true; }); // a story published while the pages were read can appear on two of them
}
async function feedItems(url) {
  const x = parser.parse(await getText(url));
  if (!x.rss && !x.feed && !x["rdf:RDF"]) throw new Error("Not a feed");
  const raw = x.rss?.channel?.item ?? x.feed?.entry ?? x["rdf:RDF"]?.item ?? [];
  return Array.isArray(raw) ? raw : [raw];
}
const dateOf = it => new Date(tx(it.pubDate ?? it.published ?? it.updated ?? it["dc:date"]));
// "excludeCategories" on a source drops its stories that carry one of those categories (an RSS <category>, matched without regard to case). The stored copy of such a story, if an earlier run kept it, is dropped too.
const catsOf = it => [it.category].flat().filter(c => c != null).map(c => normName(tx(c) || c?.["@_term"] || c?.["@_label"])).filter(Boolean);
const skippedCat = [], catDropIds = new Set();
const idOf = (kind, u) => createHash("sha1").update(isOrg(kind) && isGov(u) ? "statement:" + u : u).digest("hex").slice(0, 12);

async function pull(src) {
  const caseRe = src.skipTitle ? new RegExp(src.skipTitle, "i") : null;
  const onTopic = src.match ? new RegExp(src.match, "i") : AAPI; // "match": the source's own relevance pattern, used with "filter" in place of the general one (Pew writes "Asians", not "AAPI")
  const out = [], exCat = new Set((src.excludeCategories ?? []).map(normName));
  for (const it of await records(src)) {
    let h = clean(it.title), s = src.name, pubName = "";
    if (src.google) {
      const pub = clean(it.source);
      if (pub) { pubName = pub; s = pub; if (h.endsWith(" - " + pub)) h = h.slice(0, -(pub.length + 3)); }
      if (src.asName) s = src.asName; // e.g. show Google News results from nbcnews.com as "NBC Asian America"
    }
    const u = safeUrl(linkOf(it)), ph = src.google ? hostOf(it.source?.["@_url"] ?? "").replace(/^www\./, "") : "";
    if (ph) learnHost(s, ph); // learned before the block check, so a stored story from a blocked publisher can be recognised later
    if (hostBlocked(hostOf(u)) || hostBlocked(ph) || nameBlocked(pubName)) continue;
    if (exCat.size && catsOf(it).some(c => exCat.has(c))) { if (u) catDropIds.add(idOf(src.kind, u)); skippedCat.push(s + ": " + h); continue; }
    const raw = src.google ? "" : clean(it.description ?? it.summary ?? it["content:encoded"]).slice(0, 300); // used only for filtering/tagging
    const m = src.google ? "" : dek(it.description ?? it.summary, h);
    const gov = isPolicy(src.kind), rl = gov ? (relOf(h + " " + raw) || (src.filter ? "" : "n")) : "";
    if (!gov && caseRe && caseRe.test(h)) continue; // on a news source skipTitle drops pages that are not stories (an author page or an archive index that a search returns)
    if (!h || !u || (gov && (!isGov(u) || !rl)) || (!gov && src.filter && !onTopic.test(h + " " + raw))) continue;
    if (gov && rl === "i" && caseRe && caseRe.test(h)) continue; // individual court cases are not policy; releases that name the communities stay
    if (!isEnglish(h + " " + raw)) { skippedLang.push(s + ": " + h); continue; }
    if (!isOrg(src.kind) && abroadOnly(h + " " + raw)) { skipped.push(s + ": " + h); continue; }
    let d = dateOf(it);
    if (isNaN(d) || d > Date.now() + 864e5) d = new Date();
    const full = src.fullText ? cleanBody(tx(it["content:encoded"] ?? it.content)) : "";
    // a .gov statement can also be in the Policy tracker, so it gets an id of its own here
    const item = { id: idOf(src.kind, u), d: d.toISOString(), s, h, m, u, g: src.google ? 1 : 0, ...(ph ? { ph } : {}), k: src.kind ?? kindOf(s), ...(rl ? { rl } : {}), ...TG.all(h, raw + " " + clean(full).slice(0, 4000), d, gov ? "GOVERNMENT" : undefined) };
    if (full) { const img = heroOf(it, full); item.v = 1; item.art = { by: clean(it["dc:creator"] ?? it.author?.name), img, body: tidyBody(full, img) }; }
    out.push(item);
  }
  return out;
}

const sentences = (abs, max = 280) => { const sents = abs.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [abs]; let m = ""; for (const t of sents) { if ((m + t).trim().length > max) break; m = (m + t).trim() + " "; } return m.trim(); };
const FRFIELDS = ["title", "abstract", "type", "subtype", "html_url", "publication_date", "signing_date", "executive_order_number", "comments_close_on", "agency_names", "document_number"];
async function frGet(api, params) {
  const q = new URLSearchParams(params);
  for (const t of params._types ?? []) q.append("conditions[type][]", t);
  q.delete("_types");
  for (const f of FRFIELDS) q.append("fields[]", f);
  const res = await fetch((api ?? "https://www.federalregister.gov/api/v1/documents.json") + "?" + q, { headers: GOV_UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return (await res.json()).results ?? [];
}
// Federal Register (free API, no key). Rules and notices: documents that name AAPI communities, plus rules that touch a related issue and are still open for comment.
// The API has no filter on the comment deadline, so that check is made here.
async function pullFR(fr) {
  const since = new Date(Date.now() - (fr.days ?? 45) * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const skip = fr.skipTitle ? new RegExp(fr.skipTitle, "i") : null, out = new Map();
  const passes = [...(fr.terms ?? []).map(t => [t, "n"]), ...(fr.issueTerms ?? []).map(t => [t, "i"])];
  for (const [term, via] of passes) {
    const params = { per_page: String(fr.perTerm ?? 40), order: "newest", "conditions[term]": term, "conditions[publication_date][gte]": since };
    if (via === "i") params._types = ["RULE", "PRORULE"];
    const rows = [];
    for (let page = 1, kept = 0; page <= (fr.pages ?? 4); page++) { // boilerplate notices (skipTitle) must not use up the per-term allowance
      const got = await frGet(fr.api, { ...params, page: String(page) });
      rows.push(...got); kept += got.filter(r => !(skip && skip.test(clean(r.title)))).length;
      if (got.length < (fr.perTerm ?? 40) || kept >= (fr.perTerm ?? 40)) break;
    }
    for (const r of rows) {
      const h = clean(r.title), u = safeUrl(r.html_url), abs = clean(r.abstract), ag = (r.agency_names ?? []).slice(0, 2).join(" / ");
      const dl = /^\d{4}-\d\d-\d\d$/.test(r.comments_close_on ?? "") ? r.comments_close_on : "";
      const rl = AAPI.test(h + " " + abs) ? "n" : (via === "i" && dl >= today && ISSUE.test(h + " " + abs + " " + ag)) ? "i" : "";
      if (!h || !u || !isGov(u) || out.has(u) || (skip && skip.test(h)) || !rl) continue;
      const d = new Date((r.publication_date ?? "") + "T12:00:00Z");
      if (r.document_number) FR_DOCS.add(r.document_number);
      out.set(u, { id: createHash("sha1").update(u).digest("hex").slice(0, 12), d: isNaN(d) ? new Date().toISOString() : d.toISOString(), s: "Federal Register", h, m: sentences(abs), u, g: 0, k: "official", ty: r.type ?? "", ag, rl, ...(dl ? { dl } : {}), ...TG.all(h, abs, d, "GOVERNMENT") });
    }
  }
  return [...out.values()];
}

// Executive actions: executive orders, proclamations and memoranda from the Federal Register's presidential documents.
// A document found through an AAPI term is marked "n" (names communities); one found only through an issue term is "i" (related issue).
async function pullExec(ex) {
  const since = new Date(Date.now() - (ex.days ?? 120) * 864e5).toISOString().slice(0, 10), out = new Map(), skipI = ex.skipTitle ? new RegExp(ex.skipTitle, "i") : null;
  for (const [via, terms] of [["n", ex.terms ?? []], ["i", ex.issueTerms ?? []]]) for (const term of terms) {
    const params = { per_page: String(ex.perTerm ?? 40), order: "newest", "conditions[term]": term, "conditions[publication_date][gte]": since, _types: ["PRESDOCU"] };
    for (const r of await frGet(ex.api, params)) {
      const h = clean(r.title), u = safeUrl(r.html_url);
      if (!h || !u || !isGov(u)) continue;
      if (via === "i" && skipI && skipI.test(h)) continue; // observances such as "Citizenship Day" are not policy; skipTitle applies to related-issue matches only
      if (via === "i" && !(AAPI.test(h + " " + clean(r.abstract)) || ISSUE.test(h + " " + clean(r.abstract)))) continue; // a full-text hit deep in a ceremonial proclamation is not a policy on the issue
      const prev = out.get(u); if (prev) { if (via === "n") prev.rl = "n"; continue; }
      const ty = r.executive_order_number ? "Executive Order " + r.executive_order_number : (clean(r.subtype) || "Presidential document");
      const d = new Date((r.signing_date || r.publication_date || "") + "T12:00:00Z"), abs = clean(r.abstract);
      out.set(u, { id: createHash("sha1").update(u).digest("hex").slice(0, 12), d: isNaN(d) ? new Date().toISOString() : d.toISOString(), s: "Federal Register", h, m: sentences(abs), u, g: 0, k: "order", ty, ag: "Executive Office of the President", rl: via, ...TG.all(h, abs, d, "GOVERNMENT") });
    }
  }
  return [...out.values()];
}

// Congress.gov API (free api.data.gov key from https://api.congress.gov/sign-up/, read from API_DATA_GOV_KEY or CONGRESS_API_KEY). Bills whose title or CRS summary names AAPI communities, or whose title touches a related issue.
const BILLS = { HR: ["house-bill", "H.R."], S: ["senate-bill", "S."], HJRES: ["house-joint-resolution", "H.J.Res."], SJRES: ["senate-joint-resolution", "S.J.Res."], HCONRES: ["house-concurrent-resolution", "H.Con.Res."], SCONRES: ["senate-concurrent-resolution", "S.Con.Res."], HRES: ["house-resolution", "H.Res."], SRES: ["senate-resolution", "S.Res."] };
const ordinal = n => n + (["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);
async function pullBills(cg) {
  if (!API_KEY) return null;
  const api = (process.env.CONGRESS_API ?? cg.api ?? "https://api.congress.gov/v3").replace(/\/$/, "");
  const cong = cg.congress ?? Math.floor((new Date().getUTCFullYear() - 1789) / 2) + 1;
  const from = new Date(Date.now() - (cg.days ?? 10) * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  const pages = async (path, field) => {
    const rows = [];
    for (let p = 0; p < (cg.maxPages ?? 6); p++) {
      const q = new URLSearchParams({ format: "json", limit: "250", offset: String(p * 250), fromDateTime: from, sort: "updateDate desc" }), url = `${api}/${path}/${cong}?${q}`;
      if (!canAsk(url)) break;
      let got; try { got = (await keyed(url))[field] ?? []; } catch (e) { throw new Error(`${path}: ${e.message}`); }
      rows.push(...got);
      if (got.length < 250) break;
    }
    return rows;
  };
  const found = new Map();
  const note = (b, text, act, actDate, upd) => {
    const type = String(b.type ?? "").toUpperCase(), kind = BILLS[type], number = String(b.number ?? "").replace(/\D/g, ""), h = clean(b.title);
    if (!kind || !number || !h) return;
    const rl = AAPI.test(h + " " + text) ? "n" : ISSUE.test(h) ? "i" : "";
    if (!rl) return;
    const id = type + number, e = found.get(id) ?? { id, type, number, kind, h, rl: "", m: "", la: "", d: "", chamber: /^s/i.test(b.originChamber ?? type) ? "Senate" : "House" };
    if (rl === "n" || !e.rl) e.rl = rl;
    if (text && !e.m) { e.m = sentences(text); e.text = text.slice(0, 4000); }
    const when = actDate || upd || "";
    if (when > e.d) { e.d = when; if (act) e.la = clean(act).slice(0, 200); }
    found.set(id, e);
  };
  for (const b of await pages("bill", "bills")) note(b, "", b.latestAction?.text, b.latestAction?.actionDate, b.updateDate);
  for (const sm of await pages("summaries", "summaries")) note(sm.bill ?? {}, clean(sm.text), sm.actionDesc, sm.actionDate, sm.updateDate);
  return [...found.values()].map(e => {
    const u = `https://www.congress.gov/bill/${ordinal(cong)}-congress/${e.kind[0]}/${e.number}`, d = new Date(e.d.length > 10 ? e.d : (e.d || new Date().toISOString().slice(0, 10)) + "T12:00:00Z");
    return { id: createHash("sha1").update(u).digest("hex").slice(0, 12), d: isNaN(d) ? new Date().toISOString() : d.toISOString(), s: "Congress.gov", h: e.h, m: e.m, u, g: 0, k: "bill", ty: `${e.kind[1]} ${e.number}`, ag: e.chamber, rl: e.rl, ...(e.la ? { la: e.la } : {}), ...TG.all(e.h, e.text ?? "", d, "GOVERNMENT") };
  });
}

// Regulations.gov (API v4): documents that are open for comment right now. The list view carries no summary, so relevance is judged on the title.
// Federal Register documents already listed by pullFR (same document number) are not repeated.
async function pullRegs(rg) {
  if (!API_KEY) return null;
  const api = (rg.api ?? "https://api.regulations.gov/v4").replace(/\/$/, ""), today = new Date().toISOString().slice(0, 10), fr = cfg.federalRegister ?? {};
  const skipRe = rg.skipTitle ?? fr.skipTitle, skip = skipRe ? new RegExp(skipRe, "i") : null, out = new Map();
  const passes = [...(rg.terms ?? fr.terms ?? []).map(t => [t, "n"]), ...(rg.issueTerms ?? fr.issueTerms ?? []).map(t => [t, "i"])];
  for (const [term, via] of passes) {
    const url = api + "/documents?" + new URLSearchParams({ "filter[searchTerm]": term, "filter[commentEndDate][ge]": today, sort: "-postedDate", "page[size]": String(rg.pageSize ?? 25) });
    if (!canAsk(url)) break;
    for (const r of (await keyed(url)).data ?? []) {
      const a = r.attributes ?? {}, h = clean(a.title), u = safeUrl(`https://www.regulations.gov/document/${r.id}`), dl = String(a.commentEndDate ?? "").slice(0, 10);
      const rl = AAPI.test(h) ? "n" : (via === "i" && ISSUE.test(h)) ? "i" : "";
      if (!h || !u || out.has(u) || a.withdrawn || !rl || dl < today || !["Proposed Rule", "Rule", "Notice"].includes(a.documentType) || (a.frDocNum && FR_DOCS.has(a.frDocNum)) || (skip && skip.test(h))) continue;
      const d = new Date(a.postedDate ?? Date.now());
      out.set(u, { id: createHash("sha1").update(u).digest("hex").slice(0, 12), d: isNaN(d) ? new Date().toISOString() : d.toISOString(), s: "Regulations.gov", h, m: "", u, g: 0, k: "official", ty: a.documentType, ag: clean(a.agencyId), rl, dl, ...TG.all(h, "", d, "GOVERNMENT") });
    }
  }
  return [...out.values()];
}

// GovInfo search API: public laws, congressional hearings, committee reports and GAO reports whose TITLE names the communities or a related issue.
const GI = { PLAW: ["bill", "Public Law"], CHRG: ["hearing", "Hearing"], CRPT: ["hearing", "Committee report"], GAOREPORTS: ["hearing", "GAO report"] };
const SMALL = /\b(Of|The|For|To|In|On|And|A|An|Or|At|By|Under|With)\b(?!$)/g;
const titleCase = t => t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(\-:"])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(SMALL, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase()) : t;
async function pullGovInfo(gi) {
  if (!API_KEY) return null;
  const api = (gi.api ?? "https://api.govinfo.gov").replace(/\/$/, ""), fr = cfg.federalRegister ?? {}, cols = (gi.collections ?? Object.keys(GI)).filter(c => GI[c]);
  const since = new Date(Date.now() - (gi.days ?? 120) * 864e5).toISOString().slice(0, 10), out = new Map();
  for (const [via, terms] of [["n", gi.terms ?? fr.terms ?? []], ["i", gi.issueTerms ?? fr.issueTerms ?? []]]) {
    if (!terms.length || !cols.length) continue;
    const query = `collection:(${cols.join(" OR ")}) AND publishdate:range(${since},) AND title:(${terms.join(" OR ")})`;
    for (let page = 0, mark = "*"; page < (gi.maxPages ?? 2); page++) {
      if (!canAsk(api)) break;
      const j = await keyed(api + "/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, pageSize: 100, offsetMark: mark, sorts: [{ field: "publishdate", sortOrder: "DESC" }], historical: false, resultLevel: "default" }) });
      for (const r of j.results ?? []) {
        const meta = GI[r.collectionCode], h = titleCase(clean(r.title)), pid = String(r.packageId ?? ""), u = safeUrl(`https://www.govinfo.gov/app/details/${pid}`);
        const rl = AAPI.test(h) ? "n" : (via === "i" && ISSUE.test(h)) ? "i" : "";
        if (!meta || !h || !u || !pid || out.has(u) || !rl) continue;
        const auth = [].concat(r.governmentAuthor ?? []).join(" "), ag = /senate/i.test(auth) ? "Senate" : /house/i.test(auth) ? "House" : r.collectionCode === "GAOREPORTS" ? "GAO" : "";
        let ty = meta[1], m;
        if (r.collectionCode === "PLAW" && (m = pid.match(/^PLAW-(\d+)publ(\d+)$/))) ty = `Public Law ${m[1]}-${m[2]}`;
        if (r.collectionCode === "CRPT" && (m = pid.match(/^CRPT-(\d+)([hse])rpt(\d+)$/))) ty = `${m[2].toUpperCase()}. Rept. ${m[1]}-${m[3]}`;
        const d = new Date((r.dateIssued ?? "") + "T12:00:00Z");
        out.set(u, { id: createHash("sha1").update(u).digest("hex").slice(0, 12), d: isNaN(d) ? new Date().toISOString() : d.toISOString(), s: "GovInfo", h, m: "", u, g: 0, k: meta[0], ty, ag, rl, ...(r.collectionCode === "PLAW" ? { la: "Became law" } : {}), ...TG.all(h, "", d, "GOVERNMENT") });
      }
      if ((j.results ?? []).length < 100 || !j.offsetMark) break;
      mark = j.offsetMark;
    }
  }
  return [...out.values()];
}

let old = [], oldSources = [], oldTaxo = null;
try { const prev = JSON.parse(await readFile(OUT, "utf8")); old = prev.items ?? []; oldSources = prev.sources ?? []; oldTaxo = prev.taxo ?? null; } catch {}
// Built-in topics and communities the owner removed at the last update and has restored since: stories that fit them go back to them (the page's feed.json records what was removed).
const offNow = A.settings.builtin, nowOff = (f, key) => new Set(Object.keys(offNow[f] ?? {}).filter(k => offNow[f][k].off)), wasOff = (key) => new Set(Array.isArray(oldTaxo?.off?.[key]) ? oldTaxo.off[key] : []);
const BACK_T = new Set([...wasOff("t")].filter(k => !nowOff("topics").has(k) && TG.valid.has(k))), BACK_CM = new Set([...wasOff("c")].filter(k => !nowOff("communities").has(k) && VALID_CM.has(k)));
const PEND_MAX = cfg.pendingMax ?? 500;
const status = [], fresh = [];
const foreignSources = cfg.sources.filter(s => s.enabled !== false && !s.google && hostForeign(hostOf(s.feed ?? s.page ?? s.wp)));
if (foreignSources.length) console.log("Skipped (source is on a non-U.S. domain): " + [...new Set(foreignSources.map(s => s.name))].join(", "));
await Promise.all(cfg.sources.filter(s => s.enabled !== false && !foreignSources.includes(s)).map(async s => {
  try { const r = await pull(s); fresh.push(...r); status.push({ name: s.name, home: s.home, kind: s.kind ?? kindOf(s.asName ?? s.name), ok: true, count: r.length }); }
  catch (e) { status.push({ name: s.name, home: s.home, kind: s.kind ?? kindOf(s.asName ?? s.name), ok: false, error: String(e.message ?? e) }); }
}));
const FR_HOME = "https://www.federalregister.gov";
const runPolicy = async (name, home, kind, on, fn) => {
  if (!on) return;
  const stopNote = () => { const n = LIM.stopped; LIM.stopped = ""; return n ? { note: n } : {}; };
  try { const r = await fn(); if (r === null) status.push({ name, home, kind, ok: true, count: 0, note: NO_KEY }); else { fresh.push(...r); status.push({ name, home, kind, ok: true, count: r.length, ...stopNote() }); } }
  catch (e) { status.push({ name, home, kind, ok: false, error: String(e.message ?? e), ...stopNote() }); }
};
await runPolicy("Federal Register", FR_HOME, "official", cfg.federalRegister?.enabled, () => pullFR(cfg.federalRegister));
await runPolicy("Federal Register (executive actions)", FR_HOME, "order", cfg.executiveActions?.enabled, () => pullExec(cfg.executiveActions));
await runPolicy("Congress.gov", "https://www.congress.gov", "bill", cfg.congress?.enabled, () => pullBills(cfg.congress));
await runPolicy("Regulations.gov", "https://www.regulations.gov", "official", cfg.regulations?.enabled, () => pullRegs(cfg.regulations));
await runPolicy("GovInfo", "https://www.govinfo.gov", "hearing", cfg.govinfo?.enabled, () => pullGovInfo(cfg.govinfo));
if (cfg.apiBudget || API_KEY) console.log(`API key requests this run: ${(cfg.apiBudget?.perRun ?? 150) - LIM.left} of ${cfg.apiBudget?.perRun ?? 150} allowed`);
console.log(status.map(s => `${s.ok ? "OK  " : "FAIL"} ${s.name}: ${s.ok ? s.count + " items" + (s.note ? " (" + s.note + ")" : "") : s.error}`).join("\n"));
if (skippedLang.length) console.log("Skipped (not in English):\n  " + skippedLang.join("\n  "));
if (skippedCat.length) console.log("Skipped (excluded category):\n  " + skippedCat.join("\n  "));
if (skipped.length) console.log("Skipped (not about U.S. AAPI communities):\n  " + skipped.join("\n  "));
if (!status.some(s => s.ok)) { console.error("All sources failed; keeping previous data."); process.exit(1); }

fresh.sort((a, b) => a.g - b.g); // direct outlets win over Google News duplicates
const seen = new Set(), seenId = new Set(), items = [], now = Date.now();
const keepFR = (cfg.federalRegister?.keepCommentsDays ?? 120) * 864e5, today = new Date().toISOString().slice(0, 10);
const POL_KEEP = (cfg.policyKeepDays ?? 120) * 864e5, POL_MAX = cfg.policyMax ?? 300;
// Stored items from before a rules change are re-tagged so every item has the current topic, communities, states and bills.
// Set RETAG=1 to re-run the rules over everything already stored (after editing taxonomy.json).
// "renames" in sources.json maps an old source name to its new one (for example "The Takeaway" is now part of "The Asian American Foundation", and the publisher Google News calls "Bloomberg.com" is shown as "Bloomberg News"), for stored and for new stories alike.
const renamed = o => { const s = cfg.renames?.[o.s]; return s ? { ...o, s } : o; };
const retag = o => {
  const tg = TG.all(o.h, o.m ?? "", o.d, isPolicy(o.k) ? "GOVERNMENT" : undefined), force = !!process.env.RETAG, s = cfg.renames?.[o.s] ?? o.s;
  // The owner's own topics and communities also apply to stories already stored (a new keyword finds old stories too); a story keeps its other tags. A removed topic or community of the owner's is dropped.
  const keptCm = force || !Array.isArray(o.cm) ? [] : o.cm.filter(c => VALID_CM.has(c)), cm = [...new Set([...(keptCm.length ? keptCm : tg.cm), ...tg.cm.filter(c => CUSTOM_CM.has(c) || BACK_CM.has(c))])]; // a built-in community the owner has just restored is found on old stories again
  const t = CUSTOM_TOPICS.has(tg.t) || BACK_T.has(tg.t) ? tg.t : !force && VALID.has(o.t) ? o.t : tg.t;
  return { ...o, s, g: 1, k: o.k ?? kindOf(s), t, ...(Array.isArray(o.tx) ? { tx: o.tx.filter(k => VALID.has(k) && k !== t) } : {}), cm, st: !force && o.st ? o.st : tg.st, bl: !force && o.bl ? o.bl : tg.bl };
};
// A story that is new in this run is tagged with the topics and communities in use now; one that names a topic or community the owner has since removed (a government item filed under "Government & policy", say) gets the usual replacement.
const settle = o => ({ ...o, ...(VALID.has(o.t) ? {} : { t: TAXO.default }), ...(Array.isArray(o.cm) && o.cm.some(c => !VALID_CM.has(c)) ? { cm: o.cm.filter(c => VALID_CM.has(c)) } : {}) });
learnHosts([...old, ...fresh, ...old.map(renamed), ...fresh.map(renamed)]); // a publisher shown under its new name keeps its web address
const offTopicLog = [], gateLog = [];
for (const it0 of [...fresh.map(renamed).map(settle), ...old.map(retag), ...oldPending.map(retag)]) {
  if (catDropIds.has(it0.id)) continue; // a story in an excluded category, stored by an earlier run
  if (A.deleted[it0.id]) continue; // deleted in the admin dashboard: never collected again
  if (blocked(it0)) continue; // a blocked site, or a site on a non-U.S. domain, is dropped from stored stories too
  const it = reroute(withSourceKind(it0));
  if (gateFails(it)) { gateLog.push(it.s + ": " + it.h); continue; }
  if (offTopic(it)) { offTopicLog.push(it.s + ": " + it.h); continue; }
  const pol = isPolicy(it.k);
  if (pol && !govItem(it)) continue; // the Policy tracker takes .gov sources only
  const k = pol ? it.u : it.h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70); // companion bills can share a title, so policy items are told apart by link
  const open = it.dl && it.dl >= today && now - new Date(it.d) < keepFR;
  if (!k || seen.has(k) || seenId.has(it.id) || (now - new Date(it.d) > (pol ? POL_KEEP : keepOf(it)) && !open && !A.pinned[it.id])) continue;
  if (!pol && ((!isOrg(it.k) && abroadOnly(it.h + " " + (it.m ?? ""))) || !isEnglish(it.h + " " + (it.m ?? "")))) continue;
  seen.add(k); seenId.add(it.id); items.push(it);
}
if (gateLog.length) console.log(`Dropped (a gated site: only the stories its gate allows are kept): ${gateLog.length}\n  ` + gateLog.slice(0, 40).join("\n  "));
if (offTopicLog.length) console.log(`Dropped (headline does not name AAPI communities): ${offTopicLog.length}\n  ` + offTopicLog.slice(0, 40).join("\n  "));
// The owner's decisions: items added by hand or restored from the trash join the others (kept, or aged out like any other unless "kept permanently"); edits go on top of what was collected; an item that needs approval goes to the waiting list.
const oldIds = new Set(old.map(i => i.id)), oldPendIds = new Set(oldPending.map(i => i.id));
for (const m of A.added) if (!A.deleted[m.id] && !seenId.has(m.id) && (A.pinned[m.id] || now - Date.parse(m.d) <= keepOf(m))) { seenId.add(m.id); items.push({ ...m, g: 1 }); }
const live = [], waiting = [];
for (const it0 of items) { const it = applyEdits(it0, A); (placeOf(A, it, { live: oldIds.has(it.id), pending: oldPendIds.has(it.id) }) === "pending" ? waiting : live).push(it); }
live.sort((a, b) => b.d.localeCompare(a.d)); waiting.sort((a, b) => b.d.localeCompare(a.d));
const kept = [...live.filter(i => !isPolicy(i.k) && i.k !== "research" && !held(i)).slice(0, MAX), ...live.filter(i => !isPolicy(i.k) && i.k !== "research" && held(i)), ...live.filter(i => i.k === "research").slice(0, RES_MAX), ...live.filter(i => isPolicy(i.k)).slice(0, POL_MAX)].sort((a, b) => b.d.localeCompare(a.d));
const arts = new Map(kept.filter(i => i.art).map(i => [i.id, i.art]));
const slim = o => Object.fromEntries(Object.entries(o).filter(([, v]) => !(Array.isArray(v) && !v.length) && v !== "" && v !== undefined));
const out = kept.map(({ g, art, ...rest }) => slim(rest));
const adir = join(dirname(OUT), "articles");
await mkdir(adir, { recursive: true });
// Author pages ("byu"): an author seen before is not looked up again (sources.json "authors" lists bylines whose stories live on another site, e.g. The Yappie Staff on the newsletter), and at most 6 pages are read per run.
const stored = new Map();
for (const f of await readdir(adir)) if (f.endsWith(".json")) { try { stored.set(f.slice(0, -5), JSON.parse(await readFile(join(adir, f), "utf8"))); } catch { /* unreadable file: replaced or removed below */ } }
// An article the owner wrote or changed in the dashboard (state.article) goes on top of the collected one; its author link is kept as given.
for (const i of kept) { const ov = A.article[i.id]; if (ov && Object.keys(ov).length) arts.set(i.id, { by: "", img: "", body: "", ...(stored.get(i.id) ?? {}), ...(arts.get(i.id) ?? {}), ...ov }); }
const knownAuthor = new Map(Object.entries(Object.assign({}, ...cfg.sources.map(x => x.authors ?? {}))));
for (const a of stored.values()) if (a.by && a.byu && !knownAuthor.has(a.by)) knownAuthor.set(a.by, a.byu);
const storyUrl = new Map(kept.map(i => [i.id, i.u]));
let authorReads = 0;
const authorFor = async (id, a) => {
  if (!a.by) return undefined;
  if (knownAuthor.has(a.by)) return knownAuthor.get(a.by);
  const before = stored.get(id)?.byu;
  if (before !== undefined) return before; // looked up on an earlier run (found, or the page has no author page)
  if (authorReads >= 6 || !storyUrl.get(id)) return undefined;
  authorReads++;
  const r = await authorPage(storyUrl.get(id), a.by);
  if (r) knownAuthor.set(a.by, r);
  return r;
};
for (const [id, a] of arts) { const byu = a.byu !== undefined ? a.byu : await authorFor(id, a); await writeFile(join(adir, id + ".json"), JSON.stringify(byu === undefined ? a : { ...a, byu })); }
const keepIds = new Set(out.filter(i => i.v).map(i => i.id));
for (const [id, a] of stored) { // articles stored before this rule existed
  if (arts.has(id) || !keepIds.has(id)) continue;
  const b = tidyBody(a.body, a.img), byu = await authorFor(id, a);
  if (b !== a.body || (byu !== undefined && byu !== a.byu)) await writeFile(join(adir, id + ".json"), JSON.stringify({ ...a, body: b, ...(byu === undefined ? {} : { byu }) }));
}
for (const f of await readdir(adir)) if (f.endsWith(".json") && !keepIds.has(f.slice(0, -5))) await unlink(join(adir, f));
// Items waiting for approval, with their article text inside (the article file of an item that is not live is removed).
const pendOut = waiting.slice(0, PEND_MAX).map(({ g, art, ...rest }) => {
  const base = art ?? (rest.v ? stored.get(rest.id) : undefined), ov = A.article[rest.id]; // the owner's own article text goes on top here too
  const a = ov && Object.keys(ov).length ? { by: "", img: "", body: "", ...(base ?? {}), ...ov } : base;
  return slim(a ? { ...rest, art: a } : rest);
});
if (JSON.stringify(pendOut) !== JSON.stringify(oldPending) && (pendOut.length || oldPending.length)) await writeFile(join(ADMIN_DIR, "pending.json"), JSON.stringify({ generated: new Date().toISOString(), items: pendOut }));
const pubSources = status.map(({ name, home, kind, ok, count, note }) => ({ name, home, kind, ok, count, note }));
const taxo = feedTaxo(A.settings, TAXO_BASE); // names (never keywords) of the owner's own topics, communities and categories, new names for built-in ones and the built-in ones removed, so the page can show them
if (JSON.stringify(out) === JSON.stringify(old) && JSON.stringify(pubSources) === JSON.stringify(oldSources) && JSON.stringify(taxo) === JSON.stringify(oldTaxo)) { console.log("No changes."); process.exit(0); }
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), sources: pubSources, ...(taxo ? { taxo } : {}), items: out }));
console.log(`Wrote ${out.length} items.`);
