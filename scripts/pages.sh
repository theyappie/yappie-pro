#!/bin/bash
# usage: pages.sh <dir with index.html> — (the front page index.html is the welcome page; the news list is news.html at /news; events.html and elections.html are older addresses that now lead to the Calendar, Policy and Numbers pages) GitHub Pages serves policy.html at /policy, so each page address gets its own copy of the app; 404.html answers any other address (e.g. /policy/) with the same app, which then corrects the address
d=$1; [ -f "$d/index.html" ] || { echo "no index.html in $d"; exit 1; }
for f in news policy advocacy research hubs calendar events numbers elections orgs saved 404; do cp "$d/index.html" "$d/$f.html"; done
