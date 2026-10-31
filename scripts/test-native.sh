#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
"${JAVA_HOME:+$JAVA_HOME/bin/}javac" -d "$TMP_DIR" "$ROOT/android/app/src/main/java/app/moku/anime/Network.java" "$ROOT/tests/NativeNetworkSmoke.java" "$ROOT/tests/NativeSourceRulesSmoke.java"
"${JAVA_HOME:+$JAVA_HOME/bin/}java" -cp "$TMP_DIR" app.moku.anime.NativeSourceRulesSmoke
"${JAVA_HOME:+$JAVA_HOME/bin/}java" -cp "$TMP_DIR" app.moku.anime.NativeNetworkSmoke
