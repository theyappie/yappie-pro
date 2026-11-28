// English-only filter. Rules live in taxonomy.json ("lang") so the page and the PHP collector use the same lists.
export function makeEnglishCheck(tax) {
  const L = tax.lang, en = new Set(L.en), xx = new Set(L.xx), vi = new Set([...L.vi]);
  const inRanges = cp => L.ranges.some(([a, b]) => cp >= a && cp <= b);
  return function isEnglish(text) {
    const s = String(text ?? ""); let letters = 0, other = 0, viN = 0;
    for (const ch of s) { const cp = ch.codePointAt(0); if (/\p{L}/u.test(ch)) { letters++; if (inRanges(cp)) other++; else if (vi.has(ch.toLowerCase())) viN++; } }
    if (letters && other / letters >= 0.3) return false;
    if (viN >= 2) return false;
    const words = s.toLowerCase().match(/[a-zà-ÿ'’]+/g) ?? [];
    let e = 0, f = 0; for (const w of words) { if (en.has(w)) e++; else if (xx.has(w)) f++; }
    if (f >= 2 && f > e) return false;
    if (f >= 1 && e === 0 && words.length >= 4) return false;
    return true;
  };
}
