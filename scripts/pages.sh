#!/bin/bash
# usage: pages.sh <dir with index.html> — GitHub Pages serves policy.html at /policy, so each page address gets its own copy of the app; 404.html answers any other address (e.g. /policy/) with the same app, which then corrects the address
d=$1; [ -f "$d/index.html" ] || { echo "no index.html in $d"; exit 1; }
for f in policy advocacy research saved 404; do cp "$d/index.html" "$d/$f.html"; done
