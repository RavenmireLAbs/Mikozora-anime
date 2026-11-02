// Windows port of Android's EpisodeScheduler + EpisodeWorker +
// EpisodeNotifier, hosted by the Electron main process.
//
// Android runs checks from WorkManager; here the main process owns a
// 6-hour interval plus on-open/manual passes, and keeps running them while
// the app is open or resting in the system tray. Notification display and
// window signalling are injected from main.js so this module stays
// Electron-free and testable.
import { EPISODE_INTERVAL_MS } from './episode-store.js';
import { fetchEpisodes as defaultFetchEpisodes } from './episode-fetcher.js';

const BATCH_SIZE = 4;
const SLICE_DEADLINE_MS = 3 * 60_000;

/** Pure port of EpisodeNotifier's summary content. */
export function buildNotification(state) {
  const unread = Number(state?.unreadCount) || 0;
  if (!unread || state?.alerts === false) return null;
  const lines = [];
  for (const event of state.updates || []) {
    if (lines.length >= 3) break;
    if (!event || event.read || !event.item || !event.episode) continue;
    const number = String(event.episode.number || '');
    lines.push(`${event.item.title || 'Your series'} · ${number === '' ? (event.episode.title || 'New episode') : `Episode ${number}`}`);
  }
  if (unread > lines.length) lines.push(`+${unread - lines.length} more`);
  return {
    title: unread === 1 ? 'A new episode is here' : `${unread} new episodes`,
    body: lines.join('\n'),
    lines,
    unread,
  };
}

export class EpisodeService {
  constructor({
    store,
    fetchEpisodes = (source, url) => defaultFetchEpisodes(source, url),
    notify = () => {},
    onStateChanged = () => {},
    openNotificationSettings = () => {},
    notificationsSupported = () => true,
    now = Date.now,
    batchDelayMs = 5000,
    intervalMs = EPISODE_INTERVAL_MS,
    timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  } = {}) {
    if (!store) throw new Error('An episode store is required');
    this.store = store;
    this.fetchEpisodes = fetchEpisodes;
    this.notify = notify;
    this.onStateChanged = onStateChanged;
    this.openNotificationSettings = openNotificationSettings;
    this.notificationsSupported = notificationsSupported;
    this.now = now;
    this.batchDelayMs = batchDelayMs;
    this.intervalMs = intervalMs;
    this.timers = timers;

    this.periodicTimer = null;
    this.running = null; // Promise of the active check pass
    this.rerun = null; // follow-up request queued while a pass runs
    this.stopped = false;
    this.started = false;
  }

  async start() {
    await this.store.ready;
    this.started = true;
    this.ensure();
    return this;
  }

