import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_MATCHES_KEY,
  SOURCE_MATCH_VERSION,
  areSourceTitlesLinked,
  cleanSourceMatchItem,
  groupUniversalResults,
  linkSourceTitles,
  linkedTitleItems,
  linkedTitleKeys,
  normalizeSourceMatches,
  normalizeTitleForMatch,
  rankUniversalResults,
  readSourceMatches,
  relatedKeysByTitle,
  saveSourceMatches,
  scoreTitleMatch,
  sourceMatchEdgeCount,
  sourceMatchEdgeId,
  sourceTitleKey,
  titleMatchProfile,
  titleVariantQueries,
  unlinkSourceTitle,
  universalSearchScore,
} from '../src/source-match.js';

const item = (source, path, title = 'Frieren', extra = {}) => ({
  source,
  url: `https://example.test/${path}`,
  title,
  ...extra,
});

const frierenA = item('sogo', 'frieren', 'Frieren: Beyond Journey’s End', {
  type: 'TV',
  year: 2023,
  genres: ['Adventure', 'Fantasy'],
  status: 'Finished Airing',
  episodeCount: 28,
});
const frierenB = item('animesalt', 'frieren', 'Frieren Beyond Journeys End', {
  type: 'TV',
  year: 2023,
  genres: ['Adventure', 'Fantasy'],
  status: 'Completed',
  episodeCount: 28,
});
const frierenC = item('pahe', 'frieren-alt', 'Sousou no Frieren', {
  type: 'TV',
  year: 2023,
  episodeCount: 28,
});

