// Finishes the page after index.html was edited. Usage: node scripts/pages.mjs <folder with index.html>   (or: bash scripts/pages.sh <folder>)
//  1. Writes the page's content security policy into index.html. The policy lists the page's own scripts by fingerprint, so the browser runs those and nothing else: a script that reached the page some other way
//     (through a story's text, say) does not run, and the page can read data only from this site and from theyappie.com. The fingerprints change whenever a script changes, which is why this step exists.
//  2. Makes the copies each address needs. GitHub Pages serves policy.html at /policy, so every page address gets its own copy of the app, and 404.html answers every other address with the same app.
//     events.html and elections.html are older addresses that now lead to the Calendar and Policy pages.
// The update workflow runs this on every update, so an index.html changed on GitHub directly is put right within minutes. It writes a file only when the file would change.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PAGES = ["news", "policy", "advocacy", "research", "hubs", "calendar", "events", "thread", "elections", "orgs", "saved", "404"];
const dir = process.argv[2] ?? ".", file = join(dir, "index.html");
if (!existsSync(file)) { console.error(`no index.html in ${dir}`); process.exit(1); }
const html = readFileSync(file, "utf8");
// every script the browser runs (a <script type="application/json"> block is data, not a script)
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\btype\s*=\s*["']?application\/(?:ld\+)?json/i.test(m[1]));
if (scripts.some(m => /\bsrc\s*=/i.test(m[1]))) { console.error("index.html loads a script from a file; add its address to the policy in scripts/pages.mjs first."); process.exit(1); }
// a browser reads every line ending as a plain line feed before it takes the fingerprint, so do the same (a file saved with Windows line endings would otherwise get fingerprints that match nothing, and a blank page)
const prints = [...new Set(scripts.map(m => `'sha256-${createHash("sha256").update(m[2].replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`))];
const policy = [
  "default-src 'none'",
  `script-src ${prints.join(" ")}`,
  "style-src 'unsafe-inline' https://use.typekit.net https://p.typekit.net", // the page's own styles, and the Adobe Fonts stylesheet
  "font-src https://use.typekit.net",
  "img-src 'self' data: https:", // the pictures inside The Yappie's articles come from other sites
  "connect-src 'self' https://theyappie.com", // the data files, and an article's text from theyappie.com when it is not stored here
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const slot = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
if (!slot.test(html)) { console.error('index.html has no <meta http-equiv="Content-Security-Policy" content="..."> tag to fill in.'); process.exit(1); }
const out = html.replace(slot, `<meta http-equiv="Content-Security-Policy" content="${policy}">`);
let wrote = 0;
const put = (f, text) => { if (existsSync(f) && readFileSync(f, "utf8") === text) return; writeFileSync(f, text); wrote++; };
put(file, out);
for (const p of PAGES) put(join(dir, p + ".html"), out);
console.log(wrote ? `Pages: ${wrote} file${wrote > 1 ? "s" : ""} updated (${prints.length} scripts in the policy).` : "Pages: nothing to update.");
