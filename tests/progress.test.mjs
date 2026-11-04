import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgress, recordWatch, refreshSnapshot, removeProgressTitle, removeProgressTitles, setEpisodesWatched, setLinkedEpisodesWatched, watchedEpisodeNumbers, watchedUrlSet, watchedUrlSetForEpisodes, titleProgress, nextUp, continueWatching, progressByTitle } from '../src/progress.js';

const item = (id = 'a') => ({ source: 'sogo', url: `https://example.com/${id}`, title: `Title ${id}`, image: '', type: 'TV', badge: 'SUB', status: 'Ongoing', genres: [], aired: '', year: '2024', rating: null, nsfw: false });
const ep = (t, n) => ({ number: String(n), url: `https://example.com/${t}/ep-${n}`, title: `Episode ${n}`, ids: `${t}-${n}` });
const eps = (t, count) => Array.from({ length: count }, (_, i) => ep(t, i + 1));
const hist = (t, n, time = 1) => ({ item: item(t), episode: { number: String(n), url: ep(t, n).url, title: '' }, time });

test('recordWatch stores a cleaned snapshot and marks the episode watched', () => {
  const noisy = eps('a', 3).map(e => ({ ...e, extra: 'drop me' }));
  const entries = recordWatch([], item('a'), noisy[0], noisy, 100);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, 'sogo|https://example.com/a');
  assert.deepEqual(entries[0].episodes[0], ep('a', 1));
  assert.deepEqual(entries[0].watched, [ep('a', 1).url]);
  assert.equal(entries[0].updatedAt, 100);
  // Re-watching bumps recency and replaces the snapshot with the fresh list.
  const more = recordWatch(entries, item('a'), ep('a', 2), eps('a', 5), 200);
  assert.equal(more[0].episodes.length, 5);
  assert.deepEqual(more[0].watched, [ep('a', 1).url, ep('a', 2).url]);
  assert.equal(more[0].updatedAt, 200);
  // A play without a playlist keeps the previous snapshot.
  const kept = recordWatch(more, item('a'), ep('a', 3), [], 300);
  assert.equal(kept[0].episodes.length, 5);
  // Most recently watched title sorts first; the store is capped at 40.
  let many = [];
  for (let i = 0; i < 45; i++) many = recordWatch(many, item(`t${i}`), ep(`t${i}`, 1), eps(`t${i}`, 2), i);
  assert.equal(many.length, 40);
  assert.equal(many[0].item.title, 'Title t44');
});

test('refreshSnapshot updates only tracked titles and keeps recency', () => {
  let entries = recordWatch([], item('a'), ep('a', 1), eps('a', 2), 100);
  entries = recordWatch(entries, item('b'), ep('b', 1), eps('b', 2), 200);
  const refreshed = refreshSnapshot(entries, item('a'), eps('a', 6));
  assert.equal(refreshed[0].item.title, 'Title b');
  assert.equal(refreshed[1].episodes.length, 6);
  assert.equal(refreshed[1].updatedAt, 100);
  assert.equal(refreshSnapshot(entries, item('c'), eps('c', 3)).length, 2);
  assert.equal(refreshSnapshot(entries, item('a'), []).find(e => e.key.endsWith('/a')).episodes.length, 2);
});

test('watched sets merge progress with pre-existing history', () => {
  const entries = recordWatch([], item('a'), ep('a', 3), eps('a', 6), 100);
  const history = [hist('a', 1), hist('a', 2), hist('b', 1)];
  const set = watchedUrlSet(entries, history, item('a'));
  assert.deepEqual([...set].sort(), [ep('a', 1).url, ep('a', 2).url, ep('a', 3).url].sort());
  const p = titleProgress(entries, history, item('a'));
  assert.equal(p.watchedCount, 3);
  assert.equal(p.total, 6);
  // Without a snapshot the total is unknown but history still counts.
  const legacy = titleProgress([], history, item('b'));
  assert.equal(legacy.watchedCount, 1);
  assert.equal(legacy.total, null);
});

test('nextUp finds the first unwatched episode after the furthest watched', () => {
  const entry = { episodes: eps('a', 5) };
  const urls = (...ns) => new Set(ns.map(n => ep('a', n).url));
  assert.equal(nextUp(entry, urls(1, 2)).episode.number, '3');
  assert.equal(nextUp(entry, urls(1, 2, 4)).episode.number, '5');
  assert.equal(nextUp(entry, urls(1, 2, 4)).watchedCount, 3);
  assert.equal(nextUp(entry, urls(1, 2, 3, 4, 5)), null);
  assert.equal(nextUp(entry, urls(5)), null);
  assert.equal(nextUp(entry, new Set()), null);
  assert.equal(nextUp({ episodes: [] }, urls(1)), null);
  assert.equal(nextUp(null, urls(1)), null);
});

