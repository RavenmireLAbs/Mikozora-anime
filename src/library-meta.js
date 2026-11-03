// Personal library records kept beside the saved-title list: a private
// five-star rating, a short note and a user's own shelf status. They are
// keyed by the same source + URL identity as the library/collections and are
// deliberately separate from source-provided metadata (for example, a
// source's "Completed" airing state is not the user's own status).

import { titleKey } from './collections.js';
import { yearOf } from './content.js';

export const LIBRARY_META_KEY = 'moku.libraryMeta.v1';
export const PERSONAL_STATUSES = [
  { id: 'plan', label: 'Plan to watch' },
  { id: 'watching', label: 'Watching' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
  { id: 'dropped', label: 'Dropped' },
];
const PERSONAL_STATUS_IDS = new Set(PERSONAL_STATUSES.map(status => status.id));
const MAX_NOTE_CHARS = 600;
const MAX_RECORDS = 1000;

function cleanRecord(value) {
  const input = value && typeof value === 'object' ? value : {};
  const ratingNumber = Number(input.rating);
  const rating = Number.isFinite(ratingNumber) ? Math.max(0, Math.min(5, Math.trunc(ratingNumber))) : 0;
  const note = String(input.note || '').slice(0, MAX_NOTE_CHARS);
  const status = PERSONAL_STATUS_IDS.has(input.status) ? input.status : '';
  const updatedAt = Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : 0;
  if (!rating && !note.trim() && !status) return null;
  return { rating, note, status, updatedAt };
}

export function normalizeLibraryMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.includes('|') && key.length <= 700)
      .map(([key, record]) => [key, cleanRecord(record)])
      .filter(([, record]) => record)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_RECORDS),
  );
}

export function readLibraryMeta(storage) {
  try { return normalizeLibraryMeta(JSON.parse(storage.getItem(LIBRARY_META_KEY) || 'null')); }
  catch { return {}; }
}

export function saveLibraryMeta(storage, value) {
  try {
    storage.setItem(LIBRARY_META_KEY, JSON.stringify(normalizeLibraryMeta(value)));
    return true;
  } catch {
    return false;
  }
}

export function libraryMetaFor(meta, itemOrKey) {
  const key = typeof itemOrKey === 'string' ? itemOrKey : (itemOrKey?.source && itemOrKey?.url ? titleKey(itemOrKey) : '');
  return normalizeLibraryMeta(meta)[key] || { rating: 0, note: '', status: '', updatedAt: 0 };
}

export function setLibraryMeta(meta, itemOrKey, patch, now = Date.now()) {
  const clean = normalizeLibraryMeta(meta);
  const key = typeof itemOrKey === 'string' ? itemOrKey : (itemOrKey?.source && itemOrKey?.url ? titleKey(itemOrKey) : '');
  if (!key) return clean;
  const record = cleanRecord({ ...(clean[key] || {}), ...(patch || {}), updatedAt: now });
  if (record) clean[key] = record;
  else delete clean[key];
  return normalizeLibraryMeta(clean);
}

export function removeLibraryMeta(meta, keys) {
  const clean = normalizeLibraryMeta(meta);
  for (const key of Array.isArray(keys) ? keys : []) delete clean[key];
  return clean;
}

export function pruneLibraryMeta(meta, validKeys) {
  const valid = validKeys instanceof Set ? validKeys : new Set(Array.isArray(validKeys) ? validKeys : []);
  return Object.fromEntries(Object.entries(normalizeLibraryMeta(meta)).filter(([key]) => valid.has(key)));
}

export function personalStatusLabel(status) {
  return PERSONAL_STATUSES.find(entry => entry.id === status)?.label || '';
}

export function libraryProgressState(progress) {
  const watched = Number(progress?.watchedCount) || 0;
  const total = Number(progress?.total) || 0;
  if (!watched) return 'not-started';
  if (total > 0 && watched >= total) return 'caught-up';
  return 'in-progress';
}

function progressPercent(progress) {
  const watched = Number(progress?.watchedCount) || 0;
  const total = Number(progress?.total) || 0;
  return total > 0 ? watched / total : 0;
}

function unwatchedCount(progress) {
  const watched = Number(progress?.watchedCount) || 0;
  const total = Number(progress?.total) || 0;
  return total > 0 ? Math.max(0, total - watched) : -1;
}

export function sortLibraryTitles(items, sort, progressByKey = {}, meta = {}) {
  const cleanMeta = normalizeLibraryMeta(meta);
  const decorated = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }));
  const byTitle = (a, b) => String(a.item?.title || '').localeCompare(String(b.item?.title || ''), undefined, { sensitivity: 'base' });
  decorated.sort((a, b) => {
    const aKey = a.item?.source && a.item?.url ? titleKey(a.item) : '';
    const bKey = b.item?.source && b.item?.url ? titleKey(b.item) : '';
    const aProgress = progressByKey[aKey];
    const bProgress = progressByKey[bKey];
    const aMeta = cleanMeta[aKey] || {};
    const bMeta = cleanMeta[bKey] || {};
    switch (sort) {
      case 'title-az': return byTitle(a, b) || a.index - b.index;
      case 'title-za': return byTitle(b, a) || a.index - b.index;
      case 'progress-desc': return progressPercent(bProgress) - progressPercent(aProgress)
        || (Number(bProgress?.watchedCount) || 0) - (Number(aProgress?.watchedCount) || 0)
        || byTitle(a, b) || a.index - b.index;
      case 'unwatched-desc': return unwatchedCount(bProgress) - unwatchedCount(aProgress)
        || byTitle(a, b) || a.index - b.index;
      case 'rating-desc': return (Number(bMeta.rating) || 0) - (Number(aMeta.rating) || 0)
        || (Number(bMeta.updatedAt) || 0) - (Number(aMeta.updatedAt) || 0)
        || byTitle(a, b) || a.index - b.index;
      case 'year-desc': return (yearOf(b.item) || -1) - (yearOf(a.item) || -1) || byTitle(a, b) || a.index - b.index;
      case 'year-asc': {
        const aYear = yearOf(a.item) || 10000;
        const bYear = yearOf(b.item) || 10000;
        return aYear - bYear || byTitle(a, b) || a.index - b.index;
      }
      default: return a.index - b.index;
    }
  });
  return decorated.map(entry => entry.item);
}

export function libraryStats(items, progressByKey = {}, meta = {}) {
  const cleanMeta = normalizeLibraryMeta(meta);
  const stats = {
    titles: 0,
    inProgress: 0,
    caughtUp: 0,
    watchedEpisodes: 0,
    rated: 0,
    withNotes: 0,
  };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.source || !item?.url) continue;
    const key = titleKey(item);
    const progress = progressByKey[key];
    const state = libraryProgressState(progress);
    const record = cleanMeta[key];
    stats.titles++;
    stats.watchedEpisodes += Number(progress?.watchedCount) || 0;
    if (state === 'in-progress') stats.inProgress++;
    if (state === 'caught-up') stats.caughtUp++;
    if (record?.rating) stats.rated++;
    if (record?.note?.trim()) stats.withNotes++;
  }
  return stats;
}
