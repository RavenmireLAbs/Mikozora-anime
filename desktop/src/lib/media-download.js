// Direct-file and HLS downloading for Windows offline episodes.
//
// Direct files resume with Range when the host permits it. HLS segments are
// stored individually inside the download's work folder, so an interrupted
// episode resumes from completed segments after an app restart or retry.
// All remote fetches go through SafeHttp; ffmpeg later sees only local
// combined media files.
import { createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { safeFetch, safeGet } from './safe-http.js';
import {
  isMasterPlaylist, parseMasterPlaylist, parseMediaPlaylist, playlistIdentity,
  selectAudioRendition, selectSubtitleRenditions, selectVariant,
} from './hls.js';
import { isEnglish, mergeVttSegments, subtitleTextToVtt } from './subtitles.js';

const PLAYLIST_LIMIT = 2 * 1024 * 1024;
const KEY_LIMIT = 128;
const SUBTITLE_SEGMENT_LIMIT = 2 * 1024 * 1024;

function abortError() {
  const error = new Error('Download was canceled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function fileSize(file) {
  try { return (await stat(file)).size; } catch { return 0; }
}

export function createMediaReferer(result = {}) {
  let primaryHost = '';
  try { primaryHost = new URL(result.url || '').hostname.toLowerCase(); } catch { /* no primary */ }
  const primaryReferer = result.referer || '';
  return (raw) => {
    let host = '';
    try { host = new URL(raw).hostname.toLowerCase(); } catch { return primaryReferer; }
    if (primaryReferer && host === primaryHost) return primaryReferer;
    if (host === 'dailymotion.com' || host.endsWith('.dailymotion.com') || host.endsWith('.dmcdn.net')) return 'https://www.dailymotion.com/';
    if (host === 'mediafire.com' || host.endsWith('.mediafire.com')) return 'https://www.mediafire.com/';
    // Segment CDNs for the supported HLS providers use the same fallback
    // Android's upstream factory applies when no host-specific referer was
    // registered for that exact segment host.
    return primaryReferer || 'https://megaplay.buzz/';
  };
}

export async function readCappedResponse(response, limit) {
  if (!response?.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error('Video-host response is too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function streamResponseToFile(response, file, { append = false, signal, onBytes, idleTimeoutMs = 60000 } = {}) {
  if (!response?.body) {
    await writeFile(file, Buffer.alloc(0), { flag: append ? 'a' : 'w' });
    return 0;
  }
  const reader = response.body.getReader();
  const out = createWriteStream(file, { flags: append ? 'a' : 'w' });
  let downloaded = 0;
  let timer = null;
  let idleError = null;
  const resetIdle = () => {
    if (timer) clearTimeout(timer);
    if (!idleTimeoutMs) return;
    timer = setTimeout(() => {
      idleError = new Error('The video host stopped sending data. Try again.');
      reader.cancel(idleError).catch(() => {});
    }, idleTimeoutMs);
  };
  const onAbort = () => { reader.cancel(abortError()).catch(() => {}); };
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    resetIdle();
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      if (!value?.byteLength) continue;
      downloaded += value.byteLength;
      await new Promise((resolve, reject) => {
        out.write(Buffer.from(value), (error) => (error ? reject(error) : resolve()));
      });
      onBytes?.(downloaded);
    }
    if (idleError) throw idleError;
    throwIfAborted(signal);
    await new Promise((resolve, reject) => {
      out.end((error) => (error ? reject(error) : resolve()));
    });
    return downloaded;
  } catch (error) {
    out.destroy();
    if (signal?.aborted) throw abortError();
    throw idleError || error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function downloadDirectFile({
  url,
  destination,
  refererFor = () => '',
  signal,
  onProgress,
  safeFetchImpl = safeFetch,
  fetchImpl,
  lookup,
  resume = true,
} = {}) {
  throwIfAborted(signal);
  await mkdir(dirname(destination), { recursive: true });
  let existing = resume ? await fileSize(destination) : 0;
  if (!resume && existing) {
    await rm(destination, { force: true });
    existing = 0;
  }
  const headers = existing > 0 ? { Range: `bytes=${existing}-` } : {};
  const { response, url: finalUrl } = await safeFetchImpl(url, {
    referer: refererFor(url),
    signal,
    headers,
    fetchImpl,
    lookup,
    allowStatus: (status) => (status >= 200 && status < 300) || status === 416,
  });
  if (response.status === 416) {
    try { await response.body?.cancel(); } catch { /* ignore */ }
    if (existing > 0) {
      onProgress?.({ bytes: existing, total: existing });
      return { file: destination, bytes: existing, total: existing, url: String(finalUrl || url) };
    }
    throw new Error('The video host rejected the download range');
  }
  const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (type.startsWith('text/html')) {
    try { await response.body?.cancel(); } catch { /* ignore */ }
    throw new Error('The video host returned a web page instead of a video file');
  }
  const append = existing > 0 && response.status === 206;
  const starting = append ? existing : 0;
  let total = 0;
  const range = response.headers?.get?.('content-range') || '';
  const rangeTotal = /\/(\d+)\s*$/.exec(range)?.[1];
  const length = Number(response.headers?.get?.('content-length') || 0) || 0;
  if (rangeTotal) total = Number(rangeTotal);
  else if (length) total = starting + length;
  const downloaded = await streamResponseToFile(response, destination, {
    append,
    signal,
    onBytes: (bytes) => onProgress?.({ bytes: starting + bytes, total }),
  });
  const bytes = starting + downloaded;
  if (total && bytes !== total) throw new Error('The download ended before the file was complete');
  if (!bytes) throw new Error('The video host returned an empty file');
  onProgress?.({ bytes, total: total || bytes });
  return { file: destination, bytes, total: total || bytes, url: String(finalUrl || url) };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(value), 'utf8');
  await rename(temp, file);
}

async function fetchPlaylist(url, context) {
  throwIfAborted(context.signal);
  const { response, url: finalUrl } = await context.safeFetchImpl(url, {
    referer: context.refererFor(url),
    signal: context.signal,
    fetchImpl: context.fetchImpl,
    lookup: context.lookup,
    timeoutMs: 30000,
  });
  const text = (await readCappedResponse(response, PLAYLIST_LIMIT)).toString('utf8');
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('The host did not return an HLS playlist');
  return { text, url: String(finalUrl || url) };
}

function ivForSegment(segment) {
  const raw = String(segment.key?.iv || '').trim();
  if (raw) {
    const hex = raw.replace(/^0x/i, '').padStart(32, '0').slice(-32);
    return Buffer.from(hex, 'hex');
  }
  const iv = Buffer.alloc(16);
  let value = BigInt(segment.sequence || 0);
  for (let i = 15; i >= 0 && value > 0n; i--) {
    iv[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return iv;
}

async function sliceFile(source, destination, byteRange, signal) {
  throwIfAborted(signal);
  await pipeline(
    createReadStream(source, { start: byteRange.start, end: byteRange.end }),
    createWriteStream(destination),
    { signal },
  );
}

async function decryptFile(source, destination, key, iv, signal) {
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  await pipeline(createReadStream(source), decipher, createWriteStream(destination), { signal });
}

async function combineFiles(files, destination, signal) {
  const temp = `${destination}.tmp-${process.pid}`;
  const out = createWriteStream(temp);
  try {
    for (const file of files) {
      throwIfAborted(signal);
      await pipeline(createReadStream(file), out, { end: false, signal });
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    await rename(temp, destination);
    return destination;
  } catch (error) {
    out.destroy();
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeStreamFiles(workDir, prefix) {
  let names = [];
  try { names = await readdir(workDir); } catch { return; }
  await Promise.all(names
    .filter((name) => name.startsWith(`${prefix}-`))
    .map((name) => rm(join(workDir, name), { force: true }).catch(() => {})));
}

export async function downloadHlsMedia({
  url,
  quality = 'best',
  source = '',
  language = 'english',
  refererFor = () => '',
  workDir,
  signal,
  onProgress,
  safeFetchImpl = safeFetch,
  safeGetImpl = safeGet,
  fetchImpl,
  lookup,
  concurrency = 4,
  englishOnlySource = false,
  subtitleSelection = null,
} = {}) {
  if (!workDir) throw new Error('A download work folder is required');
  await mkdir(workDir, { recursive: true });
  const context = { safeFetchImpl, safeGetImpl, fetchImpl, lookup, signal, refererFor };
  const first = await fetchPlaylist(url, context);
  let master = null;
  let variant = null;
  let videoUrl = first.url;
  let videoText = first.text;
  let audioRendition = null;
  let subtitleRenditions = [];

  if (isMasterPlaylist(first.text)) {
    master = parseMasterPlaylist(first.text, first.url);
    variant = selectVariant(master, quality);
    videoUrl = variant.uri;
    audioRendition = selectAudioRendition(master, variant);
    subtitleRenditions = selectSubtitleRenditions(master, variant, { source, language, englishOnlySource, subtitleSelection });
    const video = await fetchPlaylist(videoUrl, context);
    videoText = video.text;
    videoUrl = video.url;
  }

  const videoPlaylist = parseMediaPlaylist(videoText, videoUrl);
  let audioPlaylist = null;
  let audioUrl = '';
  if (audioRendition?.uri) {
    const audio = await fetchPlaylist(audioRendition.uri, context);
    audioUrl = audio.url;
    audioPlaylist = parseMediaPlaylist(audio.text, audioUrl);
  }

  const streams = [{ prefix: 'v', playlist: videoPlaylist, label: 'video' }];
  if (audioPlaylist) streams.push({ prefix: 'a', playlist: audioPlaylist, label: 'audio' });

  for (const stream of streams) {
    if (!stream.playlist.segments.length) throw new Error(`The host did not provide HLS ${stream.label} segments`);
    if (!stream.playlist.endList) throw new Error('Live HLS streams cannot be downloaded');
    for (const segment of stream.playlist.segments) {
      if (segment.key && segment.key.method !== 'AES-128') {
        throw new Error('This video is protected and cannot be downloaded');
      }
      if (segment.key?.keyFormat && segment.key.keyFormat.toLowerCase() !== 'identity') {
        throw new Error('This video is protected and cannot be downloaded');
      }
    }
  }

  const manifestFile = join(workDir, 'hls-manifest.json');
  const manifest = await readJson(manifestFile, { streams: {} });
  if (!manifest.streams || typeof manifest.streams !== 'object') manifest.streams = {};

  const keyCache = new Map();
  const getKey = async (key) => {
    const cacheKey = key.uri;
    if (!keyCache.has(cacheKey)) {
      keyCache.set(cacheKey, (async () => {
        const bytes = await safeGetImpl(key.uri, refererFor(key.uri), KEY_LIMIT, { signal, fetchImpl, lookup });
        if (bytes.length !== 16) throw new Error('The host returned an invalid HLS key');
        return bytes;
      })());
    }
    return keyCache.get(cacheKey);
  };

  let totalParts = 0;
  let completedParts = 0;
  let downloadedBytes = 0;
  const streamPlans = [];

  for (const stream of streams) {
    const parts = [];
    if (stream.playlist.initSegment?.uri) {
      parts.push({
        segment: { ...stream.playlist.initSegment, sequence: stream.playlist.mediaSequence - 1, key: null },
        file: join(workDir, `${stream.prefix}-init.seg`),
      });
    }
    stream.playlist.segments.forEach((segment, index) => {
      parts.push({ segment, file: join(workDir, `${stream.prefix}-${String(index).padStart(6, '0')}.seg`) });
    });
    totalParts += parts.length;
    streamPlans.push({ ...stream, parts, identity: playlistIdentity(stream.playlist) });
  }

  const report = () => onProgress?.({
    bytes: downloadedBytes,
    completedParts,
    totalParts,
    progress: totalParts ? Math.round((completedParts / totalParts) * 100) : 0,
  });

  for (const plan of streamPlans) {
    const same = manifest.streams[plan.prefix]?.identity === plan.identity;
    if (!same) await removeStreamFiles(workDir, plan.prefix);
    manifest.streams[plan.prefix] = { identity: plan.identity, updated: Date.now() };
    await writeJson(manifestFile, manifest);

    for (const part of plan.parts) {
      const size = same ? await fileSize(part.file) : 0;
      if (size > 0) {
        part.done = true;
        part.bytes = size;
        downloadedBytes += size;
        completedParts++;
      }
    }
    report();

    const pending = plan.parts.filter((part) => !part.done);
    let next = 0;
    let failure = null;
    const worker = async () => {
      while (!failure) {
        throwIfAborted(signal);
        const currentIndex = next++;
        if (currentIndex >= pending.length) return;
        const part = pending[currentIndex];
        const segment = part.segment;
        const tempBody = `${part.file}.body-${process.pid}-${currentIndex}`;
        const tempFinal = `${part.file}.part-${process.pid}-${currentIndex}`;
        try {
          const headers = segment.byteRange ? { Range: `bytes=${segment.byteRange.start}-${segment.byteRange.end}` } : {};
          const { response } = await safeFetchImpl(segment.uri, {
            referer: refererFor(segment.uri),
            signal,
            headers,
            fetchImpl,
            lookup,
          });
          let bodyFile = tempBody;
          const received = await streamResponseToFile(response, tempBody, { signal });
          if (segment.byteRange) {
            if (response.status === 200 && received > segment.byteRange.length) {
              const sliced = `${tempBody}.sliced`;
              await sliceFile(tempBody, sliced, segment.byteRange, signal);
              await rm(tempBody, { force: true });
              bodyFile = sliced;
            } else if (received !== segment.byteRange.length) {
              throw new Error('An HLS segment was incomplete');
            }
          }
          if (segment.key) {
            const key = await getKey(segment.key);
            await decryptFile(bodyFile, tempFinal, key, ivForSegment(segment), signal);
            await rm(bodyFile, { force: true });
          } else {
            await rename(bodyFile, tempFinal);
          }
          const size = await fileSize(tempFinal);
          if (!size) throw new Error('An HLS segment was empty');
          await rename(tempFinal, part.file);
          part.done = true;
          part.bytes = size;
          downloadedBytes += size;
          completedParts++;
          report();
        } catch (error) {
          failure = error;
          await rm(tempBody, { force: true }).catch(() => {});
          await rm(`${tempBody}.sliced`, { force: true }).catch(() => {});
          await rm(tempFinal, { force: true }).catch(() => {});
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length || 1)) }, worker));
    if (plan.parts.some((part) => !part.done)) throw new Error('Some HLS segments did not download');

    const combined = join(workDir, `${plan.prefix}-combined.media`);
    const expectedBytes = plan.parts.reduce((sum, part) => sum + (part.bytes || 0), 0);
    if (!same || (await fileSize(combined)) !== expectedBytes) {
      await combineFiles(plan.parts.map((part) => part.file), combined, signal);
    }
    plan.combined = combined;
  }

  const subtitleTracks = [];
  const subtitleErrors = [];
  for (const rendition of subtitleRenditions) {
    try {
      const playlistPage = await fetchPlaylist(rendition.uri, context);
      const playlist = parseMediaPlaylist(playlistPage.text, playlistPage.url);
      if (!playlist.segments.length || playlist.segments.some((segment) => segment.key)) {
        throw new Error('Subtitle playlist is unsupported');
      }
      let offset = 0;
      const parts = [];
      for (const segment of playlist.segments) {
        const bytes = await safeGetImpl(segment.uri, refererFor(segment.uri), SUBTITLE_SEGMENT_LIMIT, { signal, fetchImpl, lookup });
        parts.push({ text: bytes.toString('utf8'), offset });
        offset += segment.duration || 0;
      }
      const content = parts.length === 1
        ? subtitleTextToVtt(parts[0].text, 'text/vtt')
        : mergeVttSegments(parts);
      if (!content.includes('-->')) throw new Error('Subtitle playlist had no cues');
      subtitleTracks.push({
        id: rendition.id || '',
        label: rendition.label || rendition.name || 'Subtitles',
        language: rendition.language,
        mime: 'text/vtt',
        preferred: !!rendition.preferred,
        content,
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      subtitleErrors.push({ label: rendition.label || rendition.name || 'Subtitles', message: String(error?.message || error) });
    }
  }

  const videoPlan = streamPlans.find((plan) => plan.prefix === 'v');
  const audioPlan = streamPlans.find((plan) => plan.prefix === 'a');
  return {
    inputs: [videoPlan.combined, ...(audioPlan ? [audioPlan.combined] : [])],
    separateAudio: !!audioPlan,
    bytes: downloadedBytes,
    duration: videoPlaylist.duration,
    variant,
    qualityLabel: variant?.width && variant?.height ? `${variant.width} x ${variant.height}` : '',
    subtitleTracks,
    subtitleErrors,
    subtitleRenditions,
  };
}

export function isHlsResult(result) {
  const mime = String(result?.mime || '').toLowerCase();
  if (mime.includes('mpegurl') || mime.includes('m3u8')) return true;
  try { return new URL(result.url).pathname.toLowerCase().endsWith('.m3u8'); } catch { return false; }
}