test('continueWatching is recency-ordered, skips finished series and honors the limit', () => {
  let entries = recordWatch([], item('done'), ep('done', 2), eps('done', 2), 300);
  entries = recordWatch(entries, item('a'), ep('a', 1), eps('a', 4), 100);
  entries = recordWatch(entries, item('b'), ep('b', 1), eps('b', 4), 200);
  const rail = continueWatching(entries, [hist('a', 2)]);
  assert.deepEqual(rail.map(r => r.item.title), ['Title b', 'Title a']);
  // History-only watch of episode 2 advances a's next episode to 3.
  assert.equal(rail[1].episode.number, '3');
  assert.equal(rail[1].watchedCount, 2);
  assert.equal(rail[1].total, 4);
  assert.equal(continueWatching(entries, [], 1).length, 1);
});

test('removeProgressTitle and progressByTitle cover the library badges', () => {
  let entries = recordWatch([], item('a'), ep('a', 1), eps('a', 4), 100);
  entries = recordWatch(entries, item('b'), ep('b', 1), eps('b', 2), 200);
  const history = [hist('c', 1), hist('c', 2)];
  const byTitle = progressByTitle(entries, history);
  assert.deepEqual(byTitle['sogo|https://example.com/a'], { watchedCount: 1, total: 4 });
  assert.deepEqual(byTitle['sogo|https://example.com/c'], { watchedCount: 2, total: null });
  const removed = removeProgressTitle(entries, item('a'));
  assert.deepEqual(removed.map(e => e.item.title), ['Title b']);
  // History alone still reports progress for the removed title's badge.
  assert.equal(progressByTitle(removed, [hist('a', 1)])['sogo|https://example.com/a'].watchedCount, 1);
});

test('normalizeProgress tolerates junk and dedupes titles', () => {
  assert.deepEqual(normalizeProgress(null), []);
  assert.deepEqual(normalizeProgress('nope'), []);
  const junk = [
    null,
    { item: { title: 'no identity' } },
    { item: item('a'), watched: ['x', 42, 'x', ''], episodes: [{ url: 'u1' }, { nope: true }, { url: 'u1' }], updatedAt: 'soon' },
    { item: item('a'), watched: [], episodes: [], updatedAt: 5 },
  ];
  const clean = normalizeProgress(junk);
  assert.equal(clean.length, 1);
  assert.deepEqual(clean[0].watched, ['x']);
  assert.equal(clean[0].episodes.length, 1);
  assert.equal(clean[0].updatedAt, 0);
});

test('normalizeProgress repairs banner-only artwork and text genres from older saved copies', () => {
  const old = { ...item('featured'), image: '', banner: 'https://example.com/banner.jpg', genres: 'Fantasy, Romance' };
  const [clean] = normalizeProgress([{ item: old, watched: [], episodes: [], updatedAt: 10 }]);
  assert.equal(clean.item.image, 'https://example.com/banner.jpg');
  assert.deepEqual(clean.item.genres, ['Fantasy', 'Romance']);
});

test('snapshots are stored in story order even when a source lists newest first', () => {
  const entries = recordWatch([], item('a'), ep('a', 4), eps('a', 4).reverse(), 100);
  assert.deepEqual(entries[0].episodes.map(e => e.number), ['1', '2', '3', '4']);
  const refreshed = refreshSnapshot(entries, item('a'), eps('a', 6).reverse());
  assert.deepEqual(refreshed[0].episodes.map(e => e.number), ['1', '2', '3', '4', '5', '6']);
  assert.equal(nextUp(refreshed[0], watchedUrlSet(refreshed, [], item('a'))).episode.number, '5');
});

test('setEpisodesWatched marks and unmarks without playing', () => {
  const all = eps('a', 5);
  let entries = setEpisodesWatched([], item('a'), all, [ep('a', 1).url, ep('a', 2).url], true, 100);
  assert.equal(entries.length, 1);
  assert.deepEqual([...entries[0].watched].sort(), [ep('a', 1).url, ep('a', 2).url].sort());
  assert.equal(continueWatching(entries, [])[0].episode.number, '3');
  entries = setEpisodesWatched(entries, item('a'), all, [ep('a', 2).url], false, 200);
  assert.deepEqual(entries[0].watched, [ep('a', 1).url]);
  assert.equal(entries[0].updatedAt, 200);
  assert.equal(continueWatching(entries, [])[0].episode.number, '2');
  // No targets: no-op beyond normalization.
  assert.deepEqual(setEpisodesWatched(entries, item('a'), all, [], true, 300), entries);
});

const sourceItem = (source, id) => ({ ...item(id), source, url: `https://example.com/${source}/${id}` });
const sourceEp = (source, id, n, number = String(n)) => ({
  number,
  url: `https://example.com/${source}/${id}/ep-${n}`,
  title: `Episode ${n}`,
  ids: `${source}-${id}-${n}`,
});
const sourceEps = (source, id, count) => Array.from({ length: count }, (_, i) => sourceEp(
  source, id, i + 1, source === 'animesalt' ? String(i + 1).padStart(2, '0') : String(i + 1),
));
const sourceHist = (source, id, n, time = 1) => ({
  item: sourceItem(source, id),
  episode: sourceEp(source, id, n),
  time,
});

