// Windows offline download manager — functional port of Android's
// OfflineStore + DownloadWorker + ExportStore/ExportWorker state machines.
//
// Metadata intentionally keeps the Android record fields consumed by the
// shared UI. Private episodes are stored as a finished MP4 under the app's
// userData folder (rather than a Media3 cache), with subtitle sidecars.
// A verified folder copy can then replace the private copy, as on Android.
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { allowedSource, matchesSource } from './allowlist.js';
import { createVideoResolver, subtitleTracksForDownload, validateSelection } from './video-resolver.js';
import { publicUrl, safeFetch, safeGet } from './safe-http.js';
import { createMediaReferer, downloadDirectFile, downloadHlsMedia, isHlsResult } from './media-download.js';
import {
  applyPreferredSubtitle, englishOnly, isEnglish, keepTrackForSelection, languageFor,
  normalizeSubtitleSelection, storedSubtitleSelection, subtitleLanguageCode, subtitleTextToVtt,
  subtitleTrackId, trackMatchesSubtitleSelection,
} from './subtitles.js';
import { episodeFileBase, seriesFolderName } from './folder-names.js';

const ID_PATTERN = /^[a-f0-9]{32}$/;
const ACTIVE_EXPORT = new Set(['queued', 'exporting', 'verifying']);
const QUEUE_ORDER_STATUSES = new Set(['queued', 'resolving', 'downloading', 'paused']);
const ONLINE_STREAM_TTL_MS = 6 * 60 * 60 * 1000;
const ONLINE_STREAM_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,120}$/;

function onlineStreamKind(resolved) {
  const url = String(resolved?.url || '');
  const mime = String(resolved?.mime || '').toLowerCase();
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  if (parsed.protocol !== 'https:' || url.length > 8192) return '';
  if (isHlsResult(resolved) || mime.includes('mpegurl') || parsed.pathname.toLowerCase().endsWith('.m3u8')) return 'hls';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url)) return 'file';
  // Several supported hosts return extensionless HTTPS media with no useful
  // MIME. Chromium/MediaSource makes the final playability decision and the
  // UI falls back to the embed if the stream cannot actually play.
  return 'file';
}

