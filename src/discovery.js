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

function hasCandidateValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return value !== undefined && value !== null && value !== false && value !== 0;
}

// The same source listing can arrive from several Home feeds with different
// pieces of metadata (for example, a catalog poster/type and a featured
// slide's genres/banner). Merge duplicates instead of letting whichever feed
// happened to be first discard the rest.
function mergeCandidate(existing, incoming) {
  const merged = { ...existing };
  for (const [field, value] of Object.entries(incoming || {})) {
    if (!hasCandidateValue(merged[field]) && hasCandidateValue(value)) merged[field] = value;
  }
  const genres = [];
  const genreKeys = new Set();
  for (const genre of [...genreList(existing), ...genreList(incoming)]) {
    const slug = canonicalGenreSlug(genre);
    if (!slug || genreKeys.has(slug)) continue;
    genreKeys.add(slug);
    genres.push(genre);
  }
  if (genres.length) merged.genres = genres;
  if (!hasCandidateValue(merged.image) && hasCandidateValue(incoming?.banner)) merged.image = incoming.banner;
  // A featured slide may temporarily use its banner as the cover. Prefer a
  // distinct listing poster when another copy of the same title provides one.
  if (existing?.image && existing.image === existing.banner && incoming?.image && incoming.image !== incoming.banner) merged.image = incoming.image;
  const genericTypes = new Set(['anime', 'donghua']);
  const existingType = String(existing?.type || '').trim().toLowerCase();
  const incomingType = String(incoming?.type || '').trim().toLowerCase();
  if (genericTypes.has(existingType) && hasCandidateValue(incoming?.type) && !genericTypes.has(incomingType)) merged.type = incoming.type;
  if (existing?.nsfw || incoming?.nsfw) merged.nsfw = true;
  const ranks = [existing?.rank, incoming?.rank].map(Number).filter(rank => Number.isFinite(rank) && rank > 0);
  if (ranks.length) merged.rank = Math.min(...ranks);
  return merged;
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
    if (key) itemsByKey.set(key, itemsByKey.has(key) ? mergeCandidate(itemsByKey.get(key), item) : item);
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
  const byKey = new Map();
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const key = keyOf(item);
    if (!key) continue;
    byKey.set(key, byKey.has(key) ? mergeCandidate(byKey.get(key), item) : item);
  }
  const pool = [...byKey.entries()]
    .filter(([key]) => !(excludeLibrary && profile.libraryKeys.has(key)) && !(excludeWatched && profile.watchedKeys.has(key)))
    .map(([, item]) => item);
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

const DONGHUA_SOURCES = new Set(['xin', 'narul', 'stream', 'world']);

function genreSlugs(item) {
  return new Set(genreList(item).map(genre => canonicalGenreSlug(genre)).filter(Boolean));
}

function profileFromContext(context = {}) {
  return context.genres instanceof Map ? context : buildTasteProfile(context);
}

function candidatePool(candidates, profile, { excludeKeys = new Set(), excludeLibrary = true, excludeWatched = true } = {}) {
  const byKey = new Map();
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const key = keyOf(item);
    if (!key || excludeKeys.has(key)) continue;
    byKey.set(key, byKey.has(key) ? mergeCandidate(byKey.get(key), item) : item);
  }
  return [...byKey.entries()]
    .filter(([key]) => !(excludeLibrary && profile.libraryKeys?.has(key)) && !(excludeWatched && profile.watchedKeys?.has(key)))
    .map(([, item]) => item);
}

