// Per-title watch progress: which episodes were opened plus the episode list
// as last seen, so Home can offer the next episode without refetching every
// series. History (moku.history.v1) stays the recent-activity feed with its
// 100-entry global cap; this store is keyed by title so long series keep
// their full progress. All helpers are pure; main.jsx persists the returned
// array under PROGRESS_KEY. Watched identity is the episode URL, matching
// the playback playlist rules.
import { titleKey } from './collections.js';
import { buildPlaybackPlaylist } from './playback.js';
import { episodeNumberKey } from './episode-tools.js';
import { genreList } from './content.js';

export const PROGRESS_KEY = 'moku.progress.v1';
const MAX_TITLES = 40;
// Keep the stored JSON comfortably below localStorage quotas even when a few
// very long series (1000+ episodes) are being tracked.
const MAX_CHARS = 1200000;

const keyOf = item => (item?.source && item?.url ? titleKey(item) : '');

function keyFromValue(value) {
  if (typeof value === 'string') return value.includes('|') ? value : '';
  return keyOf(value);
}

function itemFromKey(key) {
  const separator = typeof key === 'string' ? key.indexOf('|') : -1;
  return separator > 0 ? { source: key.slice(0, separator), url: key.slice(separator + 1) } : null;
}

// Related keys may be passed as an array/Set of keys or items, or as the
// { titleKey: [relatedKeys] } map built from confirmed source links.
function relatedKeyList(itemOrKey, related = []) {
  const self = keyFromValue(itemOrKey);
  const out = [];
  const add = value => {
    const key = keyFromValue(value);
    if (key && !out.includes(key)) out.push(key);
  };
  add(self);
  if (Array.isArray(related) || related instanceof Set) {
    for (const value of related) add(value);
  } else if (related && typeof related === 'object') {
    const mapped = self ? related[self] : null;
    if (Array.isArray(mapped) || mapped instanceof Set) for (const value of mapped) add(value);
    else if (mapped) add(mapped);
  } else if (related) {
    add(related);
  }
  return out;
}

function keyListFromValues(values) {
  if (Array.isArray(values) || values instanceof Set) {
    return [...new Set([...values].map(keyFromValue).filter(Boolean))];
  }
  const direct = keyFromValue(values);
  if (direct) return [direct];
  if (values && typeof values === 'object') {
    return [...new Set(Object.keys(values).map(keyFromValue).filter(Boolean))];
  }
  return [];
}

// Same summary shape history stores, so covers/pills/NSFW checks behave
// identically for progress items.
function cleanItem(item) {
  if (!item?.source || !item?.url) return null;
  return { source: item.source, url: item.url, title: item.title, image: item.image || item.banner, type: item.type, badge: item.badge, status: item.status, genres: genreList(item), aired: item.aired, year: item.year, rating: item.rating, nsfw: item.nsfw };
}

function cleanEpisode(episode) {
  if (!episode?.url) return null;
  return { number: episode.number ?? '', url: episode.url, title: episode.title || '', ids: episode.ids || '' };
}

function cleanEpisodes(episodes) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(episodes) ? episodes : []) {
    const ep = cleanEpisode(raw);
    if (ep && !seen.has(ep.url)) { seen.add(ep.url); out.push(ep); }
  }
  return out;
}

// Snapshots must stay in story order no matter how a source lists its
// episodes (many list newest first); nextUp() reasons about positions.
// Reuse the player's ordering rules so every writer stores the same order.
function orderedSnapshot(episodes) {
  return cleanEpisodes(buildPlaybackPlaylist(Array.isArray(episodes) ? episodes : [], null).episodes);
}

function cleanUrls(urls) {
  return [...new Set((Array.isArray(urls) ? urls : []).filter(u => typeof u === 'string' && u))];
}

