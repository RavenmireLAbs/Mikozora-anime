import { titleKey } from './collections.js';
import { canonicalGenreSlug, genreList, isNsfw, statusGroup, yearOf } from './content.js';

// Universal Search compares source listings, but it never changes the
// source-specific identity used by the library, collections or downloads.
// Likely matches may be grouped for display. A real progress link is created
// only when the user confirms that two listings are the same show.
export const SOURCE_MATCHES_KEY = 'moku.sourceMatches.v1';
export const SOURCE_MATCH_VERSION = 1;
export const SOURCE_MATCH_GROUP_THRESHOLD = 88;
export const SOURCE_MATCH_CANDIDATE_THRESHOLD = 45;

const MAX_SOURCE_MATCHES = 500;
const WORD_NUMBERS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
const ROMAN_SEASONS = {
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function cleanText(value, max = 300) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function validSource(value) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,32}$/i.test(value.trim());
}
function httpUrl(value, max = 2000) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > max) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
}
function titleFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Linked title';
    const title = decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim();
    return title ? title.replace(/\b\w/g, char => char.toUpperCase()) : 'Linked title';
  } catch {
    return 'Linked title';
  }
}

/** Return the stable source|URL key for an item or a key string, or ''. */
export function sourceTitleKey(value) {
  if (typeof value === 'string') {
    const separator = value.indexOf('|');
    if (separator <= 0) return '';
    const source = value.slice(0, separator).trim();
    const url = httpUrl(value.slice(separator + 1));
    return validSource(source) && url ? `${source}|${url}` : '';
  }
  if (!plainObject(value) || !validSource(value.source)) return '';
  const url = httpUrl(value.url);
  return url ? titleKey({ source: String(value.source).trim(), url }) : '';
}

function keyParts(key) {
  const cleanKey = sourceTitleKey(key);
  if (!cleanKey) return null;
  const separator = cleanKey.indexOf('|');
  return { source: cleanKey.slice(0, separator), url: cleanKey.slice(separator + 1) };
}

/** The small, safe title summary stored at each end of a confirmed link. */
export function cleanSourceMatchItem(item) {
  if (!plainObject(item)) return null;
  const source = cleanText(item.source, 32);
  const url = httpUrl(item.url);
  const title = cleanText(item.title, 300);
  if (!validSource(source) || !url || !title) return null;
  const image = httpUrl(item.image, 1200) || (String(item.image || '').startsWith('//') ? cleanText(item.image, 1200) : '');
  const genres = genreList(item).map(genre => cleanText(genre, 60)).filter(Boolean).slice(0, 12);
  const year = yearOf(item);
  const episodeCount = Math.max(0, Math.trunc(Number(item.episodeCount ?? item.totalEpisodes) || 0))
    || (Array.isArray(item.episodes) ? item.episodes.length : 0);
  return {
    source,
    url,
    title,
    ...(image ? { image } : {}),
    ...(cleanText(item.type, 80) ? { type: cleanText(item.type, 80) } : {}),
    ...(cleanText(item.badge, 40) ? { badge: cleanText(item.badge, 40) } : {}),
    ...(cleanText(item.status, 100) ? { status: cleanText(item.status, 100) } : {}),
    ...(genres.length ? { genres } : {}),
    ...(cleanText(item.aired || item.released || item.releaseDate, 100)
      ? { aired: cleanText(item.aired || item.released || item.releaseDate, 100) } : {}),
    ...(year ? { year } : {}),
    ...(item.rating != null && cleanText(item.rating, 40) ? { rating: cleanText(item.rating, 40) } : {}),
    ...(episodeCount ? { episodeCount } : {}),
    ...(isNsfw(item) ? { nsfw: true } : {}),
  };
}

function endpointForKey(key, candidate) {
  const clean = cleanSourceMatchItem(candidate);
  if (clean && sourceTitleKey(clean) === key) return clean;
  const parts = keyParts(key);
  return parts ? { ...parts, title: titleFromUrl(parts.url) } : null;
}

export function sourceMatchEdgeId(first, second) {
  const a = sourceTitleKey(first);
  const b = sourceTitleKey(second);
  if (!a || !b || a === b) return '';
  return [a, b].sort().join('\n');
}

