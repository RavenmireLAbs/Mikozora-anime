// Subtitle language policy and text helpers — port of Android's
// SubtitlePolicy.java, plus the small WebVTT conversions the Windows
// offline player needs.
import { createHash } from 'node:crypto';

const ENGLISH_WORD = /(?:^|[^a-z])(?:english|eng)(?:$|[^a-z])/;
const ENGLISH_TAG = /^(?:en|eng)(?:[-_][a-z0-9]{2,8})*$/;
const ENGLISH_ONLY = new Set(['sogo', 'suge', 'anikoto', 'bash', 'rulz', 'waves']);

export function englishOnly(source) {
  return ENGLISH_ONLY.has(String(source || ''));
}

export function languageFor(source, selected) {
  return englishOnly(source) ? 'english' : (selected === 'indonesian' ? 'indonesian' : 'english');
}

export function isEnglish(language, label) {
  const code = String(language || '').trim().toLowerCase();
  if (code && code !== 'und' && code !== 'unknown') {
    return ENGLISH_TAG.test(code) || code === 'english';
  }
  const name = String(label || '').trim().toLowerCase();
  if (/\bnon[-_ ]?english\b/.test(name)) return false;
  return ENGLISH_TAG.test(name)
    || /^(?:en|eng)(?:[-_][a-z0-9]{2,8})?(?:$|[ (\[].*)$/.test(name)
    || ENGLISH_WORD.test(name);
}

export function keepTrack(source, language, label) {
  return !englishOnly(source) || isEnglish(language, label);
}

const LANGUAGE_NAMES = {
  arabic: 'ar', bengali: 'bn', chinese: 'zh', czech: 'cs', danish: 'da',
  dutch: 'nl', filipino: 'fil', finnish: 'fi', french: 'fr', german: 'de',
  greek: 'el', hebrew: 'he', hindi: 'hi', hungarian: 'hu', italian: 'it',
  japanese: 'ja', korean: 'ko', malay: 'ms', norwegian: 'no', persian: 'fa',
  polish: 'pl', portuguese: 'pt', romanian: 'ro', russian: 'ru', spanish: 'es',
  swedish: 'sv', thai: 'th', turkish: 'tr', ukrainian: 'uk', urdu: 'ur',
  vietnamese: 'vi',
};

function cleanSubtitleLabel(label) {
  return String(label || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function subtitleLanguageCode(language, label = '') {
  if (isEnglish(language, label)) return 'en';
  let code = String(language || '').trim().toLowerCase().replaceAll('_', '-');
  if (code === 'ind' || code === 'in') return 'id';
  if (code && code !== 'und' && code !== 'unknown') {
    code = code.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 35);
    if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)) return code;
  }
  const name = `${cleanSubtitleLabel(label).toLowerCase()} ${code}`;
  if (name.includes('indones') || /\bindo\b/.test(name)) return 'id';
  for (const [word, value] of Object.entries(LANGUAGE_NAMES)) {
    if (name.includes(word)) return value;
  }
  return 'und';
}

export function isIndonesian(language, label = '') {
  return subtitleLanguageCode(language, label).split('-')[0] === 'id';
}

// Download choices are made from one representative episode, while actual
// subtitle URLs expire and differ per episode. The durable identity is the
// server-reported language + label, hashed so arbitrary labels stay bounded.
export function subtitleTrackId(language, label = '') {
  const code = subtitleLanguageCode(language, label);
  const name = cleanSubtitleLabel(label).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || code;
  const digest = createHash('sha256').update(`${code}\n${name}`, 'utf8').digest();
  return `s:${digest.subarray(0, 16).toString('hex')}`;
}

export function subtitleTrackOption(track, defaultSelected = false) {
  const language = subtitleLanguageCode(track?.language, track?.label || track?.name || '');
  const label = cleanSubtitleLabel(track?.label || track?.name || '') || language;
  return {
    id: subtitleTrackId(language, label),
    label,
    language,
    preferred: !!track?.preferred || !!track?.default,
    defaultSelected: !!defaultSelected,
  };
}

export function defaultSubtitleSelected(source, track, { hls = false } = {}) {
  if (!hls) return keepTrack(source, track?.language, track?.label || track?.name || '');
  if (englishOnly(source)) return isEnglish(track?.language, track?.label || track?.name || '');
  return isEnglish(track?.language, track?.label || track?.name || '')
    || isIndonesian(track?.language, track?.label || track?.name || '');
}

const SUBTITLE_TRACK_ID = /^s:[a-f0-9]{32}$/;

export function normalizeSubtitleSelection(rawMode, rawTracks, server = 'auto') {
  const mode = rawMode == null || rawMode === '' ? 'auto' : String(rawMode);
  if (!['auto', 'custom', 'none'].includes(mode)) throw new Error('Invalid subtitle selection');
  if (mode !== 'custom') return { mode, tracks: [] };
  if (String(server || 'auto') === 'auto') {
    throw new Error('Choose a server before selecting subtitle tracks');
  }
  if (!Array.isArray(rawTracks) || rawTracks.length < 1 || rawTracks.length > 60) {
    throw new Error('Choose at least one subtitle track');
  }
  const seen = new Set();
  const tracks = [];
  for (const raw of rawTracks) {
    const id = String(raw?.id || '');
    const label = cleanSubtitleLabel(raw?.label || '').slice(0, 160);
    if (!SUBTITLE_TRACK_ID.test(id) || !label || seen.has(id)) {
      if (!SUBTITLE_TRACK_ID.test(id) || !label) throw new Error('Invalid subtitle selection');
      continue;
    }
    seen.add(id);
    tracks.push({ id, label, language: subtitleLanguageCode(raw?.language, label) });
  }
  if (!tracks.length) throw new Error('Choose at least one subtitle track');
  return { mode, tracks };
}

export function storedSubtitleSelection(record) {
  try {
    return normalizeSubtitleSelection(
      record?.subtitleMode,
      record?.subtitleSelection,
      record?.serverChoice || 'selected-server',
    );
  } catch {
    return { mode: 'auto', tracks: [] };
  }
}

export function trackMatchesSubtitleSelection(track, selection) {
  if (selection?.mode !== 'custom') return false;
  const id = track?.id && SUBTITLE_TRACK_ID.test(track.id)
    ? track.id
    : subtitleTrackId(track?.language, track?.label || track?.name || '');
  return selection.tracks.some((chosen) => chosen.id === id);
}

export function keepTrackForSelection(source, selection, language, label) {
  if (!selection || selection.mode === 'auto') return keepTrack(source, language, label);
  if (selection.mode === 'none') return false;
  return trackMatchesSubtitleSelection({ language, label }, selection);
}

export function applyPreferredSubtitle(tracks, selection) {
  const saved = [...(tracks || [])];
  if (selection?.mode !== 'custom' || !saved.length) return saved;
  const preferredId = selection.tracks
    .map((track) => track.id)
    .find((id) => saved.some((track) => subtitleTrackId(track.language, track.label || track.name || '') === id));
  let marked = false;
  return saved.map((track) => {
    const id = subtitleTrackId(track.language, track.label || track.name || '');
    const preferred = !marked && id === preferredId;
    if (preferred) marked = true;
    return { ...track, preferred };
  });
}

export function srtToVtt(raw) {
  let text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return 'WEBVTT\n\n';
  if (/^WEBVTT(?:\s|$)/.test(text)) return `${text}\n`;
  text = text
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/<font[^>]*>/gi, '')
    .replace(/<\/font>/gi, '');
  return `WEBVTT\n\n${text}\n`;
}

