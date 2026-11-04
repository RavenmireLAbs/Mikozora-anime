// Shared preferences for Mikozora's two offline players.
//
// The WebView stores one normalized record on this device. Windows reads it
// directly in its <video> player; Android receives the same bounded values
// as Intent extras when its native player opens.
import { titleKey } from './collections.js';
import { episodeNumberValue } from './episode-tools.js';

export const OFFLINE_PLAYBACK_KEY = 'moku.offlinePlayback.v1';
export const OFFLINE_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const OFFLINE_SEEK_SECONDS = [5, 10, 15, 30];
export const OFFLINE_SLEEP_MINUTES = [0, 5, 10, 15, 30, 45, 60];
export const OFFLINE_SUBTITLE_SIZES = [12, 14, 16, 18, 22, 26, 32];
export const OFFLINE_SUBTITLE_COLORS = [
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'yellow', label: 'Yellow', css: '#ffe45c' },
  { id: 'cyan', label: 'Cyan', css: '#7ce7ff' },
  { id: 'green', label: 'Green', css: '#a8f0a0' },
];
export const OFFLINE_SUBTITLE_BACKGROUNDS = [
  { id: 'shadow', label: 'Soft shadow', css: 'rgba(0, 0, 0, 0.55)' },
  { id: 'solid', label: 'Solid black', css: 'rgba(0, 0, 0, 0.92)' },
  { id: 'none', label: 'No background', css: 'transparent' },
];
export const DEFAULT_OFFLINE_PLAYBACK = Object.freeze({
  playbackRate: 1,
  seekSeconds: 10,
  subtitleSize: 18,
  subtitleColor: 'white',
  subtitleBackground: 'shadow',
  sleepTimerMinutes: 0,
  autoPlayNext: true,
});

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

function allowedId(value, options, fallback) {
  return options.some(option => option.id === value) ? value : fallback;
}

export function normalizeOfflinePlayback(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    playbackRate: nearest(input.playbackRate, OFFLINE_PLAYBACK_RATES, DEFAULT_OFFLINE_PLAYBACK.playbackRate),
    seekSeconds: nearest(input.seekSeconds, OFFLINE_SEEK_SECONDS, DEFAULT_OFFLINE_PLAYBACK.seekSeconds),
    subtitleSize: nearest(input.subtitleSize, OFFLINE_SUBTITLE_SIZES, DEFAULT_OFFLINE_PLAYBACK.subtitleSize),
    subtitleColor: allowedId(input.subtitleColor, OFFLINE_SUBTITLE_COLORS, DEFAULT_OFFLINE_PLAYBACK.subtitleColor),
    subtitleBackground: allowedId(
      input.subtitleBackground,
      OFFLINE_SUBTITLE_BACKGROUNDS,
      DEFAULT_OFFLINE_PLAYBACK.subtitleBackground,
    ),
    sleepTimerMinutes: nearest(
      input.sleepTimerMinutes,
      OFFLINE_SLEEP_MINUTES,
      DEFAULT_OFFLINE_PLAYBACK.sleepTimerMinutes,
    ),
    autoPlayNext: input.autoPlayNext !== false,
  };
}

export function readOfflinePlayback(storage) {
  try {
    return normalizeOfflinePlayback(JSON.parse(storage?.getItem?.(OFFLINE_PLAYBACK_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_OFFLINE_PLAYBACK };
  }
}

export function saveOfflinePlayback(storage, value) {
  const normalized = normalizeOfflinePlayback(value);
  try {
    storage?.setItem?.(OFFLINE_PLAYBACK_KEY, JSON.stringify(normalized));
  } catch { /* The current session can still use the normalized value. */ }
  return normalized;
}

export function subtitleColorCss(colorId) {
  return OFFLINE_SUBTITLE_COLORS.find(color => color.id === colorId)?.css || OFFLINE_SUBTITLE_COLORS[0].css;
}

export function subtitleBackgroundCss(backgroundId) {
  return OFFLINE_SUBTITLE_BACKGROUNDS.find(background => background.id === backgroundId)?.css
    || OFFLINE_SUBTITLE_BACKGROUNDS[0].css;
}

export function offlineSubtitleStyle(prefs) {
  const clean = normalizeOfflinePlayback(prefs);
  return {
    '--offline-subtitle-color': subtitleColorCss(clean.subtitleColor),
    '--offline-subtitle-background': subtitleBackgroundCss(clean.subtitleBackground),
    '--offline-subtitle-size': `${clean.subtitleSize}px`,
  };
}

function keyOfItem(item) {
  return item?.source && item?.url ? titleKey(item) : '';
}

export function downloadedEpisodesForTitle(downloads, current) {
  const key = keyOfItem(current?.item);
  if (!key) return [];
  const seen = new Set();
  return (Array.isArray(downloads) ? downloads : [])
    .filter(record => record?.status === 'completed' && record?.episode?.url && keyOfItem(record.item) === key)
    .filter(record => !seen.has(record.episode.url) && seen.add(record.episode.url))
    .sort((a, b) => episodeNumberValue(a.episode) - episodeNumberValue(b.episode)
      || String(a.episode.url).localeCompare(String(b.episode.url)));
}

export function nextDownloadedEpisodes(downloads, current, limit = 20) {
  const ordered = downloadedEpisodesForTitle(downloads, current);
  const index = ordered.findIndex(record => record.id === current?.id || record.episode?.url === current?.episode?.url);
  if (index < 0) return [];
  return ordered.slice(index + 1, index + 1 + Math.max(0, Math.trunc(Number(limit) || 0)));
}

export function offlinePlaybackPayload(prefs, nextDownloads = []) {
  const clean = normalizeOfflinePlayback(prefs);
  return {
    ...clean,
    nextDownloadIds: (Array.isArray(nextDownloads) ? nextDownloads : [])
      .map(record => String(record?.id || record || ''))
      .filter(id => /^[a-f0-9]{32}$/.test(id))
      .slice(0, 50),
  };
}
