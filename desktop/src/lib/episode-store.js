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
        episode: { number: ep.number, title: ep.title, url: ep.url },
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
  return { titles: {}, events: [], automatic: true, alerts: true };
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
    const input = JSON.parse(String(payload));
    if (!Array.isArray(input) || input.length > MAX_TITLES) throw new Error('Too many collection titles to check');
    const old = this.db.titles;
    const next = {};
    let added = false;
    let changed = false;
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
      } else if (JSON.stringify(item) !== JSON.stringify(track.item)) {
        changed = true;
      }
      track.item = item;
      next[id] = track;
    }
    if (Object.keys(old).length !== Object.keys(next).length) changed = true;
    // A removed title starts a fresh baseline if it is later added again.
    // Its old alerts are also removed; downloads and library data are separate.
    const kept = [];
    for (const e of this.db.events) {
      if (e && ids.has(e.titleId)) kept.push(e);
      else changed = true;
    }
    this.db.titles = next;
    this.db.events = kept;
    if (changed) await this.markDirty('now');
    return { added, changed, watchedCount: Object.keys(next).length };
  }

  automatic() { return this.db.automatic !== false; }
  alerts() { return this.db.alerts !== false; }
  count() { return Object.keys(this.db.titles).length; }

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

  async success(title, episodes, now) {
    await this.ready;
    const track = this.db.titles[title.id];
    if (!track || track.token !== title.token) return 0;
    const found = applyEpisodes(track, episodes, now);
    const nextEvents = [];
    const seen = new Set();
    for (const e of found) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (nextEvents.length < MAX_EVENTS) nextEvents.push(e);
    }
    for (const e of this.db.events) {
      if (nextEvents.length >= MAX_EVENTS) break;
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      nextEvents.push(e);
    }
    this.db.events = nextEvents;
    await this.markDirty('now');
    return found.length;
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
    let unread = 0;
    for (const e of this.db.events) if (e && !e.read) unread++;
    const now = this.now();
    return {
      automatic: this.automatic(),
      alerts: this.alerts(),
      watchedCount: titles.length,
      initializedCount: initialized,
      unreadCount: unread,
      lastSuccess,
      lastRun: Number(this.db.lastRun) || 0,
      checking: (Number(this.db.runningUntil) || 0) > now,
      queued: (Number(this.db.pendingAt) || 0) > now - 24 * 60 * 60_000 && !!this.db.pendingAt,
      errors,
      updates: JSON.parse(JSON.stringify(this.db.events)),
    };
  }
}
