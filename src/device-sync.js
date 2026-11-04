// Folder-based device sync for Mikozora's local web stores.
//
// The native shells only choose/read/write files in a folder the user has
// already entrusted to Syncthing, OneDrive, Dropbox, a NAS, etc. This module
// owns the portable file format and merge. Every installation writes only its
// own file, so the folder service never has two Mikozora devices racing over
// one JSON document. Records carry hybrid wall-clock stamps; removals are
// retained as tombstones in the metadata so a stale peer file cannot simply
// resurrect a deleted title, collection, history entry or watched mark.
//
// Downloaded media, native episode-alert state, folder choices, app-update
// state and offline playback positions are intentionally device-local and are
// not part of a sync snapshot.
import { APP_VERSION } from './releases.js';
import { COLLECTIONS_KEY, FAVOURITES_ID, normalizeCollections, titleKey } from './collections.js';
import { PROGRESS_KEY, normalizeProgress } from './progress.js';
import { APPEARANCE_KEY, normalizeAppearance } from './appearance.js';
import { CONTENT_KEY, normalizeContentPrefs } from './content.js';
import { SMART_DOWNLOADS_KEY, normalizeSmartDownloads } from './smart-downloads.js';
import { LIBRARY_META_KEY, PERSONAL_STATUSES, normalizeLibraryMeta } from './library-meta.js';
import { SOURCE_MATCHES_KEY, normalizeSourceMatches } from './source-match.js';
import { FRANCHISE_CHAINS_KEY, normalizeFranchiseChains } from './franchise-chains.js';

export const LIBRARY_KEY = 'moku.library.v1';
export const HISTORY_KEY = 'moku.history.v1';
export const DEVICE_SYNC_KEY = 'moku.deviceSync.v1';
export const DEVICE_SYNC_FORMAT = 'mikozora-device-sync';
export const DEVICE_SYNC_VERSION = 1;
export const DEVICE_SYNC_MAX_BYTES = 8 * 1024 * 1024;
export const DEVICE_SYNC_FILE_PATTERN = /^mikozora-sync-(android|windows)-[a-f0-9]{16}\.json$/;

const MAX_LIBRARY = 2000;
const MAX_COLLECTIONS = 250;
const MAX_HISTORY = 100;
const MAX_META_LIBRARY = 5000;
const MAX_META_COLLECTIONS = 500;
const MAX_META_HISTORY = 1000;
const MAX_META_PROGRESS = 500;
const MAX_META_LIBRARY_META = 1000;
const MAX_META_SOURCE_MATCHES = 1000;
const MAX_META_FRANCHISE_CHAINS = 500;
const MAX_META_FRANCHISE_DISMISSALS = 500;
const MAX_META_SET = 10000;
const SMART_SCALARS = ['enabled', 'wifiOnly', 'maxUnwatchedPerSeries', 'notifyWhenReady'];
const ITEM_FIELDS = ['source', 'url', 'title', 'image', 'type', 'badge', 'status', 'genres', 'aired', 'year', 'rating', 'nsfw'];

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function setOwn(object, key, value) {
  if (key === '__proto__') Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true });
  else object[key] = value;
}

function parseJson(raw, fallback = null) {
  try { return JSON.parse(String(raw ?? '')); } catch { return fallback; }
}

function readStoredJson(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch { return fallback; }
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  const text = JSON.stringify(value);
  return text === undefined ? 'null' : text;
}

function hashValue(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cleanText(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanUrl(value, max = 4096) {
  const raw = String(value ?? '').replace(/[\u0000-\u0020\u007f]/g, '').trim().slice(0, max);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : '';
  } catch { return ''; }
}

function cleanSource(value) {
  const source = cleanText(value, 40);
  return /^[a-z0-9_-]{1,40}$/i.test(source) ? source : '';
}

function cleanTitleKey(value) {
  const key = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 5000);
  const split = key.indexOf('|');
  if (split < 1 || split === key.length - 1) return '';
  const source = cleanSource(key.slice(0, split));
  const url = cleanUrl(key.slice(split + 1));
  return source && url ? `${source}|${url}` : '';
}

function cleanSourceMatchEdgeId(value) {
  const keys = [...new Set(String(value ?? '').split('\n').map(cleanTitleKey).filter(Boolean))].sort();
  return keys.length === 2 ? keys.join('\n') : '';
}

function cleanCollectionId(value) {
  const id = cleanText(value, 80);
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return '';
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
}

function cleanFranchiseId(value) {
  const id = cleanText(value, 96);
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return '';
  return /^[A-Za-z0-9_-]{1,96}$/.test(id) ? id : '';
}

function cleanGenres(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => cleanText(entry, 60)).filter(Boolean))].slice(0, 20);
  }
  const text = cleanText(value, 500);
  return text || undefined;
}

function cleanItem(raw) {
  if (!isObject(raw)) return null;
  const source = cleanSource(raw.source);
  const url = cleanUrl(raw.url);
  if (!source || !url) return null;
  const item = { source, url, title: cleanText(raw.title, 500) || 'Untitled' };
  const image = cleanUrl(raw.image);
  if (image) item.image = image;
  for (const field of ['type', 'badge', 'status', 'aired', 'rating']) {
    const value = cleanText(raw[field], field === 'aired' ? 200 : 100);
    if (value) item[field] = value;
  }
  const genres = cleanGenres(raw.genres);
  if (genres !== undefined && (!Array.isArray(genres) || genres.length)) item.genres = genres;
  const year = Number(raw.year);
  if (Number.isInteger(year) && year >= 1900 && year <= 2099) item.year = year;
  else {
    const yearText = cleanText(raw.year, 20);
    if (yearText) item.year = yearText;
  }
  if (typeof raw.nsfw === 'boolean') item.nsfw = raw.nsfw;
  // Preserve the field order used by the rest of the app; JSON comparisons in
  // the UI are not order-sensitive, but stable files are easier to inspect.
  const ordered = {};
  for (const field of ITEM_FIELDS) if (item[field] !== undefined) ordered[field] = item[field];
  return ordered;
}

function itemKey(item) {
  return item?.source && item?.url ? titleKey(item) : '';
}

function cleanEpisode(raw) {
  if (!isObject(raw)) return null;
  const url = cleanUrl(raw.url);
  if (!url) return null;
  return {
    number: cleanText(raw.number ?? '', 40),
    url,
    title: cleanText(raw.title || '', 500),
    ids: cleanText(raw.ids || '', 1000),
  };
}

function cleanHistoryEntry(raw) {
  if (!isObject(raw)) return null;
  const item = cleanItem(raw.item);
  const episode = cleanEpisode(raw.episode);
  const time = timestamp(raw.time);
  if (!item || !episode) return null;
  return {
    item,
    episode: { number: episode.number, url: episode.url, title: episode.title },
    time,
  };
}

