import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaybackPlaylist, compactPlaybackEpisodes, compactPlaybackPlaylist } from '../src/playback.js';

const episode = (number, extra = {}) => ({
  number: String(number),
  title: `Episode ${number}`,
  url: `https://example.test/watch/show/ep-${number}`,
  ...extra,
});

test('playback playlists use chronological episode order and locate the current episode', () => {
  const sourceList = [episode(3), episode(1), episode('2.5'), episode(2), episode(10)];
  const { episodes, currentIndex } = buildPlaybackPlaylist(sourceList, sourceList[3]);

  assert.deepEqual(episodes.map(ep => ep.number), ['1', '2', '2.5', '3', '10']);
  assert.equal(currentIndex, 1);
  assert.equal(episodes[currentIndex - 1].number, '1');
  assert.equal(episodes[currentIndex + 1].number, '2.5');
});

test('playback playlists de-duplicate URLs, keep specials stable, and include a missing current episode', () => {
  const first = episode(1);
  const special = { number: 'SP1', title: 'Special', url: 'https://example.test/watch/show/sp-1' };
  const resumed = episode(4, { ids: 'resume-token' });
  const { episodes, currentIndex } = buildPlaybackPlaylist([
    episode(2),
    first,
    { ...first, title: 'Duplicate listing' },
    special,
    { number: 'missing', title: 'No URL' },
  ], resumed);

  assert.deepEqual(episodes.map(ep => ep.number), ['1', '2', '4', 'SP1']);
  assert.equal(episodes[currentIndex], resumed);
});

test('episodes sharing a source token but using different URLs remain distinct playable entries', () => {
  const sub = episode(1, { ids: 'shared-token' });
  const dub = episode(1, { ids: 'shared-token', url: 'https://example.test/watch/show/ep-1-dub' });
  const { episodes, currentIndex } = buildPlaybackPlaylist([sub], dub);

  assert.deepEqual(episodes, [sub, dub]);
  assert.equal(episodes[currentIndex], dub);
});

test('oversized Android playlists drop titles first and still retain the current episode as a fallback', () => {
  const episodes = Array.from({ length: 30 }, (_, index) => episode(index + 1, {
    title: `A very descriptive chapter title ${index + 1} `.repeat(4),
    url: `https://example.test/watch/a-rather-long-series-name/episode-${index + 1}`,
  }));

  const withoutTitles = compactPlaybackPlaylist(episodes, 4, 3000);
  assert.equal(withoutTitles.episodes.length, 30);
  assert.equal(withoutTitles.episodeIndex, 4);
  assert.ok(withoutTitles.episodes.every(entry => !('title' in entry)));

  const currentOnly = compactPlaybackPlaylist(episodes, 4, 120);
  assert.deepEqual(currentOnly, {
    episodes: [{ number: '5', url: episodes[4].url }],
    episodeIndex: 0,
  });
});

test('compact Android playlist entries omit source server tokens and redundant titles', () => {
  assert.deepEqual(compactPlaybackEpisodes([
    episode(1, { ids: 'private-token' }),
    episode(2, { title: 'A named chapter', ids: 'private-token-2' }),
  ]), [
    { number: '1', url: 'https://example.test/watch/show/ep-1' },
    { number: '2', url: 'https://example.test/watch/show/ep-2', title: 'A named chapter' },
  ]);
});
