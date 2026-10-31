// Pure Browse filtering and sorting logic.
//
// Kept free of React and of the DOM so the same rules can be unit tested and
// reused by the Android WebView build. Two independent layers decide whether an
// adult title can appear:
//   1. the user preference `prefs.allowNsfw` — a global kill switch, and
//   2. the per-session Browse filter `filters.nsfw` — hide / include / only.
// The stricter of the two always wins.

import { isAdultTitle } from './ratings.js';

export const TYPES = Object.freeze([
  { id: 'all', label: 'All titles' },
  { id: 'anime', label: 'Anime' },
  { id: 'donghua', label: 'Donghua' },
]);

export const STATUSES = Object.freeze([
  { id: 'all', label: 'Any status' },
  { id: 'Ongoing', label: 'Ongoing' },
  { id: 'Completed', label: 'Completed' },
  { id: 'Upcoming', label: 'Upcoming' },
]);

export const SORTS = Object.freeze([
  { id: 'popularity', label: 'Most popular' },
  { id: 'score', label: 'Highest rated' },
  { id: 'year', label: 'Newest first' },
  { id: 'title', label: 'Title A–Z' },
]);

export const NSFW_MODES = Object.freeze([
  {
    id: 'hide',
    label: 'Hide 18+',
    description: 'Adult titles are left out of the results.',
  },
  {
    id: 'show',
    label: 'Include',
    description: 'Adult titles appear alongside other titles and carry an 18+ badge.',
  },
  {
    id: 'only',
    label: 'Only 18+',
    description: 'Show only adult titles.',
  },
]);

export const ANY_YEAR = 'any';

export const DEFAULT_FILTERS = Object.freeze({
  query: '',
  type: 'all',
  source: 'all',
  status: 'all',
  genres: Object.freeze([]),
  yearFrom: ANY_YEAR,
  yearTo: ANY_YEAR,
  nsfw: 'hide',
  sort: 'popularity',
});

const TYPE_IDS = new Set(TYPES.map((entry) => entry.id));
const STATUS_IDS = new Set(STATUSES.map((entry) => entry.id));
const SORT_IDS = new Set(SORTS.map((entry) => entry.id));
const NSFW_IDS = new Set(NSFW_MODES.map((entry) => entry.id));

function toYear(value) {
  if (value === ANY_YEAR || value === null || value === undefined || value === '') return null;
  const year = Number(value);
  return Number.isInteger(year) ? year : null;
}

/**
 * Coerce arbitrary (persisted, hand-edited or stale) filter state into a valid
 * shape. `prefs.allowNsfw === false` forces the NSFW mode to "hide" so no
 * stored state can re-enable adult listings.
 */
export function normalizeFilters(raw, prefs = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const allowNsfw = prefs.allowNsfw === true;

  let nsfw = NSFW_IDS.has(input.nsfw) ? input.nsfw : DEFAULT_FILTERS.nsfw;
  if (!allowNsfw) nsfw = 'hide';

  const genres = Array.isArray(input.genres)
    ? [...new Set(input.genres.filter((genre) => typeof genre === 'string' && genre.trim()))]
    : [];

  let yearFrom = toYear(input.yearFrom);
  let yearTo = toYear(input.yearTo);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    // Clamp instead of silently swapping: the upper bound the user just chose
    // stays put and the lower bound follows it.
    yearFrom = yearTo;
  }

  return {
    query: typeof input.query === 'string' ? input.query.slice(0, 120) : '',
    type: TYPE_IDS.has(input.type) ? input.type : DEFAULT_FILTERS.type,
    source: typeof input.source === 'string' && input.source ? input.source : DEFAULT_FILTERS.source,
    status: STATUS_IDS.has(input.status) ? input.status : DEFAULT_FILTERS.status,
    genres,
    yearFrom: yearFrom === null ? ANY_YEAR : String(yearFrom),
    yearTo: yearTo === null ? ANY_YEAR : String(yearTo),
    nsfw,
    sort: SORT_IDS.has(input.sort) ? input.sort : DEFAULT_FILTERS.sort,
  };
}