function historyId(entry) {
  const key = itemKey(entry?.item);
  return key && entry?.episode?.url ? `${key}\n${entry.episode.url}` : '';
}

const PERSONAL_STATUS_IDS = new Set(PERSONAL_STATUSES.map((status) => status.id));

function cleanLibraryMetaRecord(raw) {
  if (!isObject(raw)) return null;
  const ratingNumber = Number(raw.rating);
  const rating = Number.isFinite(ratingNumber) ? Math.max(0, Math.min(5, Math.trunc(ratingNumber))) : 0;
  const note = String(raw.note ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .slice(0, 600);
  const status = PERSONAL_STATUS_IDS.has(raw.status) ? raw.status : '';
  if (!rating && !note.trim() && !status) return null;
  return { rating, note, status, updatedAt: timestamp(raw.updatedAt) };
}

function cleanLibraryMeta(raw, validLibraryKeys = null) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [rawKey, rawRecord] of Object.entries(raw)) {
    const key = cleanTitleKey(rawKey);
    if (!key || (validLibraryKeys && !validLibraryKeys.has(key))) continue;
    const record = cleanLibraryMetaRecord(rawRecord);
    if (!record) continue;
    setOwn(out, key, record);
    if (Object.keys(out).length >= MAX_META_LIBRARY_META) break;
  }
  return normalizeLibraryMeta(out);
}

function cleanFranchiseChainsForSync(raw) {
  const normalized = normalizeFranchiseChains(raw);
  const chains = {};
  for (const [id, chain] of Object.entries(normalized.chains)) {
    const entries = [];
    for (const entry of chain.entries) {
      const item = cleanItem(entry.item);
      if (!item) continue;
      entries.push({
        key: itemKey(item),
        item,
        kind: cleanText(entry.kind, 20) || 'entry',
        label: cleanText(entry.label, 80),
        ...(entry.addedAt ? { addedAt: timestamp(entry.addedAt) } : {}),
      });
    }
    if (entries.length) setOwn(chains, id, { ...chain, entries });
  }
  return normalizeFranchiseChains({ version: normalized.version, chains, dismissed: normalized.dismissed });
}

export function sanitizeSyncSnapshot(raw) {
  const value = isObject(raw) ? raw : {};

  const libraryByKey = new Map();
  for (const entry of Array.isArray(value.library) ? value.library : []) {
    const item = cleanItem(entry);
    const key = itemKey(item);
    if (item && key && !libraryByKey.has(key)) libraryByKey.set(key, item);
    if (libraryByKey.size >= MAX_LIBRARY) break;
  }

  const rawCollections = (Array.isArray(value.collections) ? value.collections : []).slice(0, MAX_COLLECTIONS).map((entry) => {
    if (!isObject(entry)) return entry;
    return {
      id: cleanCollectionId(entry.id),
      name: cleanText(entry.name, 120),
      items: [...new Set((Array.isArray(entry.items) ? entry.items : []).map(cleanTitleKey).filter(Boolean))].slice(0, 5000),
    };
  });
  const collections = normalizeCollections(rawCollections).slice(0, MAX_COLLECTIONS);

  const historyById = new Map();
  for (const entry of Array.isArray(value.history) ? value.history : []) {
    const clean = cleanHistoryEntry(entry);
    const id = historyId(clean);
    if (!clean || !id) continue;
    const previous = historyById.get(id);
    if (!previous || clean.time >= previous.time) historyById.set(id, clean);
  }
  const history = [...historyById.values()].sort((a, b) => b.time - a.time).slice(0, MAX_HISTORY);

  const progressInput = (Array.isArray(value.progress) ? value.progress : []).map((entry) => {
    if (!isObject(entry)) return entry;
    const item = cleanItem(entry.item);
    return {
      key: itemKey(item),
      item,
      watched: [...new Set((Array.isArray(entry.watched) ? entry.watched : []).map((url) => cleanUrl(url)).filter(Boolean))].slice(0, 10000),
      episodes: (Array.isArray(entry.episodes) ? entry.episodes : []).map(cleanEpisode).filter(Boolean).slice(0, 10000),
      updatedAt: timestamp(entry.updatedAt),
    };
  });
  const progress = normalizeProgress(progressInput);

  return {
    library: [...libraryByKey.values()],
    collections,
    history,
    progress,
    libraryMeta: cleanLibraryMeta(value.libraryMeta, new Set(libraryByKey.keys())),
    sourceMatches: normalizeSourceMatches(value.sourceMatches),
    franchiseChains: cleanFranchiseChainsForSync(value.franchiseChains),
    appearance: normalizeAppearance(value.appearance),
    content: normalizeContentPrefs(value.content),
    smartDownloads: normalizeSmartDownloads(value.smartDownloads),
  };
}

export function snapshotFromStorage(storage) {
  return sanitizeSyncSnapshot({
    library: readStoredJson(storage, LIBRARY_KEY, []),
    collections: readStoredJson(storage, COLLECTIONS_KEY, []),
    history: readStoredJson(storage, HISTORY_KEY, []),
    progress: readStoredJson(storage, PROGRESS_KEY, []),
    libraryMeta: readStoredJson(storage, LIBRARY_META_KEY, {}),
    sourceMatches: readStoredJson(storage, SOURCE_MATCHES_KEY, null),
    franchiseChains: readStoredJson(storage, FRANCHISE_CHAINS_KEY, null),
    appearance: readStoredJson(storage, APPEARANCE_KEY, null),
    content: readStoredJson(storage, CONTENT_KEY, null),
    smartDownloads: readStoredJson(storage, SMART_DOWNLOADS_KEY, null),
  });
}

export function applySyncSnapshotToStorage(storage, snapshot) {
  const clean = sanitizeSyncSnapshot(snapshot);
  const writes = [
    [LIBRARY_KEY, clean.library],
    [COLLECTIONS_KEY, clean.collections],
    [HISTORY_KEY, clean.history],
    [PROGRESS_KEY, clean.progress],
    [LIBRARY_META_KEY, clean.libraryMeta],
    [SOURCE_MATCHES_KEY, clean.sourceMatches],
    [FRANCHISE_CHAINS_KEY, clean.franchiseChains],
    [APPEARANCE_KEY, clean.appearance],
    [CONTENT_KEY, clean.content],
    [SMART_DOWNLOADS_KEY, clean.smartDownloads],
  ];
  for (const [key, value] of writes) storage.setItem(key, JSON.stringify(value));
  return clean;
}

export function syncSnapshotSignature(snapshot) {
  return hashValue(sanitizeSyncSnapshot(snapshot));
}

export function storageSyncSignature(storage) {
  return syncSnapshotSignature(snapshotFromStorage(storage));
}

function timestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(253402300799999, Math.floor(number));
}

function cleanHash(value) {
  const hash = cleanText(value, 16).toLowerCase();
  return /^[a-f0-9]{1,16}$/.test(hash) ? hash : '';
}

function sanitizeBaseRecord(raw) {
  if (!isObject(raw)) return null;
  return {
    hash: cleanHash(raw.hash),
    updatedAt: timestamp(raw.updatedAt),
    deletedAt: timestamp(raw.deletedAt),
  };
}

function sanitizeSetRecord(raw) {
  if (!isObject(raw)) return null;
  return { present: raw.present === true, updatedAt: timestamp(raw.updatedAt) };
}

function sanitizeMap(raw, cleanKey, cleanValue, limit) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = cleanKey(rawKey);
    const value = key ? cleanValue(rawValue, key) : null;
    if (!key || !value) continue;
    setOwn(out, key, value);
    if (Object.keys(out).length >= limit) break;
  }
  return out;
}

const sanitizeTitleRecordMap = (raw, limit = MAX_META_LIBRARY) => sanitizeMap(raw, cleanTitleKey, sanitizeBaseRecord, limit);
const sanitizeSourceMatchRecordMap = (raw, limit = MAX_META_SOURCE_MATCHES) => sanitizeMap(raw, cleanSourceMatchEdgeId, sanitizeBaseRecord, limit);
const sanitizeFranchiseRecordMap = (raw, limit = MAX_META_FRANCHISE_CHAINS) => sanitizeMap(raw, cleanFranchiseId, sanitizeBaseRecord, limit);
const sanitizeTitleSetMap = (raw, limit = MAX_META_SET) => sanitizeMap(raw, cleanTitleKey, sanitizeSetRecord, limit);
const sanitizeUrlSetMap = (raw, limit = MAX_META_SET) => sanitizeMap(raw, (url) => cleanUrl(url), sanitizeSetRecord, limit);
const sanitizeIdSetMap = (raw, limit = MAX_META_SET) => sanitizeMap(raw, cleanCollectionId, sanitizeSetRecord, limit);

export function emptySyncRecordMeta() {
  return {
    library: {},
    collections: {},
    history: {},
    progress: {},
    libraryMeta: {},
    sourceMatches: {},
    franchiseChains: {},
    franchiseDismissals: {},
    settings: {
      appearance: null,
      content: null,
      smartDownloads: { scalars: {}, titleKeys: {}, collectionIds: {}, presets: {} },
    },
  };
}

