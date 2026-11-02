#!/usr/bin/env python3
"""List races that have no AP call yet.  usage: races.py [state ...]   (run from anywhere; reads ghrepo candidates.json + results-calls.csv)"""
import json, csv, sys, collections, os
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
cands = json.load(open(f"{R}/candidates.json"))["candidates"]
called = {}
p = f"{R}/results-calls.csv"
if os.path.exists(p):
    for r in csv.DictReader(open(p, encoding="utf-8")):
        if r.get("id") and (r.get("call") or "").strip(): called[r["id"].strip()] = r["call"].strip().lower()
want = set(a.upper() for a in sys.argv[1:])
races = collections.OrderedDict()
for c in cands:
    if want and c["s"] not in want: continue
    races.setdefault((c["s"], c["lv"], c["o"]), []).append(c)
n = 0
for (s, lv, o), cs in sorted(races.items()):
    open_ = [c for c in cs if c["id"] not in called and not c.get("un")]
    if not open_: continue
    n += 1
    print(f"{s} | {lv} | {o}")
    for c in cs:
        tag = called.get(c["id"], "unopposed" if c.get("un") else "-")
        print(f"    {c['id']:34} {c['n']:28} {c['p'][:9]:9} {c['ss']} {tag}  {c.get('x','')[:70]}")
print(f"\n{n} races with at least one candidate not yet called; {len(called)} calls recorded")
