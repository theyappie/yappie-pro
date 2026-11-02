#!/usr/bin/env python3
"""Merge the four research files into power.json for the Power map page.  usage: build_power.py ORGS_JSON OUT"""
import json, sys, re, os
D = os.path.dirname(os.path.abspath(__file__))
orgs = json.load(open(sys.argv[1], encoding="utf-8"))["orgs"]
sw = lambda t: re.sub(r"(?<![/=.\w-])AANHPI(s?)(?![A-Za-z0-9])", r"AAPI\1", t) if isinstance(t, str) else t
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", re.sub(r"\(.*?\)", " ", (s or "").lower().replace("&", " and "))).strip()
byn = {}
for o in orgs: byn[norm(o["n"])] = o["id"]
def oid(name):
    n = norm(name)
    if n in byn: return byn[n]
    n2 = re.sub(r"^the ", "", n)
    for k, v in byn.items():
        k2 = re.sub(r"^the ", "", k)
        if n2 == k2: return v
    for k, v in byn.items():
        if len(k) >= 14 and (k in n or (len(n) >= 14 and n in k)): return v
    return None
ld = lambda f: json.load(open(f"{D}/{f}.json", encoding="utf-8"))
off, ins, cas, fin = ld("officials"), ld("institutions"), ld("cases"), ld("finance")
S = lambda lst: [{"n": s["n"], "u": s["u"]} for s in lst if s.get("u", "").startswith("https://")]
out = {"v": 1, "asOf": off["asOf"], "congress": off["congress"], "notes": {}}
out["officials"] = [{k: v for k, v in {"n": o["display"], "ch": o["ch"], "st": o["st"], "dist": o.get("dist") or "", "party": o["party"], "capac": o.get("capac") or "", "capacTitle": o.get("capacTitle") or "", "basis": sw(o.get("basis", "")), "u": o.get("u", ""), "cg": o.get("cg", ""), "bio": o.get("bio", ""), "x": sw(o.get("x", "")), "unverified": 1 if o.get("unverified") else 0, "src": S(o.get("src", []))}.items() if v not in ("", 0, None, [])} for o in off["officials"]]
out["capac"] = {"count": off["capacStatedCount"]["count"], "basis": sw(off["capacStatedCount"]["basis"]), "u": off["capacStatedCount"]["u"], "leaders": off["capacLeadership"], "members": [{k: v for k, v in {"n": m["name"], "ch": m["ch"], "st": m["st"], "dist": m.get("dist", ""), "party": m["party"], "tier": m.get("tier", ""), "title": m.get("title", "")}.items() if v} for m in off["capacMembers"]]}
out["bodies"] = [{k: v for k, v in {"id": b["id"], "n": b["n"], "lvl": b["lvl"], "st": b.get("st") or "", "est": b.get("est"), "by": sw(b.get("by", "")), "appt": sw(b.get("appt", "")), "status": b["status"], "u": b.get("u", ""), "x": sw(b.get("x", "")), "unverified": 1 if b.get("unverified") else 0, "src": S(b.get("src", []))}.items() if v not in ("", 0, None, [])} for b in ins["bodies"]]
out["coalitions"] = [{"id": c["id"], "n": c["n"], "u": c["u"], "about": sw(c["about"]), "members": [{k: v for k, v in {"n": m["n"], "u": m.get("u", ""), "oid": oid(m["n"])}.items() if v} for m in c["members"]], "src": S(c.get("src", []))} for c in ins["coalitions"]]
out["cases"] = [{k: v for k, v in {"id": c["id"], "n": c["n"], "ct": c["ct"], "dkt": c.get("dkt", ""), "filed": c.get("filed", ""), "status": sw(c["status"]), "sum": sw(c["sum"]), "u": c.get("u", ""), "t": c.get("t", []), "st": c.get("st", []), "unverified": 1 if c.get("unverified") else 0, "x": sw(c.get("x", "")), "orgs": [{k2: v2 for k2, v2 in {"n": o["n"], "role": o["role"], "u": o.get("u", ""), "x": sw(o.get("x", "")), "oid": oid(o["n"])}.items() if v2} for o in c["orgs"]], "src": S(c.get("src", []))}.items() if v not in ("", 0, None, [])} for c in cas["cases"]]
fo = {o["id"]: o for o in fin["orgs"]}
out["funding"] = {"orgs": [{k: v for k, v in {"id": o["id"], "ein": o.get("ein"), "legal": o.get("legal", ""), "city": o.get("city", ""), "st": o.get("st", ""), "sub": o.get("sub", ""), "pp": o.get("pp", ""), "conf": o.get("conf", ""), "x": sw(o.get("x", "")), "arms": o.get("arms"), "sponsor": o.get("sponsor"), "unverified": 1 if o.get("unverified") else 0}.items() if v not in ("", 0, None, [])} for o in fin["orgs"]],
  "grants": [{k: v for k, v in {"funder": g["funder"], "fein": g["fein"], "to": g["to"], "amt": g["amt"], "yr": g["yr"], "fye": g.get("fye", ""), "form": g["form"], "purpose": g.get("purpose", ""), "u": g["u"], "x": sw(g.get("x", ""))}.items() if v not in ("", None)} for g in fin["grants"]]}
for k, f in (("officials", off), ("bodies", ins), ("cases", cas), ("funding", fin)): out["notes"][k] = [sw(n) for n in f.get("notes", [])]
unm = [(m["n"]) for c in out["coalitions"] for m in c["members"] if "oid" not in m]
unc = sorted({o["n"] for c in out["cases"] for o in c.get("orgs", []) if "oid" not in o})
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", os.path.getsize(sys.argv[2]), "bytes; officials", len(out["officials"]), "capac members", len(out["capac"]["members"]), "bodies", len(out["bodies"]), "coalitions", len(out["coalitions"]), "cases", len(out["cases"]), "fund orgs", len(out["funding"]["orgs"]), "grants", len(out["funding"]["grants"]))
print("coalition members without a directory profile:", len(unm), "of", sum(len(c["members"]) for c in out["coalitions"]))
print("case orgs without a directory profile:", len(unc), unc[:12])