function queueOrderValue(record) {
  const value = Number(record?.queueOrder);
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

function compareQueueRecords(a, b) {
  return queueOrderValue(a) - queueOrderValue(b)
    || (Number(a?.added) || 0) - (Number(b?.added) || 0)
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

function cleanQueueOrderIds(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > 20000) throw new Error('Download queue order is too large');
    try { value = JSON.parse(raw || '[]'); }
    catch { throw new Error('Invalid download queue order'); }
  }
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid download queue order');
  const seen = new Set();
  const out = [];
  for (const id of value) {
    const clean = String(id || '');
    if (!ID_PATTERN.test(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function downloadIdFor(source, episodeUrl) {
  return createHash('sha256').update(`${source}|${episodeUrl}`, 'utf8').digest('hex').slice(0, 32);
}

function abortError() {
  const error = new Error('Download was canceled');
  error.name = 'AbortError';
  return error;
}

function safeError(error, fallback = 'Could not prepare this download. Try again.', limit = 200) {
  let current = error;
  while (current?.cause && current.cause !== current) current = current.cause;
  let text = String(current?.message || '').trim();
  if (!text) return fallback;
  text = text.replace(/https?:\/\/\S+/g, '[host]').replace(/file:\/\/\S+/g, '[file]');
  return text.length > limit ? text.slice(0, limit) : text;
}

function cleanString(value) {
  return value == null ? '' : String(value);
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function fileSize(file) {
  try { return (await stat(file)).size; } catch { return 0; }
}

async function writeBufferAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, data);
  await rename(temp, file);
}

async function copyFileWithHash(source, target, signal) {
  await mkdir(dirname(target), { recursive: true });
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(createReadStream(source), meter, createWriteStream(target, { flags: 'wx' }), { signal });
  if (!bytes) throw new Error('The saved file was empty.');
  return { bytes, sha256: hash.digest('hex') };
}

async function verifyFile(info, signal) {
  const file = info?.path || '';
  const expectedBytes = Number(info?.bytes || 0);
  const expectedHash = String(info?.sha256 || '');
  if (!file || expectedBytes <= 0 || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('The saved file could not be verified.');
  }
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expectedBytes) {
        callback(new Error('The saved file has an unexpected size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  // Drain to a sink Transform rather than discarding data in the meter so
  // pipeline backpressure stays simple and portable.
  const sink = new Transform({ transform(_chunk, _encoding, callback) { callback(); } });
  await pipeline(createReadStream(file), meter, sink, { signal });
  if (bytes !== expectedBytes || hash.digest('hex') !== expectedHash) {
    throw new Error('The saved file did not match the original. The in-app copy was kept.');
  }
}

function canonicalDirectIdentity(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch { return String(url || ''); }
}

export class DownloadService {
  constructor({
    baseDir,
    store = null,
    resolver = createVideoResolver(),
    mediaProcessor = null,
    safeGetImpl = safeGet,
    safeFetchImpl = safeFetch,
    publicUrlImpl = publicUrl,
    fetchImpl,
    lookup,
    now = Date.now,
    randomUUID = nodeRandomUUID,
    maxConcurrentDownloads = 2,
    onDownloadReady = null,
  } = {}) {
    if (!baseDir) throw new Error('A downloads folder is required');
    this.baseDir = baseDir;
    this.mediaRoot = join(baseDir, 'media');
    this.metadataFile = join(baseDir, 'downloads.json');
    this.store = store;
    this.resolver = resolver;
    this.mediaProcessor = mediaProcessor;
    this.safeGetImpl = safeGetImpl;
    this.safeFetchImpl = safeFetchImpl;
    this.publicUrlImpl = publicUrlImpl;
    this.fetchImpl = fetchImpl;
    this.lookup = lookup;
    this.now = now;
    this.randomUUID = randomUUID;
    this.maxConcurrentDownloads = Math.max(1, maxConcurrentDownloads);
    this.onDownloadReady = typeof onDownloadReady === 'function' ? onDownloadReady : null;

    this.records = new Map();
    this.activeDownloads = new Map();
    this.activeExports = new Map();
    this.playbackTokens = new Map();
    this.playbackUse = new Map();
    this.lastProgressSave = new Map();
    this.folderFallback = null;
    this.optionsController = null;
    this.onlineStreamController = null;
    this.onlineStreams = new Map();

    this.version = 0;
    this.dirty = false;
    this.writePromise = null;
    this.saveTimer = null;
    this.ready = this.load();
  }

  async init() {
    await this.ready;
    this.scheduleDownloads();
    this.scheduleExports();
    for (const record of this.records.values()) {
      if (record.storageMode === 'folder' && ['pending', 'waiting'].includes(record.cleanupStatus)) {
        this.runCleanup(record.id).catch(() => {});
      }
    }
    return this;
  }

  mediaDir(id) { return join(this.mediaRoot, id); }
  privateFile(id) { return join(this.mediaDir(id), 'episode.mp4'); }
  subtitleDir(id) { return join(this.mediaDir(id), 'subtitles'); }
  workDir(id) { return join(this.mediaDir(id), 'work'); }

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
        const snapshot = JSON.stringify([...this.records.values()], null, 2);
        await mkdir(this.baseDir, { recursive: true });
        const temp = `${this.metadataFile}.tmp-${process.pid}`;
        await writeFile(temp, snapshot, 'utf8');
        await rename(temp, this.metadataFile);
        if (version !== this.version) this.dirty = true;
      }
    })();
    try { await this.writePromise; }
    finally { this.writePromise = null; }
  }

  async load() {
    await mkdir(this.mediaRoot, { recursive: true });
    let parsed = [];
    try {
      parsed = JSON.parse(await readFile(this.metadataFile, 'utf8'));
    } catch { parsed = []; }
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    let changed = false;
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !ID_PATTERN.test(String(row.id || ''))) continue;
      const record = { ...row };
      if (['resolving', 'downloading', 'removing'].includes(record.status)) {
        record.status = 'queued';
        changed = true;
      }
      if (record.exportStatus === 'exporting') {
        record.exportStatus = 'queued';
        changed = true;
      }
      if (record.status === 'completed' && record.storageMode !== 'folder') {
        if (!(await exists(this.privateFile(record.id)))) {
          record.status = 'failed';
          record.error = 'The downloaded file is missing. Download this episode again.';
          changed = true;
        } else if (record.hasAudio === undefined && !record.exportVerified && this.mediaProcessor?.probe) {
          // Saved by a build that could mark a silent or unplayable MP4 as
          // ready. Verify it once; healthy files are remembered via
          // hasAudio so later starts skip the probe.
          try {
            const info = await this.mediaProcessor.probe(this.privateFile(record.id));
            if (!info?.hasVideo || !info?.hasAudio) {
              record.status = 'failed';
              record.error = info?.hasVideo
                ? 'This saved copy has no sound. Download the episode again.'
                : 'This saved copy has no playable picture. Download the episode again.';
              record.localBytes = 0;
              await rm(this.privateFile(record.id), { force: true }).catch(() => {});
            } else {
              record.hasAudio = true;
            }
            changed = true;
          } catch { /* probing is best-effort; never break startup over it */ }
        }
      }
      this.records.set(record.id, record);
    }
    if (changed) await this.markDirty('now');
  }

  patch(id, patch, save = 'defer') {
    const record = this.records.get(id);
    if (!record) return null;
    Object.assign(record, patch);
    this.markDirty(save).catch(() => {});
    return record;
  }

  patchProgress(id, patch) {
    const record = this.records.get(id);
    if (!record) return null;
    const beforeProgress = Math.round(Number(record.progress) || 0);
    Object.assign(record, patch);
    const afterProgress = Math.round(Number(record.progress) || 0);
    const last = this.lastProgressSave.get(id) || 0;
    const nowMs = Date.now();
    if (afterProgress !== beforeProgress || nowMs - last > 1000) {
      this.lastProgressSave.set(id, nowMs);
      this.markDirty('defer').catch(() => {});
    }
    return record;
  }

  publicRecord(record) {
    const copy = JSON.parse(JSON.stringify(record));
    delete copy.localFile;
    delete copy.exportPath;
    delete copy.exportJobFolder;
    delete copy.pendingExport;
    delete copy.verifiedExport;
    if (copy.storageMode === 'folder' && copy.exportVerified) {
      copy.status = 'completed';
      copy.bytes = Number(copy.exportBytes || copy.bytes || 0);
    }
    return copy;
  }

  async list() {
    await this.ready;
    return [...this.records.values()]
      .sort((a, b) => (Number(b.added) || 0) - (Number(a.added) || 0))
      .map((record) => this.publicRecord(record));
  }

  async getRecord(id) {
    await this.ready;
    const record = this.records.get(String(id || ''));
    return record ? this.publicRecord(record) : null;
  }

  nextQueueOrder() {
    let next = 0;
    for (const record of this.records.values()) {
      const value = queueOrderValue(record);
      if (Number.isFinite(value)) next = Math.max(next, value + 1);
    }
    return next;
  }

  async setQueueOrder(rawIds) {
    await this.ready;
    const requested = cleanQueueOrderIds(rawIds);
    const eligible = [...this.records.values()].filter((record) => QUEUE_ORDER_STATUSES.has(record.status));
    const byId = new Map(eligible.map((record) => [record.id, record]));
    const ordered = [];
    for (const id of requested) {
      const record = byId.get(id);
      if (record) {
        ordered.push(record);
        byId.delete(id);
      }
    }
    ordered.push(...[...byId.values()].sort(compareQueueRecords));

    let changed = false;
    ordered.forEach((record, index) => {
      if (record.queueOrder !== index) {
        record.queueOrder = index;
        changed = true;
      }
    });
    if (changed) await this.markDirty('now');
    this.scheduleDownloads();
    return { ok: true, updated: ordered.length, queueOrder: ordered.map((record) => record.id) };
  }

  async claimReadyNotification(id) {
    await this.ready;
    const record = this.records.get(String(id || ''));
    if (!record || record.autoDownload !== true || record.smartNotify === false || record.readyNotifiedAt) return null;
    record.readyNotifiedAt = this.now();
    await this.markDirty('now');
    return this.records.has(record.id) ? this.publicRecord(record) : null;
  }

  async notifyDownloadReady(id) {
    const record = await this.claimReadyNotification(id);
    if (!record || !this.onDownloadReady) return false;
    try { await this.onDownloadReady(record); } catch { /* Notification failure never changes download state. */ }
    return true;
  }

  cleanSelectionPair(pair, server) {
    const item = pair?.item;
    const episode = pair?.episode;
    if (!item || typeof item !== 'object' || !episode || typeof episode !== 'object') {
      throw new Error('Invalid episode selection');
    }
    const source = cleanString(item.source);
    const episodeUrl = cleanString(episode.url);
    const seriesUrl = cleanString(item.url);
    if (!server) server = 'auto';
    if (server !== 'auto' && !server.startsWith(`${source}-`)) throw new Error('Download server and source do not match');
    if (!allowedSource(episodeUrl) || !allowedSource(seriesUrl)) throw new Error('Invalid source URL in selection');
    if (!matchesSource(source, episodeUrl) || !matchesSource(source, seriesUrl)) throw new Error('Source and episode do not match');
    if (cleanString(episode.ids).length > 1000 || cleanString(item.title).length > 500 || episodeUrl.length > 2000) {
      throw new Error('Episode information is too large');
    }
    const cleanItem = {};
    for (const key of ['source', 'url', 'title', 'image', 'type']) cleanItem[key] = cleanString(item[key]);
    const cleanEpisode = {};
    for (const key of ['url', 'number', 'title', 'ids']) cleanEpisode[key] = cleanString(episode[key]);
    return { item: cleanItem, episode: cleanEpisode, source };
  }

  async enqueue(rawPayload, internalOptions = {}) {
    await this.ready;
    if (typeof rawPayload === 'string' && rawPayload.length > 350000) throw new Error('Selection is too large');
    const input = typeof rawPayload === 'string' ? JSON.parse(rawPayload || '{}') : rawPayload;
    const episodes = input?.episodes;
    if (!Array.isArray(episodes) || episodes.length < 1 || episodes.length > 50) {
      throw new Error('Choose between 1 and 50 episodes per batch');
    }
    let language = cleanString(input.language || 'english');
    if (language !== 'english' && language !== 'indonesian') language = 'english';
    const server = cleanString(input.server || 'auto');
    const quality = cleanString(input.quality || 'best');
    validateSelection(server, quality);
    if (server === 'auto' && quality !== 'best') throw new Error('Choose a server before selecting a specific quality');
    const subtitleSelection = normalizeSubtitleSelection(input.subtitleMode, input.subtitleTracks, server);
    const smart = internalOptions?.autoDownload === true ? {
      autoDownload: true,
      smartWifiOnly: internalOptions.wifiOnly === true,
      smartNotify: internalOptions.notifyWhenReady !== false,
      readyNotifiedAt: 0,
    } : {
      autoDownload: false,
      smartWifiOnly: false,
      smartNotify: false,
      readyNotifiedAt: 0,
    };

    let added = 0;
    let skipped = 0;
    let nextQueueOrder = this.nextQueueOrder();
    for (const pair of episodes) {
      const { item, episode, source } = this.cleanSelectionPair(pair, server);
      const id = downloadIdFor(source, episode.url);
      const old = this.records.get(id);
      if (old && old.status !== 'failed') {
        skipped++;
        continue;
      }
      const episodeLanguage = languageFor(source, language);
      const workKey = `${server}|${quality}|${episodeLanguage}`;
      const preserveProgress = old?.workKey === workKey;
      const record = {
        id,
        item,
        episode,
        language: episodeLanguage,
        serverChoice: server,
        qualityChoice: quality,
        subtitleMode: subtitleSelection.mode,
        subtitleSelection: subtitleSelection.tracks,
        preferredSubtitleLanguage: subtitleSelection.tracks[0]?.language || '',
        ...smart,
        status: 'queued',
        queueOrder: nextQueueOrder++,
        error: '',
        subtitleDescription: 'Preparing subtitles',
        added: this.now(),
        workId: this.randomUUID(),
        workKey,
        storageMode: 'private',
        progress: preserveProgress ? Math.max(0, Math.min(99, Number(old.progress) || 0)) : 0,
        bytes: preserveProgress ? Number(old.bytes) || 0 : 0,
      };
      this.records.set(id, record);
      added++;
    }
    if (added) {
      await this.markDirty('now');
      this.scheduleDownloads();
    }
    return { added, skipped };
  }

  async enqueueSmart({ item, episode, preset = {}, wifiOnly = false, notifyWhenReady = true } = {}) {
    return this.enqueue({
      episodes: [{ item, episode }],
      language: preset.language || 'english',
      server: preset.server || 'auto',
      quality: preset.quality || 'best',
      subtitleMode: preset.subtitleMode || 'auto',
      subtitleTracks: Array.isArray(preset.subtitleTracks) ? preset.subtitleTracks : [],
    }, { autoDownload: true, wifiOnly, notifyWhenReady });
  }

  async downloadOptions(rawPayload) {
    await this.ready;
    if (typeof rawPayload === 'string' && rawPayload.length > 6000) throw new Error('Invalid episode information');
    const data = typeof rawPayload === 'string' ? JSON.parse(rawPayload || '{}') : rawPayload;
    const language = cleanString(data?.language || 'english');
    if (language !== 'english' && language !== 'indonesian') throw new Error('Invalid subtitle language');
    if (!data?.item || typeof data.item !== 'object' || !data?.episode || typeof data.episode !== 'object') {
      throw new Error('Invalid episode information');
    }
    this.optionsController?.abort();
    const controller = new AbortController();
    this.optionsController = controller;
    const result = await this.resolver.downloadOptions(data.item, data.episode, language, { signal: controller.signal });
    if (this.optionsController !== controller || controller.signal.aborted) throw new Error('Server check superseded.');
    return result;
  }

  pruneOnlineStreams(now = this.now()) {
    for (const [token, entry] of this.onlineStreams) {
      if (!entry || now - entry.createdAt > ONLINE_STREAM_TTL_MS) this.onlineStreams.delete(token);
    }
    while (this.onlineStreams.size > 5) {
      const oldest = this.onlineStreams.keys().next().value;
      if (!oldest) break;
      this.onlineStreams.delete(oldest);
    }
  }

  async resolveOnlineStream(rawPayload) {
    await this.ready;
    if (typeof rawPayload === 'string' && rawPayload.length > 6000) throw new Error('Invalid episode information');
    const data = typeof rawPayload === 'string' ? JSON.parse(rawPayload || '{}') : rawPayload;
    if (!data?.item || typeof data.item !== 'object' || !data?.episode || typeof data.episode !== 'object') {
      throw new Error('Invalid episode information');
    }
    const server = cleanString(data.server || 'auto');
    const quality = cleanString(data.quality || 'best');
    validateSelection(server, quality);
    if (server === 'auto' && quality !== 'best') throw new Error('Choose a server before selecting a specific quality');
    const clean = this.cleanSelectionPair({ item: data.item, episode: data.episode }, server);
    const language = languageFor(clean.source, cleanString(data.language || 'english'));

    this.onlineStreamController?.abort();
    const controller = new AbortController();
    this.onlineStreamController = controller;
    const resolved = await this.resolver.resolve(clean.item, clean.episode, language, server, quality, { signal: controller.signal });
    if (this.onlineStreamController !== controller || controller.signal.aborted) throw new Error('Stream check superseded.');
    const publicUrl = await this.publicUrlImpl(resolved?.url, { lookup: this.lookup });
    const kind = onlineStreamKind({ ...resolved, url: publicUrl.href });
    if (!kind) throw new Error('This server did not provide a direct stream Mikozora can play.');

    const now = this.now();
    this.pruneOnlineStreams(now);
    const token = nodeRandomUUID();
    const stored = {
      ...resolved,
      url: publicUrl.href,
      tracks: Array.isArray(resolved.tracks) ? resolved.tracks : [],
    };
    this.onlineStreams.set(token, { resolved: stored, source: clean.source, createdAt: now });
    this.pruneOnlineStreams(now);

    const tracks = stored.tracks.map((track, index) => {
      let valid = false;
      try { valid = new URL(String(track?.url || '')).protocol === 'https:'; } catch { valid = false; }
      if (!valid) return null;
      const label = cleanString(track.label || track.name || track.language || `Subtitle ${index + 1}`).slice(0, 120);
      return {
        index,
        label: label || `Subtitle ${index + 1}`,
        language: subtitleLanguageCode(track.language, label),
        mime: cleanString(track.mime || '').slice(0, 80),
        preferred: track.preferred === true || track.default === true,
      };
    }).filter(Boolean).slice(0, 30);

    return {
      token,
      url: stored.url,
      mime: cleanString(stored.mime || ''),
      kind,
      host: cleanString(stored.host || '').slice(0, 80),
      serverLabel: cleanString(stored.serverLabel || '').slice(0, 120),
      subtitleDescription: cleanString(stored.subtitleDescription || '').slice(0, 240),
      fixedHeight: Math.max(0, Math.min(4320, Math.trunc(Number(stored.fixedHeight) || 0))),
      tracks,
      // Consumed only by desktop/src/bridge.js in the main process and
      // removed before this object is serialized to the renderer.
      _context: {
        url: stored.url,
        referer: cleanString(stored.referer || ''),
      },
    };
  }

  async onlineSubtitleContent(token, index) {
    const cleanToken = cleanString(token || '');
    if (!ONLINE_STREAM_TOKEN_PATTERN.test(cleanToken)) return null;
    this.pruneOnlineStreams();
    const entry = this.onlineStreams.get(cleanToken);
    const track = entry?.resolved?.tracks?.[Number(index)];
    if (!track?.url) return null;
    const bytes = await this.safeGetImpl(track.url, entry.resolved.referer || '', 2 * 1024 * 1024, {
      fetchImpl: this.fetchImpl,
      lookup: this.lookup,
    });
    return subtitleTextToVtt(Buffer.from(bytes).toString('utf8'), track.mime || '');
  }

  clearOnlineStream(token = '') {
    const cleanToken = cleanString(token || '');
    if (cleanToken) {
      const cleared = this.onlineStreams.delete(cleanToken) ? 1 : 0;
      return { ok: true, cleared };
    }
    const cleared = this.onlineStreams.size;
    this.onlineStreams.clear();
    return { ok: true, cleared };
  }

  scheduleDownloads() {
    const queued = [...this.records.values()]
      .filter((record) => record.status === 'queued' && !this.activeDownloads.has(record.id))
      .sort(compareQueueRecords);
    for (const record of queued) {
      if (this.activeDownloads.size >= this.maxConcurrentDownloads) break;
      const controller = new AbortController();
      const promise = this.runDownload(record.id, controller).catch(() => {});
      this.activeDownloads.set(record.id, { controller, promise });
    }
  }

  async saveDirectSubtitleTracks(record, resolved, signal) {
    const dir = this.subtitleDir(record.id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const saved = [];
    for (const track of subtitleTracksForDownload(resolved, record.item.source, storedSubtitleSelection(record))) {
      if (signal?.aborted) throw abortError();
      if (!this.records.has(record.id)) throw abortError();
      try {
        const bytes = await this.safeGetImpl(track.url, resolved.referer, 2 * 1024 * 1024, {
          signal, fetchImpl: this.fetchImpl, lookup: this.lookup,
        });
        const text = bytes.toString('utf8');
        if (!text.includes('-->')) continue;
        const name = `track-${saved.length}.${track.mime === 'application/x-subrip' ? 'srt' : 'vtt'}`;
        await writeBufferAtomic(join(dir, name), bytes);
        saved.push({
          file: name,
          label: track.label,
          language: track.language,
          mime: track.mime || 'text/vtt',
          preferred: !!track.preferred,
        });
      } catch (error) {
        if (signal?.aborted) throw abortError();
        // Android ignores an individual unusable sidecar and validates the
        // preferred-language outcome after trying all offered tracks.
      }
    }
    return applyPreferredSubtitle(saved, storedSubtitleSelection(record));
  }

  async saveHlsSubtitleTracks(record, hlsTracks, existing) {
    const saved = [...existing];
    const dir = this.subtitleDir(record.id);
    await mkdir(dir, { recursive: true });
    for (const track of hlsTracks || []) {
      const content = String(track?.content || '');
      if (!content.includes('-->')) continue;
      const duplicate = saved.some((old) => subtitleTrackId(old.language, old.label) === subtitleTrackId(track.language, track.label));
      if (duplicate) continue;
      const name = `track-${saved.length}.vtt`;
      await writeBufferAtomic(join(dir, name), Buffer.from(content, 'utf8'));
      saved.push({
        file: name,
        label: track.label || 'Subtitles',
        language: track.language || 'und',
        mime: 'text/vtt',
        preferred: !!track.preferred,
      });
    }
    return applyPreferredSubtitle(saved, storedSubtitleSelection(record));
  }

  async runDownload(id, controller) {
    const signal = controller.signal;
    let processingFile = '';
    try {
      await this.ready;
      let record = this.records.get(id);
      if (!record || signal.aborted) return;
      if (record.storageMode === 'folder' && record.exportVerified) {
        this.patch(id, { status: 'completed', error: '' }, 'now');
        return;
      }
      const alreadyDownloaded = await fileSize(this.privateFile(id));
      if (alreadyDownloaded > 0 && Number(record.localBytes || 0) === alreadyDownloaded) {
        // Size alone once trusted files that turned out silent or
        // unplayable; only skip the download when the file checks out.
        let trustworthy = true;
        if (this.mediaProcessor?.probe) {
          try {
            const info = await this.mediaProcessor.probe(this.privateFile(id));
            trustworthy = !!info?.hasVideo && (record.hasAudio === false || !!info?.hasAudio);
          } catch { /* keep the file when probing is impossible */ }
        }
        if (trustworthy) {
          this.patch(id, { status: 'completed', bytes: alreadyDownloaded, progress: 100, error: '' }, 'now');
          await this.maybeAutoExport(id);
          await this.notifyDownloadReady(id);
          return;
        }
        await rm(this.privateFile(id), { force: true }).catch(() => {});
        this.patch(id, { localBytes: 0, bytes: 0 }, 'now');
        record = this.records.get(id);
        if (!record || signal.aborted) return;
      }

      this.patch(id, { status: 'resolving', error: '' }, 'now');
      record = this.records.get(id);
      if (!record || signal.aborted) return;

      const source = record.item.source;
      const language = languageFor(source, record.language || 'english');
      const englishOnlySource = englishOnly(source);
      const subtitleSelection = storedSubtitleSelection(record);
      const resolved = await this.resolver.resolve(
        record.item,
        record.episode,
        language,
        record.serverChoice || 'auto',
        record.qualityChoice || 'best',
        { signal },
      );
      if (signal.aborted || !this.records.has(id)) return;
      await this.publicUrlImpl(resolved.url, { lookup: this.lookup });

      let savedTracks = await this.saveDirectSubtitleTracks(record, resolved, signal);
      const directSelectedOffered = subtitleSelection.mode === 'custom'
        && resolved.tracks.some((track) => trackMatchesSubtitleSelection(track, subtitleSelection));
      if (subtitleSelection.mode === 'auto' && !englishOnlySource && resolved.tracks.length && !savedTracks.length) {
        // HLS may still provide a text rendition, so defer the Android
        // failure until the playlist has been inspected below.
        if (!isHlsResult(resolved)) throw new Error('The host provided subtitles, but none could be saved. Please retry.');
      }
      if (subtitleSelection.mode === 'custom' && !isHlsResult(resolved) && !savedTracks.length) {
        throw new Error(directSelectedOffered
          ? 'The selected subtitle track could not be saved. Please retry.'
          : 'The selected subtitle track is not available for this episode.');
      }

      const preliminaryDescription = subtitleSelection.mode === 'none'
        ? (/burned in/i.test(resolved.subtitleDescription || '') ? resolved.subtitleDescription : 'No separate subtitles selected')
        : englishOnlySource && subtitleSelection.mode === 'auto'
          ? 'No English subtitles available'
          : (resolved.subtitleDescription || 'Preparing subtitles');
      this.patch(id, {
        language,
        tracks: savedTracks,
        host: resolved.host || '',
        serverLabel: resolved.serverLabel || '',
        subtitleDescription: preliminaryDescription,
        status: 'downloading',
        progress: Math.max(1, Number(record.progress) || 0),
      }, 'now');

      const mediaDir = this.mediaDir(id);
      const work = this.workDir(id);
      await mkdir(work, { recursive: true });
      const refererFor = createMediaReferer(resolved);
      let inputs = [];
      let separateAudio = false;
      let duration = 0;
      let qualityLabel = '';
      let hls = null;

      if (isHlsResult(resolved)) {
        hls = await downloadHlsMedia({
          url: resolved.url,
          quality: record.qualityChoice || 'best',
          source,
          language,
          refererFor,
          workDir: join(work, 'hls'),
          signal,
          safeFetchImpl: this.safeFetchImpl,
          safeGetImpl: this.safeGetImpl,
          fetchImpl: this.fetchImpl,
          lookup: this.lookup,
          englishOnlySource,
          subtitleSelection,
          probeFile: this.mediaProcessor?.probe ? (file) => this.mediaProcessor.probe(file) : null,
          onProgress: ({ bytes, progress }) => {
            this.patchProgress(id, {
              bytes: Number(bytes) || 0,
              progress: Math.max(1, Math.min(92, Math.round(1 + (Number(progress) || 0) * 0.91))),
              status: 'downloading',
            });
          },
        });
        inputs = hls.inputs;
        separateAudio = hls.separateAudio;
        duration = hls.duration;
        qualityLabel = hls.qualityLabel || '';
        savedTracks = await this.saveHlsSubtitleTracks(record, hls.subtitleTracks, savedTracks);
        if (subtitleSelection.mode === 'auto' && !englishOnlySource && resolved.tracks.length && !savedTracks.length) {
          throw new Error('The host provided subtitles, but none could be saved. Please retry.');
        }
        if (subtitleSelection.mode === 'custom' && !savedTracks.length) {
          const hlsSelectedOffered = (hls.subtitleRenditions || []).length > 0;
          throw new Error(directSelectedOffered || hlsSelectedOffered
            ? 'The selected subtitle track could not be saved. Please retry.'
            : 'The selected subtitle track is not available for this episode.');
        }
      } else {
        const part = join(work, 'source.part');
        const identityFile = join(work, 'source.json');
        const identity = canonicalDirectIdentity(resolved.url);
        const oldIdentity = await readFile(identityFile, 'utf8').catch(() => '');
        if (oldIdentity.trim() !== identity) {
          await rm(part, { force: true });
          await writeBufferAtomic(identityFile, Buffer.from(identity, 'utf8'));
        }
        const direct = await downloadDirectFile({
          url: resolved.url,
          destination: part,
          refererFor,
          signal,
          safeFetchImpl: this.safeFetchImpl,
          fetchImpl: this.fetchImpl,
          lookup: this.lookup,
          onProgress: ({ bytes, total }) => {
            this.patchProgress(id, {
              bytes: Number(bytes) || 0,
              progress: total ? Math.max(1, Math.min(92, Math.round((bytes / total) * 92))) : Math.max(1, Number(this.records.get(id)?.progress) || 1),
              status: 'downloading',
            });
          },
        });
        inputs = [direct.file];
      }

      if (signal.aborted || !this.records.has(id)) return;
      if (!this.mediaProcessor?.remux) throw new Error('FFmpeg is unavailable in this Windows build');

      processingFile = join(mediaDir, 'episode.processing.mp4');
      await rm(processingFile, { force: true });
      this.patchProgress(id, { progress: 95, status: 'downloading' });
      const converted = await this.mediaProcessor.remux({
        inputs,
        output: processingFile,
        separateAudio,
        signal,
        duration,
        onProgress: (ratio) => {
          this.patchProgress(id, { progress: Math.min(99, Math.round(95 + Number(ratio || 0) * 4)) });
        },
      });
      if (signal.aborted || !this.records.has(id)) {
        await rm(processingFile, { force: true }).catch(() => {});
        return;
      }
      const finalFile = this.privateFile(id);
      await rm(finalFile, { force: true });
      await rename(processingFile, finalFile);
      processingFile = '';
      const finalBytes = Number(converted?.bytes) || await fileSize(finalFile);
      if (!finalBytes) throw new Error('The converted video was incomplete');

      if (!qualityLabel) {
        if (resolved.fixedHeight > 0) qualityLabel = `${resolved.fixedHeight}p (source label)`;
        else if (converted?.width && converted?.height) qualityLabel = `${converted.width} x ${converted.height}`;
        else qualityLabel = isHlsResult(resolved) ? 'Source quality (resolution not reported)' : 'Source file (resolution not reported)';
      }

      const preferredCode = language === 'indonesian' ? 'id' : 'en';
      const directOffered = resolved.tracks.some((track) => preferredCode === track.language
        || (preferredCode === 'en' && isEnglish(track.language, track.label)));
      const hlsOffered = (hls?.subtitleTracks || []).some((track) => preferredCode === track.language)
        || (hls?.subtitleErrors || []).length > 0;
      const savedPreferred = savedTracks.some((track) => preferredCode === track.language
        || (preferredCode === 'en' && isEnglish(track.language, track.label)));
      if (subtitleSelection.mode === 'auto'
        && (directOffered || hlsOffered) && !savedPreferred && savedTracks.length === 0) {
        throw new Error('The requested subtitle track could not be saved. Please retry.');
      }

      let description = subtitleSelection.mode === 'none'
        ? (/burned in/i.test(resolved.subtitleDescription || '') ? resolved.subtitleDescription : 'No separate subtitles selected')
        : englishOnlySource && subtitleSelection.mode === 'auto'
          ? 'No English subtitles available'
          : (resolved.subtitleDescription || 'Preparing subtitles');
      if (savedTracks.length) {
        const names = savedTracks.slice(0, 3).map((track) => track.label || 'Subtitles').join(', ');
        description = `${names}${savedTracks.length > 3 ? ` + ${savedTracks.length - 3} more` : ''} subtitles saved`;
        if (subtitleSelection.mode === 'auto' && !directOffered && !hlsOffered) {
          description = `Requested language unavailable · ${description}`;
        }
      }

      // The MP4 is now self-contained, so segment/direct-file work data would
      // otherwise double the storage used by every completed episode. Remove
      // it before publishing the completed state, so "completed" also means
      // the work folder is gone.
      await rm(work, { recursive: true, force: true }).catch(() => {});

      this.patch(id, {
        language,
        tracks: savedTracks,
        host: resolved.host || '',
        serverLabel: resolved.serverLabel || '',
        subtitleDescription: description,
        qualityLabel,
        status: 'completed',
        error: '',
        progress: 100,
        hasAudio: !!converted?.hasAudio,
        bytes: finalBytes,
        localBytes: finalBytes,
        localFile: `media/${id}/episode.mp4`,
        storageMode: 'private',
        downloadedAt: this.now(),
      }, 'now');
      await this.maybeAutoExport(id);
      await this.notifyDownloadReady(id);
    } catch (error) {
      if (processingFile) await rm(processingFile, { force: true }).catch(() => {});
      if (!signal.aborted && this.records.has(id)) {
        this.patch(id, { status: 'failed', error: safeError(error) }, 'now');
      }
    } finally {
      const active = this.activeDownloads.get(id);
      if (active?.controller === controller) this.activeDownloads.delete(id);
      this.scheduleDownloads();
    }
  }

  async remove(rawId) {
    await this.ready;
    const id = String(rawId || '');
    if (!ID_PATTERN.test(id)) throw new Error('Invalid download ID');
    const record = this.records.get(id);
    if (!record) return;
    if ((this.playbackUse.get(id) || 0) > 0) throw new Error('Close the offline player before removing this episode.');

    const download = this.activeDownloads.get(id);
    const exp = this.activeExports.get(id);
    download?.controller.abort();
    exp?.controller.abort();
    this.records.delete(id);
    for (const [token, entry] of this.playbackTokens.entries()) {
      if (entry.id === id) this.playbackTokens.delete(token);
    }
    await this.markDirty('now');
    await Promise.race([
      Promise.allSettled([download?.promise, exp?.promise].filter(Boolean)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    await rm(this.mediaDir(id), { recursive: true, force: true });
    this.scheduleDownloads();
    this.scheduleExports();
  }

  folderRecord() {
    if (this.store) return this.store.get('downloadFolder', null);
    return this.folderFallback;
  }

  async folderSettings() {
    const saved = this.folderRecord();
    const path = typeof saved?.path === 'string' ? saved.path : '';
    let granted = false;
    if (path) {
      try {
        const info = await stat(path);
        if (info.isDirectory()) {
          await access(path, fsConstants.R_OK | fsConstants.W_OK);
          granted = true;
        }
      } catch { granted = false; }
    }
    return {
      configured: !!path,
      granted,
      name: path ? String(saved?.name || basename(path) || 'Selected folder') : '',
    };
  }

  async exportSettings() {
    await this.ready;
    return this.folderSettings();
  }

  async setDownloadFolder(path) {
    await this.ready;
    const selected = String(path || '');
    if (!selected) throw new Error('The folder did not grant read and write access.');
    const info = await stat(selected).catch(() => null);
    if (!info?.isDirectory()) throw new Error('The folder did not grant read and write access.');
    await access(selected, fsConstants.R_OK | fsConstants.W_OK);
    let name = basename(selected) || selected;
    if (name.length > 100) name = name.slice(0, 100);
    const value = { path: selected, name };
    if (this.store) {
      this.store.set('downloadFolder', value);
      this.store.flush?.();
    } else this.folderFallback = value;
    return this.folderSettings();
  }

  async clearDownloadFolder() {
    await this.ready;
    if (this.store) {
      this.store.set('downloadFolder', null);
      this.store.flush?.();
    } else this.folderFallback = null;
    return this.folderSettings();
  }

  playableParts(record, { requireExists = false } = {}) {
    if (!record) return null;
    if (record.storageMode === 'folder' && record.exportVerified && record.exportPath) {
      return {
        file: record.exportPath,
        tracks: (record.exportTracks || []).map((track) => ({ ...track, path: track.path || '' })),
        fromFolder: true,
      };
    }
    return {
      file: this.privateFile(record.id),
      tracks: (record.tracks || []).map((track) => ({ ...track, path: join(this.subtitleDir(record.id), track.file || '') })),
      fromFolder: false,
    };
  }

  async playableSource(id) {
    await this.ready;
    const record = this.records.get(String(id || ''));
    if (!record || record.status !== 'completed') return null;
    const source = this.playableParts(record);
    if (!source?.file || !(await exists(source.file))) return null;
    return { record: this.publicRecord(record), ...source };
  }

  async createPlaybackToken(id) {
    const source = await this.playableSource(id);
    if (!source) return null;
    const token = createHash('sha256').update(this.randomUUID()).digest('hex');
    this.playbackTokens.set(token, { id: String(id), expires: this.now() + 12 * 60 * 60 * 1000 });
    return token;
  }

  validPlaybackToken(id, token) {
    const entry = this.playbackTokens.get(String(token || ''));
    if (!entry || entry.id !== String(id)) return false;
    if (entry.expires < this.now()) {
      this.playbackTokens.delete(String(token));
      return false;
    }
    return true;
  }

  beginPlaybackUse(id) {
    this.playbackUse.set(id, (this.playbackUse.get(id) || 0) + 1);
  }

  endPlaybackUse(id) {
    const next = (this.playbackUse.get(id) || 0) - 1;
    if (next > 0) this.playbackUse.set(id, next);
    else {
      this.playbackUse.delete(id);
      const record = this.records.get(id);
      if (record?.storageMode === 'folder' && ['pending', 'waiting'].includes(record.cleanupStatus)) {
        this.runCleanup(id).catch(() => {});
      }
    }
  }

  async subtitleContent(id, index) {
    const source = await this.playableSource(id);
    const track = source?.tracks?.[Number(index)];
    if (!track?.path) return null;
    const text = await readFile(track.path, 'utf8');
    return subtitleTextToVtt(text, track.mime || '');
  }

  async queueExport(rawId) {
    await this.ready;
    const id = String(rawId || '');
    if (!ID_PATTERN.test(id)) throw new Error('Invalid episode.');
    const record = this.records.get(id);
    const source = record ? this.playableParts(record) : null;
    const playable = record?.status === 'completed' && source?.file && await exists(source.file);
    if (!record || !playable) throw new Error('Wait for the episode to finish downloading first.');
    if (ACTIVE_EXPORT.has(record.exportStatus || '')) return { queued: false };
    const folder = this.folderRecord();
    const settings = await this.folderSettings();
    if (!folder?.path) throw new Error('Choose a download folder in Settings first.');
    if (!settings.granted) throw new Error('Folder access was lost. Choose the folder again in Settings.');
    const job = this.randomUUID();
    const next = { ...record };
    delete next.pendingExport;
    this.records.set(id, next);
    this.patch(id, {
      exportStatus: 'queued',
      exportError: '',
      exportNextFolder: settings.name || basename(folder.path) || 'Selected folder',
      exportJob: job,
      exportJobFolder: folder.path,
    }, 'now');
    this.scheduleExports();
    return { queued: true };
  }

  async maybeAutoExport(id) {
    const record = this.records.get(id);
    if (!record || record.exportStatus) return;
    const folder = this.folderRecord();
    if (!folder?.path) return;
    try {
      await this.queueExport(id);
    } catch (error) {
      if (this.records.has(id)) {
        this.patch(id, { exportStatus: 'failed', exportError: safeError(error, 'Could not save the playable copy. Try again.', 180) }, 'now');
      }
    }
  }

  scheduleExports() {
    if (this.activeExports.size) return;
    const next = [...this.records.values()]
      .filter((record) => !this.activeExports.has(record.id)
        && (record.exportStatus === 'queued' || (record.exportStatus === 'verifying' && record.pendingExport)))
      .sort((a, b) => (Number(a.added) || 0) - (Number(b.added) || 0))[0];
    if (!next) return;
    const controller = new AbortController();
    const promise = this.runExport(next.id, controller).catch(() => {});
    this.activeExports.set(next.id, { controller, promise });
  }

  ensureExportActive(id, job, signal) {
    if (signal?.aborted) throw abortError();
    const record = this.records.get(id);
    if (!record) throw new Error('The download was removed.');
    if (job && record.exportJob !== job) throw new Error('A newer copy replaced this request.');
  }

  async runCleanup(id) {
    const record = this.records.get(id);
    if (!record || record.storageMode !== 'folder' || record.cleanupStatus === 'complete') return;
    if ((this.playbackUse.get(id) || 0) > 0) {
      this.patch(id, {
        cleanupStatus: 'waiting',
        cleanupMessage: 'The private copy will be removed after you close the in-app player.',
      }, 'now');
      return;
    }
    try {
      await rm(this.mediaDir(id), { recursive: true, force: true });
      if (await exists(this.mediaDir(id))) throw new Error('cleanup incomplete');
      this.patch(id, { cleanupStatus: 'complete', cleanupMessage: '', cleanupStarted: true, tracks: [] }, 'now');
    } catch {
      if (this.records.has(id)) {
        this.patch(id, {
          cleanupStatus: 'waiting',
          cleanupMessage: 'The private copy will be removed when its files are no longer in use.',
        }, 'now');
      }
    }
  }

  async verifyAndPromoteExport(id, job, signal) {
    let record = this.records.get(id);
    const pending = record?.pendingExport;
    if (!pending || pending.job !== job) throw new Error('A newer save replaced this copy.');
    const root = String(pending.tree || '');
    const rootInfo = await stat(root).catch(() => null);
    if (!rootInfo?.isDirectory()) throw new Error('Folder access was lost. The in-app copy was kept.');
    await verifyFile(pending.video, signal);
    for (const track of pending.tracks || []) {
      this.ensureExportActive(id, job, signal);
      await verifyFile(track, signal);
    }
    if (this.mediaProcessor?.probe) {
      const info = await this.mediaProcessor.probe(pending.video.path);
      if (!info?.hasVideo || (record.hasAudio !== false && !info?.hasAudio)) {
        throw new Error('The saved file is missing a readable video or audio track. The in-app copy was kept.');
      }
    }
    this.ensureExportActive(id, job, signal);
    record = this.records.get(id);
    if (!record) return;
    const keepReason = String(pending.keepReason || '');
    const next = { ...record };
    delete next.pendingExport;
    Object.assign(next, {
      verifiedExport: pending,
      exportUri: pending.video.uri,
      exportPath: pending.video.path,
      exportTree: pending.tree,
      exportFolder: pending.folder || '',
      exportSeriesFolder: pending.seriesFolder || '',
      exportFilename: pending.filename || '',
      exportBytes: Number(pending.video.bytes) || 0,
      exportTracks: pending.tracks || [],
      exportSubtitleCount: (pending.tracks || []).length,
      exportVerified: true,
      exportStatus: 'completed',
      exportError: '',
      status: 'completed',
      bytes: Number(pending.video.bytes) || record.bytes || 0,
    });
    if (keepReason) {
      next.storageMode = 'private';
      next.cleanupStatus = 'retained';
      next.cleanupMessage = keepReason;
    } else {
      next.storageMode = 'folder';
      next.cleanupStatus = 'pending';
      next.cleanupMessage = '';
    }
    this.records.set(id, next);
    await this.markDirty('now');
    if (!keepReason) await this.runCleanup(id);
  }

  async runExport(id, controller) {
    const signal = controller.signal;
    let created = [];
    let staged = false;
    let job = '';
    try {
      await this.ready;
      let record = this.records.get(id);
      if (!record || signal.aborted) return;
      job = String(record.exportJob || '');
      if (!job) {
        job = `legacy-${this.randomUUID()}`;
        this.patch(id, { exportJob: job }, 'now');
        record = this.records.get(id);
      }
      if (record.exportStatus === 'verifying' && record.pendingExport) {
        await this.verifyAndPromoteExport(id, job, signal);
        return;
      }
      if (record.exportStatus !== 'queued') return;

      const folderRoot = String(record.exportJobFolder || this.folderRecord()?.path || '');
      const settingsRootInfo = await stat(folderRoot).catch(() => null);
      if (!settingsRootInfo?.isDirectory()) throw new Error('Folder access was lost. Choose the folder again in Settings.');
      await access(folderRoot, fsConstants.R_OK | fsConstants.W_OK);

      const source = this.playableParts(record);
      if (!source?.file || !(await exists(source.file))) throw new Error('The in-app download is no longer available.');
      if (this.mediaProcessor?.probe) {
        const info = await this.mediaProcessor.probe(source.file);
        if (!info?.hasVideo || (record.hasAudio !== false && !info?.hasAudio)) throw new Error('The episode did not produce a complete video.');
      }

      this.patch(id, { exportStatus: 'exporting', exportError: '' }, 'now');
      this.ensureExportActive(id, job, signal);
      const seriesFolder = seriesFolderName(record.item?.title || '');
      const folder = join(folderRoot, seriesFolder);
      const existingFolderInfo = await stat(folder).catch(() => null);
      if (existingFolderInfo && !existingFolderInfo.isDirectory()) {
        throw new Error('A file already uses the title folder name. Rename that file and retry.');
      }
      await mkdir(folder, { recursive: true });

      let base = '';
      let videoTarget = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        base = episodeFileBase(record, id, this.randomUUID);
        videoTarget = join(folder, `${base}.mp4`);
        if (!(await exists(videoTarget))) break;
        if (attempt === 4) throw new Error('The selected folder could not create a unique file.');
      }
      created.push(videoTarget);
      const videoCopy = await copyFileWithHash(source.file, videoTarget, signal);
      const videoInfo = {
        uri: pathToFileURL(videoTarget).href,
        path: videoTarget,
        ...videoCopy,
      };

      const sourceName = record.item?.source || '';
      const subtitleSelection = storedSubtitleSelection(record);
      const preferred = subtitleSelection.tracks[0]?.language
        || record.preferredSubtitleLanguage
        || (languageFor(sourceName, record.language || 'english') === 'indonesian' ? 'id' : 'en');
      const preferredPrimary = subtitleLanguageCode(preferred).split('-')[0];
      const filtered = (source.tracks || [])
        .filter((track) => keepTrackForSelection(sourceName, subtitleSelection, track.language, track.label))
        .map((track, index) => ({ track, index }))
        .sort((a, b) => Number(!a.track.preferred) - Number(!b.track.preferred)
          || Number(subtitleLanguageCode(a.track.language, a.track.label).split('-')[0] !== preferredPrimary)
            - Number(subtitleLanguageCode(b.track.language, b.track.label).split('-')[0] !== preferredPrimary)
          || a.index - b.index)
        .map(({ track }) => track);
      const savedTracks = [];
      let written = 0;
      for (const track of filtered) {
        this.ensureExportActive(id, job, signal);
        const input = track.path || '';
        if (!input || !(await exists(input)) || (await fileSize(input)) === 0) {
          throw new Error(source.fromFolder ? 'A saved subtitle is unavailable. The original was kept.' : 'A saved subtitle is missing. Retry the download.');
        }
        let ext = track.mime === 'application/x-subrip' ? 'srt' : 'vtt';
        const byName = /\.([a-z0-9]+)$/i.exec(input)?.[1]?.toLowerCase();
        if (byName === 'srt' || byName === 'vtt') ext = byName;
        let lang = String(track.language || 'und').replace(/[^A-Za-z0-9-]/g, '') || 'und';
        const outputName = `${base}${written === 0 ? '' : `.${lang}-${written}`}.${ext}`;
        const target = join(folder, outputName);
        created.push(target);
        const copied = await copyFileWithHash(input, target, signal);
        savedTracks.push({
          uri: pathToFileURL(target).href,
          path: target,
          ...copied,
          mime: ext === 'srt' ? 'application/x-subrip' : 'text/vtt',
          language: lang,
          label: track.label || 'Subtitles',
          preferred: track.preferred == null ? written === 0 : !!track.preferred,
        });
        written++;
      }

      const rootName = record.exportNextFolder || basename(folderRoot) || 'Selected folder';
      const pending = {
        job,
        tree: folderRoot,
        folder: rootName,
        seriesFolder,
        filename: `${base}.mp4`,
        video: videoInfo,
        tracks: savedTracks,
        keepReason: '',
      };
      this.ensureExportActive(id, job, signal);
      this.patch(id, { pendingExport: pending, exportStatus: 'verifying', exportError: '' }, 'now');
      staged = true;
      await this.verifyAndPromoteExport(id, job, signal);
    } catch (error) {
      if (signal.aborted || !this.records.has(id)) return;
      let clean = staged;
      if (!staged) {
        clean = true;
        for (const file of [...created].reverse()) {
          try { await rm(file, { force: true }); }
          catch { clean = false; }
        }
      }
      const record = this.records.get(id);
      if (record && (!job || record.exportJob === job)) {
        let message = safeError(error, 'Could not save the playable copy. Try again.', 180);
        if (!clean) message += ' A partial file may remain in the selected folder.';
        const next = { ...record, exportStatus: 'failed', exportError: message };
        delete next.pendingExport;
        this.records.set(id, next);
        await this.markDirty('now');
      }
    } finally {
      const active = this.activeExports.get(id);
      if (active?.controller === controller) this.activeExports.delete(id);
      this.scheduleExports();
    }
  }

  async exportFile(id) {
    await this.ready;
    const record = this.records.get(String(id || ''));
    if (!record?.exportPath) return '';
    return await exists(record.exportPath) ? record.exportPath : '';
  }

  async shutdown() {
    this.optionsController?.abort();
    this.onlineStreamController?.abort();
    this.onlineStreams.clear();
    for (const active of this.activeDownloads.values()) active.controller.abort();
    for (const active of this.activeExports.values()) active.controller.abort();
    await this.flush().catch(() => {});
  }
}
