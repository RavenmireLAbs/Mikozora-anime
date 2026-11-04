// Windows port of Android's EpisodeState + EpisodeStore.
//
// The snapshot keeps the exact Android shapes: per-title tracks
// ({ id, token, item, known, maxNumber, baseline, lastAttempt, ... }) and a
// newest-first events array, persisted atomically in episode-updates.json
// inside the app's userData folder so tray-background checks share one
// state with the UI.
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { matchesSource } from './allowlist.js';

export const EPISODE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_TITLES = 2000;
const MAX_EVENTS = 500;
const MAX_WATCHED_EPISODES = 5000;
const MAX_SUBTITLE_TRACKS = 60;
const SMART_PENDING_STATUSES = new Set(['pending', 'pendingCap']);
const SMART_STATUSES = new Set(['pending', 'pendingCap', 'queued', 'existing', 'watched', 'skipped', 'failed']);
const SERVER_ID = /^(?:auto|(?:sogo|suge|anikoto|rulz|waves|bash|xin|narul|stream|world)-[a-z0-9-]{1,90})$/;
const QUALITY_ID = /^(?:best|v:[0-9]{2,5}x[0-9]{2,5}|f:[0-9]{3,4})$/;
const SUBTITLE_TRACK_ID = /^s:[a-f0-9]{32}$/;

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function normalizeSmartSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const cap = Math.floor(Number(value.maxUnwatchedPerSeries));
  return {
    enabled: value.enabled === true,
    wifiOnly: value.wifiOnly !== false,
    maxUnwatchedPerSeries: Number.isFinite(cap) ? Math.max(1, Math.min(10, cap)) : 3,
    notifyWhenReady: value.notifyWhenReady !== false,
  };
}

export function sanitizeAlertMode(raw) {
  return raw === 'inbox' || raw === 'muted' ? raw : 'alerts';
}

export function sanitizeAlertsMutedUntil(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.trunc(value), 4102444800000) : 0;
}

export function alertSuppressed(track, now = Date.now()) {
  if (!track) return false;
  return sanitizeAlertMode(track.alertMode) !== 'alerts'
    || sanitizeAlertsMutedUntil(track.alertsMutedUntil) > now;
}

export function inboxSuppressed(track, now = Date.now()) {
  if (!track) return false;
  return sanitizeAlertMode(track.alertMode) === 'muted'
    || sanitizeAlertsMutedUntil(track.alertsMutedUntil) > now;
}

export function sanitizeDownloadPreset(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const server = cleanText(value.server, 120);
  const quality = cleanText(value.quality, 24);
  let subtitleMode = ['auto', 'custom', 'none'].includes(value.subtitleMode) ? value.subtitleMode : 'auto';
  let subtitleTracks = [];
  const safeServer = SERVER_ID.test(server) ? server : 'auto';
  if (subtitleMode === 'custom') {
    if (safeServer === 'auto' || !Array.isArray(value.subtitleTracks)) {
      subtitleMode = 'auto';
    } else {
      const seen = new Set();
      for (const rawTrack of value.subtitleTracks) {
        const id = cleanText(rawTrack?.id, 40);
        const label = cleanText(rawTrack?.label, 160);
        if (!SUBTITLE_TRACK_ID.test(id) || !label || seen.has(id)) continue;
        seen.add(id);
        subtitleTracks.push({ id, label, language: cleanText(rawTrack?.language, 35) || 'und' });
        if (subtitleTracks.length >= MAX_SUBTITLE_TRACKS) break;
      }
      if (!subtitleTracks.length) subtitleMode = 'auto';
    }
  }
  return {
    language: value.language === 'indonesian' ? 'indonesian' : 'english',
    server: safeServer,
    quality: QUALITY_ID.test(quality) ? quality : 'best',
    subtitleMode,
    subtitleTracks,
  };
}

function cleanWatchedEpisodes(raw, source) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(raw) ? raw : []) {
    const url = cleanText(value, 2500);
    if (!url || seen.has(url) || !matchesSource(source, url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= MAX_WATCHED_EPISODES) break;
  }
  return result;
}

export function isSmartPending(event) {
  return SMART_PENDING_STATUSES.has(event?.smartDownloadStatus);
}

export function digest(input) {
  return createHash('sha256').update(String(input), 'utf8').digest('hex');
}

