#!/usr/bin/env python3
"""Merge the five area files (+ quote-check results) into atlas.json.  usage: build_atlas.py OUT"""
import json, sys, os
D = os.path.dirname(os.path.abspath(__file__))
AREAS = [
 ("history", "AAPI history in schools", "History", {
  "enacted": "State law requires public schools to include Asian American or Pacific Islander history or contributions.",
  "partial": "Standards only, a narrower mandate, or a law whose operative text does not name AAPI groups.",
  "pending": "A bill is alive in the 2025-26 session.",
  "none": "No such law found in the trackers and statutes checked.",
  "unclear": "Sources conflict or could not be confirmed."}),
 ("disagg", "Data broken out by subgroup", "Data", {
  "enacted": "State law requires agencies to collect or report data by Asian, Native Hawaiian or Pacific Islander subgroup.",
  "partial": "Covers one program or topic, or falls short of subgroup reporting.",
  "pending": "A bill is alive in the 2025-26 session.",
  "none": "No such law found in the trackers and statutes checked.",
  "unclear": "Sources conflict or could not be confirmed."}),
 ("language", "Language access in state government", "Language", {
  "enacted": "A state statute requires agencies to provide interpretation and translation for people with limited English.",
  "partial": "An executive order, one sector such as health care, or a law that only orders guidelines or reports.",
  "pending": "A bill is alive in the 2025-26 session.",
  "none": "No such law found in the trackers and statutes checked.",
  "unclear": "Sources conflict or could not be confirmed."}),
 ("hate", "Hate-crime statutes", "Hate crimes", {
  "enacted": "A state statute creates or increases penalties for crimes motivated by bias against race, ethnicity or national origin.",
  "partial": "Covers only some offenses, or does not name those groups.",
  "pending": "A bill is alive in the 2025-26 session.",
  "none": "No hate-crime statute found in the trackers and statutes checked.",
  "unclear": "Sources conflict or could not be confirmed."}),
 ("alienland", "Alien land and foreign-ownership laws", "Land laws", {
  "enacted": "State law restricts real-property ownership by foreign nationals or people tied to named countries, beyond farmland alone.",
  "partial": "Limited to farmland, land near military or infrastructure sites, or to governments and entities.",
  "pending": "A bill is alive in the 2025-26 session.",
  "none": "No restriction found, or only a conditional-permission or public-land rule.",
  "unclear": "Sources conflict or the enactment could not be confirmed."}),
]
out = {"v": 1, "asOf": None, "areas": [], "cells": {}}
for k, n, sh, defs in AREAS:
    d = json.load(open(f"{D}/{k}.json"))
    assert d["area"] == k and len(d["cells"]) == 51
    out["asOf"] = out["asOf"] or d["asOf"]; assert out["asOf"] == d["asOf"]
    qf = f"{D}/quotes/q_{k}.json"; qv = json.load(open(qf)) if os.path.exists(qf) else {}
    out["areas"].append({"k": k, "n": n, "sh": sh, "d": defs, "m": d["method"], "notes": d.get("notes", [])})
    for st, c in d["cells"].items():
        o = {"s": c["s"], "t": c["t"]}
        if c.get("law"): o["law"] = c["law"]
        if c.get("y"): o["y"] = c["y"]
        if c.get("q"): o["q"] = c["q"]
        if qv.get(st, {}).get("ok") is True: o["qv"] = 1
        if c.get("x"): o["x"] = c["x"]
        o["src"] = [({"n": s["n"], "u": s["u"], "p": 1} if s.get("p") else {"n": s["n"], "u": s["u"]}) for s in c.get("src", [])]
        out["cells"].setdefault(st, {})[k] = o
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print("wrote", sys.argv[1], os.path.getsize(sys.argv[1]), "bytes;", len(out["cells"]), "states")
