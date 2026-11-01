# Mikozora for Windows

The desktop app is the **same web UI** that ships inside the Android
WebView, wrapped in Electron. The Android native layer is re-implemented
for Windows behind the identical `MokuBridge` contract
(`desktop/src/bridge.js` ⇄ `MainActivity.java`), the network/image
allowlists are ported 1:1 from `Network.java`
(`desktop/src/lib/allowlist.js`, `http.js`), and all on-device data keeps
the Android formats — a backup exported on Android (Settings → Your data)
imports straight into the Windows app and vice versa.

## Run it locally (any OS with Node)

```sh
# in the repo root: build the web UI once
npm ci
npm run build

# then in desktop/
npm ci
npm run sync-web   # copies ../dist into desktop/web
npm start
```

## Build the Windows executables

```sh
npm run sync-web
npm run dist
```

Produces `desktop/dist/Mikozora-v<version>-Windows-Setup.exe` (per-user
NSIS installer) and `…-Windows-Portable.exe` (single-file). GitHub Actions
(`desktop.yml`) does this on a Windows runner for every PR and attaches
both files to each GitHub release next to the APK. The executables are
unsigned, so Windows SmartScreen asks for **More info → Run anyway** on
first launch — the desktop equivalent of sideloading the APK.

The app version lives in `desktop/package.json` and is kept in lockstep
with the Android version (enforced by the repo's version-consistency
test). The in-app update checker offers the Windows Setup download on
desktop and the APK on Android.

## Roadmap (staged parity with Android)

- **Stage 1 (this release):** shell + core bridge — browsing/search,
  streaming in the built-in player (episode rail, watched checks),
  library/collections/history/Continue Watching, themes, backup &
  restore, update checks, external links.
- **Stage 2:** downloads & offline playback (porting `VideoResolver` /
  `DownloadWorker` to Node with ffmpeg muxing) and folder export.
- **Stage 3:** background new-episode alerts with a system-tray resident
  checker and Windows notifications (porting `EpisodeStore`/`EpisodeFetcher`).

The web UI probes the bridge for each capability
(`typeof MokuBridge.downloads === 'function'`, …), so unimplemented
stages degrade gracefully instead of erroring.
