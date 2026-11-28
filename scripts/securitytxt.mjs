// Writes .well-known/security.txt (RFC 9116): where someone who finds a security problem can report it. The report goes to GitHub's private form for this repository (Settings, Advanced Security,
// Private vulnerability reporting), which only the owner can read. The file must carry an Expires date, and one that has expired is worse than none, so every update renews it: the date is the 1st of the month
// four months ahead, so it is always three to four months away and the file changes once a month. Run by the update workflow; it writes the file only when its text changes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CONTACT = "https://github.com/theyappie/yappie-pro/security/advisories/new";
export const CANONICAL = "https://pro.theyappie.com/.well-known/security.txt";

export function securityTxt(ms = Date.now()) {
  const d = new Date(ms);
  const expires = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 4, 1)).toISOString().slice(0, 19) + "Z";
  return `Contact: ${CONTACT}\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${CANONICAL}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL("../.well-known/", import.meta.url), file = new URL("security.txt", dir), text = securityTxt();
  mkdirSync(dir, { recursive: true });
  if (existsSync(file) && readFileSync(file, "utf8") === text) console.log("security.txt is up to date.");
  else { writeFileSync(file, text); console.log("security.txt written (" + text.split("\n")[1] + ").") }
}
