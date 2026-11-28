// Groups stories about the same event (same logic as the page): shared headline words, within 3 days, or three shared words and the same dollar figure ("$16.45M" and "$16.4M").
const STOP = new Set("the and for with from after over amid says more nation aapi asian american americans pacific islander islanders news this that into their about".split(" "));
const toks = h => new Set(h.toLowerCase().replace(/[^a-z0-9ʻ ]+/g, " ").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
const money = h => { const m = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|[BMK]\b)?/i.exec(h || ""); if (!m) return 0; const v = parseFloat(m[1].replace(/,/g, "")), u = (m[2] || "").toLowerCase()[0]; return v * (u === "b" ? 1e9 : u === "m" ? 1e6 : u === "t" || u === "k" ? 1e3 : 1); };
export function cluster(D, skip = () => false) { // skip: items that are never grouped (policy records)
  const T = D.map(x => toks(x.h)), M = D.map(x => money(x.h)), W = D.map(x => +new Date(x.d)), P = D.map((_, i) => i), f = i => { while (P[i] != i) { P[i] = P[P[i]]; i = P[i]; } return i; };
  const sorted = W.every((t, i) => !i || W[i - 1] >= t); // newest first (as in the feed): the search for a match stops at the first story more than 3 days older
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
    if (Math.abs(W[i] - W[j]) > 2592e5) { if (sorted) break; continue; }
    if (skip(D[i]) || skip(D[j])) continue;
    let n = 0; T[i].forEach(w => T[j].has(w) && n++);
    if (n >= 2 && (n / (T[i].size + T[j].size - n) >= .4 || (n >= 3 && M[i] && M[j] && Math.abs(M[i] - M[j]) <= .05 * Math.max(M[i], M[j])))) P[f(i)] = f(j);
  }
  const g = {}; D.forEach((x, i) => (g[f(i)] ??= []).push(x));
  return Object.values(g).map(a => ({ items: a, outlets: [...new Set(a.map(x => x.s))] }));
}
