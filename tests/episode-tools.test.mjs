import test from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeNumberValue,
  chronologicalEpisodes,
  findEpisodeByNumber,
  firstUnwatchedEpisode,
  episodesThrough,
  episodesInRange,
  wrappedIndex,
} from '../src/episode-tools.js';

const ep = (number, suffix = String(number)) => ({
  number: String(number),
  url: `https://example.test/ep/${suffix}`,
  title: `Episode ${number}`,
});

test('chronologicalEpisodes sorts story order and keeps specials last in source order', () => {
  const rows = [ep(3), ep('Special A', 'special-a'), ep(1), ep(2.5), ep('OVA', 'ova'), ep(2), { number: '4' }];
  assert.deepEqual(
    chronologicalEpisodes(rows).map(x => x.number),
    ['1', '2', '2.5', '3', 'Special A', 'OVA'],
  );
  assert.equal(episodeNumberValue(ep('2.5')), 2.5);
  assert.equal(episodeNumberValue(ep('Special')), Number.POSITIVE_INFINITY);
  assert.deepEqual(chronologicalEpisodes(null), []);
});

test('episode lookup, first unwatched, through and numeric ranges use story order', () => {
  const rows = [ep(5), ep(4), ep(3), ep(2), ep(1), ep('Special', 'special')];
  assert.equal(findEpisodeByNumber(rows, '4')?.number, '4');
  assert.equal(findEpisodeByNumber(rows, '99'), null);
  assert.equal(firstUnwatchedEpisode(rows, new Set([ep(1).url, ep(2).url]))?.number, '3');
  assert.equal(firstUnwatchedEpisode(rows, new Set(rows.map(x => x.url))), null);
  assert.deepEqual(episodesThrough(rows, ep(3).url).map(x => x.number), ['1', '2', '3']);
  assert.deepEqual(episodesThrough(rows, 'missing'), []);
  assert.deepEqual(episodesInRange(rows, 4, 2).map(x => x.number), ['2', '3', '4']);
  assert.deepEqual(episodesInRange(rows, 'x', 4), []);
});

test('wrappedIndex cycles server choices safely', () => {
  assert.equal(wrappedIndex(0, -1, 3), 2);
  assert.equal(wrappedIndex(2, 1, 3), 0);
  assert.equal(wrappedIndex(1, 1, 3), 2);
  assert.equal(wrappedIndex(8, 1, 3), 0);
  assert.equal(wrappedIndex(0, 1, 0), 0);
});
