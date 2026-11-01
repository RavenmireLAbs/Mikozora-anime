// Keep this version in sync with package.json and android/app/build.gradle.
// Append a new entry at the front for each release; older entries remain available.
export const APP_VERSION = '0.20.0';
export const EXPERIENCE_KEY = 'moku.startup.v1';
export const LEGACY_KEYS = ['moku.library.v1', 'moku.history.v1', 'moku.collections.v1'];

export const RELEASES = [
  {
    version: '0.20.0',
    label: 'LATEST UPDATE',
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
