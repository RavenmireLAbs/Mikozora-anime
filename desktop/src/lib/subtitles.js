// Subtitle language policy and text helpers — port of Android's
// SubtitlePolicy.java, plus the small WebVTT conversions the Windows
// offline player needs.

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
