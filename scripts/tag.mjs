// Tagging shared by the collector, the RSS/digest builders and tests. Rules live in taxonomy.json (also read by the page and the PHP collector).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TAXO_PATH = fileURLToPath(new URL("../taxonomy.json", import.meta.url));
export function makeTagger(tax = JSON.parse(readFileSync(TAXO_PATH, "utf8"))) {
  const pre = tax.pre.map(([a, b]) => [new RegExp(a, "g"), b]);
  const prep = s => pre.reduce((t, [re, b]) => t.replace(re, b), String(s ?? ""));
  const topics = tax.topics.map(t => ({ k: t.k, w: t.w ?? 1, re: new RegExp(t.re, "gi") })), valid = new Set(tax.topics.map(t => t.k));
  const comms = tax.communities.map(c => ({ k: c.k, re: new RegExp(c.re, "i") }));
  const states = tax.states.map(([k, , re]) => ({ k, re: new RegExp("\\b(?:" + re + ")\\b", "i") }));
  const billRe = new RegExp(tax.bill, "g");
  const count = (re, s) => (s.match(re) ?? []).length;
  const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]);
  return {
    valid,
    policyKinds: new Set(tax.policyKinds ?? []),
    issue: new RegExp(tax.policy?.issue ?? "$^", "i"),
    topic(h, raw = "", def = tax.default) {
      const H = prep(h), X = prep(raw);
      let best = valid.has(def) ? def : tax.default, top = 0; // a default the owner has removed (for example "Government & policy" for a government item) gives way to the catch-all topic
      for (const t of topics) { const sc = (2 * count(t.re, H) + count(t.re, X)) * t.w; if (sc > top) { top = sc; best = t.k; } }
      return best;
    },
    communities(text) { return comms.filter(c => c.re.test(text)).map(c => c.k); },
    states(text) {
      const hits = states.map(s => [text.search(s.re), s.k]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]).map(([, k]) => k);
      return hits.slice(0, 3);
    },
    bills(text, date) {
      const y = new Date(date).getFullYear() || new Date().getFullYear(), cong = Math.floor((y - 1789) / 2) + 1;
      const seen = new Map();
      for (const m of text.matchAll(billRe)) {
        const p = m[1].replace(/[\s.]/g, "").toUpperCase(), n = +m[2];
        const kind = { HR: ["HR", "house-bill", "H.R."], S: ["S", "senate-bill", "S."], HJRES: ["HJRES", "house-joint-resolution", "H.J.Res."], SJRES: ["SJRES", "senate-joint-resolution", "S.J.Res."], HRES: ["HRES", "house-resolution", "H.Res."], SRES: ["SRES", "senate-resolution", "S.Res."], HCONRES: ["HCONRES", "house-concurrent-resolution", "H.Con.Res."], SCONRES: ["SCONRES", "senate-concurrent-resolution", "S.Con.Res."] }[p];
        if (!kind || !n) continue;
        const id = kind[0] + n;
        if (!seen.has(id)) seen.set(id, { id, n: `${kind[2]} ${n}`, u: `https://www.congress.gov/bill/${ord(cong)}-congress/${kind[1]}/${n}` });
      }
      return [...seen.values()].slice(0, 4);
    },
    all(h, raw, date, def) {
      const text = prep(h) + " " + prep(raw);
      return { t: this.topic(h, raw, def), cm: this.communities(text), st: this.states(text), bl: this.bills(h + " " + raw, date) };
    },
  };
}
