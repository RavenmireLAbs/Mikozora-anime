#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
javac -d "$TMP_DIR" "$ROOT/android/app/src/main/java/app/moku/anime/Mp4CttsFixer.java" "$ROOT/tests/Mp4CttsFixerSmoke.java"
java -cp "$TMP_DIR" app.moku.anime.Mp4CttsFixerSmoke
