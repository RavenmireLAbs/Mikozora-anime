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
const SMART_OCCUPYING_STATUSES = new Set(['queued', 'resolving', 'downloading', 'paused', 'completed']);

export function smartQueueDecision(event, track, records, maxUnwatchedPerSeries) {
  const watched = new Set(Array.isArray(track?.watchedEpisodes) ? track.watchedEpisodes : []);
  const episodeUrl = event?.episode?.url || '';
  if (watched.has(episodeUrl)) return 'watched';
  const sameSeries = (Array.isArray(records) ? records : []).filter((record) => (
    record?.item?.source === track?.item?.source && record?.item?.url === track?.item?.url
  ));
  if (sameSeries.some((record) => record?.episode?.url === episodeUrl)) return 'existing';
  const occupying = sameSeries.filter((record) => record?.autoDownload === true
    && SMART_OCCUPYING_STATUSES.has(record?.status)
    && !watched.has(record?.episode?.url)).length;
  const cap = Math.max(1, Math.min(10, Math.floor(Number(maxUnwatchedPerSeries)) || 3));
  return occupying >= cap ? 'pendingCap' : 'queue';
}

/** Pure port of EpisodeNotifier's summary content. */
export function buildNotification(state) {
  const unread = Number(state?.unreadCount) || 0;
  if (!unread || state?.alerts === false) return null;
  const lines = [];
  for (const event of state.updates || []) {
    if (lines.length >= 3) break;
    if (!event || event.read || event.alertSuppressed || !event.item || !event.episode) continue;
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
    downloadService = null,
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
    this.downloadService = downloadService;
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
    this.smartQueuePromise = null;
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

  smartDownloadsEnabled() {
    return typeof this.store.smartSettings === 'function' && this.store.smartSettings().enabled;
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

  async queueSmartDownloads() {
    if (!this.downloadService || typeof this.downloadService.enqueueSmart !== 'function'
      || typeof this.downloadService.list !== 'function'
      || typeof this.store.smartSettings !== 'function'
      || typeof this.store.pendingSmartDownloads !== 'function') {
      return { queued: 0 };
    }
    const previous = this.smartQueuePromise;
    const run = (async () => {
      if (previous) await previous.catch(() => {});
      let queued = 0;
      await this.store.ready;
      for (const event of this.store.pendingSmartDownloads()) {
        if (this.stopped) break;
        const settings = this.store.smartSettings();
        const track = this.store.track(event.titleId);
        if (!settings.enabled || !track?.smartDownload) {
          await this.store.markSmartDownload(event.id, 'skipped', { now: this.now() }).catch(() => {});
          if (!settings.enabled) break;
          continue;
        }
        let records;
        try { records = await this.downloadService.list(); } catch { break; }
        const decision = smartQueueDecision(event, track, records, settings.maxUnwatchedPerSeries);
        if (decision !== 'queue') {
          await this.store.markSmartDownload(event.id, decision, { now: this.now() }).catch(() => {});
          continue;
        }
        const preset = track.downloadPreset || {};
        const fallback = { language: preset.language || 'english', server: 'auto', quality: 'best', subtitleMode: 'auto', subtitleTracks: [] };
        const isFallback = (preset.server || 'auto') === 'auto'
          && (preset.quality || 'best') === 'best'
          && (preset.subtitleMode || 'auto') === 'auto';
        try {
          let result;
          try {
            result = await this.downloadService.enqueueSmart({
              item: event.item || track.item,
              episode: event.episode,
              preset,
              wifiOnly: settings.wifiOnly,
              notifyWhenReady: settings.notifyWhenReady,
            });
          } catch (firstError) {
            if (isFallback) throw firstError;
            result = await this.downloadService.enqueueSmart({
              item: event.item || track.item,
              episode: event.episode,
              preset: fallback,
              wifiOnly: settings.wifiOnly,
              notifyWhenReady: settings.notifyWhenReady,
            });
          }
          if (Number(result?.added) > 0) {
            queued++;
            await this.store.markSmartDownload(event.id, 'queued', { now: this.now() }).catch(() => {});
          } else {
            await this.store.markSmartDownload(event.id, 'existing', { now: this.now() }).catch(() => {});
          }
        } catch (error) {
          await this.store.markSmartDownload(event.id, 'failed', {
            now: this.now(),
            error: error?.message || 'Could not queue this episode automatically',
          }).catch(() => {});
        }
      }
      return { queued };
    })();
    this.smartQueuePromise = run;
    try { return await run; } finally {
      if (this.smartQueuePromise === run) this.smartQueuePromise = null;
    }
  }

  // --- bridge-facing operations (mirror MainActivity's episode methods) ---

  async syncTitles(payload, onOpen) {
    const result = await this.store.sync(payload);
    await this.queueSmartDownloads().catch(() => {});
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
          const found = typeof this.store.successEvents === 'function'
            ? await this.store.successEvents(title, episodes, Math.max(this.now(), effectiveCutoff))
            : await this.store.success(title, episodes, Math.max(this.now(), effectiveCutoff));
          const foundCount = Array.isArray(found) ? found.length : Number(found) || 0;
          if (foundCount > 0) {
            this.refreshNotifier(!announced);
            announced = true;
            await this.queueSmartDownloads().catch(() => {});
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