function normalizeEdge(entry, suppliedId = '') {
  if (!plainObject(entry)) return null;
  let keys = [];
  let candidates = {};

  if (Array.isArray(entry.keys)) keys = entry.keys.map(sourceTitleKey).filter(Boolean);
  if (!keys.length && entry.a && entry.b) keys = [sourceTitleKey(entry.a), sourceTitleKey(entry.b)].filter(Boolean);
  if (plainObject(entry.items)) {
    candidates = entry.items;
    if (!keys.length) keys = Object.entries(candidates).map(([key, item]) => sourceTitleKey(item) || sourceTitleKey(key)).filter(Boolean);
  } else if (Array.isArray(entry.items)) {
    for (const item of entry.items) {
      const key = sourceTitleKey(item);
      if (key) candidates[key] = item;
    }
    if (!keys.length) keys = Object.keys(candidates);
  }
  if (!keys.length && suppliedId.includes('\n')) keys = suppliedId.split('\n').map(sourceTitleKey).filter(Boolean);
  keys = [...new Set(keys)].sort();
  if (keys.length !== 2) return null;

  const items = {};
  for (const key of keys) {
    const endpoint = endpointForKey(key, candidates[key]);
    if (!endpoint) return null;
    items[key] = endpoint;
  }
  const updatedAt = Number(entry.updatedAt);
  return {
    id: keys.join('\n'),
    edge: {
      keys,
      items,
      ...(Number.isFinite(updatedAt) && updatedAt > 0 ? { updatedAt } : {}),
    },
  };
}

/** Normalize the confirmed-link store and retain the newest 500 links. */
export function normalizeSourceMatches(value) {
  let rawEdges = [];
  if (Array.isArray(value)) rawEdges = value.map(edge => [edge, '']);
  else if (plainObject(value?.edges)) rawEdges = Object.entries(value.edges).map(([id, edge]) => [edge, id]);
  else if (Array.isArray(value?.edges)) rawEdges = value.edges.map(edge => [edge, '']);
  else if (plainObject(value)) rawEdges = Object.entries(value).map(([id, edge]) => [edge, id]);

  const byId = new Map();
  for (const [raw, id] of rawEdges) {
    const normalized = normalizeEdge(raw, id);
    if (!normalized) continue;
    const previous = byId.get(normalized.id);
    if (!previous || (normalized.edge.updatedAt || 0) >= (previous.updatedAt || 0)) {
      byId.set(normalized.id, normalized.edge);
    }
  }
  const kept = [...byId.entries()]
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0) || a[0].localeCompare(b[0]))
    .slice(0, MAX_SOURCE_MATCHES)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { version: SOURCE_MATCH_VERSION, edges: Object.fromEntries(kept) };
}

export function readSourceMatches(storage) {
  try { return normalizeSourceMatches(JSON.parse(storage.getItem(SOURCE_MATCHES_KEY) || 'null')); }
  catch { return normalizeSourceMatches(null); }
}
export function saveSourceMatches(storage, value) {
  try {
    storage.setItem(SOURCE_MATCHES_KEY, JSON.stringify(normalizeSourceMatches(value)));
    return true;
  } catch {
    return false;
  }
}
export function sourceMatchEdgeCount(matches) {
  return Object.keys(normalizeSourceMatches(matches).edges).length;
}

/** Add one user-confirmed same-show link. Existing identities are not merged. */
export function linkSourceTitles(matches, first, second, now = Date.now()) {
  const cleanMatches = normalizeSourceMatches(matches);
  const a = cleanSourceMatchItem(first);
  const b = cleanSourceMatchItem(second);
  const id = sourceMatchEdgeId(a, b);
  if (!a || !b || !id) return cleanMatches;
  const keys = id.split('\n');
  const items = { [sourceTitleKey(a)]: a, [sourceTitleKey(b)]: b };
  return normalizeSourceMatches({
    version: SOURCE_MATCH_VERSION,
    edges: {
      ...cleanMatches.edges,
      [id]: { keys, items, updatedAt: Number(now) || Date.now() },
    },
  });
}

/** Remove every confirmed link touching one title. */
export function unlinkSourceTitle(matches, value) {
  const cleanMatches = normalizeSourceMatches(matches);
  const key = sourceTitleKey(value);
  if (!key) return cleanMatches;
  return normalizeSourceMatches({
    version: SOURCE_MATCH_VERSION,
    edges: Object.fromEntries(Object.entries(cleanMatches.edges)
      .filter(([, edge]) => !edge.keys.includes(key))),
  });
}

