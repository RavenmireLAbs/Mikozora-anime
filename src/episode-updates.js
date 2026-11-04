import { titleKey } from './collections.js';
import { normalizeSmartDownloads } from './smart-downloads.js';
import { normalizeReleaseRadar, releaseRadarMonitorFields } from './release-radar.js';

function watchedByTitle(progressEntries, historyEntries) {
  const result = new Map();
  const add = (key, url) => {
    if (typeof key !== 'string' || !key || typeof url !== 'string' || !url) return;
    if (!result.has(key)) result.set(key, new Set());
    result.get(key).add(url);
  };
  for (const entry of Array.isArray(progressEntries) ? progressEntries : []) {
    const key = typeof entry?.key === 'string' && entry.key ? entry.key : titleKey(entry?.item);
    for (const url of Array.isArray(entry?.watched) ? entry.watched : []) add(key, url);
  }
  for (const entry of Array.isArray(historyEntries) ? historyEntries : []) {
    add(titleKey(entry?.item), entry?.episode?.url);
  }
  return result;
}

// Only titles in Favourites or a personal collection are checked. One title may
// belong to several collections, but its source + URL is sent natively once.
// Smart Downloads reuses that follow rule: selecting a standalone series
// saves/follows it through Favourites in the UI, while a selected collection
// contributes all of its member titles.
export function monitoredTitles(library, collections, smartSettings = null, progressEntries = [], historyEntries = [], radarStore = null) {
  const radar = radarStore ? normalizeReleaseRadar(radarStore) : null;
  const included = new Set((Array.isArray(collections) ? collections : []).flatMap((c) => Array.isArray(c?.items) ? c.items : []));
  const smart = smartSettings ? normalizeSmartDownloads(smartSettings) : null;
  const smartCollectionKeys = new Set();
  if (smart) {
    for (const collection of Array.isArray(collections) ? collections : []) {
      if (!smart.collectionIds.includes(collection?.id)) continue;
      for (const key of Array.isArray(collection?.items) ? collection.items : []) {
        if (typeof key === 'string' && key) smartCollectionKeys.add(key);
      }
    }
  }
  const watched = smart ? watchedByTitle(progressEntries, historyEntries) : new Map();
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(library) ? library : []) {
    if (!item || typeof item.source !== 'string' || typeof item.url !== 'string' || typeof item.title !== 'string') continue;
    const id = titleKey(item);
    if (!included.has(id) || seen.has(id)) continue;
    seen.add(id);
    const summary = { source: item.source, url: item.url, title: item.title, image: item.image || '', type: item.type || '', badge: item.badge || '', status: item.status || '' };
    if (radar) {
      Object.assign(summary, releaseRadarMonitorFields(radar, item));
    }
    if (smart) {
      const selected = smart.titleKeys.includes(id) || smartCollectionKeys.has(id);
      if (selected) {
        summary.smartDownload = true;
        summary.watchedEpisodes = [...(watched.get(id) || [])];
      }
      if (smart.presets[id]) summary.downloadPreset = smart.presets[id];
    }
    result.push(summary);
  }
  return result;
}

export function unreadByTitle(updates) {
  const counts = {};
  for (const entry of Array.isArray(updates) ? updates : []) {
    if (!entry?.read && typeof entry?.titleId === 'string') counts[entry.titleId] = (counts[entry.titleId] || 0) + 1;
  }
  return counts;
}