test('confirmed linked titles share watched numbers without merging source identities', () => {
  const a = sourceItem('sogo', 'show');
  const b = sourceItem('animesalt', 'show');
  const keyA = 'sogo|https://example.com/sogo/show';
  const keyB = 'animesalt|https://example.com/animesalt/show';
  const related = [keyA, keyB];
  const relatedByTitle = { [keyA]: related, [keyB]: [keyB, keyA] };

  let entries = recordWatch([], a, sourceEp('sogo', 'show', 2), sourceEps('sogo', 'show', 4), 100);
  entries = recordWatch(entries, a, sourceEp('sogo', 'show', 1), sourceEps('sogo', 'show', 4), 150);
  entries = recordWatch(entries, b, sourceEp('animesalt', 'show', 2, '02'), sourceEps('animesalt', 'show', 4), 200);

  assert.deepEqual([...watchedEpisodeNumbers(entries, [], related)].sort(), ['1', '2']);
  const effectiveB = watchedUrlSetForEpisodes(entries, [], b, sourceEps('animesalt', 'show', 4), related);
  assert.equal(effectiveB.has(sourceEp('animesalt', 'show', 1, '01').url), true);
  assert.equal(effectiveB.has(sourceEp('animesalt', 'show', 2, '02').url), true);
  assert.equal(effectiveB.has(sourceEp('animesalt', 'show', 3, '03').url), false);
  assert.deepEqual(
    (({ watchedCount, total }) => ({ watchedCount, total }))(titleProgress(entries, [], b, related)),
    { watchedCount: 2, total: 4 },
  );
  assert.deepEqual(progressByTitle(entries, [], relatedByTitle)[keyA], { watchedCount: 2, total: 4 });
  assert.deepEqual(progressByTitle(entries, [], relatedByTitle)[keyB], { watchedCount: 2, total: 4 });

  const rail = continueWatching(entries, [], 12, relatedByTitle);
  assert.equal(rail.length, 1);
  assert.equal(rail[0].item.source, 'animesalt');
  assert.equal(rail[0].episode.number, '03');
  assert.equal(rail[0].watchedCount, 2);

  entries = setLinkedEpisodesWatched(
    entries,
    a,
    sourceEps('sogo', 'show', 4),
    [sourceEp('sogo', 'show', 3)],
    true,
    related,
    300,
  );
  assert.equal(entries.find(entry => entry.key === keyA).watched.includes(sourceEp('sogo', 'show', 3).url), true);
  assert.equal(entries.find(entry => entry.key === keyB).watched.includes(sourceEp('animesalt', 'show', 3, '03').url), true);

  entries = setLinkedEpisodesWatched(
    entries,
    a,
    sourceEps('sogo', 'show', 4),
    [sourceEp('sogo', 'show', 2).url],
    false,
    related,
    400,
  );
  assert.equal(entries.find(entry => entry.key === keyA).watched.includes(sourceEp('sogo', 'show', 2).url), false);
  assert.equal(entries.find(entry => entry.key === keyB).watched.includes(sourceEp('animesalt', 'show', 2, '02').url), false);
  assert.deepEqual(removeProgressTitles(entries, related), []);
});

test('linked readers use history numbers but never promote unnumbered specials', () => {
  const a = sourceItem('sogo', 'legacy');
  const b = sourceItem('animesalt', 'legacy');
  const related = ['sogo|https://example.com/sogo/legacy', 'animesalt|https://example.com/animesalt/legacy'];
  const entries = recordWatch([], a, sourceEp('sogo', 'legacy', 1), sourceEps('sogo', 'legacy', 3), 100);
  const history = [sourceHist('animesalt', 'legacy', 2)];
  const effectiveA = watchedUrlSetForEpisodes(entries, history, a, sourceEps('sogo', 'legacy', 3), related);
  assert.deepEqual([...watchedEpisodeNumbers(entries, history, related)].sort(), ['1', '2']);
  assert.equal(effectiveA.has(sourceEp('sogo', 'legacy', 2).url), true);
  assert.deepEqual(
    (({ watchedCount, total }) => ({ watchedCount, total }))(titleProgress(entries, history, b, related)),
    { watchedCount: 2, total: null },
  );

  const specialA = { number: 'Special', url: 'https://example.com/sogo/legacy/special', title: 'Special', ids: '' };
  const specialB = { number: 'OVA', url: 'https://example.com/animesalt/legacy/special', title: 'OVA', ids: '' };
  const specialEntries = recordWatch([], a, specialA, [specialA], 200);
  const effectiveSpecial = watchedUrlSetForEpisodes(specialEntries, [], b, [specialB], related);
  assert.deepEqual([...watchedEpisodeNumbers(specialEntries, [], related)], []);
  assert.equal(effectiveSpecial.has(specialB.url), false);
});