function adjacency(matches) {
  const graph = new Map();
  const add = (from, to) => {
    if (!graph.has(from)) graph.set(from, new Set());
    graph.get(from).add(to);
  };
  for (const edge of Object.values(normalizeSourceMatches(matches).edges)) {
    add(edge.keys[0], edge.keys[1]);
    add(edge.keys[1], edge.keys[0]);
  }
  return graph;
}

/** The title itself plus every key in its confirmed-link component. */
export function linkedTitleKeys(matches, value) {
  const key = sourceTitleKey(value);
  if (!key) return [];
  const graph = adjacency(matches);
  const seen = new Set([key]);
  const queue = [key];
  while (queue.length) {
    const current = queue.shift();
    for (const next of graph.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [key, ...[...seen].filter(entry => entry !== key).sort()];
}

export function areSourceTitlesLinked(matches, first, second) {
  const key = sourceTitleKey(second);
  return !!key && linkedTitleKeys(matches, first).includes(key);
}

/** Endpoint summaries for linked versions, refreshed by known items when present. */
export function linkedTitleItems(matches, value, knownItems = []) {
  const cleanMatches = normalizeSourceMatches(matches);
  const keys = linkedTitleKeys(cleanMatches, value);
  const self = keys[0];
  if (!self) return [];
  const byKey = new Map();
  for (const edge of Object.values(cleanMatches.edges)) {
    for (const [key, item] of Object.entries(edge.items)) byKey.set(key, item);
  }
  for (const item of Array.isArray(knownItems) ? knownItems : []) {
    const key = sourceTitleKey(item);
    const clean = cleanSourceMatchItem(item);
    if (key && clean) byKey.set(key, { ...(byKey.get(key) || {}), ...clean });
  }
  return keys.slice(1)
    .map(key => byKey.get(key) || endpointForKey(key))
    .filter(Boolean)
    .sort((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title));
}

/** Map every linked key to its component; extra keys become singletons. */
export function relatedKeysByTitle(matches, extraValues = []) {
  const result = {};
  const graph = adjacency(matches);
  const visited = new Set();
  for (const start of graph.keys()) {
    if (visited.has(start)) continue;
    const component = [];
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const next of graph.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    component.sort();
    for (const key of component) result[key] = [key, ...component.filter(entry => entry !== key)];
  }
  for (const value of Array.isArray(extraValues) ? extraValues : []) {
    const key = sourceTitleKey(value);
    if (key && !result[key]) result[key] = [key];
  }
  return result;
}

export function normalizeTitleForMatch(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function markerValue(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  return WORD_NUMBERS[raw] || 0;
}
function titleProfileFromNormalized(normalized) {
  let season = 0;
  let part = 0;
  let base = ` ${normalized} `;

  base = base.replace(/\bseason\s*(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, (_, raw) => {
    season = markerValue(raw) || season;
    return ' ';
  });
  base = base.replace(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/g, (_, raw) => {
    season = Number(raw) || season;
    return ' ';
  });
  base = base.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/g, (_, raw) => {
    season = markerValue(raw) || season;
    return ' ';
  });
  base = base.replace(/\b(?:part|cour)\s*(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g, (_, raw) => {
    part = markerValue(raw) || part;
    return ' ';
  });
  base = base.replace(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:part|cour)\b/g, (_, raw) => {
    part = Number(raw) || part;
    return ' ';
  });

  const tokens = base.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const compactSeason = last.match(/^s(\d{1,2})$/);
    if (!season && compactSeason) {
      season = Number(compactSeason[1]);
      tokens.pop();
    } else if (!season && ROMAN_SEASONS[last]) {
      season = ROMAN_SEASONS[last];
      tokens.pop();
    } else if (!season && /^\d{1,2}$/.test(last)) {
      const numeric = Number(last);
      if (numeric > 1 && numeric <= 20) {
        season = numeric;
        tokens.pop();
      }
    }
  }
  return { base: tokens.join(' '), season, part };
}

function titleTypeGroup(item, normalized, season) {
  const type = normalizeTitleForMatch(item?.type || '');
  const combined = `${type} ${normalized}`;
  if (/\b(movie|film|gekijouban)\b/.test(combined)) return 'movie';
  if (/\b(ova|oad|special)\b/.test(type) || /\b(ova|special)\b/.test(normalized)) return 'special';
  const episodes = Number(item?.episodeCount ?? item?.totalEpisodes) || (Array.isArray(item?.episodes) ? item.episodes.length : 0);
  if (/\b(tv|ona|series|anime|donghua)\b/.test(type) || episodes > 1 || season > 0) return 'series';
  return '';
}

export function titleMatchProfile(item) {
  const normalized = normalizeTitleForMatch(item?.title || '');
  const marker = titleProfileFromNormalized(normalized);
  return {
    key: sourceTitleKey(item),
    title: cleanText(item?.title, 300),
    normalized,
    base: marker.base,
    season: marker.season,
    part: marker.part,
    type: titleTypeGroup(item, normalized, marker.season),
    year: yearOf(item),
    genres: [...new Set(genreList(item).map(canonicalGenreSlug).filter(Boolean))].sort(),
    status: statusGroup(item?.status),
    adult: isNsfw(item),
    episodeCount: Math.max(0, Math.trunc(Number(item?.episodeCount ?? item?.totalEpisodes) || 0))
      || (Array.isArray(item?.episodes) ? item.episodes.length : 0),
  };
}

function tokenSet(text) {
  return new Set(String(text || '').split(/\s+/).filter(Boolean));
}
function diceSimilarity(first, second) {
  const a = tokenSet(first);
  const b = tokenSet(second);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}
function jaccard(first, second) {
  const a = new Set(first);
  const b = new Set(second);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap++;
  return overlap / (a.size + b.size - overlap);
}
function categoryFor(item, categoryOf) {
  if (typeof categoryOf !== 'function') return '';
  const direct = cleanText(categoryOf(item), 40);
  if (direct) return direct;
  return cleanText(categoryOf(item?.source), 40);
}
function uniqueReasons(reasons) {
  return [...new Set(reasons.filter(Boolean))].slice(0, 5);
}

/**
 * Conservative same-show estimate. A high score may group a result visually,
 * but callers must still require a confirmed link before sharing progress.
 */
export function scoreTitleMatch(first, second, options = {}) {
  const a = titleMatchProfile(first);
  const b = titleMatchProfile(second);
  if (a.key && a.key === b.key) {
    return { score: 100, confidence: 'Confirmed', reasons: ['Same source listing'], hardConflict: false };
  }
  if (!a.normalized || !b.normalized) {
    return { score: 0, confidence: 'Low', reasons: ['A title is missing'], hardConflict: true };
  }

  const reasons = [];
  let hardConflict = false;
  let cap = 100;
  const addCap = (value, reason, hard = false) => {
    cap = Math.min(cap, value);
    hardConflict = hardConflict || hard;
    reasons.push(reason);
  };

  const similarity = diceSimilarity(a.normalized, b.normalized);
  let score = similarity * 55;
  if (similarity >= 0.9) reasons.push('Titles are nearly identical');
  else if (similarity >= 0.65) reasons.push('Titles strongly overlap');
  else if (similarity >= 0.4) reasons.push('Titles partly overlap');

  if (a.normalized === b.normalized) {
    score += 35;
    reasons.push('Same title after punctuation is ignored');
  } else if (a.base && a.base === b.base) {
    const explicitMismatch = (a.season && b.season && a.season !== b.season)
      || (a.part && b.part && a.part !== b.part);
    if (!explicitMismatch) {
      const complete = (a.season === b.season && a.part === b.part);
      score += complete ? 18 : 10;
      reasons.push('Same base title');
    }
  } else if (a.normalized.startsWith(`${b.normalized} `) || b.normalized.startsWith(`${a.normalized} `)) {
    score += 6;
    reasons.push('One title extends the other');
  }

  if (first?.source && first.source === second?.source) addCap(70, 'Listings are from the same source');

  if (a.season && b.season && a.season !== b.season) addCap(42, 'Different season', true);
  if (a.part && b.part && a.part !== b.part) addCap(42, 'Different part', true);
  if ((a.season > 1 && !b.season) || (b.season > 1 && !a.season)) {
    addCap(68, 'Only one listing states its season');
  }
  if ((a.part > 1 && !b.part) || (b.part > 1 && !a.part)) {
    addCap(68, 'Only one listing states its part');
  }

  if (a.year && b.year) {
    const difference = Math.abs(a.year - b.year);
    if (difference === 0) { score += 8; reasons.push('Same release year'); }
    else if (difference === 1) { score += 3; reasons.push('Release years are one year apart'); }
    else addCap(45, 'Release years differ', true);
  }
  if (a.type && b.type) {
    if (a.type === b.type) { score += 5; reasons.push('Same format'); }
    else addCap(48, 'Movie, series or special format differs', true);
  }

  const categoryA = categoryFor(first, options.categoryOf);
  const categoryB = categoryFor(second, options.categoryOf);
  if (categoryA && categoryB && categoryA.toLowerCase() !== categoryB.toLowerCase()) {
    addCap(40, 'Anime and Donghua categories differ', true);
  }

  if (a.genres.length && b.genres.length) {
    const overlap = jaccard(a.genres, b.genres);
    score += overlap * 6;
    if (overlap >= 0.25) reasons.push('Genres overlap');
  }
  if (a.status && a.status === b.status) {
    score += 2;
    reasons.push('Same release status');
  }
  if (a.episodeCount && b.episodeCount) {
    const ratio = Math.min(a.episodeCount, b.episodeCount) / Math.max(a.episodeCount, b.episodeCount);
    if (ratio >= 0.9) { score += 4; reasons.push('Similar episode count'); }
    else if (ratio >= 0.65) score += 2;
    else if (ratio < 0.35) { score -= 6; reasons.push('Episode counts differ greatly'); }
  }
  if (a.adult !== b.adult) addCap(75, 'Adult marking differs');

  score = Math.max(0, Math.min(cap, Math.round(score)));
  return {
    score,
    confidence: score >= SOURCE_MATCH_GROUP_THRESHOLD ? 'High' : score >= 70 ? 'Likely' : score >= SOURCE_MATCH_CANDIDATE_THRESHOLD ? 'Possible' : 'Low',
    reasons: uniqueReasons(reasons),
    hardConflict,
  };
}

/** Search wording variants used only when looking for a title elsewhere. */
export function titleVariantQueries(item, max = 4) {
  const title = cleanText(item?.title, 240);
  if (!title) return [];
  const profile = titleMatchProfile(item);
  const withoutBrackets = cleanText(title.replace(/\[[^\]]*\]|\([^)]*\)/g, ' '), 240);
  const candidates = [title, withoutBrackets];
  if (profile.base) candidates.push(profile.base);
  if (profile.base && profile.season > 0) candidates.push(`${profile.base} season ${profile.season}`);
  if (profile.base && profile.part > 0) candidates.push(`${profile.base} part ${profile.part}`);
  return [...new Map(candidates
    .map(candidate => cleanText(candidate, 240))
    .filter(Boolean)
    .map(candidate => [normalizeTitleForMatch(candidate), candidate])).values()]
    .slice(0, Math.max(1, Math.trunc(Number(max) || 4)));
}