/** Pure per-title comparison. A failed fetch must never be passed here. */
export function applyEpisodes(track, episodes, now) {
  const found = [];
  if (!track.known || typeof track.known !== 'object') track.known = {};
  const known = track.known;
  const baseline = !!track.baseline;
  let previousMax = Number(track.maxNumber);
  if (!Number.isFinite(previousMax)) previousMax = -1;
  let max = previousMax;
  const item = track.item;
  const titleId = track.id;
  // Compare every episode against the previous maximum, not the maximum of
  // earlier entries in this response: source listings may be in any order.
  for (const ep of episodes || []) {
    if (!ep || !ep.key) continue;
    const wasKnown = Object.prototype.hasOwnProperty.call(known, ep.key);
    const later = ep.number === '' || ep.numeric > previousMax;
    if (baseline && !wasKnown && later) {
      found.push({
        id: digest(`${titleId}\n${ep.key}`),
        titleId,
        item: JSON.parse(JSON.stringify(item)),
        episode: { number: ep.number, title: ep.title, url: ep.url, ids: cleanText(ep.ids, 1000) },
        discoveredAt: now,
        read: false,
      });
    }
    known[ep.key] = true;
    if (ep.number !== '' && ep.numeric > max) max = ep.numeric;
  }
  track.known = known;
  track.maxNumber = max;
  track.baseline = true;
  track.lastSuccess = now;
  track.lastAttempt = now;
  delete track.error;
  return found;
}

function safeError(error) {
  const s = error == null ? '' : String(error).trim();
  if (/^Source returned HTTP [0-9]{3}$/.test(s)) return s;
  if (s.toLowerCase().includes('timed out') || s.toLowerCase().includes('timeout')) return 'Source timed out';
  if (s.startsWith('Source episode list') || s.startsWith('Source did not return')
    || s.startsWith('Source episode links') || s.startsWith('Series episode list')
    || s.startsWith('AnimeBash did not provide')) {
    return s.length > 160 ? s.slice(0, 160) : s;
  }
  return 'Could not check this source';
}

function freshDb() {
  return { titles: {}, events: [], automatic: true, alerts: true, smartDownloads: normalizeSmartSettings(null) };
}

