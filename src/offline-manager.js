// Device-local tools for understanding and safely tidying downloads.
//
// Download records already live in the platform download services. This
// module never deletes anything itself: it normalizes the manager choices,
// summarizes records, orders the visible/native queue, and identifies the
// watched completed episodes that are safe cleanup candidates. The App
// performs every removal through the existing platform bridge.
import { titleKey } from './collections.js';

export const OFFLINE_MANAGER_KEY = 'moku.offlineManager.v1';
export const OFFLINE_STORAGE_LIMITS_GB = [0, 1, 2, 5, 10, 20, 50];
export const OFFLINE_AUTO_DELETE_DAYS = [0, 1, 7, 30, 90];
export const DEFAULT_OFFLINE_MANAGER = Object.freeze({
  storageLimitGb: 0,
  autoDeleteWatchedDays: 0,
  autoCleanup: false,
  queueOrder: [],
});

const DOWNLOAD_ID = /^[a-f0-9]{32}$/;
const QUEUE_STATUSES = new Set(['queued', 'resolving', 'downloading', 'paused']);
const ACTIVE_STATUSES = new Set(['resolving', 'downloading']);

function nearestAllowed(value, allowed, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  let best = fallback;
  let distance = Infinity;
  for (const candidate of allowed) {
    const nextDistance = Math.abs(candidate - number);
    if (nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return best;
}

function cleanQueueOrder(value) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(value) ? value : []) {
    const clean = String(id || '');
    if (!DOWNLOAD_ID.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 500) break;
  }
  return out;
}

export function normalizeOfflineManager(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    storageLimitGb: nearestAllowed(
      input.storageLimitGb,
      OFFLINE_STORAGE_LIMITS_GB,
      DEFAULT_OFFLINE_MANAGER.storageLimitGb,
    ),
    autoDeleteWatchedDays: nearestAllowed(
      input.autoDeleteWatchedDays,
      OFFLINE_AUTO_DELETE_DAYS,
      DEFAULT_OFFLINE_MANAGER.autoDeleteWatchedDays,
    ),
    autoCleanup: input.autoCleanup === true,
    queueOrder: cleanQueueOrder(input.queueOrder),
  };
}

