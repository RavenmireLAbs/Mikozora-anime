# Mikozora

An Android-first anime and donghua browser inspired by the source-based discovery, library and history idea in [Kotatsu Redo](https://github.com/Kotatsu-Redo/Kotatsu-Redo). Mikozora is an independent project; it does not include Kotatsu's code or manga parsers.

**Mikozora was previously called Moku.** The app keeps the legacy `app.moku.anime` and `moku.*` values for its Android application ID and on-device storage identifiers. Releases from 0.13.0 onward use Mikozora's permanent Android signing key; a debug-signed 0.12.0 or earlier installation must be uninstalled once before moving to a permanently signed release. See [`docs/SIGNING.md`](docs/SIGNING.md).

## Download

Get the latest build from [GitHub Releases](https://github.com/RavenmireLAbs/Mikozora-anime/releases/latest):

- Android: `Mikozora-v<version>-Android.apk` (Android 6.0+ with an up-to-date Android System WebView)
- Windows 10/11: `Mikozora-v<version>-Windows-Setup.exe` or `Mikozora-v<version>-Windows-Portable.exe`

Windows builds are unsigned, so SmartScreen may ask for **More info → Run anyway** on first launch. Signed Android releases from 0.13.0 onward update in place.

## Features

- **Browse and watch:** ten sources—AnimeSogo, AnimeSuge, Anikoto, Animerulz, Aniwaves, AnimeBash, AnimeXin, NarulDonghua, DonghuaStream and DonghuaWorld—with local taste-based picks, Discover/Trending rails, search, saved/not-saved views, sorting for loaded results, and source/status/genre/year/content filters where a source supports them. Multi-source searches group likely versions of the same show and expose the other listings through “Also on” buttons. Cards show source-provided age ratings (or NR), and adult-marked titles can be hidden completely.
- **Library and progress:** save titles, organise them into Favourites and personal collections, add your own ratings, shelf statuses and private notes, search/sort/filter the library, use bulk collection actions, keep local history, mark episodes watched/unwatched by hand, and resume from Continue Watching. A series page can find the same show on another existing source; after you explicitly link two listings as the same show, watched episode numbers carry between those versions while library entries, collections, shelf data and downloads remain source-specific. Series pages and players add next-unwatched and episode-number jumps; players keep Previous/Next controls, server switching and a scrollable episode rail with watched checks. Offline players share remembered speed, configurable 5–30 second seeks, restart, subtitle size/colour/background choices, a sleep timer and optional auto-play of the next completed episode from the same series; on Android, those offline tools hide with the playback controls during playback and return when you tap the video.
- **Online and offline playback:** when a server provides a direct stream Mikozora can play, Android uses its own Media3 player and Windows uses its built-in direct player, with exact device-local resume, remembered speed, configurable seeks, subtitle styling, a sleep timer and optional auto-next. Servers that only provide an embed keep the clearly labelled embedded player; those third-party players cannot report an exact timestamp to Mikozora. Offline players share the same core playback preferences.
- **Discovery and finding things:** local “Because you watched” picks, similar-title explanations, mood shelves, a random watch picker, recent/saved searches and a Command Centre (Command button or Ctrl/⌘+K) spanning pages, library, history, progress, Planner, Downloads and Release Radar already loaded on the device.
- **Planner and stats:** Home and Planner build a local catch-up queue from started series, with episodes-behind counts, Tonight/This weekend/Later plans, per-title sitting sizes and generated binge sessions. Watch Stats shows streaks, weekly/monthly activity, favourite genres/sources/series, completion and shelf totals, plus a monthly Wrapped recap.
- **Release Radar:** titles in Favourites or a personal collection are checked on open and periodically. The first check is a quiet baseline; later additions and ready Smart Downloads share one inbox, with digest, Last 14 days and alert-history views. Per-title Alerts + inbox, Inbox only and Muted modes plus 7/30-day snoozes control device alerts without stopping checks.
- **Downloads:** queue single episodes or batches, choose server/quality when offered, keep Automatic subtitles, choose reported subtitle tracks, or skip separate subtitles. Downloads can be retried, changed to another server, and played offline. **Offline Manager 2.0** adds storage totals by series/source, watched and folder-copy markers, search/filter/sort/group tools, bulk actions, persisted queue priority, storage limits and optional watched-episode cleanup rules; incomplete downloads, active exports and verified folder-only records are not cleanup candidates. **Smart Downloads** can automatically queue genuinely new episodes for selected series/collections, with a per-series unwatched limit and an Android unmetered-only option.
- **Library portability and sharing:** export or import saved titles, collections, shelf data and watched counts as local Mikozora JSON, CSV, MAL-style XML or AniList-style JSON. Imports show a merge preview with exact, possible-duplicate and unmatched rows; title-only rows are never guessed, but can be matched by searching and choosing a source listing. Wrapped and series SVG cards are generated locally.
- **Sync and backup:** Android and Windows can two-way sync through a shared folder you already keep with Syncthing, OneDrive, Dropbox, a NAS or another file-sync service. Manual backup export/import remains available for moving data by file.
- **Personalisation and updates:** dark/light modes with accent colours, content preferences, latest-only What's New notes, and in-app checks for newer GitHub releases.

## Device Sync and privacy

Choose the same shared folder in **Settings → Device Sync** on Android and Windows. Each installation writes only its own `mikozora-sync-<platform>-<device-id>.json` file; your file-sync service carries it, and Mikozora merges changes when it opens, when you return to it, periodically, shortly after synced data changes, or when you press **Sync now**.

Sync covers library titles, collections, history, watch progress, confirmed source-version links, personal ratings, shelf statuses and private notes, appearance, content preferences and Smart Downloads settings—including deletions, collection changes, source-link changes and episodes marked unwatched. Downloaded episodes/queues, download/export folders, episode-alert state, offline playback positions, app-update choices and startup state stay on each device. Sync files are not end-to-end encrypted, so use only a folder and service you trust. Manual backups include library/collection/personal-shelf/history/progress/confirmed source-link data, planner choices, offline-manager rules, offline/online playback settings and direct positions, Release Radar rules, pending imported watched counts, recent/saved searches and other backed-up settings, but not downloaded videos, native download records/queues or per-device sync identity/state.

## Folder copies and external players (Android)

1. Choose a writable folder in **Settings → Download location**.
2. Download an episode, or use **Downloads → Save to folder** for an existing download.
3. Mikozora saves a verified playable MP4 and any saved subtitle sidecars in a subfolder named for the title, then can play from that copy or hand it to an external player with **Open file**.

Changing the folder or stopping folder copies does not move or delete files already saved. Removing a download inside Mikozora or uninstalling the app also leaves exported folder files alone. Do not move, rename or revoke access to a folder copy if you want its Downloads entry to keep playing. Conversion depends on the source format, device codecs and Android storage provider; unsupported or DRM streams fail instead of being presented as complete.

## Limitations

- Downloads are host-dependent. Unsupported mirrors, DRM, unavailable files, anti-bot checks, regional restrictions and changing source/host APIs can make an episode fail; retry, change server, or open the original site.
- Subtitles are source/server dependent. Automatic Anime downloads keep identifiable English tracks; explicit choices can save other reported tracks. Burned-in or embedded captions may not be removable, and Mikozora does not create subtitles.
- Downloads can be large and may use mobile data. Battery/network limits, timeouts or low storage can interrupt them.
- Mikozora has no Mikozora-run cloud account, tracker integrations or installable extensions. Direct online playback is host-dependent: a server may provide only an embed, reject a direct stream or change its API, in which case Mikozora falls back to the embedded player. Exact online resume is available only from Mikozora’s direct players; embedded players do not expose a timestamp. Release Radar dates are when Mikozora discovered an episode, not source-provided air dates. Watch Stats covers the latest 100 opened episodes stored locally, and watch time is estimated from a reported duration or 24 minutes per episode.
- Use sources and content you have the right to access. Mikozora is not affiliated with the source sites, Kotatsu or their video hosts.

## Build from source

Requirements: Node.js 20+, Java 17, Android SDK Platform 35 and Android build tools. The committed `android/app/src/main/assets/web/` already contains the built UI, so Android Studio can build `debug` without Node until the web UI changes.

After changing the web UI:

```sh
npm ci
npm test
npm run prepare:android
cd android
./gradlew assembleDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. For Windows, see [`desktop/README.md`](desktop/README.md). For a browser preview, run `npm run dev` and open the Vite address; native Android/Windows features are limited or unavailable there.

## Tests

`npm test` runs the main unit, source-adapter, data, sync and wiring checks. Additional UI/native harnesses live in `tests/` and `scripts/`; simulated bridge/UI tests are useful, but they are not a substitute for real-device playback and download checks.

## License

The original Mikozora code is MIT licensed. Third-party credits, licenses and fonts are in `third_party_licenses/` and in the app's settings. Anime titles, artwork and video belong to their respective owners and are obtained from the chosen sources at runtime.
