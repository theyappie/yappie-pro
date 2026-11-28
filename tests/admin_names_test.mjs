// Tests of the new names (sources, events, issues, sections), the Organizations tab and the Numbers tab in scripts/admin.mjs. usage: node admin_names_test.mjs <repo>
import { readFileSync } from "node:fs";
const REPO = process.argv[2], A = await import(REPO + "/scripts/admin.mjs"), rd = f => JSON.parse(readFileSync(REPO + "/" + f, "utf8"));
const TAX = rd("taxonomy.json"), HUBS = rd("hubs.json"), ORGS = rd("orgs.json"), X = A.taxSets(TAX, HUBS, null, ORGS);
const ok = [], chk = (n, c, x = "") => { console.log(c ? "PASS" : "FAIL", n, c ? "" : String(x).slice(0, 500)); ok.push(!!c); };
const NOW = Date.parse("2026-11-01T12:00:00Z"), ctx = { X, now: NOW }, go = (s, op, args) => A.applyOp(s, op, args, ctx);
const thr = (f, m) => { try { f(); return false; } catch (e) { return e instanceof A.AdminError && (!m || m.test(e.message)); } };
const E0 = A.normalizeState(null), J = o => JSON.parse(JSON.stringify(o));

// ---------------- source names
let r = go(E0, "renames", { sources: [{ f: "AsAmNews", t: "AsAm News" }] });
chk("renames: a source gets a new name, and the summary says which", r.summary === "Renamed the source “AsAmNews” to “AsAm News”" && JSON.stringify(r.state.settings.names.sources) === '[{"f":"AsAmNews","t":"AsAm News"}]', r.summary);
chk("renames: the shown name is looked up by the collected one, whatever the capitals and punctuation", A.renamedTo(r.state.settings.names.sources, "asamnews") === "AsAm News" && A.renamedTo(r.state.settings.names.sources, "Other") === "Other");
chk("renames: nothing changed is refused", thr(() => go(r.state, "renames", { sources: r.state.settings.names.sources }), /Nothing to change/));
chk("renames: an empty new name, a missing original and a source listed twice are refused", thr(() => go(E0, "renames", { sources: [{ f: "A", t: "" }] }), /needs a new name/) && thr(() => go(E0, "renames", { sources: [{ f: "", t: "B" }] }), /missing its original/) && thr(() => go(E0, "renames", { sources: [{ f: "A", t: "B" }, { f: "a", t: "C" }] }), /twice/));
{ const L = A.renameShown([], "Hoodline.com", "Hoodline"), L2 = A.renameShown(L, "Hoodline", "Hoodline News"), L3 = A.renameShown(L2, "Hoodline News", "Hoodline.com");
  chk("renameShown: renaming a renamed source points every earlier name at the newest one", JSON.stringify(L2) === '[{"f":"Hoodline.com","t":"Hoodline News"},{"f":"Hoodline","t":"Hoodline News"}]', JSON.stringify(L2));
  chk("renameShown: renaming back to the first name makes every other name point to it, and the first name stays listed as the original", JSON.stringify(L3) === JSON.stringify([{ f: "Hoodline.com", t: "Hoodline.com" }, { f: "Hoodline", t: "Hoodline.com" }, { f: "Hoodline News", t: "Hoodline.com" }]) && A.renamedTo(L3, "Hoodline.com") === "Hoodline.com" && A.renamedTo(L3, "Hoodline") === "Hoodline.com", JSON.stringify(L3));
  { const one = A.renameShown(A.renameShown([], "Alpha", "Beta"), "Beta", "Alpha");
    chk("renameShown: one rename and back keeps the first name as the original and nothing else changes", JSON.stringify(one) === JSON.stringify([{ f: "Alpha", t: "Alpha" }, { f: "Beta", t: "Alpha" }]) && A.renamedTo(one, "Beta") === "Alpha" && A.renamedTo(one, "Alpha") === "Alpha", JSON.stringify(one));
    chk("renameShown / cleanRenames: a name that leads to itself is dropped when no other name leads to it", JSON.stringify(A.cleanRenames([{ f: "A", t: "A" }])) === "[]" && JSON.stringify(A.cleanRenames(one)) === JSON.stringify(one));
    const again = A.renameShown(one, "Alpha", "Gamma");
    chk("renameShown: renaming again after that points every name at the newest, without a leftover marker", JSON.stringify(again) === JSON.stringify([{ f: "Alpha", t: "Gamma" }, { f: "Beta", t: "Gamma" }]), JSON.stringify(again));
    chk("feedTaxo: only the real alias is published, not the marker", JSON.stringify(A.feedTaxo(go(go(E0, "renames", { sources: A.renameShown([], "Alpha", "Beta") }).state, "renames", { sources: one }).state.settings, TAX).sn ?? null) === '{"Beta":"Alpha"}'); }
  chk("renameShown: renameChanges lists what is shown differently", JSON.stringify(A.renameChanges(L, L2)) === '[{"from":"Hoodline","to":"Hoodline News"}]', JSON.stringify(A.renameChanges(L, L2))); }
{ let s = go(go(go(E0, "blockSources", { sources: ["Old Name"] }).state, "sourceKinds", { sources: ["Old Name", "Other"], kind: "community" }).state, "settings", { approval: { mode: "custom", sources: ["Old Name"], kinds: [] } }).state;
  s = go(s, "renames", { sources: [{ f: "Old Name", t: "New Name" }] }).state;
  chk("renames: what was decided about the source (blocked, category, approval) follows the new name", Object.keys(s.settings.blocked).join() === "New Name" && s.settings.sourceKinds["New Name"] === "community" && !("Old Name" in s.settings.sourceKinds) && s.settings.sourceKinds.Other === "community" && s.settings.approval.sources.join() === "New Name", JSON.stringify(s.settings));
  s = go(s, "renames", { sources: [] }).state;
  chk("renames: going back to the original name moves those decisions back", Object.keys(s.settings.blocked).join() === "Old Name" && s.settings.approval.sources.join() === "Old Name", JSON.stringify(s.settings.blocked)); }
