import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG, SOURCE_CATEGORIES } from '../src/data/catalog.js';
import {
  ANY_YEAR,
  DEFAULT_FILTERS,
  activeFilterCount,
  availableGenres,
  availableSources,
  availableYears,
  countAdultTitles,
  filterTitles,
  normalizeFilters,
  toggleGenre,
} from '../src/lib/filters.js';
import { RATING_IDS, describeRating, getRating, isAdultTitle } from '../src/lib/ratings.js';
import {
  DEFAULT_PREFS,
  STORAGE_KEYS,
  loadPrefs,
  normalizePrefs,
  readJson,
  savePrefs,
  writeJson,
} from '../src/lib/storage.js';

const ALLOW = { allowNsfw: true };
const SAFE = { allowNsfw: false };
const ids = (titles) => titles.map((title) => title.id);

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('catalogue has a PG rating on every anime and donghua', () => {
  assert.ok(CATALOG.length >= 40);
  const seen = new Set();
  for (const title of CATALOG) {
    assert.ok(!seen.has(title.id), `duplicate id ${title.id}`);
    seen.add(title.id);
    assert.ok(RATING_IDS.includes(title.rating), `${title.id} has an unknown rating`);
    assert.equal(typeof title.nsfw, 'boolean', `${title.id} needs an explicit nsfw flag`);
    assert.ok(Number.isInteger(title.year), `${title.id} needs a release year`);
    assert.ok(title.genres.length > 0, `${title.id} needs genres`);
    if (title.nsfw) assert.equal(title.rating, '18+', `${title.id} is NSFW and must be rated 18+`);
  }
});

test('adult titles exist in the demo catalogue on both sources', () => {
  const adult = CATALOG.filter(isAdultTitle);
  assert.ok(adult.length >= 4);
  assert.ok(adult.some((title) => title.type === 'anime'));
  assert.ok(adult.some((title) => title.type === 'donghua'));
});

test('every catalogue source belongs to a known category', () => {
  const known = new Set([...SOURCE_CATEGORIES.anime, ...SOURCE_CATEGORIES.donghua]);
  for (const title of CATALOG) {
    assert.ok(known.has(title.source), `unknown source ${title.source}`);
    const expected = SOURCE_CATEGORIES[title.type].includes(title.source);
    assert.ok(expected, `${title.source} cannot serve ${title.type}`);
  }
});

test('NSFW titles are hidden by default', () => {
  const results = filterTitles(CATALOG, DEFAULT_FILTERS, DEFAULT_PREFS);
  assert.equal(results.length, CATALOG.length - countAdultTitles(CATALOG));
  assert.ok(results.every((title) => !isAdultTitle(title)));
});

test('the global adult switch beats the NSFW filter, even when state is stale', () => {
  const staleFilters = { ...DEFAULT_FILTERS, nsfw: 'show' };
  const results = filterTitles(CATALOG, staleFilters, SAFE);
  assert.ok(results.every((title) => !isAdultTitle(title)));
  assert.equal(normalizeFilters(staleFilters, SAFE).nsfw, 'hide');

  const only = filterTitles(CATALOG, { ...DEFAULT_FILTERS, nsfw: 'only' }, SAFE);
  assert.deepEqual(only, []);
});

test('NSFW filter include / only modes', () => {
  const included = filterTitles(CATALOG, { ...DEFAULT_FILTERS, nsfw: 'show' }, ALLOW);
  assert.equal(included.length, CATALOG.length);

  const adultOnly = filterTitles(CATALOG, { ...DEFAULT_FILTERS, nsfw: 'only' }, ALLOW);
  assert.equal(adultOnly.length, countAdultTitles(CATALOG));
  assert.ok(adultOnly.every(isAdultTitle));
});

test('genre filtering matches any selected genre', () => {
  const results = filterTitles(CATALOG, { ...DEFAULT_FILTERS, genres: ['Sports', 'Music'] }, ALLOW);
  assert.ok(results.length > 0);
  assert.ok(results.every((title) => title.genres.includes('Sports') || title.genres.includes('Music')));
  assert.ok(results.some((title) => title.genres.includes('Sports')));
  assert.ok(results.some((title) => title.genres.includes('Music')));
});

test('genre filtering never leaks an adult title when the switch is off', () => {
  const results = filterTitles(CATALOG, { ...DEFAULT_FILTERS, genres: ['Ecchi'] }, SAFE);
  assert.deepEqual(results, []);
});