export function universalSearchScore(item, query) {
  const normalizedQuery = normalizeTitleForMatch(query);
  if (!normalizedQuery) return 0;
  const profile = titleMatchProfile(item);
  const title = profile.normalized;
  if (!title) return 0;
  const queryMarker = titleProfileFromNormalized(normalizedQuery);
  let score;
  if (title === normalizedQuery) score = 100;
  else if (title.startsWith(normalizedQuery)) score = 86 + diceSimilarity(title, normalizedQuery) * 8;
  else if (title.includes(normalizedQuery)) score = 76 + diceSimilarity(title, normalizedQuery) * 8;
  else {
    const queryTokens = tokenSet(normalizedQuery);
    const titleTokens = tokenSet(title);
    let present = 0;
    for (const token of queryTokens) if (titleTokens.has(token)) present++;
    const coverage = queryTokens.size ? present / queryTokens.size : 0;
    score = coverage * 58 + diceSimilarity(title, normalizedQuery) * 28;
    if (queryMarker.base && queryMarker.base === profile.base) score += 10;
  }
  if (queryMarker.season && profile.season && queryMarker.season !== profile.season) score -= 35;
  else if (queryMarker.season > 1 && !profile.season) score -= 8;
  if (queryMarker.part && profile.part && queryMarker.part !== profile.part) score -= 35;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function keyCollection(values) {
  const set = new Set();
  const addValue = value => {
    const key = sourceTitleKey(value);
    if (key) set.add(key);
    else if (typeof value === 'string' && value.includes('|')) set.add(value);
  };
  if (values instanceof Set || Array.isArray(values)) for (const value of values) addValue(value);
  else if (plainObject(values)) for (const value of Object.keys(values)) addValue(value);
  return set;
}
function relevanceWithContext(item, query, context = {}) {
  const key = sourceTitleKey(item);
  let score = universalSearchScore(item, query);
  if (keyCollection(context.libraryKeys).has(key)) score += 4;
  if (keyCollection(context.watchedKeys).has(key)) score += 2;
  return score;
}

/** Deduplicate exact listings and order all sources by search relevance. */
export function rankUniversalResults(items, query = '', context = {}) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index, key: sourceTitleKey(item), score: relevanceWithContext(item, query, context) }))
    .filter(entry => {
      if (!entry.item) return false;
      if (!entry.key) return true;
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    })
    .sort((a, b) => b.score - a.score
      || normalizeTitleForMatch(a.item.title).localeCompare(normalizeTitleForMatch(b.item.title))
      || String(a.item.source || '').localeCompare(String(b.item.source || ''))
      || a.index - b.index)
    .map(entry => entry.item);
}

