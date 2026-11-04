// Device-local preferences and exact positions for Mikozora's direct-stream
// online players. Embedded third-party players cannot report a timestamp to
// Mikozora, so these positions are written only by the Android Media3 player
// and the Windows <video>/HLS player. An embed remains an honest fallback.
import { titleKey } from './collections.js';

export const ONLINE_PLAYBACK_KEY = 'moku.onlinePlayback.v1';
export const ONLINE_POSITIONS_KEY = 'moku.onlinePositions.v1';
export const ONLINE_QUALITY_CAPS = [0, 360, 480, 720, 1080, 1440, 2160];
export const ONLINE_PLAYBACK_PREFERENCE_VERSION = 2;
export const DEFAULT_ONLINE_PLAYBACK = Object.freeze({
  preferenceVersion: ONLINE_PLAYBACK_PREFERENCE_VERSION,
  directFirst: false,
  resume: true,
  autoPlayNext: true,
  qualityCap: 0,
  subtitleLanguage: 'english',
});

const MAX_POSITIONS = 500;

function nearest(value, allowed, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  let best = fallback;
  let distance = Infinity;
  for (const candidate of allowed) {
    const nextDistance = Math.abs(candidate - number);
    if (nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return best;
}

export function normalizeOnlinePlayback(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  // Version 1 had no marker and was saved automatically with direct-first on,
  // even when the user had never visited Settings. Move those stored values
  // to the new off-by-default choice once; version 2 values are remembered.
  const migrated = Number(input.preferenceVersion) >= ONLINE_PLAYBACK_PREFERENCE_VERSION;
  return {
    preferenceVersion: ONLINE_PLAYBACK_PREFERENCE_VERSION,
    directFirst: migrated ? input.directFirst === true : false,
    resume: input.resume !== false,
    autoPlayNext: input.autoPlayNext !== false,
    qualityCap: nearest(input.qualityCap, ONLINE_QUALITY_CAPS, DEFAULT_ONLINE_PLAYBACK.qualityCap),
    subtitleLanguage: input.subtitleLanguage === 'indonesian' ? 'indonesian' : 'english',
  };
}

export function readOnlinePlayback(storage) {
  try {
    return normalizeOnlinePlayback(JSON.parse(storage?.getItem?.(ONLINE_PLAYBACK_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_ONLINE_PLAYBACK };
  }
}

export function saveOnlinePlayback(storage, value) {
  const normalized = normalizeOnlinePlayback(value);
  try {
    storage?.setItem?.(ONLINE_PLAYBACK_KEY, JSON.stringify(normalized));
  } catch { /* The current session can still use the normalized value. */ }
  return normalized;
}

export function episodePlaybackKey(item, episode) {
  if (!item?.source || !item?.url || !episode?.url) return '';
  return `${titleKey(item)}\n${episode.url}`;
}

function cleanPosition(value) {
  const input = value && typeof value === 'object' ? value : {};
  const seconds = Math.floor(Number(input.seconds));
  const duration = Math.floor(Number(input.duration));
  const updatedAt = Number(input.updatedAt);
  if (!Number.isFinite(seconds) || seconds <= 5) return null;
  if (Number.isFinite(duration) && duration > 20 && seconds >= duration - 10) return null;
  return {
    seconds,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

export function normalizeOnlinePositions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.includes('|') && key.includes('\n') && key.length <= 5000)
      .map(([key, position]) => [key, cleanPosition(position)])
      .filter(([, position]) => position)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_POSITIONS),
  );
}

export function readOnlinePositions(storage) {
  try {
    return normalizeOnlinePositions(JSON.parse(storage?.getItem?.(ONLINE_POSITIONS_KEY) || 'null'));
  } catch {
    return {};
  }
}

export function saveOnlinePositions(storage, value) {
  const normalized = normalizeOnlinePositions(value);
  try {
    storage?.setItem?.(ONLINE_POSITIONS_KEY, JSON.stringify(normalized));
  } catch { /* Position memory is best-effort. */ }
  return normalized;
}

export function onlinePositionFor(positions, item, episode) {
  const key = episodePlaybackKey(item, episode);
  return key ? normalizeOnlinePositions(positions)[key] || null : null;
}

export function rememberOnlinePosition(positions, item, episode, seconds, duration = 0, now = Date.now(), ended = false) {
  const clean = normalizeOnlinePositions(positions);
  const key = episodePlaybackKey(item, episode);
  if (!key) return clean;
  if (ended) {
    delete clean[key];
    return clean;
  }
  const position = cleanPosition({ seconds, duration, updatedAt: now });
  if (position) clean[key] = position;
  else delete clean[key];
  return normalizeOnlinePositions(clean);
}

export function clearOnlinePosition(positions, item, episode) {
  const clean = normalizeOnlinePositions(positions);
  const key = episodePlaybackKey(item, episode);
  if (key) delete clean[key];
  return clean;
}

export function formatPlaybackClock(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function directStreamKind(stream) {
  const url = String(stream?.url || '');
  const mime = String(stream?.mime || '').toLowerCase();
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  if (parsed.protocol !== 'https:') return '';
  const path = parsed.pathname.toLowerCase();
  if (mime.includes('mpegurl') || mime.includes('vnd.apple.mpegurl') || path.endsWith('.m3u8')) return 'hls';
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(url)) return 'file';
  // Several supported hosts return an extensionless HTTPS media URL with no
  // useful MIME from their API. The native players make the final decision;
  // the shared layer only needs to know this is a plausible direct stream.
  return url.length <= 8192 ? 'file' : '';
}

export function cleanDirectStream(stream) {
  const kind = directStreamKind(stream);
  if (!kind) return null;
  const tracks = (Array.isArray(stream.tracks) ? stream.tracks : []).slice(0, 30).map((track, index) => ({
    index: Number.isInteger(Number(track?.index)) ? Number(track.index) : index,
    label: String(track?.label || track?.name || track?.language || `Subtitle ${index + 1}`).trim().slice(0, 120),
    language: String(track?.language || 'und').trim().toLowerCase().slice(0, 35) || 'und',
    mime: String(track?.mime || '').trim().toLowerCase().slice(0, 80),
    preferred: track?.preferred === true || track?.default === true,
    ...(typeof track?.url === 'string' && track.url.startsWith('https://') ? { url: track.url } : {}),
  }));
  return {
    url: String(stream.url),
    mime: String(stream.mime || ''),
    kind,
    token: typeof stream.token === 'string' ? stream.token.slice(0, 120) : '',
    host: String(stream.host || '').trim().slice(0, 80),
    serverLabel: String(stream.serverLabel || '').trim().slice(0, 120),
    subtitleDescription: String(stream.subtitleDescription || '').trim().slice(0, 240),
    fixedHeight: Math.max(0, Math.min(4320, Math.trunc(Number(stream.fixedHeight) || 0))),
    tracks,
  };
}

export function qualityCapLabel(cap) {
  const clean = normalizeOnlinePlayback({ qualityCap: cap }).qualityCap;
  return clean ? `${clean}p or lower` : 'Best available';
}