export function similarTitles(seed, candidates, context = {}, {
  limit = 10,
  excludeLibrary = true,
  excludeWatched = true,
} = {}) {
  if (!validItem(seed)) return [];
  const profile = profileFromContext(context);
  const seedKey = keyOf(seed);
  const seedGenres = genreSlugs(seed);
  const seedYear = yearOf(seed) || 0;
  const seedCategory = DONGHUA_SOURCES.has(seed.source) ? 'donghua' : 'anime';
  return candidatePool(candidates, profile, { excludeKeys: new Set([seedKey]), excludeLibrary, excludeWatched })
    .map((item, index) => {
      const genres = genreSlugs(item);
      const shared = [...genres].filter(slug => seedGenres.has(slug));
      const union = new Set([...seedGenres, ...genres]);
      const jaccard = union.size ? shared.length / union.size : 0;
      let score = jaccard * 12 + shared.length * 1.4 + scoreCandidate(item, profile, index) * 0.35;
      const category = DONGHUA_SOURCES.has(item.source) ? 'donghua' : 'anime';
      if (category === seedCategory) score += 2;
      if (String(item.type || '').trim().toUpperCase() === String(seed.type || '').trim().toUpperCase() && seed.type) score += 1.2;
      if (statusGroup(item.status) === statusGroup(seed.status) && seed.status) score += 0.6;
      const year = yearOf(item) || 0;
      if (seedYear && year) score += Math.max(0, 1.2 - Math.abs(seedYear - year) * 0.12);
      const sharedLabels = shared.slice(0, 2).map(slug => genreList(item).find(genre => canonicalGenreSlug(genre) === slug) || titleLabel(slug));
      return {
        ...item,
        similarityScore: score,
        recommendationReason: sharedLabels.length
          ? `Similar ${sharedLabels.join(' · ')} to ${seed.title}`
          : `A nearby ${category} pick to ${seed.title}`,
      };
    })
    .sort((a, b) => b.similarityScore - a.similarityScore || String(a.title).localeCompare(String(b.title)))
    .slice(0, Math.max(0, Math.min(50, Math.trunc(Number(limit) || 10))));
}

const MOOD_DEFINITIONS = [
  { id: 'cozy', label: 'Cozy and light', description: 'Gentler stories for an easy sitting.', genres: ['slice-of-life', 'comedy', 'romance', 'iyashikei'] },
  { id: 'adrenaline', label: 'Adrenaline', description: 'Action, adventure and forward momentum.', genres: ['action', 'adventure', 'martial-arts', 'sports'] },
  { id: 'wonder', label: 'Wonder worlds', description: 'Fantasy, sci-fi and places beyond the ordinary.', genres: ['fantasy', 'sci-fi', 'science-fiction', 'supernatural', 'magic'] },
  { id: 'intense', label: 'Dark and intense', description: 'Higher stakes, tension and psychological turns.', genres: ['thriller', 'psychological', 'horror', 'mystery', 'suspense'] },
  { id: 'heart', label: 'Heart first', description: 'Drama and character-led stories.', genres: ['drama', 'romance', 'slice-of-life'] },
];

export function moodShelves(candidates, context = {}, { limitPerShelf = 10, excludeLibrary = true, excludeWatched = true } = {}) {
  const profile = profileFromContext(context);
  const pool = candidatePool(candidates, profile, { excludeLibrary, excludeWatched });
  return MOOD_DEFINITIONS.map(definition => {
    const wanted = new Set(definition.genres);
    const items = pool.map((item, index) => {
      const matches = [...genreSlugs(item)].filter(slug => wanted.has(slug));
      if (!matches.length) return null;
      const labels = matches.slice(0, 2).map(slug => genreList(item).find(genre => canonicalGenreSlug(genre) === slug) || titleLabel(slug));
      return {
        ...item,
        moodScore: matches.length * 3 + scoreCandidate(item, profile, index) * 0.3,
        recommendationReason: `${definition.label} · ${labels.join(' · ')}`,
      };
    }).filter(Boolean)
      .sort((a, b) => b.moodScore - a.moodScore || String(a.title).localeCompare(String(b.title)))
      .slice(0, Math.max(0, Math.min(30, Math.trunc(Number(limitPerShelf) || 10))));
    return { ...definition, items };
  }).filter(shelf => shelf.items.length);
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function pickRandomTitle(candidates, { seed = 'mikozora', excludeKeys = [] } = {}) {
  const excluded = new Set((Array.isArray(excludeKeys) ? excludeKeys : []).map(value => typeof value === 'string' ? value : keyOf(value)).filter(Boolean));
  const pool = (Array.isArray(candidates) ? candidates : []).filter(item => {
    const key = keyOf(item);
    return key && !excluded.has(key);
  });
  if (!pool.length) return null;
  return pool.reduce((best, item) => {
    const score = stableHash(`${seed}\n${keyOf(item)}`);
    return !best || score < best.score ? { item, score } : best;
  }, null).item;
}
