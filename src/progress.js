// Per-title watch progress: which episodes were opened plus the episode list
// as last seen, so Home can offer the next episode without refetching every
// series. History (moku.history.v1) stays the recent-activity feed with its
// 100-entry global cap; this store is keyed by title so long series keep
// their full progress. All helpers are pure; main.jsx persists the returned
// array under PROGRESS_KEY. Watched identity is the episode URL, matching
// the playback playlist rules.
import { titleKey } from './collections.js';

export const PROGRESS_KEY = 'moku.progress.v1';
const MAX_TITLES = 40;
// Keep the stored JSON comfortably below localStorage quotas even when a few
// very long series (1000+ episodes) are being tracked.
const MAX_CHARS = 1200000;

const keyOf = item => (item?.source && item?.url ? titleKey(item) : '');

// Same summary shape history stores, so covers/pills/NSFW checks behave
// identically for progress items.
function cleanItem(item) {
  if (!item?.source || !item?.url) return null;
  return { source: item.source, url: item.url, title: item.title, image: item.image, type: item.type, badge: item.badge, status: item.status, genres: item.genres, aired: item.aired, year: item.year, rating: item.rating, nsfw: item.nsfw };
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
  const snapshot = cleanEpisodes(episodes);
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
  const snapshot = cleanEpisodes(episodes);
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
  const key = keyOf(item);
  return normalizeProgress(entries).filter(e => e.key !== key);
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

export function titleProgress(entries, history, item) {
  const key = keyOf(item);
  const entry = normalizeProgress(entries).find(e => e.key === key);
  const watched = new Set([...(entry?.watched || []), ...historyUrls(history, key)]);
  if (entry?.episodes.length) {
    return { watched, watchedCount: entry.episodes.filter(e => watched.has(e.url)).length, total: entry.episodes.length };
  }
  return { watched, watchedCount: watched.size, total: null };
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
export function continueWatching(entries, history, limit = 12) {
  const out = [];
  for (const entry of normalizeProgress(entries)) {
    const watched = new Set([...entry.watched, ...historyUrls(history, entry.key)]);
    const up = nextUp(entry, watched);
    if (up) out.push({ item: entry.item, episode: up.episode, episodes: entry.episodes, watchedCount: up.watchedCount, total: up.total, updatedAt: entry.updatedAt });
    if (out.length >= limit) break;
  }
  return out;
}

// { titleKey: {watchedCount, total} } for every title with any progress,
// for library card badges. `total` is null when no snapshot is known.
export function progressByTitle(entries, history) {
  const clean = normalizeProgress(entries);
  const items = new Map(clean.map(e => [e.key, e.item]));
  for (const entry of Array.isArray(history) ? history : []) {
    const key = keyOf(entry?.item);
    if (key && !items.has(key)) items.set(key, entry.item);
  }
  const out = {};
  for (const [key, item] of items) {
    const p = titleProgress(clean, history, item);
    if (p.watchedCount > 0) out[key] = { watchedCount: p.watchedCount, total: p.total };
  }
  return out;
}