// Sanitize whatever was stored into entries the rest of the app can trust:
// one per title, most recently watched first.
export function normalizeProgress(raw) {
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const item = cleanItem(entry?.item);
    if (!item) continue;
    out.push({
      key: keyOf(item),
      item,
      watched: cleanUrls(entry.watched),
      episodes: cleanEpisodes(entry.episodes),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
    });
  }
  const seen = new Set();
  return out
    .filter(e => !seen.has(e.key) && seen.add(e.key))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TITLES);
}

function trimmed(entries) {
  let out = entries.slice(0, MAX_TITLES);
  while (out.length > 1 && JSON.stringify(out).length > MAX_CHARS) out = out.slice(0, -1);
  return out;
}

// Record that an episode was opened. `episodes` is the chronological
// playlist the player used; it becomes the title's new snapshot.
export function recordWatch(entries, item, episode, episodes, now = Date.now()) {
  const clean = normalizeProgress(entries);
  const summary = cleanItem(item);
  if (!summary || !episode?.url) return clean;
  const key = keyOf(summary);
  const prev = clean.find(e => e.key === key);
  const snapshot = orderedSnapshot(episodes);
  const entry = {
    key,
    item: summary,
    watched: cleanUrls([...(prev?.watched || []), episode.url]),
    episodes: snapshot.length ? snapshot : (prev?.episodes || []),
    updatedAt: now,
  };
  return trimmed([entry, ...clean.filter(e => e.key !== key)]);
}

// Refresh a tracked title's episode list (e.g. its detail page was opened
// after new episodes aired) without changing watch recency. Titles that were
// never played are not added.
export function refreshSnapshot(entries, item, episodes) {
  const clean = normalizeProgress(entries);
  const summary = cleanItem(item);
  const snapshot = orderedSnapshot(episodes);
  if (!summary) return clean;
  if (!snapshot.length) return entries;
  const key = keyOf(summary);
  const existing = clean.find(e => e.key === key);
  if (!existing) return entries;
  // Return the original array when nothing changed so callers keeping it in
  // state do not re-render or rewrite storage for a no-op sync.
  const sameList = existing.episodes.length === snapshot.length && existing.episodes.every((e, i) => e.url === snapshot[i].url);
  if (sameList) return entries;
  return clean.map(e => (e.key === key ? { ...e, item: summary, episodes: snapshot } : e));
}

export function removeProgressTitle(entries, item) {
  return removeProgressTitles(entries, [item]);
}

export function removeProgressTitles(entries, itemsOrKeys) {
  const keys = new Set(keyListFromValues(itemsOrKeys));
  if (!keys.size && itemsOrKeys && !Array.isArray(itemsOrKeys)) {
    const key = keyFromValue(itemsOrKeys);
    if (key) keys.add(key);
  }
  return normalizeProgress(entries).filter(e => !keys.has(e.key));
}

// Mark episodes watched or unwatched by hand, for viewing that happened
// outside the player. `episodes` refreshes the snapshot like recordWatch;
// `urls` are added to or removed from the title's watched set. History is
// not touched here — when unmarking, the caller also drops matching history
// entries so the merged watched set actually loses them.
export function setEpisodesWatched(entries, item, episodes, urls, watched, now = Date.now()) {
  const clean = normalizeProgress(entries);
  const summary = cleanItem(item);
  const targets = cleanUrls(urls);
  if (!summary || !targets.length) return clean;
  const key = keyOf(summary);
  const prev = clean.find(e => e.key === key);
  const set = new Set(prev?.watched || []);
  for (const url of targets) {
    if (watched) set.add(url);
    else set.delete(url);
  }
  const snapshot = orderedSnapshot(episodes);
  const entry = {
    key,
    item: summary,
    watched: [...set],
    episodes: snapshot.length ? snapshot : (prev?.episodes || []),
    updatedAt: now,
  };
  return trimmed([entry, ...clean.filter(e => e.key !== key)]);
}

function targetEpisodeList(targets) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(targets) ? targets : []) {
    const episode = typeof raw === 'string' ? cleanEpisode({ url: raw }) : cleanEpisode(raw);
    if (episode && !seen.has(episode.url)) {
      seen.add(episode.url);
      out.push(episode);
    }
  }
  return out;
}