test('year range is inclusive and clamped', () => {
  const years = filterTitles(
    CATALOG.filter((title) => !isAdultTitle(title)),
    { ...DEFAULT_FILTERS, yearFrom: '2018', yearTo: '2020' },
    SAFE,
  );
  assert.ok(years.length > 0);
  assert.ok(years.every((title) => title.year >= 2018 && title.year <= 2020));

  const clamped = normalizeFilters({ ...DEFAULT_FILTERS, yearFrom: '2024', yearTo: '2010' }, SAFE);
  assert.equal(clamped.yearFrom, '2010');
  assert.equal(clamped.yearTo, '2010');
});

test('a single year can be selected by matching both bounds', () => {
  const results = filterTitles(CATALOG, { ...DEFAULT_FILTERS, yearFrom: '2024', yearTo: '2024' }, ALLOW);
  assert.ok(results.length > 0);
  assert.ok(results.every((title) => title.year === 2024));
});

test('category, source and status filters compose', () => {
  const donghua = filterTitles(CATALOG, { ...DEFAULT_FILTERS, type: 'donghua' }, ALLOW);
  assert.ok(donghua.length > 0);
  assert.ok(donghua.every((title) => title.type === 'donghua'));

  const source = filterTitles(CATALOG, { ...DEFAULT_FILTERS, source: 'AnimeSogo' }, ALLOW);
  assert.ok(source.length > 0);
  assert.ok(source.every((title) => title.source === 'AnimeSogo'));

  const ongoing = filterTitles(CATALOG, { ...DEFAULT_FILTERS, status: 'Ongoing' }, ALLOW);
  assert.ok(ongoing.length > 0);
  assert.ok(ongoing.every((title) => title.status === 'Ongoing'));

  const combined = filterTitles(
    CATALOG,
    { ...DEFAULT_FILTERS, type: 'donghua', status: 'Ongoing', genres: ['Cultivation'] },
    ALLOW,
  );
  assert.ok(combined.length > 0);
  assert.ok(
    combined.every(
      (title) => title.type === 'donghua' && title.status === 'Ongoing' && title.genres.includes('Cultivation'),
    ),
  );
});

test('search is case-insensitive across titles, alternate titles and genres', () => {
  const byTitle = filterTitles(CATALOG, { ...DEFAULT_FILTERS, query: 'frieren' }, SAFE);
  assert.deepEqual(ids(byTitle), ['frieren']);

  const byAlt = filterTitles(CATALOG, { ...DEFAULT_FILTERS, query: 'KIMETSU' }, SAFE);
  assert.deepEqual(ids(byAlt), ['demon-slayer']);

  const byGenre = filterTitles(CATALOG, { ...DEFAULT_FILTERS, query: 'cultivation' }, SAFE);
  assert.ok(byGenre.length >= 5);
  assert.ok(byGenre.every((title) => title.genres.includes('Cultivation')));

  const nothing = filterTitles(CATALOG, { ...DEFAULT_FILTERS, query: 'zzzz-no-match' }, SAFE);
  assert.deepEqual(nothing, []);
});

test('sorting orders results without mutating the catalogue', () => {
  const snapshot = CATALOG.map((title) => title.id);
  const score = filterTitles(CATALOG, { ...DEFAULT_FILTERS, sort: 'score' }, SAFE);
  for (let index = 1; index < score.length; index += 1) {
    assert.ok(score[index - 1].score >= score[index].score);
  }

  const year = filterTitles(CATALOG, { ...DEFAULT_FILTERS, sort: 'year' }, SAFE);
  for (let index = 1; index < year.length; index += 1) {
    assert.ok(year[index - 1].year >= year[index].year);
  }

  const alphabetical = filterTitles(CATALOG, { ...DEFAULT_FILTERS, sort: 'title' }, SAFE);
  const names = alphabetical.map((title) => title.title);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  const popularity = filterTitles(CATALOG, { ...DEFAULT_FILTERS, sort: 'popularity' }, SAFE);
  for (let index = 1; index < popularity.length; index += 1) {
    assert.ok(popularity[index - 1].popularity >= popularity[index].popularity);
  }

  assert.deepEqual(
    CATALOG.map((title) => title.id),
    snapshot,
    'filtering must not reorder the shared catalogue array',
  );
});

