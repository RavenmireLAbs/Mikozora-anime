# Building the APK

## Prerequisites

- **JDK 17** (Java Development Kit)
- **Android SDK** with platform 35 and build-tools 35.0.0
- **Node.js 18+** and npm (for the web layer)

## Quick build (web + APK)

```bash
cd movie-app
./build-android.sh
```

This runs `npm run build` to compile the web app, copies the output into
`android/app/src/main/assets/web/`, then runs `./gradlew assembleDebug`.

The APK will be at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## Manual build

### Step 1 — Build the web app

```bash
cd movie-app
npm install
npm run build
```

The built files are in `dist/`.

### Step 2 — Copy web assets into the Android project

```bash
rm -rf android/app/src/main/assets/web
mkdir -p android/app/src/main/assets/web
cp -r dist/* android/app/src/main/assets/web/
```

### Step 3 — Build the APK

```bash
cd android
./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`

### Release build

```bash
cd android
./gradlew assembleRelease
```

The release APK is unsigned by default. To sign it, create a keystore and
add signing config to `app/build.gradle`, or use `apksigner` to sign manually.

## Installing

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Or sideload the APK on your device.

## Setting up Android SDK

If you don't have the Android SDK, install it via the command line:

```bash
# Download command-line tools from https://developer.android.com/tools/downloads
sdkmanager "platforms;android-35" "build-tools;35.0.0"
```

Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK root path, or create a
`local.properties` file in the `android/` directory:

```
sdk.dir=/path/to/Android/Sdk
```

## Testing the web app in a browser

Before building the APK, you can test the web layer directly:

```bash
npm run dev
```

Then open `http://localhost:5173` in a browser. Note: the movie sources may
block cross-origin requests from a browser. The app falls back to a CORS
proxy in the browser; the native bridge (used in the Android app) avoids this
entirely.