/**
 * Apply a manual watched/unwatched change to this title and to matching
 * episode numbers in snapshots for user-confirmed linked source versions.
 * Playback itself remains recorded against the source actually played;
 * readers derive its shared episode numbers while the link exists.
 */
export function setLinkedEpisodesWatched(entries, item, episodes, targets, watched, relatedKeys = [], now = Date.now()) {
  const targetList = targetEpisodeList(targets);
  const next = setEpisodesWatched(entries, item, episodes, targetList.map(episode => episode.url), watched, now);
  const self = keyOf(item);
  const keys = relatedKeyList(item, relatedKeys).filter(key => key && key !== self);
  if (!self || !keys.length || !targetList.length) return next;

  const numberByUrl = new Map(cleanEpisodes(episodes)
    .map(episode => [episode.url, episodeNumberKey(episode)])
    .filter(([, number]) => number));
  const numbers = new Set(targetList
    .map(episode => episodeNumberKey(episode) || numberByUrl.get(episode.url) || '')
    .filter(Boolean));
  if (!numbers.size) return next;

  let changed = false;
  const mapped = next.map(entry => {
    if (!keys.includes(entry.key)) return entry;
    const set = new Set(entry.watched);
    let entryChanged = false;
    for (const episode of entry.episodes) {
      if (!numbers.has(episodeNumberKey(episode))) continue;
      if (watched && !set.has(episode.url)) { set.add(episode.url); entryChanged = true; }
      if (!watched && set.has(episode.url)) { set.delete(episode.url); entryChanged = true; }
    }
    if (!entryChanged) return entry;
    changed = true;
    return { ...entry, watched: [...set], updatedAt: now };
  });
  return changed ? trimmed(mapped) : next;
}

function historyUrls(history, key) {
  const urls = [];
  for (const entry of Array.isArray(history) ? history : []) {
    if (entry?.episode?.url && keyOf(entry.item) === key) urls.push(entry.episode.url);
  }
  return urls;
}

// Every episode URL known watched for a title: the progress store merged
// with history, so episodes opened before this feature existed still count.
export function watchedUrlSet(entries, history, item) {
  const key = keyOf(item);
  const entry = normalizeProgress(entries).find(e => e.key === key);
  return new Set([...(entry?.watched || []), ...historyUrls(history, key)]);
}

/**
 * Canonical watched episode numbers for one title or a confirmed linked
 * component. Playback remains stored by source-specific episode URL; this
 * number view is derived from each version's stored snapshot and history.
 */
export function watchedEpisodeNumbers(entries, history, values) {
  const wanted = new Set(keyListFromValues(values));
  const numbers = new Set();
  if (!wanted.size) return numbers;

  for (const entry of normalizeProgress(entries)) {
    if (!wanted.has(entry.key)) continue;
    const watched = new Set(entry.watched);
    for (const episode of entry.episodes) {
      if (!watched.has(episode.url)) continue;
      const number = episodeNumberKey(episode);
      if (number) numbers.add(number);
    }
  }
  for (const entry of Array.isArray(history) ? history : []) {
    if (!wanted.has(keyOf(entry?.item))) continue;
    const number = episodeNumberKey(entry?.episode);
    if (number) numbers.add(number);
  }
  return numbers;
}

/**
 * Effective watched URLs for the episode list currently being displayed:
 * direct URLs for this listing plus URLs whose episode number was watched
 * on a confirmed linked version.
 */
export function watchedUrlSetForEpisodes(entries, history, item, episodes = [], relatedKeys = []) {
  const watched = watchedUrlSet(entries, history, item);
  const keys = relatedKeyList(item, relatedKeys);
  if (keys.length <= 1) return watched;
  const numbers = watchedEpisodeNumbers(entries, history, keys);
  if (!numbers.size) return watched;
  for (const episode of cleanEpisodes(episodes)) {
    if (numbers.has(episodeNumberKey(episode))) watched.add(episode.url);
  }
  return watched;
}