function matchesQuery(title, query) {
  if (!query) return true;
  const haystack = [
    title.title,
    title.altTitle,
    title.source,
    title.status,
    ...(title.genres || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function sortTitles(titles, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const sorted = [...titles];
  switch (sort) {
    case 'score':
      return sorted.sort((a, b) => (b.score || 0) - (a.score || 0) || byTitle(a, b));
    case 'year':
      return sorted.sort((a, b) => (b.year || 0) - (a.year || 0) || byTitle(a, b));
    case 'title':
      return sorted.sort(byTitle);
    case 'popularity':
    default:
      return sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || byTitle(a, b));
  }
}

/** Apply every Browse filter + sort. Never mutates its inputs. */
export function filterTitles(titles, filters, prefs = {}) {
  const safe = normalizeFilters(filters, prefs);
  const query = safe.query.trim().toLowerCase();
  const from = toYear(safe.yearFrom);
  const to = toYear(safe.yearTo);
  const allowNsfw = prefs.allowNsfw === true;

  // If adult content is off and the caller explicitly asked for adult-only
  // results, return nothing rather than silently showing everything else.
  if (!allowNsfw && filters?.nsfw === 'only') return [];

  const matched = (Array.isArray(titles) ? titles : []).filter((title) => {
    if (!title) return false;
    const adult = isAdultTitle(title);

    // Layer 1: the global adult-content switch always wins.
    if (adult && !allowNsfw) return false;

    // Layer 2: the Browse NSFW filter.
    if (safe.nsfw === 'hide' && adult) return false;
    if (safe.nsfw === 'only' && !adult) return false;

    if (safe.type !== 'all' && title.type !== safe.type) return false;
    if (safe.source !== 'all' && title.source !== safe.source) return false;
    if (safe.status !== 'all' && title.status !== safe.status) return false;
    if (from !== null && Number(title.year) < from) return false;
    if (to !== null && Number(title.year) > to) return false;
    if (safe.genres.length > 0 && !safe.genres.some((genre) => (title.genres || []).includes(genre))) {
      return false;
    }
    if (!matchesQuery(title, query)) return false;
    return true;
  });

  return sortTitles(matched, safe.sort);
}

/** Number of adult titles currently in the catalogue. */
export function countAdultTitles(titles) {
  return (Array.isArray(titles) ? titles : []).filter(isAdultTitle).length;
}

/** Number of filters the user has actively changed, for the mobile badge. */
export function activeFilterCount(raw, prefs = {}) {
  const filters = normalizeFilters(raw, prefs);
  let count = 0;
  if (filters.query.trim()) count += 1;
  if (filters.type !== 'all') count += 1;
  if (filters.source !== 'all') count += 1;
  if (filters.status !== 'all') count += 1;
  if (filters.genres.length > 0) count += 1;
  if (filters.yearFrom !== ANY_YEAR || filters.yearTo !== ANY_YEAR) count += 1;
  if (filters.nsfw !== 'hide') count += 1;
  return count;
}

/** Sorted list of years present in the catalogue, newest first. */
export function availableYears(titles) {
  const years = new Set();
  for (const title of Array.isArray(titles) ? titles : []) {
    const year = Number(title?.year);
    if (Number.isInteger(year) && year > 1900) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

/** Alphabetical list of genres present in the catalogue. */
export function availableGenres(titles) {
  const genres = new Set();
  for (const title of Array.isArray(titles) ? titles : []) {
    for (const genre of title?.genres || []) genres.add(genre);
  }
  return [...genres].sort((a, b) => a.localeCompare(b));
}

/** Sorted list of source names present in the catalogue. */
export function availableSources(titles) {
  const sources = new Set();
  for (const title of Array.isArray(titles) ? titles : []) {
    if (title?.source) sources.add(title.source);
  }
  return [...sources].sort((a, b) => a.localeCompare(b));
}

/** Toggle a genre inside a filter's genre array. */
export function toggleGenre(filters, genre) {
  const current = Array.isArray(filters?.genres) ? filters.genres : [];
  const next = current.includes(genre)
    ? current.filter((entry) => entry !== genre)
    : [...current, genre];
  return { ...filters, genres: next };
}
