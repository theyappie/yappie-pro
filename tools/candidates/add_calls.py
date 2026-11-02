#!/usr/bin/env python3
"""Append race calls to results-calls.csv and validate them with scripts/results.mjs.
usage: add_calls.py < lines     each line:  id | won/lost/runoff/recount | time e.g. 2026-11-03 21:41 ET | AP link (apnews.com, or blank) | evidence URL or note
Lines for ids already in the file replace the older row.  Only call a race when a page you read says the Associated Press called it."""
import sys, csv, subprocess, os, json
R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
P = f"{R}/results-calls.csv"
cands = {c["id"]: c for c in json.load(open(f"{R}/candidates.json"))["candidates"]}
H = ["id", "name", "state", "office", "party", "call", "time", "link", "note"]
rows = {r["id"]: r for r in csv.DictReader(open(P, encoding="utf-8"))} if os.path.exists(P) else {}
for line in sys.stdin:
    if not line.strip() or line.startswith("#"): continue
    f = [x.strip() for x in line.split("|")] + [""] * 5
    i, call, t, link, note = f[:5]
    if i not in cands: print("UNKNOWN ID", i); continue
    c = cands[i]
    rows[i] = {"id": i, "name": c["n"], "state": c["s"], "office": c["o"], "party": c["p"], "call": call, "time": t, "link": link, "note": note}
with open(P, "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, H, lineterminator="\n"); w.writeheader()
    for i in sorted(rows): w.writerow(rows[i])
env = dict(os.environ, ROOT=R, OUT=os.path.join(__import__("tempfile").gettempdir(), "_calls_check.json"), RESULTS_CSV_URL="")
r = subprocess.run(["node", f"{R}/scripts/results.mjs"], env=env, capture_output=True, text=True, cwd=R); print(r.stdout.strip()); print(r.stderr.strip() or "no problems reported")