function parseTimestamp(value) {
  const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(String(match[4] || '0').padEnd(3, '0'));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function cuesFromVtt(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) continue;
    if (/^WEBVTT\b/.test(lines[0]) || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timeIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeIndex < 0) continue;
    const [startRaw, rest = ''] = lines[timeIndex].split('-->');
    const endMatch = rest.trim().match(/^(\S+)(?:\s+(.*))?$/);
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endMatch?.[1]);
    const body = lines.slice(timeIndex + 1).join('\n').trim();
    if (start == null || end == null || end <= start || !body) continue;
    cues.push({ start, end, settings: endMatch?.[2] || '', text: body });
  }
  return cues;
}

// Segmented HLS WebVTT usually restarts timestamps in each segment. Merge
// cues with the media-playlist offsets, while avoiding a second offset for
// providers that already publish absolute cue times.
export function mergeVttSegments(segments) {
  const seen = new Set();
  const merged = [];
  for (const segment of segments || []) {
    const offset = Math.max(0, Number(segment?.offset) || 0);
    const cues = cuesFromVtt(segment?.text || '');
    const alreadyAbsolute = offset > 0 && cues.length && cues[0].start >= Math.max(0, offset - 0.5);
    const shift = alreadyAbsolute ? 0 : offset;
    for (const cue of cues) {
      const moved = { ...cue, start: cue.start + shift, end: cue.end + shift };
      const key = `${moved.start.toFixed(3)}|${moved.end.toFixed(3)}|${moved.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(moved);
    }
  }
  merged.sort((a, b) => a.start - b.start || a.end - b.end || a.text.localeCompare(b.text));
  const body = merged.map((cue) => (
    `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}${cue.settings ? ` ${cue.settings}` : ''}\n${cue.text}`
  )).join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

export function subtitleTextToVtt(raw, mime = '') {
  const text = String(raw || '');
  if (/^WEBVTT(?:\s|$)/.test(text.replace(/^\uFEFF/, '').trim())) return text;
  if (mime === 'application/x-subrip' || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return srtToVtt(text);
  return srtToVtt(text);
}
