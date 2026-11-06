#!/bin/sh
# Rebuilds "Join the hunt" (Kalikkam, Field Map Doodle): sound events -> picture -> score -> film.
# Usage: sh build.sh            (writes out/ and kalikkam-join-the-hunt.mp4 here)
#        OUT=<folder> sh build.sh   (writes everything, the film too, to <folder>)
set -e
LIB=${LIB:-C:/Users/Abcom/lemo-opuscar}
export LIB
HERE=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
if [ -n "$OUT" ]; then FILM="$OUT/kalikkam-join-the-hunt.mp4"; else OUT="$HERE/out"; FILM="$HERE/kalikkam-join-the-hunt.mp4"; fi
mkdir -p "$OUT"
PY="$LIB/.venv/bin/python"; [ -x "$PY" ] || PY="$LIB/.venv/Scripts/python.exe"
cd "$LIB"
node core/render/events.mjs "$HERE" --size 1080x1920 --out "$OUT/events.json"
node core/render/video.mjs "$HERE" --fps 30 --size 1080x1920 --workers 3 --out "$OUT/video.mp4"
"$PY" "$HERE/score.py" "$OUT/mix.wav" "$OUT/events.json"
sh core/render/mux.sh "$OUT/video.mp4" "$OUT/mix.wav" "$FILM" 30 0