  async shutdown() {
    this.stopped = true;
    if (this.periodicTimer) {
      this.timers.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    await this.store.flush().catch(() => {});
  }

  /** Resolves when no check pass is running (test/shutdown helper). */
  async idle() {
    while (this.running) {
      const current = this.running;
      await current;
      if (this.running === current) break;
    }
  }

  automaticEnabled() {
    return this.store.automatic();
  }

  state() {
    return {
      ...this.store.state(),
      // Windows has no runtime notification permission prompt; access is a
      // system setting, so there is nothing to "ask" inside the app.
      notificationStatus: this.notificationsSupported() ? 'allowed' : 'blocked',
      permissionAsked: true,
    };
  }

  // --- bridge-facing operations (mirror MainActivity's episode methods) ---

  async syncTitles(payload, onOpen) {
    const result = await this.store.sync(payload);
    if (onOpen) this.queueAutomatic(this.now() + 1);
    else if (result.added) this.queueAutomatic(0);
    else this.ensure();
    if (result.changed) {
      this.refreshNotifier(false);
      this.onStateChanged(this.state());
    }
    return this.state();
  }

  async updates() {
    await this.store.ready;
    return this.state();
  }

  async checkNow() {
    await this.store.ready;
    if (this.store.count() === 0) throw new Error('Add a title to Favourites or a collection first.');
    await this.store.queued(true);
    this.startRun({ manual: true, cutoff: this.now() + 1 });
    return this.state();
  }

  async setAutomatic(enabled) {
    await this.store.setAutomatic(!!enabled);
    this.ensure();
    if (enabled) this.queueAutomatic(this.now() + 1);
    this.onStateChanged(this.state());
    return this.state();
  }

  async setAlerts(enabled) {
    await this.store.setAlerts(!!enabled);
    this.refreshNotifier(false);
    this.onStateChanged(this.state());
    return this.state();
  }

  async markRead(updateId) {
    await this.store.ready;
    if (updateId === 'all') await this.store.markRead('all', true);
    else if (/^[a-f0-9]{64}$/.test(String(updateId || ''))) await this.store.markRead(updateId, false);
    this.refreshNotifier(false);
    this.onStateChanged(this.state());
    return this.state();
  }

  notificationPermission(automaticPrompt) {
    if (!automaticPrompt) this.openNotificationSettings();
  }

  // --- scheduling (EpisodeScheduler) ---

  ensure() {
    if (!this.started || this.stopped) return;
    const wanted = this.store.automatic() && this.store.count() > 0;
    if (wanted && !this.periodicTimer) {
      this.periodicTimer = this.timers.setInterval(() => {
        this.startRun({ manual: false, cutoff: 0 });
      }, this.intervalMs);
      this.periodicTimer.unref?.();
    } else if (!wanted && this.periodicTimer) {
      this.timers.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  queueAutomatic(cutoff) {
    this.ensure();
    if (this.stopped || !this.store.automatic() || this.store.count() === 0) return;
    this.store.queued(false).catch(() => {});
    this.startRun({ manual: false, cutoff });
  }

  // --- check pass (EpisodeWorker) ---

  startRun(params) {
    if (this.stopped) return;
    if (this.running) {
      // A collection can change while a pass is running; queue a follow-up
      // rather than dropping the newer request (APPEND_OR_REPLACE).
      this.rerun = params;
      return;
    }
    this.running = (async () => {
      try {
        await this.runPass(params);
      } catch { /* per-title failures are recorded; a pass never throws */ }
      this.running = null;
      if (this.rerun && !this.stopped) {
        const next = this.rerun;
        this.rerun = null;
        this.startRun(next);
      }
    })();
  }

  async runPass({ manual, cutoff }) {
    await this.store.ready;
    let effectiveCutoff = cutoff;
    if (!effectiveCutoff || effectiveCutoff <= 0) effectiveCutoff = this.now() - this.intervalMs;
    if (this.stopped || (!manual && !this.store.automatic())) return;

    let announced = false;
    for (;;) {
      const run = await this.store.begin();
      let moreDue = false;
      try {
        let processed = 0;
        const deadline = this.now() + SLICE_DEADLINE_MS;
        while (!this.stopped && processed < BATCH_SIZE && this.now() < deadline) {
          if (!manual && !this.store.automatic()) break;
          const due = this.store.due(effectiveCutoff);
          if (!due.length) break;
          const title = due[0];
          let episodes;
          try {
            episodes = await this.fetchEpisodes(title.source, title.url);
          } catch (problem) {
            if (!this.stopped) {
              await this.store.failure(title, problem?.message || '', Math.max(this.now(), effectiveCutoff));
            }
            processed++;
            continue;
          }
          if (this.stopped || (!manual && !this.store.automatic())) break;
          const found = await this.store.success(title, episodes, Math.max(this.now(), effectiveCutoff));
          if (found > 0) {
            this.refreshNotifier(!announced);
            announced = true;
          }
          processed++;
        }
        moreDue = !this.stopped && (manual || this.store.automatic())
          && this.store.due(effectiveCutoff).length > 0;
      } finally {
        await this.store.finish(run);
      }
      this.onStateChanged(this.state());
      if (!moreDue) return;
      // Continue the next batch shortly, like WorkManager's chained runs.
      await this.store.queued(manual);
      await this.delay(this.batchDelayMs);
      if (this.stopped) return;
    }
  }

  delay(ms) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = this.timers.setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  // --- notifier (EpisodeNotifier.refresh) ---

  refreshNotifier(alert) {
    try {
      const content = buildNotification(this.store.state());
      this.notify(content, { alert: !!alert });
    } catch { /* Alerts are optional; in-app updates remain saved. */ }
  }
}

/** Mirrors MainActivity.episodeError: only known user-facing messages pass. */
export function episodeErrorMessage(error) {
  const message = String(error?.message || '');
  if (message.startsWith('Add a title') || message.startsWith('Too many collection')
    || message.startsWith('A collection title') || message.startsWith('Collection snapshot')) {
    return message;
  }
  return 'Could not read or schedule episode updates. Please try again.';
}
