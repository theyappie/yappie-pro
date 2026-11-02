#!/usr/bin/env python3
"""Check that each cell's verbatim quote `q` appears on one of its cited pages.
usage: qcheck.py area.json out.json   -> out: {STATE: {"ok": bool|None, "u": matched url|None, "tried": n}}
ok True = quote found on a cited page; False = pages fetched but quote not found; None = no page could be fetched/read."""
import sys, json, re, subprocess, html, concurrent.futures as cf, tempfile, os
UA = "Mozilla/5.0 (compatible; TheYappiePro/1.0; +https://pro.theyappie.com)"
CA = os.environ.get("CA_BUNDLE", "")  # optional path to a CA bundle, only needed behind a proxy

def norm(s):
    s = html.unescape(s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-").replace(" ", " ")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return s.strip()

_cache = {}
def fetch(u):
    if u in _cache: return _cache[u]
    out = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as f: tmp = f.name
        r = subprocess.run(["curl", "-sS", "-L", "-m", "25"] + (["--cacert", CA] if CA else []) + ["-A", UA, "-o", tmp, "-w", "%{http_code} %{content_type}", u], capture_output=True, text=True, timeout=32)
        code, _, ct = r.stdout.partition(" ")
        if code.startswith("2"):
            data = open(tmp, "rb").read()
            if data[:4] == b"%PDF" or "pdf" in ct.lower():
                p = subprocess.run(["pdftotext", "-q", tmp, "-"], capture_output=True, text=True, timeout=40)
                out = p.stdout
            else:
                out = data.decode("utf-8", "replace")
        os.unlink(tmp)
    except Exception:
        out = None
    _cache[u] = norm(out) if out else None
    return _cache[u]

def check(item):
    st, c = item
    q = norm(c.get("q") or "")
    if not q or c["s"] == "none":
        return st, {"ok": None, "u": None, "tried": 0, "skip": True}
    tried = 0; got = 0
    for s in c.get("src", []):
        t = fetch(s["u"]); tried += 1
        if t is None: continue
        got += 1
        if q in t: return st, {"ok": True, "u": s["u"], "tried": tried}
    return st, {"ok": False if got else None, "u": None, "tried": tried}

if __name__ == "__main__":
    d = json.load(open(sys.argv[1]))
    with cf.ThreadPoolExecutor(10) as ex:
        res = dict(ex.map(check, d["cells"].items()))
    json.dump(res, open(sys.argv[2], "w"), indent=0)
    from collections import Counter
    print(Counter((v.get("skip") and "skip") or v["ok"] for v in res.values()))
    for k, v in sorted(res.items()):
        if not v.get("skip") and v["ok"] is not True: print(k, v["ok"], d["cells"][k]["q"][:80])
