// Groups stories about the same event (same logic as the page): shared headline words, within 3 days.
const STOP = new Set("the and for with from after over amid says more nation aapi asian american americans pacific islander islanders news this that into their about".split(" "));
const toks = h => new Set(h.toLowerCase().replace(/[^a-z0-9ʻ ]+/g, " ").split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
export function cluster(D, skip = () => false) { // skip: items that are never grouped (policy records)
  const T = D.map(x => toks(x.h)), W = D.map(x => +new Date(x.d)), P = D.map((_, i) => i), f = i => { while (P[i] != i) { P[i] = P[P[i]]; i = P[i]; } return i; };
  const sorted = W.every((t, i) => !i || W[i - 1] >= t); // newest first (as in the feed): the search for a match stops at the first story more than 3 days older
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
    if (Math.abs(W[i] - W[j]) > 2592e5) { if (sorted) break; continue; }
    if (skip(D[i]) || skip(D[j])) continue;
    let n = 0; T[i].forEach(w => T[j].has(w) && n++);
    if (n >= 2 && n / (T[i].size + T[j].size - n) >= .4) P[f(i)] = f(j);
  }
  const g = {}; D.forEach((x, i) => (g[f(i)] ??= []).push(x));
  return Object.values(g).map(a => ({ items: a, outlets: [...new Set(a.map(x => x.s))] }));
}