export function sanitizeSyncRecordMeta(raw) {
  const value = isObject(raw) ? raw : {};
  const collections = sanitizeMap(value.collections, cleanCollectionId, (entry) => {
    const base = sanitizeBaseRecord(entry);
    return base ? { ...base, members: sanitizeTitleSetMap(entry.members) } : null;
  }, MAX_META_COLLECTIONS);
  const progress = sanitizeMap(value.progress, cleanTitleKey, (entry) => {
    const base = sanitizeBaseRecord(entry);
    return base ? { ...base, watched: sanitizeUrlSetMap(entry.watched) } : null;
  }, MAX_META_PROGRESS);
  const history = sanitizeMap(value.history, (rawKey) => {
    const text = String(rawKey ?? '');
    const split = text.lastIndexOf('\n');
    if (split < 1) return '';
    const key = cleanTitleKey(text.slice(0, split));
    const url = cleanUrl(text.slice(split + 1));
    return key && url ? `${key}\n${url}` : '';
  }, sanitizeBaseRecord, MAX_META_HISTORY);
  const settings = isObject(value.settings) ? value.settings : {};
  const smart = isObject(settings.smartDownloads) ? settings.smartDownloads : {};
  const scalars = {};
  if (isObject(smart.scalars)) {
    for (const key of SMART_SCALARS) {
      const record = sanitizeBaseRecord(smart.scalars[key]);
      if (record) scalars[key] = record;
    }
  }
  return {
    library: sanitizeTitleRecordMap(value.library),
    collections,
    history,
    progress,
    libraryMeta: sanitizeTitleRecordMap(value.libraryMeta, MAX_META_LIBRARY_META),
    sourceMatches: sanitizeSourceMatchRecordMap(value.sourceMatches, MAX_META_SOURCE_MATCHES),
    franchiseChains: sanitizeFranchiseRecordMap(value.franchiseChains, MAX_META_FRANCHISE_CHAINS),
    franchiseDismissals: sanitizeFranchiseRecordMap(value.franchiseDismissals, MAX_META_FRANCHISE_DISMISSALS),
    settings: {
      appearance: sanitizeBaseRecord(settings.appearance),
      content: sanitizeBaseRecord(settings.content),
      smartDownloads: {
        scalars,
        titleKeys: sanitizeTitleSetMap(smart.titleKeys),
        collectionIds: sanitizeIdSetMap(smart.collectionIds),
        presets: sanitizeTitleRecordMap(smart.presets, 1000),
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stampBaseMap(map, values, now, intrinsicTimes = {}) {
  const seen = new Set();
  for (const [key, value] of Object.entries(values)) {
    seen.add(key);
    const hash = hashValue(value);
    const old = map[key];
    const intrinsic = timestamp(intrinsicTimes[key]);
    if (!old || old.deletedAt || old.hash !== hash) {
      setOwn(map, key, { hash, updatedAt: Math.max(now, intrinsic), deletedAt: 0 });
    } else if (intrinsic > old.updatedAt) {
      old.updatedAt = intrinsic;
    }
  }
  for (const [key, record] of Object.entries(map)) {
    if (!seen.has(key) && !record.deletedAt) record.deletedAt = now;
  }
}

function stampSetMap(map, currentValues, now) {
  const current = new Set(currentValues);
  let changed = false;
  for (const key of current) {
    const old = map[key];
    if (!old || !old.present) {
      setOwn(map, key, { present: true, updatedAt: now });
      changed = true;
    }
  }
  for (const [key, record] of Object.entries(map)) {
    if (record.present && !current.has(key)) {
      record.present = false;
      record.updatedAt = now;
      changed = true;
    }
  }
  return changed;
}

function stampScalar(old, value, now) {
  const hash = hashValue(value);
  if (!old || old.deletedAt || old.hash !== hash) return { hash, updatedAt: now, deletedAt: 0 };
  return { ...old, hash, deletedAt: 0 };
}

/**
 * Compare a materialized snapshot to the last merged metadata and assign an
 * event time to additions, edits and removals. This is how stores that do not
 * themselves carry per-record timestamps participate in sync.
 */
export function stampSyncSnapshot(snapshot, previousMeta, now = Date.now()) {
  const data = sanitizeSyncSnapshot(snapshot);
  const eventNow = timestamp(now) || Date.now();
  const meta = sanitizeSyncRecordMeta(cloneJson(previousMeta || emptySyncRecordMeta()));

  const libraryValues = {};
  for (const item of data.library) setOwn(libraryValues, itemKey(item), item);
  stampBaseMap(meta.library, libraryValues, eventNow);

  const collectionIds = new Set();
  for (const collection of data.collections) {
    collectionIds.add(collection.id);
    const old = meta.collections[collection.id] || { hash: '', updatedAt: 0, deletedAt: 0, members: {} };
    const members = old.members || {};
    const membersChanged = stampSetMap(members, collection.items, eventNow);
    const hash = hashValue(collection.name);
    const updatedAt = !meta.collections[collection.id] || old.deletedAt || old.hash !== hash || membersChanged
      ? eventNow
      : old.updatedAt;
    setOwn(meta.collections, collection.id, { hash, updatedAt, deletedAt: 0, members });
  }
  for (const [id, record] of Object.entries(meta.collections)) {
    if (id !== FAVOURITES_ID && !collectionIds.has(id) && !record.deletedAt) record.deletedAt = eventNow;
    if (id === FAVOURITES_ID) record.deletedAt = 0;
  }

  const historyValues = {};
  const historyTimes = {};
  for (const entry of data.history) {
    const id = historyId(entry);
    setOwn(historyValues, id, entry);
    setOwn(historyTimes, id, entry.time);
  }
  stampBaseMap(meta.history, historyValues, eventNow, historyTimes);

  const progressIds = new Set();
  for (const entry of data.progress) {
    const key = entry.key || itemKey(entry.item);
    if (!key) continue;
    progressIds.add(key);
    const old = meta.progress[key] || { hash: '', updatedAt: 0, deletedAt: 0, watched: {} };
    const watched = old.watched || {};
    const watchedChanged = stampSetMap(watched, entry.watched, eventNow);
    const hash = hashValue({ item: entry.item, episodes: entry.episodes });
    const changed = !meta.progress[key] || old.deletedAt || old.hash !== hash || watchedChanged;
    setOwn(meta.progress, key, {
      hash,
      updatedAt: Math.max(changed ? eventNow : old.updatedAt, timestamp(entry.updatedAt)),
      deletedAt: 0,
      watched,
    });
  }
  for (const [key, record] of Object.entries(meta.progress)) {
    if (!progressIds.has(key) && !record.deletedAt) record.deletedAt = eventNow;
  }

  const libraryMetaTimes = {};
  for (const [key, record] of Object.entries(data.libraryMeta)) setOwn(libraryMetaTimes, key, record.updatedAt);
  stampBaseMap(meta.libraryMeta, data.libraryMeta, eventNow, libraryMetaTimes);

  const sourceMatchTimes = {};
  for (const [id, edge] of Object.entries(data.sourceMatches.edges)) setOwn(sourceMatchTimes, id, edge.updatedAt);
  stampBaseMap(meta.sourceMatches, data.sourceMatches.edges, eventNow, sourceMatchTimes);

  const franchiseChainTimes = {};
  for (const [id, chain] of Object.entries(data.franchiseChains.chains)) setOwn(franchiseChainTimes, id, chain.updatedAt);
  stampBaseMap(meta.franchiseChains, data.franchiseChains.chains, eventNow, franchiseChainTimes);
  const franchiseDismissalTimes = {};
  for (const [id, record] of Object.entries(data.franchiseChains.dismissed)) setOwn(franchiseDismissalTimes, id, record.updatedAt);
  stampBaseMap(meta.franchiseDismissals, data.franchiseChains.dismissed, eventNow, franchiseDismissalTimes);

  meta.settings.appearance = stampScalar(meta.settings.appearance, data.appearance, eventNow);
  meta.settings.content = stampScalar(meta.settings.content, data.content, eventNow);
  const smartMeta = meta.settings.smartDownloads;
  for (const key of SMART_SCALARS) {
    smartMeta.scalars[key] = stampScalar(smartMeta.scalars[key], data.smartDownloads[key], eventNow);
  }
  stampSetMap(smartMeta.titleKeys, data.smartDownloads.titleKeys, eventNow);
  stampSetMap(smartMeta.collectionIds, data.smartDownloads.collectionIds, eventNow);
  stampBaseMap(smartMeta.presets, data.smartDownloads.presets, eventNow);

  return pruneSyncRecordMeta(meta);
}

function recordEventTime(record) {
  return Math.max(timestamp(record?.updatedAt), timestamp(record?.deletedAt));
}

function pruneMap(map, limit, timeOf = recordEventTime) {
  const entries = Object.entries(map || {});
  if (entries.length <= limit) return map;
  entries.sort((a, b) => timeOf(b[1]) - timeOf(a[1]) || a[0].localeCompare(b[0]));
  const out = {};
  for (const [key, value] of entries.slice(0, limit)) setOwn(out, key, value);
  return out;
}

function pruneSyncRecordMeta(meta) {
  const clean = sanitizeSyncRecordMeta(meta);
  clean.library = pruneMap(clean.library, MAX_META_LIBRARY);
  clean.collections = pruneMap(clean.collections, MAX_META_COLLECTIONS);
  for (const record of Object.values(clean.collections)) record.members = pruneMap(record.members, MAX_META_SET, (entry) => timestamp(entry?.updatedAt));
  clean.history = pruneMap(clean.history, MAX_META_HISTORY);
  clean.progress = pruneMap(clean.progress, MAX_META_PROGRESS);
  for (const record of Object.values(clean.progress)) record.watched = pruneMap(record.watched, MAX_META_SET, (entry) => timestamp(entry?.updatedAt));
  clean.libraryMeta = pruneMap(clean.libraryMeta, MAX_META_LIBRARY_META);
  clean.sourceMatches = pruneMap(clean.sourceMatches, MAX_META_SOURCE_MATCHES);
  clean.franchiseChains = pruneMap(clean.franchiseChains, MAX_META_FRANCHISE_CHAINS);
  clean.franchiseDismissals = pruneMap(clean.franchiseDismissals, MAX_META_FRANCHISE_DISMISSALS);
  const smart = clean.settings.smartDownloads;
  smart.titleKeys = pruneMap(smart.titleKeys, MAX_META_SET, (entry) => timestamp(entry?.updatedAt));
  smart.collectionIds = pruneMap(smart.collectionIds, MAX_META_SET, (entry) => timestamp(entry?.updatedAt));
  smart.presets = pruneMap(smart.presets, 1000);
  return clean;
}

function maxMetaClock(meta) {
  let max = 0;
  const visit = (value) => {
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
    if (!isObject(value)) return;
    max = Math.max(max, timestamp(value.updatedAt), timestamp(value.deletedAt));
    for (const entry of Object.values(value)) visit(entry);
  };
  visit(meta);
  return max;
}

function randomDeviceId() {
  try {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues(bytes);
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (/^[a-f0-9]{16}$/.test(hex) && hex !== '0000000000000000') return hex;
  } catch { /* fall through to a non-cryptographic installation id */ }
  let seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  let out = '';
  while (out.length < 16) {
    seed = hashValue(seed);
    out += seed;
  }
  return out.slice(0, 16);
}

function cleanPlatform(value) {
  return value === 'windows' || value === 'desktop' ? 'windows' : 'android';
}

function defaultDeviceName(platform, deviceId) {
  return `${platform === 'windows' ? 'Windows PC' : 'Android device'} ${String(deviceId || '').slice(-4).toUpperCase()}`;
}

export function normalizeDeviceSyncMeta(raw, platform = 'android', randomId = randomDeviceId) {
  const value = isObject(raw) ? raw : {};
  const actualPlatform = cleanPlatform(value.platform || platform);
  const suppliedId = typeof randomId === 'function' ? randomId : randomDeviceId;
  const deviceId = /^[a-f0-9]{16}$/.test(String(value.deviceId || '')) ? String(value.deviceId) : suppliedId();
  const validId = /^[a-f0-9]{16}$/.test(deviceId) ? deviceId : randomDeviceId();
  return {
    version: 1,
    deviceId: validId,
    deviceName: cleanText(value.deviceName, 80) || defaultDeviceName(actualPlatform, validId),
    platform: actualPlatform,
    autoSync: value.autoSync !== false,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    clock: timestamp(value.clock),
    lastSyncAt: timestamp(value.lastSyncAt),
    lastPublishedAt: timestamp(value.lastPublishedAt),
    lastPublishedSignature: cleanHash(value.lastPublishedSignature),
    recordMeta: sanitizeSyncRecordMeta(value.recordMeta),
  };
}

export function saveDeviceSyncMeta(storage, meta) {
  const normalized = normalizeDeviceSyncMeta(meta, meta?.platform || 'android', () => meta?.deviceId || randomDeviceId());
  try {
    storage?.setItem(DEVICE_SYNC_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}

export function readDeviceSyncMeta(storage, platform = 'android', options = {}) {
  const raw = (() => {
    try { return parseJson(storage?.getItem(DEVICE_SYNC_KEY) || 'null'); } catch { return null; }
  })();
  const meta = normalizeDeviceSyncMeta(raw, platform, options.randomId || randomDeviceId);
  if (!raw || raw.deviceId !== meta.deviceId || options.create === true) saveDeviceSyncMeta(storage, meta);
  return meta;
}

export function publicDeviceSyncMeta(meta) {
  const clean = normalizeDeviceSyncMeta(meta, meta?.platform || 'android', () => meta?.deviceId || randomDeviceId());
  return {
    deviceId: clean.deviceId,
    deviceName: clean.deviceName,
    platform: clean.platform,
    autoSync: clean.autoSync,
    revision: clean.revision,
    lastSyncAt: clean.lastSyncAt,
    lastPublishedAt: clean.lastPublishedAt,
  };
}

export function setDeviceSyncAuto(storage, enabled, platform = 'android') {
  const meta = readDeviceSyncMeta(storage, platform, { create: true });
  meta.autoSync = enabled === true;
  saveDeviceSyncMeta(storage, meta);
  return publicDeviceSyncMeta(meta);
}

/**
 * Forget only that this snapshot was published. Connecting a folder that
 * may not contain this device's file yet must publish once even when the
 * same snapshot was already sent to a previous folder. Record metadata and
 * revision history stay intact.
 */
export function resetDeviceSyncPublication(storage, platform = 'android') {
  const meta = readDeviceSyncMeta(storage, platform, { create: true });
  meta.lastPublishedSignature = '';
  saveDeviceSyncMeta(storage, meta);
  return publicDeviceSyncMeta(meta);
}

export function deviceSyncFileName(metaOrPlatform, maybeId = '') {
  const platform = typeof metaOrPlatform === 'string' ? cleanPlatform(metaOrPlatform) : cleanPlatform(metaOrPlatform?.platform);
  const id = typeof metaOrPlatform === 'string' ? String(maybeId || '') : String(metaOrPlatform?.deviceId || '');
  return `mikozora-sync-${platform}-${id}.json`;
}

function payloadSignature(data, meta) {
  return hashValue({ data: sanitizeSyncSnapshot(data), meta: sanitizeSyncRecordMeta(meta) });
}

export function buildDeviceSyncPayload(data, recordMeta, identity, revision = 0, updatedAt = Date.now()) {
  const cleanIdentity = normalizeDeviceSyncMeta(identity, identity?.platform || 'android', () => identity?.deviceId || randomDeviceId());
  return {
    format: DEVICE_SYNC_FORMAT,
    version: DEVICE_SYNC_VERSION,
    appVersion: APP_VERSION,
    device: {
      id: cleanIdentity.deviceId,
      name: cleanIdentity.deviceName,
      platform: cleanIdentity.platform,
    },
    revision: Math.max(0, Math.floor(Number(revision) || 0)),
    updatedAt: timestamp(updatedAt),
    data: sanitizeSyncSnapshot(data),
    meta: sanitizeSyncRecordMeta(recordMeta),
  };
}

export function parseDeviceSyncFile(text) {
  const rawText = String(text ?? '');
  if (!rawText || rawText.length > DEVICE_SYNC_MAX_BYTES) return null;
  const parsed = parseJson(rawText);
  if (!isObject(parsed) || parsed.format !== DEVICE_SYNC_FORMAT) return null;
  if (Number(parsed.version) > DEVICE_SYNC_VERSION) return null;
  const device = isObject(parsed.device) ? parsed.device : {};
  const deviceId = String(device.id || '');
  if (!/^[a-f0-9]{16}$/.test(deviceId)) return null;
  const platform = cleanPlatform(device.platform);
  const data = sanitizeSyncSnapshot(parsed.data);
  const updatedAt = timestamp(parsed.updatedAt);
  return {
    deviceId,
    deviceName: cleanText(device.name, 80) || defaultDeviceName(platform, deviceId),
    platform,
    revision: Math.max(0, Math.floor(Number(parsed.revision) || 0)),
    updatedAt,
    appVersion: cleanText(parsed.appVersion, 40),
    data,
    // Stamping fills any missing record metadata from the file time while
    // retaining explicit tombstones supplied by a complete peer file.
    meta: stampSyncSnapshot(data, parsed.meta, updatedAt || 1),
  };
}

function richness(value) {
  if (!isObject(value)) return value == null ? 0 : 1;
  let score = 0;
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) score += entry.length;
    else if (entry !== '' && entry != null && entry !== false) score += 1;
  }
  return score;
}

function mergeBaseRecords(candidates, getValue, getRecord, valueHash = hashValue) {
  const keys = new Set();
  for (const candidate of candidates) {
    for (const key of Object.keys(getValue(candidate) || {})) keys.add(key);
    for (const key of Object.keys(getRecord(candidate) || {})) keys.add(key);
  }
  const values = {};
  const meta = {};
  for (const key of keys) {
    let deletedAt = 0;
    let tombstoneHash = '';
    let best = null;
    candidates.forEach((candidate, index) => {
      const record = getRecord(candidate)?.[key];
      if (record?.deletedAt >= deletedAt) {
        deletedAt = record.deletedAt || deletedAt;
        tombstoneHash = record.hash || tombstoneHash;
      }
      const value = getValue(candidate)?.[key];
      if (value === undefined) return;
      const updatedAt = timestamp(record?.updatedAt);
      const entry = { value, updatedAt, index, rich: richness(value) };
      if (!best || entry.updatedAt > best.updatedAt
        || (entry.updatedAt === best.updatedAt && (entry.rich > best.rich
          || (entry.rich === best.rich && stableStringify(entry.value) > stableStringify(best.value))))) {
        best = entry;
      }
    });
    if (best && best.updatedAt > deletedAt) {
      setOwn(values, key, best.value);
      setOwn(meta, key, { hash: valueHash(best.value), updatedAt: best.updatedAt, deletedAt: 0 });
    } else {
      setOwn(meta, key, {
        hash: tombstoneHash || (best ? valueHash(best.value) : ''),
        updatedAt: best?.updatedAt || 0,
        deletedAt,
      });
    }
  }
  return { values, meta };
}

function mergeSetRecords(candidates, getRecord) {
  const keys = new Set();
  for (const candidate of candidates) for (const key of Object.keys(getRecord(candidate) || {})) keys.add(key);
  const present = new Set();
  const meta = {};
  for (const key of keys) {
    let best = null;
    candidates.forEach((candidate, index) => {
      const record = getRecord(candidate)?.[key];
      if (!record) return;
      const entry = { present: record.present === true, updatedAt: timestamp(record.updatedAt), index };
      // The local candidate is first; on an exact timestamp tie a removal is
      // safer than resurrecting a membership/watched mark.
      if (!best || entry.updatedAt > best.updatedAt || (entry.updatedAt === best.updatedAt && best.present && !entry.present)) best = entry;
    });
    if (!best) continue;
    setOwn(meta, key, { present: best.present, updatedAt: best.updatedAt });
    if (best.present) present.add(key);
  }
  return { present, meta };
}

function orderedSet(candidates, lists, present) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < candidates.length; i++) {
    for (const key of lists[i] || []) {
      if (present.has(key) && !seen.has(key)) { seen.add(key); out.push(key); }
    }
  }
  for (const key of present) if (!seen.has(key)) out.push(key);
  return out;
}

function scalarCandidate(candidates, getValue, getRecord) {
  let best = null;
  candidates.forEach((candidate, index) => {
    const value = getValue(candidate);
    if (value === undefined) return;
    const record = getRecord(candidate);
    const entry = { value, updatedAt: timestamp(record?.updatedAt), deletedAt: timestamp(record?.deletedAt), index };
    if (!best || entry.updatedAt > best.updatedAt
      || (entry.updatedAt === best.updatedAt && stableStringify(entry.value) > stableStringify(best.value))) best = entry;
  });
  return best;
}

export function mergeDeviceSyncSnapshots(localCandidate, peerCandidates = []) {
  const candidates = [localCandidate, ...(Array.isArray(peerCandidates) ? peerCandidates : [])]
    .filter((candidate) => candidate && isObject(candidate.data))
    .map((candidate) => ({
      ...candidate,
      data: sanitizeSyncSnapshot(candidate.data),
      meta: stampSyncSnapshot(sanitizeSyncSnapshot(candidate.data), candidate.meta, timestamp(candidate.updatedAt) || 1),
    }));
  if (!candidates.length) return { data: sanitizeSyncSnapshot(null), meta: emptySyncRecordMeta(), clock: 0 };

  const libraryMaps = candidates.map((candidate) => Object.fromEntries(candidate.data.library.map((item) => [itemKey(item), item])));
  const libraryByCandidate = new Map(candidates.map((candidate, index) => [candidate, libraryMaps[index]]));
  const library = mergeBaseRecords(candidates, (candidate) => libraryByCandidate.get(candidate), (candidate) => candidate.meta.library);

  const collectionMaps = candidates.map((candidate) => Object.fromEntries(candidate.data.collections.map((collection) => [collection.id, collection])));
  const collectionByCandidate = new Map(candidates.map((candidate, index) => [candidate, collectionMaps[index]]));
  const collectionBase = mergeBaseRecords(
    candidates,
    (candidate) => Object.fromEntries(Object.entries(collectionByCandidate.get(candidate) || {}).map(([id, collection]) => [id, collection.name])),
    (candidate) => candidate.meta.collections,
    (name) => hashValue(name),
  );
  const collections = [];
  const collectionMeta = {};
  const collectionOrder = [];
  for (const candidate of candidates) {
    for (const collection of candidate.data.collections) if (!collectionOrder.includes(collection.id)) collectionOrder.push(collection.id);
  }
  for (const id of Object.keys(collectionBase.meta)) if (!collectionOrder.includes(id)) collectionOrder.push(id);
  for (const id of collectionOrder) {
    const base = collectionBase.meta[id];
    const memberMerge = mergeSetRecords(candidates, (candidate) => candidate.meta.collections[id]?.members || {});
    const deletedAt = base?.deletedAt || 0;
    let present = memberMerge.present;
    if (deletedAt && base?.updatedAt > deletedAt) {
      // A collection revived by a later edit should not automatically revive
      // every membership that predated its deletion.
      present = new Set([...present].filter((key) => timestamp(memberMerge.meta[key]?.updatedAt) > deletedAt));
    }
    setOwn(collectionMeta, id, { ...(base || { hash: hashValue(''), updatedAt: 0, deletedAt: 0 }), members: memberMerge.meta });
    const alive = id === FAVOURITES_ID || Object.prototype.hasOwnProperty.call(collectionBase.values, id);
    if (!alive) continue;
    const name = id === FAVOURITES_ID ? 'Favourites' : String(collectionBase.values[id] || 'Collection');
    const lists = candidates.map((candidate) => collectionByCandidate.get(candidate)?.[id]?.items || []);
    collections.push({ id, name, items: orderedSet(candidates, lists, present) });
  }
  if (!collections.some((collection) => collection.id === FAVOURITES_ID)) {
    collections.unshift({ id: FAVOURITES_ID, name: 'Favourites', items: [] });
    if (!collectionMeta[FAVOURITES_ID]) collectionMeta[FAVOURITES_ID] = { hash: hashValue('Favourites'), updatedAt: 0, deletedAt: 0, members: {} };
  }

  const historyMaps = candidates.map((candidate) => Object.fromEntries(candidate.data.history.map((entry) => [historyId(entry), entry])));
  const historyByCandidate = new Map(candidates.map((candidate, index) => [candidate, historyMaps[index]]));
  const historyMerged = mergeBaseRecords(candidates, (candidate) => historyByCandidate.get(candidate), (candidate) => candidate.meta.history);
  const history = Object.values(historyMerged.values).sort((a, b) => b.time - a.time).slice(0, MAX_HISTORY);

  const progressMaps = candidates.map((candidate) => Object.fromEntries(candidate.data.progress.map((entry) => [entry.key || itemKey(entry.item), entry])));
  const progressByCandidate = new Map(candidates.map((candidate, index) => [candidate, progressMaps[index]]));
  const progressBase = mergeBaseRecords(
    candidates,
    (candidate) => Object.fromEntries(Object.entries(progressByCandidate.get(candidate) || {}).map(([key, entry]) => [key, { item: entry.item, episodes: entry.episodes }])),
    (candidate) => candidate.meta.progress,
    (value) => hashValue(value),
  );
  const progress = [];
  const progressMeta = {};
  for (const [key, base] of Object.entries(progressBase.meta)) {
    const watchedMerge = mergeSetRecords(candidates, (candidate) => candidate.meta.progress[key]?.watched || {});
    setOwn(progressMeta, key, { ...base, watched: watchedMerge.meta });
    const chosen = progressBase.values[key];
    if (!chosen) continue;
    let updatedAt = 0;
    for (const candidate of candidates) updatedAt = Math.max(updatedAt, timestamp(progressByCandidate.get(candidate)?.[key]?.updatedAt));
    const episodeOrder = (chosen.episodes || []).map((episode) => episode.url);
    const watchedLists = candidates.map((candidate) => progressByCandidate.get(candidate)?.[key]?.watched || []);
    const watched = orderedSet(candidates, [episodeOrder, ...watchedLists], watchedMerge.present);
    progress.push({ key, item: chosen.item, episodes: chosen.episodes || [], watched, updatedAt });
  }

  const libraryMetaMerged = mergeBaseRecords(
    candidates,
    (candidate) => candidate.data.libraryMeta,
    (candidate) => candidate.meta.libraryMeta,
  );

  const sourceMatchesMerged = mergeBaseRecords(
    candidates,
    (candidate) => candidate.data.sourceMatches.edges,
    (candidate) => candidate.meta.sourceMatches,
  );

  const franchiseChainsMerged = mergeBaseRecords(
    candidates,
    (candidate) => candidate.data.franchiseChains.chains,
    (candidate) => candidate.meta.franchiseChains,
  );
  const franchiseDismissalsMerged = mergeBaseRecords(
    candidates,
    (candidate) => candidate.data.franchiseChains.dismissed,
    (candidate) => candidate.meta.franchiseDismissals,
  );

  const appearanceChoice = scalarCandidate(candidates, (candidate) => candidate.data.appearance, (candidate) => candidate.meta.settings.appearance);
  const contentChoice = scalarCandidate(candidates, (candidate) => candidate.data.content, (candidate) => candidate.meta.settings.content);
  const smart = { ...candidates[0].data.smartDownloads };
  const smartMeta = { scalars: {}, titleKeys: {}, collectionIds: {}, presets: {} };
  for (const key of SMART_SCALARS) {
    const choice = scalarCandidate(candidates, (candidate) => candidate.data.smartDownloads[key], (candidate) => candidate.meta.settings.smartDownloads.scalars[key]);
    if (choice) {
      smart[key] = choice.value;
      smartMeta.scalars[key] = { hash: hashValue(choice.value), updatedAt: choice.updatedAt, deletedAt: 0 };
    }
  }
  const smartTitles = mergeSetRecords(candidates, (candidate) => candidate.meta.settings.smartDownloads.titleKeys);
  const smartCollections = mergeSetRecords(candidates, (candidate) => candidate.meta.settings.smartDownloads.collectionIds);
  smart.titleKeys = orderedSet(candidates, candidates.map((candidate) => candidate.data.smartDownloads.titleKeys), smartTitles.present);
  smart.collectionIds = orderedSet(candidates, candidates.map((candidate) => candidate.data.smartDownloads.collectionIds), smartCollections.present);
  smartMeta.titleKeys = smartTitles.meta;
  smartMeta.collectionIds = smartCollections.meta;
  const presetMaps = candidates.map((candidate) => candidate.data.smartDownloads.presets || {});
  const presetByCandidate = new Map(candidates.map((candidate, index) => [candidate, presetMaps[index]]));
  const presets = mergeBaseRecords(candidates, (candidate) => presetByCandidate.get(candidate), (candidate) => candidate.meta.settings.smartDownloads.presets);
  smart.presets = presets.values;
  smartMeta.presets = presets.meta;

  const libraryList = orderedSet(
    candidates,
    candidates.map((candidate) => candidate.data.library.map((item) => itemKey(item))),
    new Set(Object.keys(library.values)),
  ).map((key) => library.values[key]).filter(Boolean);

  const data = sanitizeSyncSnapshot({
    library: libraryList,
    collections,
    history,
    progress,
    libraryMeta: libraryMetaMerged.values,
    sourceMatches: { version: 1, edges: sourceMatchesMerged.values },
    franchiseChains: { version: 1, chains: franchiseChainsMerged.values, dismissed: franchiseDismissalsMerged.values },
    appearance: appearanceChoice?.value,
    content: contentChoice?.value,
    smartDownloads: smart,
  });

  const meta = pruneSyncRecordMeta({
    library: library.meta,
    collections: collectionMeta,
    history: historyMerged.meta,
    progress: progressMeta,
    libraryMeta: libraryMetaMerged.meta,
    sourceMatches: sourceMatchesMerged.meta,
    franchiseChains: franchiseChainsMerged.meta,
    franchiseDismissals: franchiseDismissalsMerged.meta,
    settings: {
      appearance: appearanceChoice ? { hash: hashValue(appearanceChoice.value), updatedAt: appearanceChoice.updatedAt, deletedAt: 0 } : null,
      content: contentChoice ? { hash: hashValue(contentChoice.value), updatedAt: contentChoice.updatedAt, deletedAt: 0 } : null,
      smartDownloads: smartMeta,
    },
  });

  // normalizeProgress may drop titles beyond the app's 40-title retention
  // cap. Mark those dropped titles deleted at their own event time so the
  // next local diff does not look like a fresh user deletion with a new time.
  const retainedProgress = new Set(data.progress.map((entry) => entry.key));
  for (const [key, record] of Object.entries(meta.progress)) {
    if (!retainedProgress.has(key) && !record.deletedAt) record.deletedAt = Math.max(1, record.updatedAt || 1);
  }
  const retainedLibraryMeta = new Set(Object.keys(data.libraryMeta));
  for (const [key, record] of Object.entries(meta.libraryMeta)) {
    if (!retainedLibraryMeta.has(key) && !record.deletedAt) record.deletedAt = Math.max(1, record.updatedAt || 1);
  }
  const retainedSourceMatches = new Set(Object.keys(data.sourceMatches.edges));
  for (const [key, record] of Object.entries(meta.sourceMatches)) {
    if (!retainedSourceMatches.has(key) && !record.deletedAt) record.deletedAt = Math.max(1, record.updatedAt || 1);
  }
  const retainedFranchiseChains = new Set(Object.keys(data.franchiseChains.chains));
  for (const [key, record] of Object.entries(meta.franchiseChains)) {
    if (!retainedFranchiseChains.has(key) && !record.deletedAt) record.deletedAt = Math.max(1, record.updatedAt || 1);
  }
  const retainedFranchiseDismissals = new Set(Object.keys(data.franchiseChains.dismissed));
  for (const [key, record] of Object.entries(meta.franchiseDismissals)) {
    if (!retainedFranchiseDismissals.has(key) && !record.deletedAt) record.deletedAt = Math.max(1, record.updatedAt || 1);
  }

  return { data, meta, clock: Math.max(...candidates.map((candidate) => maxMetaClock(candidate.meta)), maxMetaClock(meta)) };
}

function peerText(entry) {
  if (typeof entry === 'string') return entry;
  if (typeof entry?.text === 'string') return entry.text;
  return '';
}

function selectPeerCandidates(entries, ownDeviceId) {
  const byDevice = new Map();
  let ignored = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseDeviceSyncFile(peerText(entry));
    if (!parsed || parsed.deviceId === ownDeviceId) { ignored++; continue; }
    const old = byDevice.get(parsed.deviceId);
    if (!old || parsed.revision > old.revision || (parsed.revision === old.revision && parsed.updatedAt >= old.updatedAt)) {
      byDevice.set(parsed.deviceId, parsed);
    }
  }
  return { peers: [...byDevice.values()].sort((a, b) => a.deviceId.localeCompare(b.deviceId)), ignored };
}

/**
 * Read local stores, stamp local changes, merge valid peer files, apply the
 * result to this device, and prepare (but do not write) this device's new
 * sync file. Call markDeviceSyncPublished only after the native write works.
 */
export function prepareDeviceSync(storage, peerFiles = [], options = {}) {
  const now = timestamp(options.now) || Date.now();
  const meta = readDeviceSyncMeta(storage, options.platform || 'android', { create: true, randomId: options.randomId });
  const hasStoredValue = (key) => {
    try { return storage?.getItem(key) != null; } catch { return false; }
  };
  // Appearance/content/Smart Download snapshots materialize defaults when
  // their stores have never been written. Those are not user choices, so on
  // a first sync they receive event time zero and cannot overwrite settings
  // another device actually selected. Changing one later stamps it normally.
  const implicitAppearance = !hasStoredValue(APPEARANCE_KEY);
  const implicitContent = !hasStoredValue(CONTENT_KEY);
  const implicitSmartDownloads = !hasStoredValue(SMART_DOWNLOADS_KEY);
  const before = snapshotFromStorage(storage);
  const eventNow = Math.max(now, timestamp(meta.clock) + 1);
  const stamped = stampSyncSnapshot(before, meta.recordMeta, eventNow);
  const markImplicit = (record, previous) => (
    record && !timestamp(previous?.updatedAt) ? { ...record, updatedAt: 0 } : record
  );
  if (implicitAppearance) {
    stamped.settings.appearance = markImplicit(stamped.settings.appearance, meta.recordMeta.settings.appearance);
  }
  if (implicitContent) {
    stamped.settings.content = markImplicit(stamped.settings.content, meta.recordMeta.settings.content);
  }
  if (implicitSmartDownloads) {
    for (const key of SMART_SCALARS) {
      stamped.settings.smartDownloads.scalars[key] = markImplicit(
        stamped.settings.smartDownloads.scalars[key],
        meta.recordMeta.settings.smartDownloads.scalars[key],
      );
    }
  }
  const localCandidate = {
    deviceId: meta.deviceId,
    deviceName: meta.deviceName,
    platform: meta.platform,
    revision: meta.revision,
    updatedAt: meta.lastPublishedAt || eventNow,
    data: before,
    meta: stamped,
  };
  const { peers, ignored } = selectPeerCandidates(peerFiles, meta.deviceId);
  const merged = mergeDeviceSyncSnapshots(localCandidate, peers);
  const applied = applySyncSnapshotToStorage(storage, merged.data);
  const signature = payloadSignature(applied, merged.meta);
  const shouldWrite = signature !== meta.lastPublishedSignature;
  const revision = shouldWrite ? meta.revision + 1 : meta.revision;
  const payload = buildDeviceSyncPayload(applied, merged.meta, meta, revision, now);
  const nextMeta = {
    ...meta,
    revision,
    clock: Math.max(meta.clock, merged.clock, eventNow),
    lastSyncAt: now,
    recordMeta: merged.meta,
  };
  if (!saveDeviceSyncMeta(storage, nextMeta)) {
    throw new Error('Mikozora could not save device-sync information on this device.');
  }
  return {
    identity: publicDeviceSyncMeta(nextMeta),
    fileName: deviceSyncFileName(nextMeta),
    before,
    data: applied,
    changed: syncSnapshotSignature(before) !== syncSnapshotSignature(applied),
    peerCount: peers.length,
    ignoredPeerFiles: ignored,
    payload,
    payloadText: JSON.stringify(payload, null, 2),
    signature,
    revision,
    shouldWrite,
  };
}

export function markDeviceSyncPublished(storage, signature, revision, now = Date.now()) {
  const meta = readDeviceSyncMeta(storage, 'android');
  if (meta.revision !== Math.max(0, Math.floor(Number(revision) || 0))) return publicDeviceSyncMeta(meta);
  meta.lastPublishedSignature = cleanHash(signature);
  meta.lastPublishedAt = timestamp(now) || Date.now();
  meta.lastSyncAt = meta.lastPublishedAt;
  saveDeviceSyncMeta(storage, meta);
  return publicDeviceSyncMeta(meta);
}
