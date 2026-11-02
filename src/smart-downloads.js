// Smart Downloads are intentionally small, durable preferences. They store
// which titles/collections are selected and the last successful download
// choices for a series, but never media or subtitle URLs: those expire and
// differ by episode. Native Android/Windows code receives a sanitized copy
// through the episode-title sync and resolves each new episode natively.
export const SMART_DOWNLOADS_KEY = 'moku.smartDownloads.v1';

export const DEFAULT_SMART_DOWNLOADS = Object.freeze({
  enabled: false,
  wifiOnly: true,
  maxUnwatchedPerSeries: 3,
  notifyWhenReady: true,
  titleKeys: [],
  collectionIds: [],
  presets: {},
});

const MAX_TITLE_KEYS = 1000;
const MAX_COLLECTIONS = 200;
const MAX_PRESETS = 1000;
const MAX_SUBTITLE_TRACKS = 60;
const SERVER_ID = /^(?:auto|(?:sogo|suge|anikoto|rulz|waves|bash|xin|narul|stream|world)-[a-z0-9-]{1,90})$/;
const QUALITY_ID = /^(?:best|v:[0-9]{2,5}x[0-9]{2,5}|f:[0-9]{3,4})$/;
const SUBTITLE_TRACK_ID = /^s:[a-f0-9]{32}$/;
const COLLECTION_ID = /^[A-Za-z0-9_-]{1,80}$/;

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanTitleKey(value) {
  const key = cleanText(value, 1000);
  const separator = key.indexOf('|');
  if (separator < 1 || separator === key.length - 1) return '';
  const source = key.slice(0, separator);
  const url = key.slice(separator + 1);
  if (!/^[a-z0-9_-]{1,40}$/i.test(source) || !/^https?:\/\//i.test(url)) return '';
  return key;
}

function uniqueClean(values, clean, limit) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function normalizeDownloadPreset(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const language = value.language === 'indonesian' ? 'indonesian' : 'english';
  const server = SERVER_ID.test(cleanText(value.server, 120)) ? cleanText(value.server, 120) : 'auto';
  const quality = QUALITY_ID.test(cleanText(value.quality, 24)) ? cleanText(value.quality, 24) : 'best';
  let subtitleMode = ['auto', 'custom', 'none'].includes(value.subtitleMode) ? value.subtitleMode : 'auto';
  let subtitleTracks = [];
  if (subtitleMode === 'custom') {
    if (server === 'auto' || !Array.isArray(value.subtitleTracks)) {
      subtitleMode = 'auto';
    } else {
      const seen = new Set();
      for (const rawTrack of value.subtitleTracks) {
        const id = cleanText(rawTrack?.id, 40);
        const label = cleanText(rawTrack?.label, 160);
        const trackLanguage = cleanText(rawTrack?.language, 35) || 'und';
        if (!SUBTITLE_TRACK_ID.test(id) || !label || seen.has(id)) continue;
        seen.add(id);
        subtitleTracks.push({ id, label, language: trackLanguage });
        if (subtitleTracks.length >= MAX_SUBTITLE_TRACKS) break;
      }
      if (!subtitleTracks.length) subtitleMode = 'auto';
    }
  }
  return { language, server, quality, subtitleMode, subtitleTracks };
}

export function normalizeSmartDownloads(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const cap = Math.floor(Number(value.maxUnwatchedPerSeries));
  const presets = {};
  if (value.presets && typeof value.presets === 'object' && !Array.isArray(value.presets)) {
    for (const [rawKey, rawPreset] of Object.entries(value.presets)) {
      const key = cleanTitleKey(rawKey);
      if (!key) continue;
      presets[key] = normalizeDownloadPreset(rawPreset);
      if (Object.keys(presets).length >= MAX_PRESETS) break;
    }
  }
  return {
    enabled: value.enabled === true,
    wifiOnly: value.wifiOnly !== false,
    maxUnwatchedPerSeries: Number.isFinite(cap) ? Math.max(1, Math.min(10, cap)) : 3,
    notifyWhenReady: value.notifyWhenReady !== false,
    titleKeys: uniqueClean(value.titleKeys, cleanTitleKey, MAX_TITLE_KEYS),
    collectionIds: uniqueClean(value.collectionIds, (id) => {
      const clean = cleanText(id, 80);
      return COLLECTION_ID.test(clean) ? clean : '';
    }, MAX_COLLECTIONS),
    presets,
  };
}

export function readSmartDownloads(storage) {
  try {
    const raw = storage?.getItem(SMART_DOWNLOADS_KEY);
    return normalizeSmartDownloads(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SMART_DOWNLOADS, titleKeys: [], collectionIds: [], presets: {} };
  }
}

export function saveSmartDownloads(storage, settings) {
  const normalized = normalizeSmartDownloads(settings);
  try { storage?.setItem(SMART_DOWNLOADS_KEY, JSON.stringify(normalized)); } catch { /* Session state still applies. */ }
  return normalized;
}

export function smartTitleSelection(settings, key, collections) {
  const normalized = normalizeSmartDownloads(settings);
  const cleanKey = cleanTitleKey(key);
  const direct = !!cleanKey && normalized.titleKeys.includes(cleanKey);
  const selectedCollections = (Array.isArray(collections) ? collections : [])
    .filter((collection) => collection
      && normalized.collectionIds.includes(collection.id)
      && Array.isArray(collection.items)
      && collection.items.includes(cleanKey))
    .map((collection) => ({ id: collection.id, name: cleanText(collection.name, 120) || 'Collection' }));
  return {
    selected: direct || selectedCollections.length > 0,
    direct,
    collections: selectedCollections,
  };
}

export function isSmartTitleSelected(settings, key, collections) {
  return smartTitleSelection(settings, key, collections).selected;
}

export function smartDownloadsForSync(settings) {
  const normalized = normalizeSmartDownloads(settings);
  return {
    enabled: normalized.enabled,
    wifiOnly: normalized.wifiOnly,
    maxUnwatchedPerSeries: normalized.maxUnwatchedPerSeries,
    notifyWhenReady: normalized.notifyWhenReady,
  };
}

export function withDownloadPreset(settings, key, preset) {
  const normalized = normalizeSmartDownloads(settings);
  const cleanKey = cleanTitleKey(key);
  if (!cleanKey) return normalized;
  return {
    ...normalized,
    presets: { ...normalized.presets, [cleanKey]: normalizeDownloadPreset(preset) },
  };
}

// Pure decision helper shared by tests and mirrored by both native stores.
// Only automatic records occupy the per-series unwatched allowance. Manual
// downloads do not block Smart Downloads except for the same episode itself.
export function smartQueueDecision({ episodeUrl, watchedEpisodes, records, maxUnwatchedPerSeries }) {
  const watched = new Set(Array.isArray(watchedEpisodes) ? watchedEpisodes : []);
  if (watched.has(episodeUrl)) return 'watched';
  const list = Array.isArray(records) ? records : [];
  if (list.some((record) => record?.episode?.url === episodeUrl)) return 'existing';
  const occupying = list.filter((record) => record?.autoDownload === true
    && ['queued', 'resolving', 'downloading', 'paused', 'completed'].includes(record?.status)
    && !watched.has(record?.episode?.url)).length;
  const cap = Math.max(1, Math.min(10, Math.floor(Number(maxUnwatchedPerSeries)) || 3));
  return occupying >= cap ? 'cap' : 'queue';
}
