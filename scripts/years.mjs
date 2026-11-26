// A source whose address names the year ("https://www.nj.gov/governor/news/2026/approved/news_archive.shtml") is written in sources.json with {year} where the year goes, so it does not stop on 1 January.
// The collector reads the current year's page; in January it also reads last year's page, because the end of December is still listed there.
const FIELDS = ["home", "feed", "page", "wp", "link"];
const hasYear = s => FIELDS.some(k => typeof s[k] === "string" && s[k].includes("{year}"));
const forYear = (s, y) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, FIELDS.includes(k) && typeof v === "string" ? v.replaceAll("{year}", String(y)) : v]));
/** The list of sources with every {year} replaced: one entry for the year of `ms`, and in January a second one for the year before. */
export function expandYears(sources, ms = Date.now()) {
  const d = new Date(ms), y = d.getUTCFullYear();
  return sources.flatMap(s => !hasYear(s) ? [s] : d.getUTCMonth() === 0 ? [forYear(s, y), forYear(s, y - 1)] : [forYear(s, y)]);
}