export class EpisodeStore {
  constructor({ file, now = Date.now, randomUUID = nodeRandomUUID } = {}) {
    if (!file) throw new Error('An episode updates file is required');
    this.file = file;
    this.now = now;
    this.randomUUID = randomUUID;
    this.db = freshDb();
    this.version = 0;
    this.dirty = false;
    this.writePromise = null;
    this.saveTimer = null;
    this.ready = this.load();
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object'
        && parsed.titles && typeof parsed.titles === 'object' && Array.isArray(parsed.events)) {
        this.db = { ...freshDb(), ...parsed };
        this.db.smartDownloads = normalizeSmartSettings(this.db.smartDownloads);
        for (const track of Object.values(this.db.titles)) {
          if (!track || typeof track !== 'object') continue;
          track.smartDownload = track.smartDownload === true;
          track.alertMode = sanitizeAlertMode(track.alertMode);
          track.alertsMutedUntil = sanitizeAlertsMutedUntil(track.alertsMutedUntil);
          track.downloadPreset = sanitizeDownloadPreset(track.downloadPreset);
          track.watchedEpisodes = track.smartDownload
            ? cleanWatchedEpisodes(track.watchedEpisodes, track.item?.source)
            : [];
        }
      }
    } catch { /* first run or unreadable snapshot: rebuild from scratch */ }
    return this;
  }

  markDirty(save = 'defer') {
    this.version++;
    this.dirty = true;
    if (save === 'now') return this.flush();
    if (this.saveTimer) return Promise.resolve();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(() => {});
    }, 250);
    this.saveTimer.unref?.();
    return Promise.resolve();
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.writePromise) return this.writePromise;
    this.writePromise = (async () => {
      while (this.dirty) {
        const version = this.version;
        this.dirty = false;
        const snapshot = JSON.stringify(this.db);
        await mkdir(dirname(this.file), { recursive: true });
        const temp = `${this.file}.tmp-${process.pid}`;
        await writeFile(temp, snapshot, 'utf8');
        await rename(temp, this.file);
        if (version !== this.version) this.dirty = true;
      }
    })();
    try { await this.writePromise; }
    finally { this.writePromise = null; }
  }

  bounded(item, key, max) {
    const value = String(item?.[key] ?? '').trim();
    if (value.length > max) throw new Error('Invalid collection title');
    return value;
  }

  async sync(payload) {
    await this.ready;
    if (payload == null || String(payload).length > 6_000_000) throw new Error('Collection snapshot is too large');
    const parsed = JSON.parse(String(payload));
    const legacy = Array.isArray(parsed);
    const input = legacy ? parsed : parsed?.titles;
    if (!Array.isArray(input) || input.length > MAX_TITLES) throw new Error('Too many collection titles to check');
    const nextSmartSettings = legacy
      ? normalizeSmartSettings(this.db.smartDownloads)
      : normalizeSmartSettings(parsed?.smartDownloads);
    const old = this.db.titles;
    const next = {};
    let added = false;
    let changed = !sameJson(nextSmartSettings, normalizeSmartSettings(this.db.smartDownloads));
    const ids = new Set();
    for (const x of input) {
      const source = this.bounded(x, 'source', 30);
      const url = this.bounded(x, 'url', 2500);
      const title = this.bounded(x, 'title', 500);
      if (title === '' || !matchesSource(source, url)) throw new Error('A collection title has an invalid source');
      const id = `${source}|${url}`;
      if (ids.has(id)) continue;
      ids.add(id);
      const item = {
        source, url, title,
        image: this.bounded(x, 'image', 3000),
        type: this.bounded(x, 'type', 100),
        badge: this.bounded(x, 'badge', 100),
        status: this.bounded(x, 'status', 200),
      };
      let track = old[id];
      if (!track) {
        track = { id, token: this.randomUUID(), baseline: false, known: {}, maxNumber: -1, lastAttempt: 0 };
        added = true;
        changed = true;
      } else if (!sameJson(item, track.item)) {
        changed = true;
      }
      const smartDownload = legacy ? track.smartDownload === true : x?.smartDownload === true;
      const downloadPreset = legacy && track.downloadPreset
        ? sanitizeDownloadPreset(track.downloadPreset)
        : sanitizeDownloadPreset(x?.downloadPreset);
      const watchedEpisodes = smartDownload
        ? (legacy ? cleanWatchedEpisodes(track.watchedEpisodes, source) : cleanWatchedEpisodes(x?.watchedEpisodes, source))
        : [];
      const alertMode = sanitizeAlertMode(legacy ? track.alertMode : x?.alertMode);
      const alertsMutedUntil = sanitizeAlertsMutedUntil(legacy ? track.alertsMutedUntil : x?.alertsMutedUntil);
      if (track.smartDownload !== smartDownload
        || !sameJson(downloadPreset, sanitizeDownloadPreset(track.downloadPreset))
        || !sameJson(watchedEpisodes, Array.isArray(track.watchedEpisodes) ? track.watchedEpisodes : [])
        || sanitizeAlertMode(track.alertMode) !== alertMode
        || sanitizeAlertsMutedUntil(track.alertsMutedUntil) !== alertsMutedUntil) {
        changed = true;
      }
      track.item = item;
      track.smartDownload = smartDownload;
      track.downloadPreset = downloadPreset;
      track.watchedEpisodes = watchedEpisodes;
      track.alertMode = alertMode;
      track.alertsMutedUntil = alertsMutedUntil;
      next[id] = track;
    }
    if (Object.keys(old).length !== Object.keys(next).length) changed = true;
    // A removed title starts a fresh baseline if it is later added again.
    // Its old alerts are also removed; downloads and library data are separate.
    const kept = [];
    for (const e of this.db.events) {
      if (e && ids.has(e.titleId)) {
        if (SMART_PENDING_STATUSES.has(e.smartDownloadStatus)
          && (!nextSmartSettings.enabled || !next[e.titleId]?.smartDownload)) {
          e.smartDownloadStatus = 'skipped';
          changed = true;
        } else if (!legacy && e.smartDownloadStatus === 'failed'
          && nextSmartSettings.enabled && next[e.titleId]?.smartDownload) {
          // A foreground sync is a natural, bounded retry point after the
          // user watches an episode or changes a series/cloud setting.
          e.smartDownloadStatus = 'pending';
          delete e.smartDownloadError;
          changed = true;
        }
        kept.push(e);
      } else changed = true;
    }
    this.db.titles = next;
    this.db.events = kept;
    this.db.smartDownloads = nextSmartSettings;
    if (changed) await this.markDirty('now');
    return { added, changed, watchedCount: Object.keys(next).length };
  }

  automatic() { return this.db.automatic !== false; }
  alerts() { return this.db.alerts !== false; }
  count() { return Object.keys(this.db.titles).length; }

  smartSettings() {
    return normalizeSmartSettings(this.db.smartDownloads);
  }

  track(id) {
    const track = this.db.titles[id];
    return track ? JSON.parse(JSON.stringify(track)) : null;
  }

  pendingSmartDownloads() {
    const numeric = (event) => {
      const value = Number.parseFloat(event?.episode?.number);
      return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    };
    return this.db.events
      .filter((event) => event && isSmartPending(event) && this.db.titles[event.titleId])
      .sort((a, b) => (Number(a.discoveredAt) || 0) - (Number(b.discoveredAt) || 0)
        || String(a.titleId).localeCompare(String(b.titleId))
        || numeric(a) - numeric(b)
        || String(a.episode?.url || '').localeCompare(String(b.episode?.url || '')))
      .map((event) => JSON.parse(JSON.stringify(event)));
  }

  async markSmartDownload(id, status, details = {}) {
    await this.ready;
    if (!SMART_STATUSES.has(status)) return false;
    const event = this.db.events.find((entry) => entry?.id === id);
    if (!event) return false;
    event.smartDownloadStatus = status;
    event.smartDownloadUpdatedAt = Number(details.now) || this.now();
    if (status === 'queued') delete event.smartDownloadError;
    if (status === 'failed') {
      event.smartDownloadAttempts = (Number(event.smartDownloadAttempts) || 0) + 1;
      event.smartDownloadError = cleanText(details.error || 'Could not queue this episode automatically', 220);
    }
    await this.markDirty('now');
    return true;
  }

  async setAutomatic(value) {
    await this.ready;
    this.db.automatic = !!value;
    if (!value && this.db.pendingMode === 'auto') {
      delete this.db.pendingAt;
      delete this.db.pendingMode;
    }
    await this.markDirty('now');
  }

  async setAlerts(value) {
    await this.ready;
    this.db.alerts = !!value;
    await this.markDirty('now');
  }

  async queued(manual) {
    await this.ready;
    this.db.pendingAt = this.now();
    this.db.pendingMode = manual ? 'manual' : 'auto';
    await this.markDirty('now');
  }

  async begin() {
    await this.ready;
    const run = this.randomUUID();
    const now = this.now();
    this.db.running = run;
    this.db.runningUntil = now + 9 * 60_000;
    this.db.lastRun = now;
    delete this.db.pendingAt;
    delete this.db.pendingMode;
    await this.markDirty('now');
    return run;
  }

  async finish(run) {
    await this.ready;
    if (run && run === this.db.running) {
      delete this.db.running;
      delete this.db.runningUntil;
      await this.markDirty('now');
    }
  }

  due(cutoff) {
    const out = [];
    for (const track of Object.values(this.db.titles)) {
      const attempt = Number(track.lastAttempt) || 0;
      if (attempt === 0 || attempt < cutoff) {
        out.push({
          id: track.id,
          token: track.token,
          source: track.item?.source || '',
          url: track.item?.url || '',
          attempt,
        });
      }
    }
    out.sort((a, b) => a.attempt - b.attempt);
    return out;
  }

  async successEvents(title, episodes, now) {
    await this.ready;
    const track = this.db.titles[title.id];
    if (!track || track.token !== title.token) return [];
    const found = applyEpisodes(track, episodes, now);
    const settings = this.smartSettings();
    if (settings.enabled && track.smartDownload) {
      for (const event of found) {
        event.smartDownloadStatus = 'pending';
        event.smartDownloadUpdatedAt = now;
      }
    }
    const inserted = [];
    const nextEvents = [];
    const seen = new Set();
    for (const e of found) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (nextEvents.length < MAX_EVENTS) {
        nextEvents.push(e);
        inserted.push(e);
      }
    }
    for (const e of this.db.events) {
      if (nextEvents.length >= MAX_EVENTS) break;
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      nextEvents.push(e);
    }
    this.db.events = nextEvents;
    await this.markDirty('now');
    return JSON.parse(JSON.stringify(inserted));
  }

  async success(title, episodes, now) {
    return (await this.successEvents(title, episodes, now)).length;
  }

  async failure(title, error, now) {
    await this.ready;
    const track = this.db.titles[title.id];
    if (!track || track.token !== title.token) return;
    track.lastAttempt = now;
    track.error = safeError(error);
    await this.markDirty('now');
  }

  async markRead(id, all) {
    await this.ready;
    let changed = false;
    for (const e of this.db.events) {
      if (e && !e.read && (all || e.id === id)) {
        e.read = true;
        changed = true;
      }
    }
    if (changed) await this.markDirty('now');
  }

  state() {
    const titles = Object.values(this.db.titles);
    const errors = [];
    let initialized = 0;
    let lastSuccess = 0;
    for (const t of titles) {
      if (t.baseline) initialized++;
      lastSuccess = Math.max(lastSuccess, Number(t.lastSuccess) || 0);
      if (t.error) errors.push({ item: t.item, message: t.error, at: Number(t.lastAttempt) || 0 });
    }
    const now = this.now();
    const updates = JSON.parse(JSON.stringify(this.db.events));
    let unread = 0;
    for (const e of updates) {
      if (!e) continue;
      e.alertSuppressed = alertSuppressed(this.db.titles[e.titleId], now);
      if (!e.read && !inboxSuppressed(this.db.titles[e.titleId], now)) unread++;
    }
    return {
      automatic: this.automatic(),
      alerts: this.alerts(),
      smartDownloads: this.smartSettings(),
      watchedCount: titles.length,
      initializedCount: initialized,
      unreadCount: unread,
      lastSuccess,
      lastRun: Number(this.db.lastRun) || 0,
      checking: (Number(this.db.runningUntil) || 0) > now,
      queued: (Number(this.db.pendingAt) || 0) > now - 24 * 60 * 60_000 && !!this.db.pendingAt,
      errors,
      updates,
    };
  }
}