export function titleProgress(entries, history, item, relatedKeys = []) {
  const clean = normalizeProgress(entries);
  const key = keyOf(item);
  const keys = relatedKeyList(item, relatedKeys);
  const entry = clean.find(e => e.key === key);
  const direct = new Set([...(entry?.watched || []), ...historyUrls(history, key)]);
  if (entry?.episodes.length) {
    const watched = watchedUrlSetForEpisodes(clean, history, item, entry.episodes, keys);
    return { watched, watchedCount: entry.episodes.filter(e => watched.has(e.url)).length, total: entry.episodes.length };
  }
  const numbers = watchedEpisodeNumbers(clean, history, keys);
  return { watched: direct, watchedCount: Math.max(direct.size, numbers.size), total: null };
}

// The next unwatched episode after the furthest one watched, or null when
// nothing was watched from this snapshot or the series is finished.
export function nextUp(entry, watched) {
  const episodes = entry?.episodes || [];
  if (!episodes.length) return null;
  let last = -1;
  let watchedCount = 0;
  episodes.forEach((ep, i) => { if (watched.has(ep.url)) { watchedCount++; last = i; } });
  if (!watchedCount) return null;
  for (let i = last + 1; i < episodes.length; i++) {
    if (!watched.has(episodes[i].url)) return { episode: episodes[i], watchedCount, total: episodes.length };
  }
  return null;
}

// Rail-ready list, most recently watched first, finished series excluded.
// Confirmed linked versions produce one rail entry, using the most recent
// version that still has a next episode.
export function continueWatching(entries, history, limit = 12, relatedKeysByKey = {}) {
  let max = limit;
  let related = relatedKeysByKey;
  if (limit && typeof limit === 'object') {
    related = limit;
    max = 12;
  }
  max = Number.isFinite(Number(max)) ? Math.max(0, Math.trunc(Number(max))) : 12;
  if (!max) return [];

  const clean = normalizeProgress(entries);
  const shownComponents = new Set();
  const out = [];
  for (const entry of clean) {
    const keys = relatedKeyList(entry.item, related);
    const component = keys.slice().sort().join('\n');
    if (shownComponents.has(component)) continue;
    const watched = watchedUrlSetForEpisodes(clean, history, entry.item, entry.episodes, keys);
    const up = nextUp(entry, watched);
    if (!up) continue;
    shownComponents.add(component);
    out.push({ item: entry.item, episode: up.episode, episodes: entry.episodes, watchedCount: up.watchedCount, total: up.total, updatedAt: entry.updatedAt });
    if (out.length >= max) break;
  }
  return out;
}

// { titleKey: {watchedCount, total} } for every title with any progress,
// for library card badges. `total` is null when no snapshot is known.
export function progressByTitle(entries, history, relatedKeysByKey = {}) {
  const clean = normalizeProgress(entries);
  const items = new Map(clean.map(e => [e.key, e.item]));
  for (const entry of Array.isArray(history) ? history : []) {
    const key = keyOf(entry?.item);
    if (key && !items.has(key)) items.set(key, entry.item);
  }
  if (relatedKeysByKey && typeof relatedKeysByKey === 'object' && !Array.isArray(relatedKeysByKey)) {
    for (const key of Object.keys(relatedKeysByKey)) {
      if (items.has(key)) continue;
      const keys = relatedKeyList(key, relatedKeysByKey);
      if (!keys.some(relatedKey => items.has(relatedKey))) continue;
      const item = itemFromKey(key);
      if (item) items.set(key, item);
    }
  }
  const out = {};
  for (const [key, item] of items) {
    const p = titleProgress(clean, history, item, relatedKeysByKey);
    if (p.watchedCount > 0) out[key] = { watchedCount: p.watchedCount, total: p.total };
  }
  return out;
}
