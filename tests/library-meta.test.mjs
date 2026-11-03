import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_META_KEY,
  normalizeLibraryMeta,
  readLibraryMeta,
  saveLibraryMeta,
  libraryMetaFor,
  setLibraryMeta,
  removeLibraryMeta,
  pruneLibraryMeta,
  personalStatusLabel,
  libraryProgressState,
  sortLibraryTitles,
  libraryStats,
} from '../src/library-meta.js';

const item = (id, patch = {}) => ({
  source: 'sogo',
  url: `https://example.test/${id}`,
  title: `Title ${id}`,
  year: 2024,
  ...patch,
});
const key = value => `${value.source}|${value.url}`;

class Store {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(name) { return this.values.has(name) ? this.values.get(name) : null; }
  setItem(name, value) { this.values.set(name, String(value)); }
}

test('normalizeLibraryMeta cleans records and drops empty or invalid entries', () => {
  const first = item('a');
  const second = item('b');
  const cleaned = normalizeLibraryMeta({
    [key(first)]: { rating: 8, note: '  keep this spacing  ', status: 'watching', updatedAt: 20 },
    [key(second)]: { rating: 0, note: '   ', status: 'unknown', updatedAt: 30 },
    nope: { rating: 5 },
    'sogo|https://example.test/c': null,
  });

  assert.deepEqual(cleaned, {
    [key(first)]: { rating: 5, note: '  keep this spacing  ', status: 'watching', updatedAt: 20 },
  });
  assert.deepEqual(normalizeLibraryMeta(null), {});
  assert.deepEqual(normalizeLibraryMeta([]), {});
});

test('library metadata reads, writes, patches, clears and prunes by title key', () => {
  const show = item('show');
  const other = item('other');
  let meta = setLibraryMeta({}, show, { rating: 4, status: 'paused', note: 'Return after exams' }, 100);
  assert.deepEqual(libraryMetaFor(meta, show), {
    rating: 4,
    note: 'Return after exams',
    status: 'paused',
    updatedAt: 100,
  });

  meta = setLibraryMeta(meta, key(show), { rating: 5 }, 200);
  assert.equal(libraryMetaFor(meta, show).note, 'Return after exams');
  assert.equal(libraryMetaFor(meta, show).updatedAt, 200);

  const store = new Store();
  assert.equal(saveLibraryMeta(store, meta), true);
  assert.deepEqual(readLibraryMeta(store), meta);
  assert.equal(JSON.parse(store.getItem(LIBRARY_META_KEY))[key(show)].rating, 5);

  meta = setLibraryMeta(meta, other, { status: 'plan' }, 300);
  assert.deepEqual(Object.keys(pruneLibraryMeta(meta, [key(show)])), [key(show)]);
  assert.deepEqual(Object.keys(removeLibraryMeta(meta, [key(other)])), [key(show)]);
  assert.deepEqual(setLibraryMeta(meta, show, { rating: 0, status: '', note: '' }, 400)[key(show)], undefined);
  assert.equal(personalStatusLabel('completed'), 'Completed');
  assert.equal(personalStatusLabel(''), '');
});

test('malformed storage and note limits stay bounded', () => {
  assert.deepEqual(readLibraryMeta(new Store({ [LIBRARY_META_KEY]: '{broken' })), {});

  const show = item('long-note');
  const meta = setLibraryMeta({}, show, { note: 'x'.repeat(700) }, 1);
  assert.equal(libraryMetaFor(meta, show).note.length, 600);

  const many = {};
  for (let index = 0; index < 1005; index++) {
    many[`sogo|https://example.test/${index}`] = { rating: 1, updatedAt: index };
  }
  assert.equal(Object.keys(normalizeLibraryMeta(many)).length, 1000);
});

test('library progress states, sorting and stats use progress plus personal records', () => {
  assert.equal(libraryProgressState(null), 'not-started');
  assert.equal(libraryProgressState({ watchedCount: 2, total: null }), 'in-progress');
  assert.equal(libraryProgressState({ watchedCount: 4, total: 4 }), 'caught-up');

  const alpha = item('alpha', { title: 'Alpha', year: 2020 });
  const beta = item('beta', { title: 'Beta', year: 2025 });
  const gamma = item('gamma', { title: 'Gamma', year: 2023 });
  const progress = {
    [key(alpha)]: { watchedCount: 9, total: 10 },
    [key(beta)]: { watchedCount: 1, total: 12 },
    [key(gamma)]: { watchedCount: 6, total: 6 },
  };
  const meta = {
    [key(alpha)]: { rating: 3, note: '', status: 'watching', updatedAt: 10 },
    [key(beta)]: { rating: 5, note: 'Favourite arc', status: 'watching', updatedAt: 20 },
    [key(gamma)]: { rating: 4, note: '', status: 'completed', updatedAt: 30 },
  };
  const titles = [alpha, beta, gamma];

  assert.deepEqual(sortLibraryTitles(titles, 'title-az', progress, meta).map(x => x.title), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(sortLibraryTitles(titles, 'progress-desc', progress, meta).map(x => x.title), ['Gamma', 'Alpha', 'Beta']);
  assert.deepEqual(sortLibraryTitles(titles, 'unwatched-desc', progress, meta).map(x => x.title), ['Beta', 'Alpha', 'Gamma']);
  assert.deepEqual(sortLibraryTitles(titles, 'rating-desc', progress, meta).map(x => x.title), ['Beta', 'Gamma', 'Alpha']);
  assert.deepEqual(sortLibraryTitles(titles, 'year-desc', progress, meta).map(x => x.title), ['Beta', 'Gamma', 'Alpha']);
  assert.deepEqual(libraryStats(titles, progress, meta), {
    titles: 3,
    inProgress: 2,
    caughtUp: 1,
    watchedEpisodes: 16,
    rated: 3,
    withNotes: 1,
  });
});
