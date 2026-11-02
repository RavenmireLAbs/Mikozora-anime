// Keep this version in sync with package.json and android/app/build.gradle.
// Append a new entry at the front for each release; the app shows only that newest entry.
export const APP_VERSION = '0.25.0';
export const EXPERIENCE_KEY = 'moku.startup.v1';
export const LEGACY_KEYS = ['moku.library.v1', 'moku.history.v1', 'moku.collections.v1'];

export const RELEASES = [
  {
    version: '0.25.0',
    label: 'LATEST UPDATE',
    entries: [
      { title: 'Smart Downloads for series and collections', description: 'Turn on Smart Downloads for an individual series or a whole collection, and Mikozora automatically queues genuinely new episodes when its episode checker finds them. The first check still establishes a quiet starting point, so turning it on never downloads the existing backlog. Android can check and download in the background; on Windows, keep Mikozora open or resting in the system tray.' },
      { title: 'Your download choices are remembered', description: 'Each series reuses the language, server, quality and separate subtitle tracks from the last manual download Mikozora successfully queued for it, and the download dialog preselects those choices when they are still offered. If you have never downloaded that series manually, Smart Downloads uses Automatic and Best.' },
      { title: 'Storage and mobile-data safeguards', description: 'Choose how many unwatched automatically downloaded episodes Mikozora may keep waiting per series; newer episodes wait until you watch or mark one watched. Android can also restrict Smart Downloads to Wi‑Fi or another unmetered connection. Windows cannot reliably tell whether a connection is metered, so it does not pretend to offer that switch.' },
      { title: 'Ready-to-watch alerts', description: 'Smart downloads are labelled in Downloads, and Mikozora can notify you once when one is ready offline; tapping the notification opens Downloads. Playing a downloaded episode now counts it as watched, matching online playback and freeing space under the Smart Download limit.' },
      { title: 'What’s new stays focused', description: 'After a first install or an update, Mikozora now shows only the newest version’s changes instead of repeating the older release history. Settings → What’s new uses the same latest-only view.' },
    ],
  },
  {
    version: '0.24.5',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows downloads work from image-disguised servers', description: 'Some servers, including HD-1, hide each video segment behind a tiny image. Android sees through that disguise, but the Windows converter treated the combined download as a 1×1 picture and stopped with “Could not convert this downloaded stream to MP4”. Mikozora now removes the image disguise from every segment before the episode is combined and converted. Retry an episode that failed this way and the parts already on your computer are cleaned and reused instead of downloading again. Android is unchanged.' },
    ],
  },
  {
    version: '0.24.4',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows downloads from split-audio servers keep their sound', description: 'Some servers (the HD-1 server among them) serve a video stream that declares an audio track which never actually carries any sound — the real audio is a separate stream. On Windows that empty declaration fooled Mikozora into treating the video as already having sound, so the separate audio was never paired and the download then failed at conversion, while other servers such as Vidstream worked. Mikozora now recognises an audio declaration with nothing behind it, pairs the server’s real audio stream, and converts the result with sound. Retry an episode that failed this way and it reuses the parts already downloaded. Android is unchanged.' },
    ],
  },
  {
    version: '0.24.3',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows conversion gets more chances to succeed', description: 'After the sound fix in 0.24.2, some Windows downloads could stop at “Could not convert this downloaded stream to MP4” when converting that server’s video for the built-in player failed on the first attempt. Mikozora now converts only the part the player cannot handle — video or audio — when it can, retries with a more forgiving conversion, and checks paired audio files before using them. If an episode still cannot be converted, the error now shows the converter’s actual reason. Retrying a failed episode reuses the parts already downloaded, so it goes straight back to conversion. Android is unchanged.' },
    ],
  },
  {
    version: '0.24.2',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows downloads keep their sound', description: 'Some Windows downloads finished as “Ready to watch offline” but the saved episode had no sound — and some would not play at all. Certain servers keep the audio in a separate stream that the download did not pair, or serve a video format the built-in player cannot decode. Mikozora now pairs the server’s audio stream, converts anything the player cannot handle, and only counts a download as complete when the finished file really has picture and sound.' },
      { title: 'Already-saved broken copies are flagged', description: 'Episodes saved without sound by earlier Windows versions are detected when Mikozora starts and marked as failed with an explanation, so you can download them again instead of wondering why the player stays black. Healthy downloads are untouched. Android is unchanged in this release.' },
    ],
  },
  {
    version: '0.24.1',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows updates download the Windows build', description: 'In the Windows app, “Download update” was saving the Android APK instead of the Windows installer. The update banner and Settings → About → App updates now download the Windows Setup build on Windows, as intended. If an earlier click left a Mikozora .apk file in your Windows Downloads folder, you can simply delete it. Android updates are unchanged.' },
    ],
  },
  {
    version: '0.24.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Choose which subtitles a server saves', description: 'The download dialog now lists the separate subtitle tracks a selected server reports — including AnimeSogo and the other supported sources. Keep Automatic, tick one or more languages or named tracks such as an SDH/CC variant, or choose no separate subtitles. On Anime sources, Automatic still saves identifiable English tracks, but an explicit choice can save a different language instead.' },
      { title: 'Your choice stays with the episode', description: 'Mikozora remembers your subtitle choice for retries, uses the first chosen saved track as the playback default, and copies those same tracks into a verified folder save on Android and Windows. When you change a failed download’s server, choosing the same server restores its earlier subtitle picks.' },
      { title: 'Only tracks the server actually offers', description: 'Choices are matched by language and label on every episode, without storing expiring subtitle web addresses. If none of your chosen tracks is available for an episode, that episode fails with a clear message rather than silently switching. Servers with no separate tracks say so, and subtitles burned into the video cannot be removed.' },
    ],
  },
  {
    version: '0.23.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'New-episode alerts arrive on Windows', description: 'The Windows app now checks your Favourites and personal collections for new episodes, just like Android: when it opens and about every six hours after that. The first check quietly sets a starting point, so existing episodes never trigger a flood of alerts, and anything genuinely new lands in Updates with badges on your library cards.' },
      { title: 'Mikozora waits in the tray', description: 'While automatic checks are on, closing the Windows window parks Mikozora in the system tray so background checks and Windows notifications keep working. Double-click the tray icon to come back, use its menu to check right away, or choose Quit Mikozora to exit fully. Turn automatic checks off in Settings and closing the window quits as before.' },
      { title: 'Full parity, one app', description: 'With episode alerts in place, the Windows app now matches Android across browsing, streaming, downloads, offline playback and episode updates. Android itself is unchanged in this release.' },
    ],
  },
  {
    version: '0.22.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Downloads arrive on Windows', description: 'The Windows app can now download episodes for offline viewing, just like Android. Queue a single episode or a batch, choose an available server and quality, and Mikozora resolves the media privately, saves the right subtitles and converts streams into playable MP4 files.' },
      { title: 'Watch without a connection', description: 'Completed downloads open in a built-in offline player on Windows, with saved subtitle tracks and your place remembered on that computer. Interrupted downloads resume their saved work when they can instead of starting over.' },
      { title: 'Keep a folder copy', description: 'Choose a download folder on Windows and Mikozora can save one folder per series with the episode MP4 and matching subtitles. New downloads are copied automatically, older ones can be saved with “Save to folder”, and every copy is verified before the in-app copy is removed.' },
      { title: 'Android stays just as it was', description: 'Android downloads, offline playback and folder export are unchanged. Background new-episode alerts are the remaining Windows feature still to come.' },
    ],
  },
  {
    version: '0.21.1',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Windows playback fixed', description: 'Third-party video hosts could reject episodes in the Windows app with a 410 error because the player embed arrived from the app’s private origin instead of the source site that supplied it. Windows now presents the same source-origin context as the Android player. Android playback is unchanged.' },
    ],
  },
  {
    version: '0.21.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Mikozora comes to Windows', description: 'The same Mikozora now runs on Windows 10 and 11: download the Windows Setup (or portable) build from the GitHub release page. Browsing, streaming, library, collections, Continue Watching and themes all work just like on your phone — and a backup exported here imports straight into the Windows app, so your data comes with you. First launch may ask you to choose “More info” → “Run anyway”, as the installers are unsigned for now.' },
      { title: 'On Windows, downloads and alerts are next', description: 'This first Windows release streams everything in the built-in player; episode downloads for offline viewing and background new-episode alerts are being ported next. On Android, this update only prepares the shared groundwork — nothing about the phone app changes.' },
    ],
  },
  {
    version: '0.20.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Back up everything, restore anywhere', description: 'Settings → Your data can now export your library, collections, history, watch progress and settings to a single backup file — and restore that file again on this device or a new one. Downloaded videos stay where they are; they are not part of the backup.' },
      { title: 'Mark episodes watched by hand', description: 'Watched somewhere else first? Tap the circle beside any episode to mark it watched (tap again to undo), or select a run of episodes and choose Mark watched or Mark unwatched. Continue Watching and your progress counts follow immediately.' },
      { title: 'Blue is the new default look', description: 'Fresh installs now start with the dark theme and a blue accent. If you have already chosen an appearance it is kept exactly as it is, and the original green remains one tap away in Settings → Appearance.' },
      { title: 'The right next episode, from every source', description: 'Some sources list episodes newest-first, which could throw off next-up suggestions. Mikozora now keeps every series in story order, so Continue Watching always offers the right next episode.' },
    ],
  },
  {
    version: '0.19.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Watched checks reach the Android player', description: 'Episodes you have already opened now carry a check and a dimmer label in the Android player’s episode rail, matching the markers on series pages and in the browser player.' },
      { title: 'Always current while you watch', description: 'The marks update as you move through a series with Previous, Next or the episode rail, so you always know exactly where you are without leaving the player.' },
    ],
  },
  {
    version: '0.18.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Update downloads work again', description: 'Tapping “Download update” could silently do nothing, because GitHub links were blocked by the same allowlist that protects source links. Mikozora now lets its own GitHub release links open in your browser as intended.' },
      { title: 'Sorry about the detour', description: 'If you fetched this update from the GitHub releases page because the button did nothing — that was this bug. From now on, update banners take you straight to the download again.' },
    ],
  },
  {
    version: '0.17.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Continue watching, right where you left off', description: 'Home now leads with a Continue watching rail: one tap plays the next unwatched episode of each series you are in the middle of, with your progress shown on every card.' },
      { title: 'See what you have already watched', description: 'Opened episodes are marked WATCHED in episode lists and carry a check in the player’s episode rail, and Library cards show your progress — like 7/12 — with a slim progress bar.' },
      { title: 'Your progress stays yours', description: 'Progress is saved only on this device, alongside your history, and episodes you opened before this update still count. Remove a series from the rail with its × button, or clear everything together with your history.' },
    ],
  },
  {
    version: '0.16.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Mikozora can spot its own updates', description: 'From now on, Mikozora quietly checks GitHub when it opens and shows a small banner when a newer version is ready — no more visiting the releases page just to find out.' },
      { title: 'One tap to the new APK', description: 'The banner and Settings → About → App updates link straight to the download. New versions install over your current one, so your library, history and downloads stay put.' },
      { title: 'Polite about it', description: 'Checks happen at most twice a day. Dismiss a version to skip it, check manually whenever you like, or turn automatic checks off in Settings → About.' },
    ],
  },
  {
    version: '0.15.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'A new dawn for Mikozora', description: 'Mikozora has a new app icon: a torii gate beneath the morning star, with the sun rising between its pillars — shrine and sky, just like the name.' },
      { title: 'At home on every launcher', description: 'The icon now adapts to your launcher’s shape and includes a themed monochrome version on Android 13 and newer.' },
      { title: 'Same Mikozora inside', description: 'Your library, collections, history, downloads and settings are untouched — only the face of the app changed.' },
    ],
  },
  {
    version: '0.14.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Keep watching without going back', description: 'The online player now has Previous and Next episode buttons, so you can move through a series without returning to its episode list.' },
      { title: 'Pick any episode in the player', description: 'Scroll the episode rail under the video, tap an episode number, and Mikozora finds that episode’s servers while the current one stays open.' },
      { title: 'Your place stays up to date', description: 'Episodes opened from the player are added to your recent history just like episodes chosen from a series page.' },
    ],
  },
  {
    version: '0.13.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Signed for smoother updates', description: 'Mikozora now uses one permanent Android signing key, so future GitHub releases can update this signed installation in place.' },
      { title: 'One last reinstall from older builds', description: 'Android cannot update a debug-signed 0.12.0 or earlier installation to this build. Uninstalling removes in-app data and private downloads; files already exported to your chosen folder remain.' },
      { title: 'Same Mikozora', description: 'No sources or features change in this release. This update establishes the stable signing identity for future versions.' },
    ],
  },
  {
    version: '0.12.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Moku is now Mikozora', description: 'Same app and same project, with a new name and wordmark.' },
      { title: 'Nothing moves', description: 'Your library, collections, history, downloads, appearance and episode-update preferences stay right where they were.' },
      { title: 'A name of our own', description: 'Moku was already used by other apps. Mikozora gives this little anime space an identity it does not have to share.' },
    ],
  },
  {
    version: '0.11.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Filters for every mood', description: 'Browse by genre, release year and content in the new Browse filters, alongside source and status.' },
      { title: 'Age ratings at a glance', description: 'Every anime and donghua card now shows its source age rating — like PG or PG-13 — or NR when the source provides none.' },
      { title: 'NSFW, completely off if you want', description: 'A new Settings switch hides titles sources mark as adult everywhere in the app, without deleting anything you saved.' },
    ],
  },
  {
    version: '0.10.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Your space, your colors', description: 'Choose light or dark mode and a green, blue, purple, pink or amber accent in Settings.' },
      { title: 'Make it yours', description: 'Your chosen look applies right away and stays saved when you reopen the app.' },
      { title: 'Nothing else changes', description: 'Your library, collections, downloads and episode-update preferences stay in place.' },
    ],
  },
  {
    version: '0.9.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'New episodes, all together', description: 'Follow titles in Favourites and your personal collections from the new Updates screen.' },
      { title: 'A little heads-up', description: 'The app checks on open and in the background, with optional Android notifications and a manual check.' },
      { title: 'A quiet start', description: 'The first successful check records existing episodes without sending old-episode alerts.' },
    ],
  },
  {
    version: '0.8.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'A little welcome', description: 'A quick introduction to your anime space when you first open the app.' },
      { title: 'Updates at a glance', description: 'See what changed the first time you open the app after an update.' },
      { title: 'Catch up anytime', description: 'Find these release notes again in Settings, whenever you need them.' },
    ],
  },
  {
    version: '0.7.0',
    label: 'EARLIER UPDATE',
    entries: [
      { title: 'More worlds to explore', description: 'Eight additional sources, organized with AnimeSogo and AnimeXin into Anime and Donghua.' },
    ],
  },
];

