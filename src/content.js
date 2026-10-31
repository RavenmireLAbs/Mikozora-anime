// Content classification (age ratings, NSFW), the global hide-NSFW preference and
// Browse filtering. This is deliberately separate from the library, collections,
// downloads and appearance preferences, and never invents metadata: a rating,
// genre or year the source did not provide stays unknown instead of becoming a guess.

// The hide-NSFW preference has its own storage key, like appearance does.
export const CONTENT_KEY = 'moku.content.v1';
export const DEFAULT_CONTENT_PREFS = Object.freeze({ hideNsfw:false });

// Canonical Browse genres. Source listings use their own naming, so matching is
// done on slugs (with a few aliases) while the source's own wording is kept for display.
export const GENRES = [
  'Action','Adventure','Comedy','Cultivation','Drama','Ecchi','Fantasy','Game','Harem',
  'Hentai','Historical','Horror','Martial Arts','Mecha','Music','Mystery','Psychological',
  'Romance','School','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller',
];
// Genres whose presence marks a title as adult (NSFW) content.
const ADULT_GENRES = new Set(['hentai','ecchi','erotica','adult','pornographic','smut']);
const GENRE_ALIASES = {
  'science-fiction':'sci-fi',
  'martial-art':'martial-arts',
  'slice-of-life':'slice-of-life',
  'super-natural':'supernatural',
  'suspense':'thriller',
};
export function genreSlug(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}
export function canonicalGenreSlug(name) {
  const slug = genreSlug(name);
  return GENRE_ALIASES[slug] || slug;
}
/** Resolve a user/source genre name to the canonical Browse genre, or ''. */
export function findGenre(name) {
  const slug = canonicalGenreSlug(name);
  return GENRES.find(genre => canonicalGenreSlug(genre) === slug) || '';
}
/** Genres attached to a catalog/detail item, as display strings. */
export function genreList(item) {
  const raw = item?.genres ?? item?.genre ?? [];
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,·|]/);
  return values.map(value => String(value || '').trim()).filter(Boolean);
}
export function isAdultGenre(name) { return ADULT_GENRES.has(canonicalGenreSlug(name)); }

// Age ratings are normalized to one small PG-style scale, whatever system the
// source used (PG-13, TV-14, R - 17+, TV-MA, Rx ...). Level orders the scale;
// only the top level (18+) counts as NSFW on its own.
const ADULT_RATING = Object.freeze({ label:'18+', age:18, level:4, adult:true });
export function normalizeRating(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\s+/g,' ');
  if (!raw) return null;
  // A bare number is a score (e.g. 7.85 or 8/10), never an age rating.
  if (/^\d+(?:\.\d+)?\s*(?:[/]|out of)?\s*(?:10)?$/i.test(raw) && !/^1[0-9]\+$/.test(raw)) return null;
  const upper = raw.toUpperCase();
  if (/\bRX\b|HENTAI|PORNOGRAPH|XXX|ADULT ONLY|R\+|18\+/.test(upper)) return {...ADULT_RATING};
  if (/NC-17|TV-MA|R\s*[-–]?\s*17|17\+/.test(upper) || upper === 'R') return { label:'R', age:17, level:3, adult:false };
  if (/16\+/.test(upper)) return { label:'16+', age:16, level:3, adult:false };
  if (/PG-13|TV-14|13\+|TEENS?\s*13/.test(upper)) return { label:'PG-13', age:13, level:2, adult:false };
  if (/\bPG\b|TV-PG|TV-Y7|CHILDREN/.test(upper)) return { label:'PG', age:7, level:1, adult:false };
  if (/TV-G|TV-Y|ALL AGES|EVERYONE/.test(upper) || upper === 'G') return { label:'G', age:0, level:0, adult:false };
  return null;
}
// Find an age-rating token inside a larger metadata string. Bare "G"/"R" are
// deliberately not searched for here; they are only trusted as a whole label value.
const RATING_TOKEN = /(PG-13|TV-MA|TV-14|TV-PG|TV-Y7|TV-G|TV-Y|NC-17|R\+|RX|18\+|17\+|16\+|13\+|\bPG\b)/i;
export function findRatingInText(value) {
  const match = String(value || '').match(RATING_TOKEN);
  return match ? normalizeRating(match[1]) : null;
}
/**
 * Whether a title is marked adult/NSFW: an explicit source adult flag, an 18+
 * class rating, or an adult genre (Hentai, Ecchi, Erotica...). Unknown means the
 * source said nothing; that is treated as not marked, never as a safe guarantee.
 */
export function isNsfw(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.nsfw === true || item.isAdult === true || item.adult === true) return true;
  if (normalizeRating(item.rating)?.adult) return true;
  if (genreList(item).some(isAdultGenre)) return true;
  return isAdultGenre(item.type);
}
/** The normalized age rating for badges, or null when the source provided none. */
export function ratingOf(item) {
  const rating = normalizeRating(item?.rating);
  if (rating) return rating;
  return isNsfw(item) ? {...ADULT_RATING} : null;
}
/** First plausible release year (19xx/20xx) in a date string, or 0 when absent. */
export function yearFromText(value) {
  const match = String(value || '').match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  return match ? Number(match[1]) : 0;
}
/** Release year of a title from its year field or its aired/released text. */
export function yearOf(item) {
  const direct = Number(item?.year);
  if (Number.isInteger(direct) && direct >= 1900 && direct <= 2099) return direct;
  return yearFromText(item?.aired || item?.released || item?.releaseDate || '');
}
/** Map a source status wording to the Browse status groups, or '' when unknown. */
export function statusGroup(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (/not yet|upcoming|not_yet/.test(text)) return 'upcoming';
  if (/finished|completed|complete/.test(text)) return 'completed';
  if (/currently airing|releasing|ongoing|airing/.test(text)) return 'ongoing';
  return '';
}
/**
 * Apply Browse filters to titles. Genre, year and status are also sent to the
 * source's own listing routes (see data.js), so a title is only excluded here when
 * it carries metadata that positively does not match — unknown metadata is kept,
 * because the source may already have filtered it. The NSFW rule is different:
 * "safe" hides every title marked adult (and the global preference forces "safe"),
 * while "only" keeps only titles that are marked adult.
 */
export function filterTitles(items, filters = {}) {
  const genre = filters.genre ? canonicalGenreSlug(filters.genre) : '';
  const year = filters.year ? String(filters.year) : '';
  const status = filters.status && filters.status !== 'all' ? filters.status : '';
  const nsfw = filters.hideNsfw ? 'safe' : (filters.nsfw || 'all');
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item) return false;
    const adult = isNsfw(item);
    if (nsfw === 'safe' && adult) return false;
    if (nsfw === 'only' && !adult) return false;
    if (genre) {
      const genres = genreList(item).map(canonicalGenreSlug);
      if (genres.length && !genres.includes(genre)) return false;
    }
    if (year) {
      const released = yearOf(item);
      if (released && String(released) !== year) return false;
    }
    if (status) {
      const group = statusGroup(item.status);
      if (group && group !== status) return false;
    }
    return true;
  });
}

export function normalizeContentPrefs(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  return { hideNsfw: candidate.hideNsfw === true };
}
export function readContentPrefs(storage) {
  try { return normalizeContentPrefs(JSON.parse(storage.getItem(CONTENT_KEY) || 'null')); }
  catch { return {...DEFAULT_CONTENT_PREFS}; }
}
export function saveContentPrefs(storage, value) {
  try { storage.setItem(CONTENT_KEY, JSON.stringify(normalizeContentPrefs(value))); return true; }
  catch { return false; }
}