r = go(E0, "renames", { events: [{ f: "Weekly webinar", t: "AAPI weekly webinar" }] });
chk("renames: a collected event gets a new title", r.summary === "Renamed the event “Weekly webinar” to “AAPI weekly webinar”" && A.renamedTo(r.state.settings.names.events, "weekly WEBINAR") === "AAPI weekly webinar", r.summary);
chk("renames: names survive a round trip through JSON; junk is dropped", (() => { const s = A.normalizeState(JSON.parse(JSON.stringify(go(r.state, "renames", { sources: [{ f: "A", t: "B" }] }).state))); return s.settings.names.sources.length === 1 && s.settings.names.events.length === 1 && A.normalizeState({ settings: { names: { sources: [{ f: "x" }, 5, { f: "", t: "y" }], events: "no", hubs: { "BAD KEY": "x", good: "Ok" } } } }).settings.names.hubs.good === "Ok"; })());
{ const t = A.feedTaxo(go(E0, "renames", { sources: [{ f: "AsAmNews", t: "AsAm News" }] }).state.settings, TAX);
  chk("feedTaxo: the page is told the new source names (original -> shown)", JSON.stringify(t.sn) === '{"AsAmNews":"AsAm News"}', JSON.stringify(t)); }

// ---------------- issue names
const sh = HUBS.hubs[0], sh2 = HUBS.hubs[1];
r = go(E0, "hubs", { names: { [sh.k]: "Renamed issue" } });
chk("hubs names: a starter issue gets a new name; hubList uses it", r.summary === `Renamed the issue “${sh.label}” to “Renamed issue”` && A.hubList(HUBS.hubs, r.state.settings)[0].label === "Renamed issue" && A.hubList(HUBS.hubs, r.state.settings)[0].k === sh.k, r.summary);
chk("hubs names: feedHubs (the page) carries the new name, the original keywords still match", A.feedHubs(A.hubList(HUBS.hubs, r.state.settings))[0].label === "Renamed issue" && A.hubList(HUBS.hubs, r.state.settings)[0].words.length === HUBS.hubs[0].words.length);
chk("hubs names: a name another issue already has is refused (starter, own, and a starter's new name)", thr(() => go(E0, "hubs", { names: { [sh.k]: sh2.label } }), /There is already an issue/) && thr(() => go(go(E0, "hubs", { list: [{ label: "Mine", words: "x1" }] }).state, "hubs", { names: { [sh.k]: "mine" } }), /There is already an issue/) && thr(() => go(r.state, "hubs", { list: [{ label: "Renamed issue", words: "abc" }] }), /There is already an issue/));
chk("hubs names: the original name of a renamed starter issue stays taken (an issue of your own would get the same address)", (() => { const q = go(E0, "hubs", { names: { [sh.k]: "Zed issue" } }).state; return thr(() => go(q, "hubs", { list: [{ label: sh.label, words: "abc" }] }), /There is already an issue/); })());
chk("hubs names: an unknown issue and an empty name are refused; naming it as it was removes the change", thr(() => go(E0, "hubs", { names: { nope: "X" } }), /Unknown issue/) && thr(() => go(E0, "hubs", { names: { [sh.k]: "  " } }), /needs a name/) && JSON.stringify(go(r.state, "hubs", { names: { [sh.k]: sh.label } }).state.settings.names.hubs) === "{}");
chk("hubs names: saving the issues list keeps the new names (the list op leaves names alone)", JSON.stringify(go(r.state, "hubs", { list: [{ label: "Mine", words: "abc" }] }).state.settings.names.hubs) === JSON.stringify({ [sh.k]: "Renamed issue" }));

