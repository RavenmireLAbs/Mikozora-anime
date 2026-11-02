import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EpisodeStore } from '../desktop/src/lib/episode-store.js';

const SOGO = { source: 'sogo', url: 'https://animesogo.to/watch/example', title: 'Example Series', image: '', type: 'TV', badge: '', status: '' };
const XIN = { source: 'xin', url: 'https://animexin.dev/example/', title: 'Donghua Example', image: '', type: '', badge: '', status: '' };

const ep = (n) => ({
  key: `number:${n}`, number: String(n), title: `Episode ${n}`,
  url: `https://animesogo.to/watch/example/ep-${n}`, numeric: Number(n),
});

async function makeStore(nowRef = { value: 1_000_000 }) {
  const dir = await mkdtemp(join(tmpdir(), 'mikozora-episodes-'));
  const file = join(dir, 'episode-updates.json');
  let seq = 0;
  const store = new EpisodeStore({ file, now: () => nowRef.value, randomUUID: () => `uuid-${++seq}` });
  await store.ready;
  return { store, file, nowRef };
}

test('sync adds, deduplicates, prunes removed titles and validates input', async () => {
  const { store } = await makeStore();
  const payload = JSON.stringify([SOGO, XIN, SOGO]);
  assert.deepEqual(await store.sync(payload), { added: true, changed: true, watchedCount: 2 });
  assert.deepEqual(await store.sync(payload), { added: false, changed: false, watchedCount: 2 });

  await assert.rejects(
    store.sync(JSON.stringify([{ ...SOGO, url: 'https://animexin.dev/other/' }])),
    /A collection title has an invalid source/,
  );
  await assert.rejects(
    store.sync(JSON.stringify([{ ...SOGO, title: 'x'.repeat(501) }])),
    /Invalid collection title/,
  );

  const removed = await store.sync(JSON.stringify([SOGO]));
  assert.equal(removed.watchedCount, 1);
  assert.equal(store.count(), 1);
});

test('first successful check is a silent baseline; genuinely later episodes alert', async () => {
  const { store, nowRef } = await makeStore();
  await store.sync(JSON.stringify([SOGO]));
  const [title] = store.due(nowRef.value + 1);
  assert.equal(await store.success(title, [ep(1), ep(2), ep(4), ep(5)], nowRef.value), 0);
  let state = store.state();
  assert.equal(state.initializedCount, 1);
  assert.equal(state.unreadCount, 0);

  // Episode 3 appears late but is older than the known maximum: no alert.
  assert.equal(await store.success(title, [ep(1), ep(2), ep(3), ep(4), ep(5)], nowRef.value + 10), 0);
  // Episode 6 is later than the maximum: one event.
  assert.equal(await store.success(title, [ep(1), ep(6)], nowRef.value + 20), 1);
  state = store.state();
  assert.equal(state.unreadCount, 1);
  const [event] = state.updates;
  assert.match(event.id, /^[a-f0-9]{64}$/);
  assert.equal(event.episode.number, '6');
  assert.equal(event.item.title, 'Example Series');
  assert.equal(event.read, false);

  // A new unnumbered (URL-key) episode also alerts exactly once.
  const special = { key: 'url:https://animesogo.to/watch/example/ep-special', number: '', title: 'Special', url: 'https://animesogo.to/watch/example/ep-special', numeric: 0 };
  assert.equal(await store.success(title, [ep(6), special], nowRef.value + 30), 1);
  assert.equal(await store.success(title, [ep(6), special], nowRef.value + 40), 0);
  assert.equal(store.state().unreadCount, 2);

  await store.markRead('all', true);
  assert.equal(store.state().unreadCount, 0);
});

test('removed titles lose their events and restart with a fresh baseline', async () => {
  const { store, nowRef } = await makeStore();
  await store.sync(JSON.stringify([SOGO]));
  const [title] = store.due(nowRef.value + 1);
  await store.success(title, [ep(1)], nowRef.value);
  await store.success(title, [ep(1), ep(2)], nowRef.value + 10);
  assert.equal(store.state().unreadCount, 1);

  await store.sync(JSON.stringify([]));
  assert.equal(store.state().unreadCount, 0);
  assert.equal(store.state().watchedCount, 0);

  await store.sync(JSON.stringify([SOGO]));
  const [fresh] = store.due(nowRef.value + 100);
  assert.equal(await store.success(fresh, [ep(1), ep(2), ep(3)], nowRef.value + 100), 0);
  assert.equal(store.state().unreadCount, 0);
});

test('failures record Android-safe error text and respect title tokens', async () => {
  const { store, nowRef } = await makeStore();
  await store.sync(JSON.stringify([SOGO]));
  const [title] = store.due(nowRef.value + 1);

  await store.failure(title, 'Source returned HTTP 503', nowRef.value);
  assert.equal(store.state().errors[0].message, 'Source returned HTTP 503');
  await store.failure(title, 'socket hang up somewhere secret', nowRef.value);
  assert.equal(store.state().errors[0].message, 'Could not check this source');
  await store.failure(title, 'request timed out', nowRef.value);
  assert.equal(store.state().errors[0].message, 'Source timed out');

  assert.equal(await store.success({ ...title, token: 'stale' }, [ep(1)], nowRef.value), 0);
  assert.equal(store.state().initializedCount, 0);
});

test('due ordering, run flags and persistence survive reload', async () => {
  const { store, file, nowRef } = await makeStore();
  await store.sync(JSON.stringify([SOGO, XIN]));
  const due = store.due(nowRef.value + 1);
  await store.failure(due[0], 'Source timed out', nowRef.value + 50);
  // Never-attempted title comes first, then the one attempted most recently.
  assert.deepEqual(store.due(nowRef.value + 100).map((t) => t.id), [due[1].id, due[0].id]);
  // A cutoff at the failure time excludes the just-attempted title.
  assert.deepEqual(store.due(nowRef.value + 50).map((t) => t.id), [due[1].id]);

  await store.queued(false);
  assert.equal(store.state().queued, true);
  const run = await store.begin();
  assert.equal(store.state().checking, true);
  assert.equal(store.state().queued, false);
  await store.finish(run);
  assert.equal(store.state().checking, false);

  const reloaded = new EpisodeStore({ file, now: () => nowRef.value });
  await reloaded.ready;
  assert.equal(reloaded.state().watchedCount, 2);
  assert.equal(reloaded.state().errors.length, 1);
});