class Store {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('source title keys and endpoint summaries stay source-specific and bounded', () => {
  assert.equal(sourceTitleKey(frierenA), 'sogo|https://example.test/frieren');
  assert.equal(sourceTitleKey(' sogo | https://example.test/frieren '), 'sogo|https://example.test/frieren');
  assert.equal(sourceTitleKey('bad source|https://example.test/frieren'), '');
  assert.equal(sourceTitleKey({ ...frierenA, url: 'ftp://example.test/frieren' }), '');
  assert.equal(sourceMatchEdgeId(frierenB, frierenA), sourceMatchEdgeId(frierenA, frierenB));
  assert.equal(sourceMatchEdgeId(frierenA, frierenA), '');

  const cleaned = cleanSourceMatchItem({
    ...frierenA,
    title: '  Frieren:  Beyond Journey’s End ',
    image: 'https://img.example.test/frieren.jpg',
    badge: 'SUB',
    aired: '2023',
    rating: '8.9',
    genres: Array.from({ length: 15 }, (_, index) => `Genre ${index}`),
    episodes: [{ url: 'https://example.test/ep-1' }],
    secretToken: 'must-not-leak',
  });
  assert.equal(cleaned.title, 'Frieren: Beyond Journey’s End');
  assert.equal(cleaned.genres.length, 12);
  assert.equal(cleaned.episodeCount, 28);
  assert.equal(cleaned.year, 2023);
  assert.equal(Object.hasOwn(cleaned, 'episodes'), false);
  assert.equal(Object.hasOwn(cleaned, 'secretToken'), false);
  assert.equal(cleanSourceMatchItem({ ...frierenA, title: '' }), null);
  assert.equal(cleanSourceMatchItem({ ...frierenA, url: 'not a URL' }), null);
});

test('confirmed source links form transitive components and unlinking isolates only that title', () => {
  let matches = linkSourceTitles(null, frierenA, frierenB, 100);
  matches = linkSourceTitles(matches, frierenB, frierenC, 200);

  assert.equal(matches.version, SOURCE_MATCH_VERSION);
  assert.equal(sourceMatchEdgeCount(matches), 2);
  assert.equal(areSourceTitlesLinked(matches, frierenA, frierenC), true);
  assert.deepEqual(linkedTitleKeys(matches, frierenA), [
    sourceTitleKey(frierenA),
    sourceTitleKey(frierenB),
    sourceTitleKey(frierenC),
  ]);
  assert.deepEqual(linkedTitleItems(matches, frierenA).map(entry => entry.source), ['animesalt', 'pahe']);

  const related = relatedKeysByTitle(matches, [item('sogo', 'unlinked', 'Unlinked')]);
  assert.deepEqual(related[sourceTitleKey(frierenA)], [
    sourceTitleKey(frierenA),
    sourceTitleKey(frierenB),
    sourceTitleKey(frierenC),
  ]);
  assert.deepEqual(related['sogo|https://example.test/unlinked'], ['sogo|https://example.test/unlinked']);

  const withoutMiddle = unlinkSourceTitle(matches, frierenB);
  assert.equal(sourceMatchEdgeCount(withoutMiddle), 0);
  assert.equal(areSourceTitlesLinked(withoutMiddle, frierenA, frierenC), false);
});

test('stored source matches survive malformed data and keep only the newest 500 links', () => {
  const matches = linkSourceTitles(null, frierenA, frierenB, 100);
  const storage = new Store();
  assert.equal(saveSourceMatches(storage, matches), true);
  assert.deepEqual(readSourceMatches(storage), matches);
  assert.equal(storage.getItem(SOURCE_MATCHES_KEY), JSON.stringify(matches));

  storage.setItem(SOURCE_MATCHES_KEY, '{not-json');
  assert.deepEqual(readSourceMatches(storage), normalizeSourceMatches(null));
  assert.deepEqual(normalizeSourceMatches({ edges: { broken: { keys: ['sogo|not-a-url'] } } }), normalizeSourceMatches(null));

  const many = normalizeSourceMatches(Array.from({ length: 505 }, (_, index) => ({
    a: item('sogo', `a-${index}`, `A ${index}`),
    b: item('animesalt', `b-${index}`, `B ${index}`),
    updatedAt: index + 1,
  })));
  assert.equal(sourceMatchEdgeCount(many), 500);
  const retainedTimes = Object.values(many.edges).map(edge => edge.updatedAt);
  assert.equal(Math.min(...retainedTimes), 6);
  assert.equal(Math.max(...retainedTimes), 505);
});

test('title profiles parse season and part spellings while preserving the base title', () => {
  const cases = [
    ['Demon Lord Season 2 Part 1', 2, 1],
    ['Demon Lord S2', 2, 0],
    ['Demon Lord II', 2, 0],
    ['Demon Lord 2', 2, 0],
    ['Demon Lord 2nd Season', 2, 0],
    ['Demon Lord Second Season', 2, 0],
    ['Demon Lord Part 2', 0, 2],
  ];
  for (const [title, season, part] of cases) {
    const profile = titleMatchProfile(item('sogo', 'demon-lord', title));
    assert.equal(profile.base, 'demon lord', title);
    assert.equal(profile.season, season, title);
    assert.equal(profile.part, part, title);
  }

  assert.equal(normalizeTitleForMatch('  Frieren: Beyond Journey’s End & Magie! '), 'frieren beyond journeys end and magie');
  assert.deepEqual(titleVariantQueries(item('sogo', 'demon-lord', 'Demon Lord Season 2 Part 1')), [
    'Demon Lord Season 2 Part 1',
    'demon lord',
    'demon lord season 2',
    'demon lord part 1',
  ]);
  assert.equal(titleVariantQueries(item('sogo', 'one', 'Simple Title'), 1)[0].toLowerCase(), 'simple title');
});

test('same-show scoring rewards a punctuation-only variant and caps hard conflicts', () => {
  assert.deepEqual(scoreTitleMatch(frierenA, frierenB).score, 100);
  assert.equal(scoreTitleMatch(frierenA, frierenB).confidence, 'High');
  assert.equal(scoreTitleMatch(frierenA, frierenB).hardConflict, false);
  assert.deepEqual(scoreTitleMatch(frierenA, frierenA), {
    score: 100,
    confidence: 'Confirmed',
    reasons: ['Same source listing'],
    hardConflict: false,
  });

  const seasonConflict = scoreTitleMatch(
    item('sogo', 's1', 'Sky Blade Season 1', { type: 'TV' }),
    item('animesalt', 's2', 'Sky Blade Season 2', { type: 'TV' }),
  );
  assert.equal(seasonConflict.score <= 42 && seasonConflict.hardConflict, true);

  const partConflict = scoreTitleMatch(
    item('sogo', 'p1', 'Sky Blade Part 1', { type: 'TV' }),
    item('animesalt', 'p2', 'Sky Blade Part 2', { type: 'TV' }),
  );
  assert.equal(partConflict.score <= 42 && partConflict.hardConflict, true);

  const formatConflict = scoreTitleMatch(
    item('sogo', 'movie', 'Sky Blade', { type: 'Movie' }),
    item('animesalt', 'tv', 'Sky Blade', { type: 'TV' }),
  );
  assert.equal(formatConflict.score <= 48 && formatConflict.hardConflict, true);

  const yearConflict = scoreTitleMatch(
    item('sogo', 'new', 'Sky Blade', { year: 2024 }),
    item('animesalt', 'old', 'Sky Blade', { year: 2019 }),
  );
  assert.equal(yearConflict.score <= 45 && yearConflict.hardConflict, true);

  const categoryConflict = scoreTitleMatch(frierenA, frierenB, {
    categoryOf: candidate => candidate.source === 'sogo' ? 'Anime' : 'Donghua',
  });
  assert.equal(categoryConflict.score <= 40 && categoryConflict.hardConflict, true);

  const oneSidedSeason = scoreTitleMatch(
    item('sogo', 'missing', 'Sky Blade', { type: 'TV' }),
    item('animesalt', 'season-2', 'Sky Blade Season 2', { type: 'TV' }),
  );
  assert.equal(oneSidedSeason.score <= 68 && !oneSidedSeason.hardConflict, true);

  const sameSource = scoreTitleMatch(
    item('sogo', 'one', 'Sky Blade', { type: 'TV' }),
    item('sogo', 'two', 'Sky Blade', { type: 'TV' }),
  );
  assert.equal(sameSource.score <= 70 && !sameSource.hardConflict, true);
});

test('universal ranking deduplicates exact listings and prefers exact, season-correct titles', () => {
  assert.equal(universalSearchScore(frierenA, 'frieren beyond journeys end'), 100);
  assert.equal(
    universalSearchScore(item('sogo', 's2', 'Sky Blade Season 2'), 'sky blade season 2')
      > universalSearchScore(item('sogo', 's1', 'Sky Blade Season 1'), 'sky blade season 2'),
    true,
  );

  const ranked = rankUniversalResults([
    frierenB,
    item('sogo', 'other', 'Journey into Mystery'),
    frierenA,
    frierenB,
  ], 'frieren beyond journeys end');
  assert.equal(ranked.length, 3);
  assert.deepEqual(ranked.map(entry => entry.title).slice(0, 2), [frierenB.title, frierenA.title]);

  const libraryBoost = rankUniversalResults([
    item('sogo', 'beta', 'Frieren Quest'),
    item('animesalt', 'alpha', 'Frieren Quest'),
  ], 'frieren quest', { libraryKeys: [item('animesalt', 'alpha', 'Frieren Quest')] });
  assert.equal(libraryBoost[0].source, 'animesalt');
});

test('display grouping joins strong cross-source matches but leaves conflicts and unlinked history separate', () => {
  const grouped = groupUniversalResults([
    frierenA,
    frierenB,
    item('animesalt', 's1', 'Sky Blade Season 1', { type: 'TV' }),
    item('sogo', 's2', 'Sky Blade Season 2', { type: 'TV' }),
  ], { query: 'frieren' });
  assert.equal(grouped.length, 3);
  assert.deepEqual(grouped[0].sources.sort(), ['animesalt', 'sogo']);
  assert.deepEqual(grouped[0].items.map(entry => entry.title), [frierenA.title, frierenB.title]);

  const categoryGroups = groupUniversalResults([frierenA, frierenB], {
    query: 'frieren',
    categoryOf: candidate => candidate.source === 'sogo' ? 'Anime' : 'Donghua',
  });
  assert.equal(categoryGroups.length, 2);

  let matches = linkSourceTitles(null, frierenA, frierenB, 100);
  matches = linkSourceTitles(matches, frierenB, frierenC, 200);
  const forced = groupUniversalResults([frierenA, frierenB, frierenC], { links: matches });
  assert.equal(forced.length, 1);
  assert.equal(forced[0].items.length, 3);
});