// ---------------- section and type names
r = go(E0, "newsKinds", { list: [], builtin: { bill: { label: "Federal bills" }, statement: { label: "Group statements" }, community: { label: "AAPI outlets" } } });
{ const T = A.withCustom(TAX, r.state.settings), tt = A.feedTaxo(r.state.settings, TAX), wt = A.withFeedTaxo(TAX, tt);
  chk("kinds: Policy types and Statements can be renamed like News categories", T.kinds.bill === "Federal bills" && T.kinds.statement === "Group statements" && T.kinds.community === "AAPI outlets" && T.kinds.news === "Mainstream", JSON.stringify(T.kinds));
  chk("kinds: the page is told (rn.k) and the feed readers apply them", JSON.stringify(tt.rn.k) === '{"bill":"Federal bills","community":"AAPI outlets","statement":"Group statements"}' && wt.kinds.bill === "Federal bills", JSON.stringify(tt)); }
chk("kinds: a section cannot be removed, only renamed; a name in use is refused", thr(() => go(E0, "newsKinds", { list: [], builtin: { bill: { off: true, to: "news" } } }), /cannot be removed/) && thr(() => go(E0, "newsKinds", { list: [], builtin: { bill: { label: "Statements" } } }), /There is already a category/));
chk("kinds: renaming a section does not stop News categories from being removed (their sources go to a News category)", (() => { const q = go(r.state, "newsKinds", { builtin: { ...r.state.settings.builtin.kinds, news: { off: true, to: "community" } } }); return q.state.settings.builtin.kinds.news.off === true && q.state.settings.builtin.kinds.bill.label === "Federal bills"; })());
chk("kinds: the name of a custom News category cannot be a renamed section's name", thr(() => go(r.state, "newsKinds", { list: [{ label: "Federal bills" }] }), /There is already a category|too close/));

