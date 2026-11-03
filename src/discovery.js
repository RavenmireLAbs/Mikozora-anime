// Local, explainable title picks. Mikozora learns only from what is already
// on this device — saved titles, opened episodes, progress snapshots and the
// user's own ratings/statuses — then ranks the source listings that Home has
// already fetched. Nothing is uploaded and no account is needed.

import { titleKey } from './collections.js';
import { canonicalGenreSlug, genreList, statusGroup, yearOf } from './content.js';
import { libraryMetaFor, normalizeLibraryMeta } from './library-meta.js';

function validItem(item) {
  return !!(item?.source && item?.url && item?.title);
}

function keyOf(item) {
  return validItem(item) ? titleKey(item) : '';
}

function add(map, key, amount) {
  if (!key || !Number.isFinite(amount) || amount === 0) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function titleLabel(value) {
  const text = String(value || '').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

export function buildTasteProfile({ library = [], history = [], progress = [], libraryMeta = {} } = {}) {
  const genres = new Map();
  const genreLabels = new Map();
  const sources = new Map();
  const types = new Map();
  const statuses = new Map();
  const itemsByKey = new Map();
  const libraryKeys = new Set();
  const watchedKeys = new Set();
  const meta = normalizeLibraryMeta(libraryMeta);

  const remember = item => {
    const key = keyOf(item);
    if (key && !itemsByKey.has(key)) itemsByKey.set(key, item);
  };
  for (const item of Array.isArray(library) ? library : []) {
    remember(item);
    const key = keyOf(item);
    if (key) libraryKeys.add(key);
  }
  const historyCounts = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const item = entry?.item;
    remember(item);
    const key = keyOf(item);
    if (!key) continue;
    watchedKeys.add(key);
    historyCounts.set(key, (historyCounts.get(key) || 0) + 1);
  }
  for (const entry of Array.isArray(progress) ? progress : []) {
    remember(entry?.item);
    const key = keyOf(entry?.item) || (typeof entry?.key === 'string' ? entry.key : '');
    if (key && Array.isArray(entry?.watched) && entry.watched.length) watchedKeys.add(key);
  }

  const weights = new Map();
  const weightFor = (key, amount) => {
    if (key) weights.set(key, (weights.get(key) || 0) + amount);
  };
  for (const key of libraryKeys) weightFor(key, 1);
  for (const [key, count] of historyCounts) weightFor(key, 1 + Math.min(4, count) * 0.35);
  for (const entry of Array.isArray(progress) ? progress : []) {
    const key = keyOf(entry?.item) || (typeof entry?.key === 'string' ? entry.key : '');
    const watched = Array.isArray(entry?.watched) ? entry.watched.length : 0;
    if (key && watched) weightFor(key, 1 + Math.min(24, watched) / 8);
  }
  for (const [key, record] of Object.entries(meta)) {
    if (record.rating >= 4) weightFor(key, 2.25);
    else if (record.rating === 3) weightFor(key, 0.75);
    else if (record.rating >= 1) weightFor(key, -1.25);
    if (record.status === 'completed') weightFor(key, 0.75);
    if (record.status === 'dropped') weightFor(key, -2);
  }

  let strength = 0;
  for (const [key, weight] of weights) {
    const item = itemsByKey.get(key);
    if (!validItem(item) || weight === 0) continue;
    strength += Math.abs(weight);
    add(sources, item.source, weight);
    add(types, String(item.type || '').trim().toUpperCase(), weight * 0.8);
    add(statuses, statusGroup(item.status), weight * 0.7);
    for (const genre of genreList(item)) {
      const slug = canonicalGenreSlug(genre);
      if (!slug) continue;
      if (!genreLabels.has(slug)) genreLabels.set(slug, titleLabel(genre));
      add(genres, slug, weight);
    }
  }

  return { genres, genreLabels, sources, types, statuses, libraryKeys, watchedKeys, strength };
}

export function topTasteGenres(profile, limit = 2) {
  if (!profile?.genres) return [];
  return [...profile.genres.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([slug]) => profile.genreLabels.get(slug) || titleLabel(slug));
}

function positiveGenres(item, profile) {
  return genreList(item)
    .map(genre => ({ label: titleLabel(genre), slug: canonicalGenreSlug(genre), weight: profile.genres.get(canonicalGenreSlug(genre)) || 0 }))
    .filter(entry => entry.slug && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

function scoreCandidate(item, profile, index) {
  let score = 0;
  for (const genre of genreList(item)) score += (profile.genres.get(canonicalGenreSlug(genre)) || 0) * 1.35;
  score += (profile.sources.get(item.source) || 0) * 0.22;
  score += (profile.types.get(String(item.type || '').trim().toUpperCase()) || 0) * 0.45;
  score += (profile.statuses.get(statusGroup(item.status)) || 0) * 0.4;
  const year = yearOf(item);
  if (year >= new Date().getFullYear() - 5) score += 0.25;
  // Tiny deterministic ordering among near-ties; earlier source listings win.
  score -= Math.min(index, 200) * 0.001;
  return score;
}

function diversePicks(candidates, limit) {
  const bySource = new Map();
  for (const [item] of candidates) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const out = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const queue of bySource.values()) {
      const next = queue.shift();
      if (!next) continue;
      out.push({ ...next, recommendationReason: 'A fresh pick from your sources' });
      added = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function recommendTitles(candidates, context = {}, { limit = 14, excludeLibrary = true, excludeWatched = true } = {}) {
  const profile = context.genres instanceof Map ? context : buildTasteProfile(context);
  const seen = new Set();
  const pool = [];
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (excludeLibrary && profile.libraryKeys.has(key)) continue;
    if (excludeWatched && profile.watchedKeys.has(key)) continue;
    pool.push(item);
  }
  if (!pool.length) return [];
  if (!profile.strength) return diversePicks(pool.map((item, index) => [item, index]), limit);

  return pool
    .map((item, index) => {
      const matched = positiveGenres(item, profile).slice(0, 2).map(entry => entry.label);
      return {
        ...item,
        recommendationScore: scoreCandidate(item, profile, index),
        recommendationReason: matched.length ? `Because you watch ${matched.join(' · ')}` : 'Picked from your watching patterns',
      };
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit);
}

export function sortBrowseTitles(items, sort) {
  const decorated = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }));
  const byTitle = (a, b) => String(a.item?.title || '').localeCompare(String(b.item?.title || ''), undefined, { sensitivity: 'base' });
  const statusRank = item => ({ ongoing: 0, completed: 1, upcoming: 2 }[statusGroup(item?.status)] ?? 3);
  decorated.sort((a, b) => {
    switch (sort) {
      case 'title-az': return byTitle(a, b) || a.index - b.index;
      case 'title-za': return byTitle(b, a) || a.index - b.index;
      case 'year-desc': return (yearOf(b.item) || -1) - (yearOf(a.item) || -1) || byTitle(a, b) || a.index - b.index;
      case 'year-asc': return (yearOf(a.item) || 10000) - (yearOf(b.item) || 10000) || byTitle(a, b) || a.index - b.index;
      case 'status': return statusRank(a.item) - statusRank(b.item) || byTitle(a, b) || a.index - b.index;
      case 'source-title': return String(a.item?.source || '').localeCompare(String(b.item?.source || '')) || byTitle(a, b) || a.index - b.index;
      default: return a.index - b.index;
    }
  });
  return decorated.map(entry => entry.item);
}

export function personalRecordFor(meta, item) {
  return libraryMetaFor(meta, item);
}
