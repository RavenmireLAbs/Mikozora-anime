#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPS="${TMPDIR:-/tmp}/moku-resolver-test-deps"; OUT="${TMPDIR:-/tmp}/moku-resolver-test-classes"
mkdir -p "$DEPS" "$OUT"
[ -s "$DEPS/jsoup.jar" ] || curl -fsSL https://repo.maven.apache.org/maven2/org/jsoup/jsoup/1.17.2/jsoup-1.17.2.jar -o "$DEPS/jsoup.jar"
[ -s "$DEPS/json.jar" ] || curl -fsSL https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar -o "$DEPS/json.jar"
CP="$DEPS/jsoup.jar:$DEPS/json.jar"
"${JAVA_HOME:+$JAVA_HOME/bin/}javac" -cp "$CP" -d "$OUT" \
  "$ROOT/tests/stubs/android/util/Base64.java" \
  "$ROOT/android/app/src/main/java/app/moku/anime/Network.java" \
  "$ROOT/android/app/src/main/java/app/moku/anime/SafeHttp.java" \
  "$ROOT/android/app/src/main/java/app/moku/anime/SubtitlePolicy.java" \
  "$ROOT/android/app/src/main/java/app/moku/anime/VideoResolver.java" \
  "$ROOT/tests/NativeDownloadResolverSmoke.java"
"${JAVA_HOME:+$JAVA_HOME/bin/}java" -cp "$OUT:$CP" app.moku.anime.NativeDownloadResolverSmoke
