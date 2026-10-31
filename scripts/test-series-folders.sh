#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="${TMPDIR:-/tmp}/moku-series-folder-test-classes"
mkdir -p "$OUT"
"${JAVA_HOME:+$JAVA_HOME/bin/}javac" -encoding UTF-8 -d "$OUT" \
  "$ROOT/android/app/src/main/java/app/moku/anime/SeriesFolderName.java" \
  "$ROOT/tests/SeriesFolderNameSmoke.java"
"${JAVA_HOME:+$JAVA_HOME/bin/}java" -cp "$OUT" app.moku.anime.SeriesFolderNameSmoke
