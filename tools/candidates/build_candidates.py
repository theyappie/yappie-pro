#!/usr/bin/env python3
"""Turn the compiled candidate workbook (Confirmed tab) into candidates.json for the Election results page.
usage: build_candidates.py <workbook.xlsx> <taxonomy.json> <out candidates.json> [compiled-date]"""
import sys, re, json, openpyxl, collections

xlsx, taxp, out = sys.argv[1:4]
compiled = sys.argv[4] if len(sys.argv) > 4 else "2026-11-01"
tax = json.load(open(taxp))
USPS = {s[1]: s[0] for s in tax["states"]}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

LV = {"Congress": "congress", "Statewide executive": "statewide", "State legislature": "legislature"}
GROUPS = [  # (label, pattern applied to the first phrase of the heritage text only)
    ("Chinese", r"chinese|hong kong"), ("Taiwanese", r"taiwan"), ("Japanese", r"japanese|okinawan"), ("Korean", r"korean"),
    ("Filipino", r"filipin"), ("Vietnamese", r"vietnam"), ("Indian", r"\bindian\b|indian-|indo-"), ("Pakistani", r"pakistan"),
    ("Bangladeshi", r"banglad"), ("Nepali", r"nepal"), ("Sri Lankan", r"sri lank"), ("Afghan", r"afghan"),
    ("Hmong", r"hmong"), ("Cambodian", r"cambod"), ("Thai", r"\bthai\b"),
    ("Native Hawaiian", r"native hawaiian|kanaka"), ("Samoan", r"samoan"), ("Tongan", r"tongan"), ("Pacific Islander", r"pacific islander"),
    ("South Asian", r"^south asian|south asian american"),
]
PARTY = lambda p: "D" if re.match(r"^(D\b|DFL)", p) else "R" if re.match(r"^R\b", p) else "O"
SEAT = lambda s: ("I" if re.match(r"^inc", s, re.I) else "C" if re.match(r"^chal", s, re.I) else "O" if re.match(r"^open", s, re.I) else "N")

wb = openpyxl.load_workbook(xlsx, data_only=True)
rows = [r for r in list(wb["Confirmed"].iter_rows(values_only=True))[1:] if r[2]]
cands, seen = [], collections.Counter()
for r in rows:
    lv, state, name, office, party, her, seat, notes, flags, ev, src = [(c or "").strip() if isinstance(c, str) else c for c in r[:11]]
    if lv not in LV or state not in USPS: raise SystemExit(f"unexpected row: {r[:4]}")
    first = re.split(r"\s*[(;:\[]\s*", her)[0].strip().rstrip(",")
    gs = [g for g, pat in GROUPS if re.search(pat, first, re.I)]
    if not gs and re.search(r"asian american|asian", first, re.I): gs = ["Asian American"]
    if not gs: raise SystemExit(f"no heritage group for {name}: {her!r}")
    m = re.search(r"\((\d+) seats?\)", office) or re.search(r"(\d+)-seat", notes or "")
    base = re.sub(r"\s*\(\d+ seats?\)", "", office).strip()
    fl = [f.strip() for f in (flags or "").split(";") if f.strip() and not f.strip().startswith("2+ AANHPI")]
    cid = f"{USPS[state].lower()}-{slug(name)}"; seen[cid] += 1
    if seen[cid] > 1: cid += f"-{seen[cid]}"
    urls = [u for u in re.split(r"[\s;]+", src or "") if re.match(r"https://", u)][:3]
    sn = re.search(r"\((.+)\)", seat or "")
    c = {"id": cid, "n": name, "s": USPS[state], "lv": LV[lv], "o": base, "p": party, "pg": PARTY(party), "h": first, "g": gs,
         "ev": "M" if ev == "Moderate" else "S", "ss": SEAT(seat or ""), "x": (notes or "").strip(), "u": urls}
    if m: c["seats"] = int(m.group(1))
    if sn: c["sn"] = sn.group(1)
    if "Unopposed" in fl: c["un"] = 1
    fl = [f for f in fl if f != "Unopposed"]
    if fl: c["fl"] = fl
    cands.append(c)

order = {"congress": 0, "statewide": 1, "legislature": 2}
nat = lambda s: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]
cands.sort(key=lambda c: (order[c["lv"]], tax["states"][[s[0] for s in tax["states"]].index(c["s"])][1], nat(c["o"]), c["n"]))
doc = {"v": 1, "compiled": compiled,
       "note": "Compiled from candidate trackers, Ballotpedia, state election results and community press. Not an official list. Heritage is as sourced; Moderate evidence means a single or secondary source.",
       "candidates": cands}
json.dump(doc, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(cands), "candidates;", collections.Counter(c["lv"] for c in cands), collections.Counter(g for c in cands for g in c["g"]).most_common(),
      "unopposed", sum(1 for c in cands if c.get("un")), "bytes", len(json.dumps(doc, ensure_ascii=False)))
