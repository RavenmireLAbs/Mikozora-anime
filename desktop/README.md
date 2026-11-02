# Mikozora for Windows

The desktop app is the **same web UI** that ships inside the Android
WebView, wrapped in Electron. The Android native layer is re-implemented
for Windows behind the identical `MokuBridge` contract
(`desktop/src/bridge.js` ⇄ `MainActivity.java`), the network/image
allowlists are ported 1:1 from `Network.java`
(`desktop/src/lib/allowlist.js`, `http.js`), and all on-device data keeps
the Android formats — a backup exported on Android (Settings → Your data)
imports straight into the Windows app and vice versa.

Downloads live under Electron's per-user `userData/downloads` folder.
Expiring media URLs stay in the main process; provider/media requests use
the Node equivalent of Android's `SafeHttp`, HLS renditions are downloaded
with resume support, and completed media is converted to MP4 with the
bundled FFmpeg binary for the built-in offline player and folder export.

Episode-update state lives in `userData/episode-updates.json`. Checks run
on open, on demand, and about every six hours while the app is open or
parked in the system tray; with automatic checks on, closing the window
hides it to the tray (Quit from the tray menu exits fully), and new
episodes raise a Windows notification that opens the Updates screen.

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

- **Stage 1:** shell + core bridge — browsing/search, streaming in the
  built-in player (episode rail, watched checks),
  library/collections/history/Continue Watching, themes, backup &
  restore, update checks, external links.
- **Stage 2:** downloads & offline playback
  (`VideoResolver`/`DownloadWorker` ported to Node with FFmpeg muxing),
  resumable direct/HLS transfers, subtitles, and verified folder export.
- **Stage 3 (this release):** background new-episode alerts with a system-tray resident
  checker and Windows notifications (porting `EpisodeStore`/`EpisodeFetcher`).

The web UI probes the bridge for each capability
(`typeof MokuBridge.downloads === 'function'`, …), so unimplemented
stages degrade gracefully instead of erroring.