export function readOfflineManager(storage) {
  try {
    return normalizeOfflineManager(JSON.parse(storage?.getItem?.(OFFLINE_MANAGER_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_OFFLINE_MANAGER, queueOrder: [] };
  }
}

export function saveOfflineManager(storage, value) {
  const normalized = normalizeOfflineManager(value);
  try {
    storage?.setItem?.(OFFLINE_MANAGER_KEY, JSON.stringify(normalized));
  } catch { /* The current session can still use the normalized value. */ }
  return normalized;
}

export function downloadBytes(record) {
  const candidates = [record?.bytes, record?.localBytes, record?.exportBytes]
    .map(value => Number(value) || 0)
    .filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function downloadTitleKey(record) {
  const item = record?.item;
  return item?.source && item?.url ? titleKey(item) : '';
}

function rawWatchedValue(watchedById, id) {
  if (!id || !watchedById) return undefined;
  if (watchedById instanceof Map) return watchedById.get(id);
  if (watchedById instanceof Set) return watchedById.has(id);
  if (Array.isArray(watchedById)) return watchedById.includes(id);
  if (typeof watchedById === 'object') return watchedById[id];
  return undefined;
}

export function watchedInfoFor(watchedById, record) {
  const raw = rawWatchedValue(watchedById, record?.id);
  if (raw && typeof raw === 'object') {
    return {
      watched: raw.watched === true,
      watchedAt: Number.isFinite(Number(raw.watchedAt)) ? Number(raw.watchedAt) : 0,
    };
  }
  if (typeof raw === 'number') return { watched: raw > 0, watchedAt: raw > 0 ? raw : 0 };
  return { watched: raw === true, watchedAt: 0 };
}

function cleanRecords(records) {
  const seen = new Set();
  return (Array.isArray(records) ? records : []).filter(record => {
    if (!record || typeof record !== 'object' || !DOWNLOAD_ID.test(String(record.id || ''))) return false;
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function addedAt(record) {
  return Number(record?.added) || Number(record?.downloadedAt) || 0;
}

function statusRank(record) {
  if (ACTIVE_STATUSES.has(record?.status)) return 0;
  if (QUEUE_STATUSES.has(record?.status)) return 1;
  if (record?.status === 'failed') return 2;
  if (record?.status === 'completed') return 3;
  return 4;
}

function queueIndex(record, orderIndex) {
  return orderIndex.has(record.id) ? orderIndex.get(record.id) : Number.POSITIVE_INFINITY;
}

export function queueOrderIds(records, managerOrOrder = []) {
  const order = Array.isArray(managerOrOrder) ? cleanQueueOrder(managerOrOrder) : normalizeOfflineManager(managerOrOrder).queueOrder;
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return cleanRecords(records)
    .filter(record => QUEUE_STATUSES.has(record.status))
    .sort((a, b) => queueIndex(a, orderIndex) - queueIndex(b, orderIndex)
      || statusRank(a) - statusRank(b)
      || addedAt(a) - addedAt(b)
      || String(a.id).localeCompare(String(b.id)))
    .map(record => record.id);
}

export function moveQueueOrder(currentOrder, id, move) {
  const order = cleanQueueOrder(currentOrder);
  const index = order.indexOf(id);
  if (index < 0) return order;
  const next = [...order];
  const [moved] = next.splice(index, 1);
  let target = index;
  if (move === 'front') target = 0;
  else if (move === 'back') target = next.length;
  else target = Math.max(0, Math.min(next.length, index + (Number(move) || 0)));
  next.splice(target, 0, moved);
  return next;
}

export function sortManagerDownloads(records, { sort = 'queue', queueOrder = [] } = {}) {
  const clean = cleanRecords(records);
  const order = cleanQueueOrder(queueOrder);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const byTitle = (a, b) => String(a.item?.title || '').localeCompare(String(b.item?.title || ''), undefined, { sensitivity: 'base' })
    || (Number.parseFloat(a.episode?.number) || Infinity) - (Number.parseFloat(b.episode?.number) || Infinity)
    || addedAt(b) - addedAt(a);
  return clean.sort((a, b) => {
    if (sort === 'size-desc') return downloadBytes(b) - downloadBytes(a) || byTitle(a, b);
    if (sort === 'size-asc') return downloadBytes(a) - downloadBytes(b) || byTitle(a, b);
    if (sort === 'series') return byTitle(a, b);
    if (sort === 'newest') return addedAt(b) - addedAt(a) || byTitle(a, b);
    if (sort === 'oldest') return addedAt(a) - addedAt(b) || byTitle(a, b);
    return statusRank(a) - statusRank(b)
      || queueIndex(a, orderIndex) - queueIndex(b, orderIndex)
      || (statusRank(a) <= 1 ? addedAt(a) - addedAt(b) : addedAt(b) - addedAt(a))
      || byTitle(a, b);
  });
}

export function downloadStorageSummary(records, watchedById = {}) {
  const clean = cleanRecords(records);
  const summary = {
    totalRecords: clean.length,
    totalBytes: 0,
    completedCount: 0,
    completedBytes: 0,
    activeCount: 0,
    queuedCount: 0,
    failedCount: 0,
    watchedCount: 0,
    watchedBytes: 0,
    unwatchedBytes: 0,
    folderCopies: 0,
    bySeries: [],
    bySource: [],
  };
  const series = new Map();
  const sources = new Map();

  for (const record of clean) {
    const bytes = downloadBytes(record);
    const watched = watchedInfoFor(watchedById, record);
    const completed = record.status === 'completed';
    summary.totalBytes += bytes;
    if (completed) {
      summary.completedCount++;
      summary.completedBytes += bytes;
      if (watched.watched) {
        summary.watchedCount++;
        summary.watchedBytes += bytes;
      } else {
        summary.unwatchedBytes += bytes;
      }
    }
    if (ACTIVE_STATUSES.has(record.status)) summary.activeCount++;
    else if (QUEUE_STATUSES.has(record.status)) summary.queuedCount++;
    if (record.status === 'failed') summary.failedCount++;
    if (record.storageMode === 'folder' && record.exportVerified) summary.folderCopies++;

    const key = downloadTitleKey(record) || record.id;
    const currentSeries = series.get(key) || {
      key,
      item: record.item || null,
      title: record.item?.title || 'Downloaded episode',
      source: record.item?.source || '',
      count: 0,
      completedCount: 0,
      watchedCount: 0,
      bytes: 0,
      watchedBytes: 0,
      newestAdded: 0,
    };
    currentSeries.count++;
    currentSeries.bytes += bytes;
    currentSeries.newestAdded = Math.max(currentSeries.newestAdded, addedAt(record));
    if (completed) currentSeries.completedCount++;
    if (completed && watched.watched) {
      currentSeries.watchedCount++;
      currentSeries.watchedBytes += bytes;
    }
    series.set(key, currentSeries);

    const source = record.item?.source || 'unknown';
    const currentSource = sources.get(source) || { source, count: 0, completedCount: 0, bytes: 0, watchedBytes: 0 };
    currentSource.count++;
    currentSource.bytes += bytes;
    if (completed) currentSource.completedCount++;
    if (completed && watched.watched) currentSource.watchedBytes += bytes;
    sources.set(source, currentSource);
  }

  summary.bySeries = [...series.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count || a.title.localeCompare(b.title));
  summary.bySource = [...sources.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count || a.source.localeCompare(b.source));
  return summary;
}

function isCleanupEligible(record) {
  if (record?.status !== 'completed') return false;
  // Removing a verified folder-backed record does not delete the user's
  // folder file, and after private cleanup it frees no app storage. Never
  // present it as though cleanup would recover those bytes.
  if (record.storageMode === 'folder' && record.exportVerified && record.cleanupStatus === 'complete') return false;
  if (['queued', 'exporting', 'verifying'].includes(record.exportStatus)) return false;
  return true;
}

function cleanupTimestamp(record, watched) {
  return watched.watchedAt || Number(record?.downloadedAt) || addedAt(record) || 0;
}

export function downloadCleanupCandidates(records, manager, watchedById = {}, now = Date.now()) {
  const prefs = normalizeOfflineManager(manager);
  const clean = cleanRecords(records);
  const completedBytes = clean
    .filter(record => record.status === 'completed')
    .reduce((sum, record) => sum + downloadBytes(record), 0);
  const eligible = clean
    .filter(isCleanupEligible)
    .map(record => ({ record, watched: watchedInfoFor(watchedById, record) }))
    .filter(entry => entry.watched.watched)
    .map(entry => ({ ...entry, timestamp: cleanupTimestamp(entry.record, entry.watched) }))
    .sort((a, b) => a.timestamp - b.timestamp || addedAt(a.record) - addedAt(b.record) || downloadBytes(b.record) - downloadBytes(a.record));

  const chosen = new Map();
  const dayMs = 24 * 60 * 60 * 1000;
  if (prefs.autoDeleteWatchedDays > 0) {
    const cutoff = now - prefs.autoDeleteWatchedDays * dayMs;
    for (const entry of eligible) {
      if (entry.timestamp > 0 && entry.timestamp <= cutoff) {
        chosen.set(entry.record.id, { record: entry.record, reason: 'watched-age' });
      }
    }
  }

  if (prefs.storageLimitGb > 0) {
    const limitBytes = prefs.storageLimitGb * 1024 * 1024 * 1024;
    let remaining = completedBytes - [...chosen.values()].reduce((sum, entry) => sum + downloadBytes(entry.record), 0);
    for (const entry of eligible) {
      if (remaining <= limitBytes) break;
      if (!chosen.has(entry.record.id)) chosen.set(entry.record.id, { record: entry.record, reason: 'storage-limit' });
      remaining -= downloadBytes(entry.record);
    }
  }

  return [...chosen.values()].sort((a, b) => addedAt(a.record) - addedAt(b.record));
}

export function cleanupBytes(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .reduce((sum, entry) => sum + downloadBytes(entry?.record || entry), 0);
}
