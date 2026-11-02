import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EpisodeStore } from '../desktop/src/lib/episode-store.js';
import { EpisodeService, buildNotification, episodeErrorMessage } from '../desktop/src/lib/episode-service.js';

const item = (n) => ({
  source: 'sogo', url: `https://animesogo.to/watch/example-${n}`, title: `Example Series ${n}`,
  image: '', type: 'TV', badge: '', status: '',
});
const ep = (series, n) => ({
  key: `number:${n}`, number: String(n), title: `Episode ${n}`,
  url: `${series}/ep-${n}`, numeric: Number(n),
});

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), 'mikozora-episode-service-'));
  let seq = 0;
  const lists = new Map();
  const notifyCalls = [];
  const stateChanges = [];
  // A ticking clock: attempts are recorded at max(now, cutoff), so a frozen
  // clock would leave every title permanently "just checked".
  let clock = 2_000_000;
  const now = () => (clock += 1000);
  const service = new EpisodeService({
    store: new EpisodeStore({
      file: join(dir, 'episode-updates.json'),
      now,
      randomUUID: () => `uuid-${++seq}`,
    }),
    fetchEpisodes: async (_source, url) => (lists.get(url) || []).map((e) => ({ ...e })),
    notify: (content, options) => notifyCalls.push({ content, alert: !!options?.alert }),
    onStateChanged: (state) => stateChanges.push(state),
    notificationsSupported: () => true,
    now,
    batchDelayMs: 0,
    intervalMs: 60 * 60 * 1000,
  });
  await service.start();
  return { service, lists, notifyCalls, stateChanges };
}

const setList = (lists, n, numbers) => {
  lists.set(item(n).url, numbers.map((x) => ep(item(n).url, x)));
};

test('episode service: baseline, alerts, read state, toggles and removal', async () => {
  const { service, lists, notifyCalls } = await makeService();

  await assert.rejects(service.checkNow(), /Add a title to Favourites or a collection first\./);

  setList(lists, 1, [1, 2, 3]);
  await service.syncTitles(JSON.stringify([item(1)]), true);
  await service.idle();
  let state = service.state();
  assert.equal(state.watchedCount, 1);
  assert.equal(state.initializedCount, 1);
  assert.equal(state.unreadCount, 0);
  assert.equal(state.notificationStatus, 'allowed');
  assert.ok(notifyCalls.every((c) => c.content === null), 'baseline must not alert');

  setList(lists, 1, [1, 2, 3, 4]);
  await service.checkNow();
  await service.idle();
  state = service.state();
  assert.equal(state.unreadCount, 1);
  const firstAlert = notifyCalls.find((c) => c.content);
  assert.equal(firstAlert.alert, true);
  assert.equal(firstAlert.content.title, 'A new episode is here');
  assert.match(firstAlert.content.body, /Example Series 1 · Episode 4/);

  await service.markRead('all');
  assert.equal(service.state().unreadCount, 0);
  assert.equal(notifyCalls.at(-1).content, null, 'marking read cancels the notification');

  setList(lists, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
  await service.checkNow();
  await service.idle();
  const batch = notifyCalls.filter((c) => c.content).at(-1);
  assert.equal(batch.content.title, '4 new episodes');
  assert.deepEqual(batch.content.lines.length, 4);
  assert.match(batch.content.lines.at(-1), /^\+1 more$/);

  await service.setAlerts(false);
  setList(lists, 1, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await service.checkNow();
  await service.idle();
  assert.equal(service.state().unreadCount, 5);
  assert.equal(notifyCalls.at(-1).content, null, 'alerts off keeps notifications silent');

  await service.setAutomatic(false);
  setList(lists, 1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await service.checkNow();
  await service.idle();
  assert.equal(service.state().unreadCount, 6, 'manual checks still work with automatic off');

  await service.syncTitles(JSON.stringify([]), false);
  state = service.state();
  assert.equal(state.watchedCount, 0);
  assert.equal(state.unreadCount, 0);

  await service.shutdown();
});

test('batched passes initialize more than one batch of titles', async () => {
  const { service, lists } = await makeService();
  const items = [1, 2, 3, 4, 5].map(item);
  for (const it of items) lists.set(it.url, [ep(it.url, 1)]);
  await service.syncTitles(JSON.stringify(items), true);
  await service.idle();
  assert.equal(service.state().initializedCount, 5);
  await service.shutdown();
});

test('notification content and bridge error mapping mirror Android', () => {
  assert.equal(buildNotification({ unreadCount: 0, alerts: true, updates: [] }), null);
  assert.equal(buildNotification({ unreadCount: 2, alerts: false, updates: [] }), null);
  const content = buildNotification({
    unreadCount: 1,
    alerts: true,
    updates: [{ read: false, item: { title: 'Show' }, episode: { number: '', title: 'Special' } }],
  });
  assert.equal(content.title, 'A new episode is here');
  assert.equal(content.body, 'Show · Special');

  assert.equal(episodeErrorMessage(new Error('Add a title to Favourites or a collection first.')), 'Add a title to Favourites or a collection first.');
  assert.equal(episodeErrorMessage(new Error('boom')), 'Could not read or schedule episode updates. Please try again.');
});