/**
 * Decide what to show before the library/history hooks create their storage keys.
 * A pending record is persisted immediately so an interrupted first launch remains
 * a first launch even if the rest of the app initialized storage in the meantime.
 * This only touches EXPERIENCE_KEY; saved titles and download data are untouched.
 */
export function startupExperience(storage, version = APP_VERSION) {
  try {
    const raw = storage.getItem(EXPERIENCE_KEY);
    let prior = null;
    try { prior = raw ? JSON.parse(raw) : null; } catch { /* ignore malformed state */ }
    const valid = prior && typeof prior === 'object' && typeof prior.version === 'string';
    if (valid && prior.version === version && prior.status === 'seen') return null;
    if (valid && prior.version === version && prior.status === 'pending' && ['intro', 'update'].includes(prior.mode)) {
      return { mode: prior.mode };
    }
    // An interrupted onboarding remains onboarding even across an update.
    const stillNew = valid && prior.status === 'pending' && prior.mode === 'intro';
    const hadEarlierVersion = valid || LEGACY_KEYS.some(key => storage.getItem(key) !== null);
    const mode = stillNew || !hadEarlierVersion ? 'intro' : 'update';
    try { storage.setItem(EXPERIENCE_KEY, JSON.stringify({ version, status: 'pending', mode })); } catch { /* will be shown again if storage is unavailable */ }
    return { mode };
  } catch {
    // If storage is unavailable, do not prevent the app from opening.
    return { mode: 'intro' };
  }
}

export function completeExperience(storage, version = APP_VERSION) {
  try { storage.setItem(EXPERIENCE_KEY, JSON.stringify({ version, status: 'seen' })); return true; }
  catch { return false; }
}
