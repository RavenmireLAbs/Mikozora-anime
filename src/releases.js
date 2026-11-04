// Keep this version in sync with package.json and android/app/build.gradle.
// Append a new entry at the front for each release; the app shows only that newest entry.
export const APP_VERSION = '0.30.0';
export const EXPERIENCE_KEY = 'moku.startup.v1';
export const LEGACY_KEYS = ['moku.library.v1', 'moku.history.v1', 'moku.collections.v1'];

export const RELEASES = [
  {
    version: '0.30.0',
    label: 'LATEST UPDATE',
    entries: [
      { title: 'Offline Manager 2.0', description: 'Downloads now shows how much space each series and source uses, which completed episodes are watched, and which have a verified folder copy. Search, filter, sort or group downloads by series, select several for bulk actions, and move waiting episodes earlier, later or to the front. The chosen order is remembered by the Android and Windows download engines; an episode already transferring is not cancelled just to swap places. Storage limits and watched-episode age rules can identify safe cleanup candidates, with optional automatic cleanup kept off until you turn it on. Incomplete downloads, active folder exports and verified folder-only records are protected from cleanup, and removing a Mikozora entry never deletes a file already saved to your chosen folder.' },
      { title: 'Catch-Up & Binge Planner', description: 'Home now includes a Catch up rail, and the new Planner brings every started-but-unfinished series into one Up Next queue with its next episode and episodes-behind count. Sort by Mikozora’s smart order, quickest finish, most behind, recent activity or your plans. Mark a show for Tonight, This weekend or Later, choose how many episodes belong in a sitting, and build a binge session you can open episode by episode or send through the normal download choices. The planner uses progress already stored on this device, respects Dropped and Completed shelf choices, and shows each confirmed linked source version only once.' },
      { title: 'Offline Playback Pro', description: 'Settings → Offline Playback now remembers your playback speed, 5–30 second seek length, subtitle size, subtitle colour and background, sleep-timer length and whether to play the next saved episode automatically. The same choices drive the Android and Windows offline players, including their speed and seek controls. Auto-play uses only completed downloads from the same series, the sleep deadline carries across an automatic next episode instead of restarting, and your playback place remains remembered on that device. Android’s offline title and tools continue to hide with the regular player controls during playback.' },
      { title: 'Watch Stats & Wrapped', description: 'Watch Stats turns the history, progress, ratings and shelf data already on this device into current and longest streaks, last-7-day and last-30-day activity, eight weekly and six monthly charts, favourite genres, sources and series, completion totals and a monthly Wrapped recap with a previous-month comparison. History records episodes that were opened—Mikozora keeps the latest 100—so streaks and recaps cover that stored history rather than pretending to know every play forever. Repeated opens of the same episode are counted once, and watch time uses a source-reported duration when available or a clearly estimated 24 minutes otherwise.' },
      { title: 'Plans and offline choices are backed up', description: 'Planner choices, Offline Manager rules and Offline Playback settings are now included in a manual backup. Restoring an older backup keeps its existing point-in-time behaviour: settings that cannot be present in that older file are cleared rather than left behind. Downloaded videos and native download records themselves still stay on the device where they were downloaded.' },
    ],
  },
  {
    version: '0.29.1',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Offline player controls now get out of the way', description: 'On Android, the downloaded-episode player’s title and −10s, Restart, Speed and +10s tools now hide together with the regular playback controls after five seconds while a video is playing. Tap the video to bring them back; using any of those tools restarts the timer. The controls remain visible while playback is paused or ended so resuming stays easy.' },
    ],
  },
  {
    version: '0.29.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'One search across your sources', description: 'Universal Search now groups likely versions of the same show when you search across Mikozora’s existing sources. A grouped card keeps an “Also on” button for the other listings, so you can open the exact source version you want. Grouping is display-only and deliberately conservative: different seasons or parts, far-apart years, movies versus series or specials, and Anime versus Donghua mismatches are not silently merged.' },
      { title: 'Find a show on another source', description: 'Every series page now has a Source Versions section. Choose “Find on other sources” and Mikozora searches the other sources in that title’s Anime or Donghua category, then shows likely matches with a confidence score and the reasons behind it. Mikozora searches only when you ask, so simply opening a title does not send requests to every source.' },
      { title: 'Watched episode numbers can carry over', description: 'When two listings really are the same show, choose “Link as same show” and confirm. Watched episode numbers—not source-specific episode URLs—then carry between the linked versions on the series page, in Continue Watching and Library progress, and in the players. Unnumbered specials do not inherit a watched mark. Your separate library entries, collections, ratings, notes and downloads stay separate, and you can unlink a version at any time.' },
      { title: 'Your confirmed links travel with your data', description: 'Confirmed source-version links are included in manual backups and in shared-folder device sync between Android and Windows, including later unlinks and relinks. Restoring an older backup replaces those links with the backup’s set, just like the rest of the local data it restores.' },
    ],
  },
  {
    version: '0.28.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Picks shaped by your watching', description: 'Discover now adds a “Made for your taste” rail built only from this device’s library, history, watch progress and your own ratings or shelf choices. Cards explain matching genres, and your most-watched genres are shown above the rail. Browse can also show saved or not-yet-saved titles and sort the results already loaded—including a “For you” order. Nothing about your taste is uploaded.' },
      { title: 'Your own shelf for every story', description: 'Open any series to add a five-star rating, a Plan to watch/Watching/Paused/Completed/Dropped shelf status and a private note. Adding one to an unsaved title saves it to your library automatically. Library now shows progress and shelf statistics and can search, sort, filter and bulk-add or bulk-remove selected titles. Your shelf is included in backups and shared-folder device sync.' },
      { title: 'Find the right episode faster', description: 'Series pages can jump straight to an episode number, open the next unwatched episode, mark everything through an episode watched, and select a numeric range for batch actions. The Windows and Android online players add the same next-unwatched and episode-number tools, watched counts, a current-episode watched/unwatched toggle, and previous/next server buttons beside the server list.' },
      { title: 'Better offline playback controls', description: 'Downloaded episodes now offer playback speed, 10-second back/forward seeks and restart in both the Android and Windows offline players, while your saved place continues to be remembered on that device. Online episodes still play inside each server’s embedded player, so speed and seeking there remain under that server player’s control; Mikozora’s new controls handle episodes, servers and watched marks around it.' },
    ],
  },
  {
    version: '0.27.1',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Google Drive sync removed', description: 'Direct Google Drive sync has been removed from Mikozora. Settings → Device Sync now uses the shared-folder method only: choose the same folder kept by Syncthing, OneDrive, Dropbox, a NAS, or another file-sync service on Android and Windows.' },
      { title: 'Your data stays put', description: 'Removing the Drive transport does not delete your library, collections, history, watch progress, downloads, or the old Mikozora folder/files in Google Drive. Local Google connection state is cleared where Mikozora stored it. If you used Drive sync in 0.27.0, choose a shared folder on both devices and Mikozora will publish and merge each device’s current data there; delete the old Drive folder yourself if you no longer want it.' },
    ],
  },
  {
    version: '0.27.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Google Drive sync, without another sync app', description: 'Settings → Device Sync can now use Google Drive directly on Android and Windows. Choose Google Drive as the sync method, connect the same Google account on both devices, and Mikozora keeps one small sync file per device in a visible “Mikozora” folder in that account’s Drive. No FolderSync, Autosync, Drive for Desktop, or manually paired shared folder is needed.' },
      { title: 'Your account, your sync files', description: 'Drive sync uses the Google account connected on each device, so a user’s files stay in that user’s own Drive—not in the developer’s account. Mikozora asks Google only for per-file access to files it creates, plus the account email so Settings can show which account is connected. Shared-folder sync remains available if you prefer it.' },
      { title: 'The same careful two-way merge', description: 'Library titles, collections, history, watch progress, appearance, content preferences and Smart Downloads settings merge in both directions, including later deletions, collection changes and episodes marked unwatched. Sync runs when Mikozora opens, when you return to it, periodically while it stays open, and shortly after synced data changes; Sync now remains in Settings. Downloaded episodes, queues and other device-specific state stay on each device.' },
      { title: 'Private to your account, not end-to-end encrypted', description: 'Devices need internet access when they sync, but they do not need to be online at the same time. Google and anyone who can access the connected account or its Mikozora folder can read the title and watch metadata in the sync files, so use an account you trust. Disconnecting removes that device’s stored Google authorization and stops syncing, while deliberately leaving the Drive folder and files where they are.' },
    ],
  },
  {
    version: '0.26.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Sync Android and Windows through a folder you already trust', description: 'Settings → Device Sync can now connect Mikozora on Android and Windows through the same folder kept by Syncthing, OneDrive, Dropbox, Google Drive, a NAS, or another file-sync service. Choose that folder on both devices; each copy of Mikozora writes only its own small sync file and your chosen service carries it. No Mikozora account is needed, and the devices do not need to be online at the same time.' },
      { title: 'Your space comes with you', description: 'Library titles, collections, history, watch progress, appearance, content preferences and Smart Downloads settings merge in both directions when Mikozora opens, when you return to it, and shortly after something changes; Sync now is there whenever you want it. Later deletions, collection changes and episodes marked unwatched sync too, while a fresh device’s untouched default settings will not overwrite choices you already made on the other device.' },
      { title: 'Downloads still belong to each device', description: 'Downloaded episodes and queues, the folder used for playable copies, episode-alert state, offline playback positions and app-update choices remain device-local. Connecting or disconnecting device sync never moves your videos, and disconnecting leaves sync files already in the shared folder untouched.' },
      { title: 'Use a folder you trust', description: 'Anyone or any service that can read the chosen folder can see the title and watch metadata in Mikozora’s sync files. If that is a concern, use a private folder or leave device sync off—manual backup export and import remain available exactly as before.' },
    ],
  },
  {
    version: '0.25.1',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'App updates are checked when Mikozora opens', description: 'Mikozora now checks GitHub once on every launch after the startup screen, again when you return to an already-running copy, and periodically during long sessions. You no longer need to visit Settings and press Check before the update banner can appear. Automatic checks can still be turned off in Settings → About, and the manual Check button remains available.' },
      { title: 'Failed checks no longer hide the next retry', description: 'A launch made without a working connection is no longer remembered as a successful update check. Mikozora keeps the last successful check time, retries after a short cooldown, and preserves an already-known update if a later check fails.' },
    ],
  },
  {
    version: '0.25.0',
    label: 'PREVIOUS UPDATE',
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
