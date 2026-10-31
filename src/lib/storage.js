// Persistence helpers for Browse filters and adult-content preferences.
//
// Preferences deliberately live under their own keys, separate from library,
// collections, history and download records, so clearing one never disturbs the
// others. Every read is defensive: a WebView with storage disabled, a stale
// schema or hand-edited JSON must never break app start-up.

export const STORAGE_KEYS = Object.freeze({
  prefs: 'moku.prefs.v1',
  browseFilters: 'moku.browse.filters.v1',
});

export const DEFAULT_PREFS = Object.freeze({
  // Adult titles are hidden on a fresh install. Turning this off is a global
  // switch: NSFW titles disappear from Browse, search, rails and deep links.
  allowNsfw: false,
});

function getDefaultStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw when storage is blocked by the WebView.
    return null;
  }
}

/** Read and parse JSON, returning `fallback` on any failure. */
export function readJson(key, fallback, storage = getDefaultStorage()) {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

/** Write JSON, silently ignoring quota or disabled-storage failures. */
export function writeJson(key, value, storage = getDefaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function normalizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  return {
    ...DEFAULT_PREFS,
    // Only an explicit `true` enables adult content.
    allowNsfw: raw.allowNsfw === true,
  };
}

export function loadPrefs(storage = getDefaultStorage()) {
  return normalizePrefs(readJson(STORAGE_KEYS.prefs, DEFAULT_PREFS, storage));
}

export function savePrefs(prefs, storage = getDefaultStorage()) {
  return writeJson(STORAGE_KEYS.prefs, normalizePrefs(prefs), storage);
}

export function loadBrowseFilters(storage = getDefaultStorage()) {
  return readJson(STORAGE_KEYS.browseFilters, null, storage);
}

export function saveBrowseFilters(filters, storage = getDefaultStorage()) {
  return writeJson(STORAGE_KEYS.browseFilters, filters, storage);
}