/**
 * Group strongly-matched cross-source listings for display. Confirmed links
 * always group; algorithmic groups remain display-only.
 */
export function groupUniversalResults(items, options = {}) {
  const query = options.query || '';
  const threshold = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore) : SOURCE_MATCH_GROUP_THRESHOLD;
  const preserveOrder = options.preserveOrder === true;
  const seen = new Set();
  const records = (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      item,
      index,
      key: sourceTitleKey(item),
      score: relevanceWithContext(item, query, options),
    }))
    .filter(record => {
      if (!record.item || !record.key || seen.has(record.key)) return false;
      seen.add(record.key);
      return true;
    });

  const parent = records.map((_, index) => index);
  const members = new Map(records.map((_, index) => [index, [index]]));
  const find = index => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const pairScores = new Map();
  const pairScore = (a, b) => {
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!pairScores.has(id)) {
      pairScores.set(id, scoreTitleMatch(records[a].item, records[b].item, options));
    }
    return pairScores.get(id);
  };
  const tryUnion = (a, b, force = false) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return true;
    if (!force) {
      for (const left of members.get(rootA) || []) {
        for (const right of members.get(rootB) || []) {
          if (pairScore(left, right).hardConflict) return false;
        }
      }
    }
    const keep = (members.get(rootA)?.length || 0) >= (members.get(rootB)?.length || 0) ? rootA : rootB;
    const drop = keep === rootA ? rootB : rootA;
    parent[drop] = keep;
    members.set(keep, [...(members.get(keep) || []), ...(members.get(drop) || [])]);
    members.delete(drop);
    return true;
  };

  const componentIds = new Map(records.map(record => [
    record.key,
    linkedTitleKeys(options.links || options.matches, record.key).slice().sort().join('\n'),
  ]));
  const profiles = records.map(record => titleMatchProfile(record.item));

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const forced = componentIds.get(records[i].key) === componentIds.get(records[j].key)
        && componentIds.get(records[i].key).includes('\n');
      if (forced) {
        tryUnion(i, j, true);
        continue;
      }
      if (records[i].item.source === records[j].item.source) continue;
      const a = profiles[i];
      const b = profiles[j];
      const plausible = a.normalized === b.normalized || (a.base && a.base === b.base)
        || diceSimilarity(a.normalized, b.normalized) >= 0.45;
      if (!plausible) continue;
      const match = pairScore(i, j);
      if (match.score >= threshold && !match.hardConflict) tryUnion(i, j);
    }
  }

  const grouped = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(record);
  });

  const groups = [...grouped.values()].map(variants => {
    const sorted = variants.slice().sort((a, b) => preserveOrder
      ? a.index - b.index
      : b.score - a.score || a.index - b.index);
    const primary = sorted[0];
    const keys = sorted.map(record => record.key);
    return {
      id: keys.slice().sort().join('\n'),
      item: primary.item,
      items: sorted.map(record => record.item),
      variants: sorted.map(record => record.item),
      keys,
      sources: [...new Set(sorted.map(record => record.item.source).filter(Boolean))],
      score: Math.min(100, primary.score + Math.min(6, Math.max(0, sorted.length - 1) * 2)),
      primaryIndex: preserveOrder ? Math.min(...sorted.map(record => record.index)) : primary.index,
    };
  });
  groups.sort((a, b) => preserveOrder
    ? a.primaryIndex - b.primaryIndex
    : b.score - a.score || a.primaryIndex - b.primaryIndex);
  return groups.map(({ primaryIndex, ...group }) => group);
}
