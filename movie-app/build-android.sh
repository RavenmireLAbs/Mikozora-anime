#!/bin/bash
# One-shot build: compile the web app, copy to Android assets, assemble debug APK.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Building web app…"
npm install --silent
npm run build

echo "==> Copying web assets to Android…"
rm -rf android/app/src/main/assets/web
mkdir -p android/app/src/main/assets/web
cp -r dist/* android/app/src/main/assets/web/

echo "==> Building debug APK…"
cd android
./gradlew assembleDebug

echo "==> Done. APK at: android/app/build/outputs/apk/debug/app-debug.apk"
