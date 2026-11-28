#!/bin/bash
# usage: pages.sh <dir with index.html>
# Run this after every change to index.html. It writes the page's content security policy and makes the copy of the app that each page address needs (see scripts/pages.mjs).
d=${1:-.}; [ -f "$d/index.html" ] || { echo "no index.html in $d"; exit 1; }
node "$(dirname "$0")/pages.mjs" "$d"
