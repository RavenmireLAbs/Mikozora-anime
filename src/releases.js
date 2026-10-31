// Keep this version in sync with package.json and android/app/build.gradle.
// Append a new entry at the front for each release; older entries remain available.
export const APP_VERSION = '0.11.0';
export const EXPERIENCE_KEY = 'moku.startup.v1';
export const LEGACY_KEYS = ['moku.library.v1', 'moku.history.v1', 'moku.collections.v1'];

export const RELEASES = [
  {
    version: '0.11.0',
    label: 'LATEST UPDATE',
    entries: [
      { title: 'Filters for every mood', description: 'Browse by genre, release year and content in the new Browse filters, alongside source and status.' },
      { title: 'Age ratings at a glance', description: 'Every anime and donghua card now shows its source age rating — like PG or PG-13 — or NR when the source provides none.' },
      { title: 'NSFW, completely off if you want', description: 'A new Settings switch hides titles sources mark as adult everywhere in Moku, without deleting anything you saved.' },
    ],
  },
  {
    version: '0.10.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'Your space, your colors', description: 'Choose light or dark mode and a green, blue, purple, pink or amber accent in Settings.' },
      { title: 'Make it yours', description: 'Your chosen look applies right away and stays with Moku when you reopen it.' },
      { title: 'Nothing else changes', description: 'Your library, collections, downloads and episode-update preferences stay in place.' },
    ],
  },
  {
    version: '0.9.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'New episodes, all together', description: 'Follow titles in Favourites and your personal collections from the new Updates screen.' },
      { title: 'A little heads-up', description: 'Moku checks on open and in the background, with optional Android notifications and a manual check.' },
      { title: 'A quiet start', description: 'The first successful check records existing episodes without sending old-episode alerts.' },
    ],
  },
  {
    version: '0.8.0',
    label: 'PREVIOUS UPDATE',
    entries: [
      { title: 'A little welcome', description: 'A quick introduction to your Moku space when you first open the app.' },
      { title: 'Updates at a glance', description: 'See what changed the first time you open Moku after an update.' },
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
