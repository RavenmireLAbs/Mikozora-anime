import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTasteProfile,
  topTasteGenres,
  recommendTitles,
  sortBrowseTitles,
  personalRecordFor,
  moodShelves,
  similarTitles,
} from '../src/discovery.js';

const item = (id, patch = {}) => ({
  source: 'sogo',
  url: `https://example.test/${id}`,
  title: `Title ${id}`,
  type: 'TV',
  status: 'Ongoing',
  genres: [],
  ...patch,
});
const key = value => `${value.source}|${value.url}`;

test('taste profile learns from library, history, progress and personal ratings', () => {
  const action = item('action', { genres: ['Action', 'Fantasy'] });
  const dropped = item('dropped', { genres: ['Romance'], source: 'xin' });
  const profile = buildTasteProfile({
    library: [action, dropped],
    history: [
      { item: action, episode: { number: '1', url: 'https://example.test/action/1' } },
      { item: action, episode: { number: '2', url: 'https://example.test/action/2' } },
    ],
    progress: [{ key: key(action), item: action, watched: ['https://example.test/action/1'] }],
    libraryMeta: {
      [key(action)]: { rating: 5, note: '', status: 'completed', updatedAt: 10 },
      [key(dropped)]: { rating: 1, note: '', status: 'dropped', updatedAt: 11 },
    },
  });

  assert.ok(profile.strength > 0);
  assert.equal(profile.libraryKeys.has(key(action)), true);
  assert.equal(profile.watchedKeys.has(key(action)), true);
  assert.deepEqual(topTasteGenres(profile, 2), ['Action', 'Fantasy']);
  assert.ok((profile.genres.get('action') || 0) > 0);
  assert.ok((profile.genres.get('romance') || 0) < 0);
});

test('recommendations exclude saved and watched titles and explain matching genres', () => {
  const saved = item('saved', { genres: ['Action'] });
  const watched = item('watched', { genres: ['Action'] });
  const strongMatch = item('strong', { title: 'Strong Match', genres: ['Action', 'Fantasy'], year: new Date().getFullYear() });
  const weakMatch = item('weak', { title: 'Weak Match', genres: ['Comedy'], source: 'xin' });

  const picks = recommendTitles(
    [weakMatch, saved, strongMatch, watched, { ...strongMatch }],
    {
      library: [saved, item('teacher', { genres: ['Action', 'Fantasy'] })],
      history: [
        { item: watched, episode: { number: '1', url: 'https://example.test/watched/1' } },
        { item: item('teacher', { genres: ['Action', 'Fantasy'] }), episode: { number: '1', url: 'https://example.test/teacher/1' } },
      ],
      progress: [],
      libraryMeta: {
        [key(item('teacher'))]: { rating: 5, note: '', status: 'watching', updatedAt: 1 },
      },
    },
    { limit: 10 },
  );

  assert.deepEqual(picks.map(x => x.title), ['Strong Match', 'Weak Match']);
  assert.match(picks[0].recommendationReason, /Action/);
  assert.equal(Number.isFinite(picks[0].recommendationScore), true);
});

test('cold-start recommendations round-robin across sources', () => {
  const picks = recommendTitles([
    item('a', { title: 'A' }),
    item('b', { title: 'B' }),
    item('c', { title: 'C', source: 'xin' }),
    item('d', { title: 'D', source: 'bash' }),
  ], {}, { limit: 4 });

  assert.deepEqual(picks.map(x => x.title), ['A', 'C', 'D', 'B']);
  assert.equal(picks[0].recommendationReason, 'A fresh pick from your sources');
});

test('browse sorting is stable and tolerates missing metadata', () => {
  const older = item('older', { title: 'Zulu', year: 2001, status: 'Finished' });
  const newer = item('newer', { title: 'Alpha', year: 2025, status: 'Currently Airing', source: 'xin' });
  const unknown = item('unknown', { title: 'Middle', year: undefined, status: undefined, source: 'bash' });
  const rows = [older, unknown, newer];

  assert.deepEqual(sortBrowseTitles(rows, 'title-az').map(x => x.title), ['Alpha', 'Middle', 'Zulu']);
  assert.deepEqual(sortBrowseTitles(rows, 'year-desc').map(x => x.title), ['Alpha', 'Zulu', 'Middle']);
  assert.deepEqual(sortBrowseTitles(rows, 'year-asc').map(x => x.title), ['Zulu', 'Alpha', 'Middle']);
  assert.deepEqual(sortBrowseTitles(rows, 'status').map(x => x.title), ['Alpha', 'Zulu', 'Middle']);
  assert.deepEqual(sortBrowseTitles(rows, 'default').map(x => x.title), ['Zulu', 'Middle', 'Alpha']);
  assert.deepEqual(sortBrowseTitles(null, 'title-az'), []);
});

test('personalRecordFor returns a safe empty record when no shelf data exists', () => {
  assert.deepEqual(personalRecordFor({}, item('none')), {
    rating: 0,
    note: '',
    status: '',
    updatedAt: 0,
  });
});

test('discovery merges duplicate feed copies instead of losing shelf metadata', () => {
  const catalogCopy = item('merged', {
    title: 'Merged Show',
    image: 'https://example.test/poster.jpg',
    type: 'TV',
    genres: [],
  });
  const featuredCopy = {
    ...catalogCopy,
    image: 'https://example.test/banner.jpg',
    banner: 'https://example.test/banner.jpg',
    type: 'Anime',
    genres: 'Fantasy, Romance',
  };
  const shelves = moodShelves([catalogCopy, featuredCopy], {}, { limitPerShelf: 5 });
  const wonder = shelves.find(shelf => shelf.id === 'wonder');

  assert.equal(wonder?.items.length, 1);
  assert.equal(wonder.items[0].image, 'https://example.test/poster.jpg');
  assert.equal(wonder.items[0].banner, 'https://example.test/banner.jpg');
  assert.equal(wonder.items[0].type, 'TV');
  assert.deepEqual(wonder.items[0].genres, ['Fantasy', 'Romance']);

  const seed = item('seed', { title: 'Seed Show', genres: ['Fantasy'] });
  const [featuredFirst] = similarTitles(seed, [featuredCopy, catalogCopy], {}, { limit: 1 });
  assert.equal(featuredFirst.image, 'https://example.test/poster.jpg');
  assert.equal(featuredFirst.type, 'TV');
  assert.match(featuredFirst.recommendationReason, /Similar Fantasy/);
});
