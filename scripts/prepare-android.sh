#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
npm run build
rm -rf android/app/src/main/assets/web
mkdir -p android/app/src/main/assets/web
cp -R dist/. android/app/src/main/assets/web/
echo 'Bundled web UI copied into the Android app.'
