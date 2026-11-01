#!/bin/sh
# Usage: tools/stills.sh OUTDIR t1 t2 ...   — headless Edge stills of dist/echolocation.html#t=
OUT="$1"; shift
ROOT="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
mkdir -p "$OUT"
for t in "$@"; do
  "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --hide-scrollbars --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist \
    --allow-file-access-from-files --window-size=1920,1080 --virtual-time-budget=30000 \
    --screenshot="$OUT/t$t.png" "file:///$ROOT/dist/echolocation.html?w=1920&h=1080#t=$t" >/dev/null 2>&1
done
ls "$OUT"
