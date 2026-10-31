#!/bin/sh
# Build a throwaway debug APK with an extra test-only activity. The activity and
# manifest entry are removed even if Gradle fails; never distribute this APK.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP="${TMPDIR:-/tmp}/moku-episode-device-build"
MANIFEST="$ROOT/android/app/src/main/AndroidManifest.xml"
BUILD_FILE="$ROOT/android/app/build.gradle"
ACTIVITY="$ROOT/android/app/src/main/java/app/moku/anime/EpisodeWorkerDeviceTestActivity.java"
mkdir -p "$TMP"
cp "$MANIFEST" "$TMP/AndroidManifest.xml"
cp "$BUILD_FILE" "$TMP/build.gradle"
restore(){ cp "$TMP/AndroidManifest.xml" "$MANIFEST"; cp "$TMP/build.gradle" "$BUILD_FILE"; rm -f "$ACTIVITY"; }
trap restore EXIT HUP INT TERM
cp "$ROOT/tests/android/EpisodeWorkerDeviceTestActivity.java" "$ACTIVITY"
python3 - "$MANIFEST" "$BUILD_FILE" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
s=s.replace('<activity android:name=".MainActivity"', '<activity android:name=".EpisodeWorkerDeviceTestActivity" android:exported="true" />\n        <activity android:name=".MainActivity"')
p.write_text(s)
p=Path(sys.argv[2]);s=p.read_text().replace("applicationId 'app.moku.anime'", "applicationId 'app.moku.anime.episodetest'")
p.write_text(s)
PY
"${GRADLE:-gradle}" -p "$ROOT/android" --no-daemon --max-workers 2 assembleDebug
cp "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" "$TMP/episode-device-test-only.apk"
echo "Test-only APK: $TMP/episode-device-test-only.apk"