// ---------------- organizations
const so = ORGS.orgs[0], so2 = ORGS.orgs[1];
const newOrg = { n: "Test Community Center", u: "https://tcc.example.org", sc: "local", hq: "Tulsa, OK", ty: "Direct Services", fd: "1999", st: ["OK", "ZZ"], c: ["KR", "NOPE"], is: ["EDUCATION"], src: ["TCC News", "TCC News"] };
r = go(E0, "orgs", { own: [newOrg] });
const mine = r.state.settings.orgs.own[0];
chk("orgs: an organization is added with a name-based id, a checked shape, and unknown tags dropped", mine.id === "test-community-center" && mine.ty === "direct services" && JSON.stringify(mine.st) === '["OK"]' && JSON.stringify(mine.c) === '["KR"]' && JSON.stringify(mine.src) === '["TCC News"]' && mine.ab === "" && mine.fd === "1999" && r.summary === "Added the organization “Test Community Center”", JSON.stringify(mine) + r.summary);
{ const m = A.mergeOrgs(ORGS, r.state.settings.orgs);
  chk("orgs: the merged list has the starter ones in their order and the new one at the end, in the shape the site reads", m.orgs.length === ORGS.orgs.length + 1 && m.orgs[0].id === so.id && m.orgs.at(-1).id === mine.id && typeof m.orgs.at(-1).ab === "string" && /^https:\/\//.test(m.orgs.at(-1).u) && m.note === ORGS.note); }
chk("orgs: a website without https, a missing name, an unknown place, a bad year and a duplicate name are refused", thr(() => go(E0, "orgs", { own: [{ ...newOrg, u: "http://x.example" }] }), /https/) && thr(() => go(E0, "orgs", { own: [{ ...newOrg, n: "  " }] }), /needs a name/) && thr(() => go(E0, "orgs", { own: [{ ...newOrg, sc: "galaxy" }] }), /Choose where/) && thr(() => go(E0, "orgs", { own: [{ ...newOrg, fd: "91" }] }), /four digits/) && thr(() => go(E0, "orgs", { own: [{ ...newOrg, n: so.n.toUpperCase() }] }), /There is already an organization/) && thr(() => go(E0, "orgs", { own: [newOrg, { ...newOrg, u: "https://other.example.org" }] }), /There is already an organization/));
chk("orgs: nothing changed is refused", thr(() => go(r.state, "orgs", { own: r.state.settings.orgs.own }), /Nothing to change/));
{ const q = go(E0, "orgs", { edit: { [so.id]: { ...so, n: "A New Name", hq: "Reno, NV", is: ["HEALTH"] } } }), e = q.state.settings.orgs.edit[so.id];
  chk("orgs: changing a starter organization saves only the fields that differ", JSON.stringify(Object.keys(e).sort()) === '["hq","is","n"]' && e.n === "A New Name" && q.summary === "Changed the organization “A New Name”", JSON.stringify(e) + q.summary);
  const m = A.mergeOrgs(ORGS, q.state.settings.orgs);
  chk("orgs: the merged list shows the change, and the id stays the same", m.orgs[0].id === so.id && m.orgs[0].n === "A New Name" && m.orgs[0].hq === "Reno, NV" && m.orgs[0].u === so.u);
  chk("orgs: putting the starter values back removes the change", Object.keys(go(q.state, "orgs", { edit: { [so.id]: so } }).state.settings.orgs.edit).length === 0);
  chk("orgs: a name another organization has is refused after a rename too", thr(() => go(E0, "orgs", { edit: { [so.id]: { ...so, n: so2.n } } }), /There is already an organization/));
  chk("orgs: an unknown starter id is refused", thr(() => go(E0, "orgs", { edit: { nope: { ...so } } }), /Unknown organization/)); }
{ const q = go(E0, "orgs", { off: [so.id, "nope", so.id] });
  chk("orgs: a starter organization is hidden (once; unknown ids are ignored), shown again, and says so", JSON.stringify(q.state.settings.orgs.off) === JSON.stringify([so.id]) && q.summary === `Hid the organization “${so.n}”` && A.mergeOrgs(ORGS, q.state.settings.orgs).orgs.length === ORGS.orgs.length - 1 && go(q.state, "orgs", { off: [] }).summary === `Showed the organization “${so.n}”`, q.summary);
  const w = go(r.state, "orgs", { own: [] });
  chk("orgs: an organization you added is removed", w.summary === "Removed the organization “Test Community Center”" && w.state.settings.orgs.own.length === 0 && !A.orgsChanged(w.state.settings.orgs)); }
chk("orgs: renaming an added organization keeps its id; two with the same name get different ids", (() => { const q = go(r.state, "orgs", { own: [{ ...mine, n: "Test Community Centre" }] }); return q.state.settings.orgs.own[0].id === mine.id && q.state.settings.orgs.own[0].n === "Test Community Centre"; })());
chk("orgs: an id that collides with a starter id is made different", (() => { const q = go(E0, "orgs", { own: [{ ...newOrg, id: so.id }] }); return q.state.settings.orgs.own[0].id !== so.id && /^[a-z0-9-]+$/.test(q.state.settings.orgs.own[0].id); })());
chk("orgs: the whole state survives a round trip through JSON", (() => { const s = go(go(r.state, "orgs", { edit: { [so.id]: { ...so, n: "Zed" } } }).state, "orgs", { off: [so2.id] }).state, back = A.normalizeState(JSON.parse(JSON.stringify(s))); return JSON.stringify(back.settings.orgs) === JSON.stringify(s.settings.orgs) && back.settings.orgs.own.length === 1; })());
chk("orgs: unreadable saved entries are dropped, not fatal", (() => { const s = A.normalizeState({ settings: { orgs: { own: [{ n: "x" }, 5, { id: "ok-one", n: "Fine", u: "https://fine.example" }], edit: { "a b": { n: "x" }, good: { u: "http://no" }, good2: { n: "Two" } }, off: [1, "ok-id"] } } }); return s.settings.orgs.own.length === 1 && s.settings.orgs.own[0].id === "ok-one" && Object.keys(s.settings.orgs.edit).join() === "good2" && s.settings.orgs.off.join() === "ok-id"; })());

// ---------------- sizes, state
chk("limits: too many organizations or figures of your own are refused", thr(() => go(E0, "orgs", { own: Array.from({ length: A.LIMITS.orgs + 1 }, (_, i) => ({ ...newOrg, n: "Org " + i })) }), /at most/));
chk("an empty settings object has the new parts, and an old saved state without them still reads", (() => { const s = A.normalizeState({ settings: { approval: { mode: "off" } } }).settings; return s.names.sources.length === 0 && s.orgs.own.length === 0 && !("numbers" in s); })());

chk("numbers removed: a state saved with figures still reads and the figures are left out", (() => { const s = A.normalizeState({ settings: { numbers: { own: [{ id: "pop-x", v: "1", t: "t", y: "2024", cat: "pop", s: "census" }], off: ["a"], cats: { pop: "People" } }, orgs: { off: [ORGS.orgs[0].id] } } }); return !("numbers" in s.settings) && s.settings.orgs.off.length === 1; })());
chk("numbers removed: the old dashboard's \"numbers\" change is refused, not applied", (() => { try { go(E0, "numbers", { off: ["x"] }); return false; } catch (e) { return true; } })());
console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");