test('normalizeFilters repairs unknown values and caps the search length', () => {
  const repaired = normalizeFilters(
    {
      query: 'x'.repeat(500),
      type: 'movie',
      source: '',
      status: 'Airing',
      genres: ['Action', 'Action', 42, '', 'Drama'],
      yearFrom: 'soon',
      yearTo: ANY_YEAR,
      nsfw: 'everything',
      sort: 'random',
    },
    ALLOW,
  );
  assert.equal(repaired.query.length, 120);
  assert.equal(repaired.type, 'all');
  assert.equal(repaired.source, 'all');
  assert.equal(repaired.status, 'all');
  assert.deepEqual(repaired.genres, ['Action', 'Drama']);
  assert.equal(repaired.yearFrom, ANY_YEAR);
  assert.equal(repaired.nsfw, 'hide');
  assert.equal(repaired.sort, 'popularity');
  assert.deepEqual(normalizeFilters(null, SAFE), normalizeFilters(DEFAULT_FILTERS, SAFE));
});

test('active filter count reflects every user-visible refinement', () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS, SAFE), 0);
  assert.equal(
    activeFilterCount(
      {
        ...DEFAULT_FILTERS,
        query: 'dragon',
        type: 'donghua',
        source: 'AnimeXin',
        status: 'Ongoing',
        genres: ['Action', 'Fantasy'],
        yearFrom: '2018',
        yearTo: '2024',
        nsfw: 'show',
      },
      ALLOW,
    ),
    7,
  );
  // With adult content off, the stored "show" mode is normalized away.
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, nsfw: 'show' }, SAFE), 0);
});

test('facet helpers list unique, sorted values', () => {
  const genres = availableGenres(CATALOG);
  assert.equal(new Set(genres).size, genres.length);
  assert.deepEqual(genres, [...genres].sort((a, b) => a.localeCompare(b)));
  assert.ok(genres.includes('Ecchi'));

  const years = availableYears(CATALOG);
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
  assert.ok(years.includes(2024));

  const sources = availableSources(CATALOG);
  assert.ok(sources.includes('AnimeSogo'));
  assert.ok(sources.includes('DonghuaWorld'));
});

test('toggleGenre adds and removes without duplicates', () => {
  const withSports = toggleGenre(DEFAULT_FILTERS, 'Sports');
  assert.deepEqual(withSports.genres, ['Sports']);
  const without = toggleGenre(withSports, 'Sports');
  assert.deepEqual(without.genres, []);
  assert.deepEqual(DEFAULT_FILTERS.genres, [], 'default filters stay frozen and untouched');
});

test('ratings describe themselves and fall back safely', () => {
  assert.equal(getRating('PG-13').name, 'Teens 13 and up');
  assert.equal(getRating('18+').tone, 'adult');
  assert.equal(getRating('nope').id, 'NR');
  assert.equal(describeRating('R-17'), 'R-17 · Mature 17 and up');
  assert.equal(isAdultTitle({ rating: '18+', nsfw: false }), true);
  assert.equal(isAdultTitle({ rating: 'PG-13', nsfw: true }), true);
  assert.equal(isAdultTitle({ rating: 'PG-13', nsfw: false }), false);
  assert.equal(isAdultTitle(null), false);
});

test('preferences default to adult content off and only accept an explicit true', () => {
  assert.equal(DEFAULT_PREFS.allowNsfw, false);
  assert.equal(normalizePrefs({ allowNsfw: true }).allowNsfw, true);
  assert.equal(normalizePrefs({ allowNsfw: 'yes' }).allowNsfw, false);
  assert.equal(normalizePrefs({}).allowNsfw, false);
  assert.equal(normalizePrefs(null).allowNsfw, false);
});

test('storage round-trips, survives corrupt data and blocked storage', () => {
  const storage = memoryStorage();
  assert.equal(savePrefs({ allowNsfw: true }, storage), true);
  assert.equal(loadPrefs(storage).allowNsfw, true);
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEYS.prefs)).allowNsfw, true);

  storage.setItem(STORAGE_KEYS.prefs, '{not json');
  assert.equal(loadPrefs(storage).allowNsfw, false);

  storage.setItem(STORAGE_KEYS.prefs, '"a string"');
  assert.equal(loadPrefs(storage).allowNsfw, false);

  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  assert.equal(loadPrefs(blocked).allowNsfw, false);
  assert.equal(savePrefs({ allowNsfw: true }, blocked), false);
  assert.deepEqual(readJson('missing.key', { fallback: true }, memoryStorage()), { fallback: true });
  assert.equal(writeJson('x', { a: 1 }, null), false);
});
