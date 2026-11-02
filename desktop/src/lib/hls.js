// Small HLS playlist parser for the Windows download engine. It supports
// the ordinary VOD shape Mikozora's supported hosts publish: multivariant
// playlists, separate audio/subtitle renditions, TS/fMP4 segments,
// EXT-X-MAP, byte ranges and AES-128 segment keys.
import { createHash } from 'node:crypto';
import {
  defaultSubtitleSelected, englishOnly, isEnglish, isIndonesian, subtitleLanguageCode,
  subtitleTrackId, subtitleTrackOption, trackMatchesSubtitleSelection,
} from './subtitles.js';

export function parseAttributes(raw) {
  const attrs = {};
  const text = String(raw || '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ',' || /\s/.test(text[i]))) i++;
    const start = i;
    while (i < text.length && text[i] !== '=' && text[i] !== ',') i++;
    const key = text.slice(start, i).trim().toUpperCase();
    if (!key || text[i] !== '=') {
      while (i < text.length && text[i] !== ',') i++;
      continue;
    }
    i++;
    let value = '';
    if (text[i] === '"') {
      i++;
      while (i < text.length && text[i] !== '"') value += text[i++];
      if (text[i] === '"') i++;
    } else {
      const valueStart = i;
      while (i < text.length && text[i] !== ',') i++;
      value = text.slice(valueStart, i).trim();
    }
    attrs[key] = value;
  }
  return attrs;
}

function lines(text) {
  return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim());
}

function absolute(uri, base) {
  try { return new URL(uri, base).href; } catch { return ''; }
}

export function isMasterPlaylist(text) {
  return /^#EXT-X-STREAM-INF:/m.test(String(text || ''));
}

export function parseMasterPlaylist(text, baseUrl = '') {
  const variants = [];
  const media = [];
  const rows = lines(text);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      let uri = '';
      for (let j = i + 1; j < rows.length; j++) {
        if (!rows[j]) continue;
        if (!rows[j].startsWith('#')) { uri = absolute(rows[j], baseUrl); i = j; }
        break;
      }
      const resolution = /^(\d+)x(\d+)$/i.exec(attrs.RESOLUTION || '');
      variants.push({
        uri,
        bandwidth: Number(attrs.BANDWIDTH) || 0,
        averageBandwidth: Number(attrs['AVERAGE-BANDWIDTH']) || 0,
        codecs: attrs.CODECS || '',
        width: resolution ? Number(resolution[1]) : 0,
        height: resolution ? Number(resolution[2]) : 0,
        frameRate: Number(attrs['FRAME-RATE']) || 0,
        audioGroup: attrs.AUDIO || '',
        subtitlesGroup: attrs.SUBTITLES || '',
        attrs,
      });
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      media.push({
        type: (attrs.TYPE || '').toUpperCase(),
        groupId: attrs['GROUP-ID'] || '',
        name: attrs.NAME || '',
        language: attrs.LANGUAGE || '',
        uri: attrs.URI ? absolute(attrs.URI, baseUrl) : '',
        default: /^yes$/i.test(attrs.DEFAULT || ''),
        autoselect: /^yes$/i.test(attrs.AUTOSELECT || ''),
        forced: /^yes$/i.test(attrs.FORCED || ''),
        channels: attrs.CHANNELS || '',
        attrs,
      });
    }
  }
  return { variants, media };
}

export function hlsQualities(master) {
  const found = new Map();
  for (const raw of lines(master)) {
    if (!raw.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrsText = raw.slice(raw.indexOf(':') + 1);
    const match = /(?:^|,)RESOLUTION=([0-9]{2,5})x([0-9]{2,5})(?:,|$)/i.exec(attrsText);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 100 || height < 100 || width > 8192 || height > 4320) continue;
    found.set(`v:${width}x${height}`, { width, height });
  }
  return [...found.entries()]
    .sort((a, b) => b[1].height - a[1].height || b[1].width - a[1].width)
    .map(([id, { width, height }]) => {
      const standard = [144, 240, 288, 360, 480, 576, 720, 1080, 1440, 2160, 4320].includes(height);
      return { id, label: `${standard ? `${height}p - ` : ''}${width} x ${height}` };
    });
}

export function selectVariant(master, quality = 'best') {
  const variants = (master?.variants || []).filter((variant) => variant.uri);
  if (!variants.length) throw new Error('The host did not provide a downloadable HLS variant');
  if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
  if (String(quality).startsWith('v:')) {
    const match = /^v:(\d+)x(\d+)$/.exec(quality);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    const exact = variants.filter((variant) => variant.width === width && variant.height === height);
    if (!exact.length) throw new Error('The selected video quality is unavailable for this episode');
    return exact.sort((a, b) => (b.bandwidth || b.averageBandwidth) - (a.bandwidth || a.averageBandwidth))[0];
  }
  const capped = variants.filter((variant) => (!variant.width || variant.width <= 1920) && (!variant.height || variant.height <= 1080));
  const pool = capped.length ? capped : variants;
  return [...pool].sort((a, b) => (
    (b.height - a.height)
    || ((b.bandwidth || b.averageBandwidth) - (a.bandwidth || a.averageBandwidth))
    || (b.width - a.width)
  ))[0];
}

export function selectAudioRendition(master, variant) {
  if (!variant?.audioGroup) return null;
  const options = (master?.media || []).filter((item) => item.type === 'AUDIO' && item.groupId === variant.audioGroup && item.uri);
  if (!options.length) return null;
  return [...options].sort((a, b) => Number(b.default) - Number(a.default) || Number(b.autoselect) - Number(a.autoselect))[0];
}

// Some hosts publish video-only variants whose EXT-X-STREAM-INF omits the
// AUDIO attribute (or points at a group that does not exist) while the
// master still lists audio renditions. Players pair the default rendition
// anyway; when the downloaded variant turns out to carry no audio, this
// picks the rendition such a player would have used.
export function fallbackAudioRendition(master) {
  const options = (master?.media || []).filter((item) => item.type === 'AUDIO' && item.uri);
  if (!options.length) return null;
  return [...options].sort((a, b) => Number(b.default) - Number(a.default) || Number(b.autoselect) - Number(a.autoselect))[0];
}

export function subtitleRenditions(master, variant) {
  const group = variant?.subtitlesGroup || '';
  const options = (master?.media || []).filter((item) => (
    item.type === 'SUBTITLES'
    && item.uri
    && (!group || item.groupId === group)
  ));
  const seen = new Set();
  const result = [];
  for (const item of options) {
    const language = subtitleLanguageCode(item.language, item.name);
    const label = String(item.name || '').trim() || language;
    const id = subtitleTrackId(language, label);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      ...item,
      id,
      label,
      language,
      mime: 'text/vtt',
      preferred: !!item.default,
    });
  }
  return result;
}

export function subtitleRenditionOptions(master, variant, { source = '' } = {}) {
  return subtitleRenditions(master, variant).map((item) => subtitleTrackOption(
    item,
    defaultSubtitleSelected(source, item, { hls: true }),
  ));
}

export function selectSubtitleRenditions(master, variant, {
  source = '', language = 'english', englishOnlySource = false, subtitleSelection = null,
} = {}) {
  if (!variant?.subtitlesGroup) return [];
  if (subtitleSelection?.mode === 'none') return [];
  const options = subtitleRenditions(master, variant);
  if (subtitleSelection?.mode === 'custom') {
    return options.filter((item) => trackMatchesSubtitleSelection(item, subtitleSelection));
  }
  const selectedCode = language === 'indonesian' ? 'id' : 'en';
  return options
    .filter((item) => {
      const english = isEnglish(item.language, item.label);
      const indonesian = isIndonesian(item.language, item.label);
      return englishOnlySource || englishOnly(source) ? english : english || indonesian;
    })
    .map((item) => ({
      ...item,
      preferred: subtitleLanguageCode(item.language, item.label).split('-')[0] === selectedCode || item.default,
    }));
}

function parseByteRange(raw, previousEnd = 0) {
  const match = /^(\d+)(?:@(\d+))?$/.exec(String(raw || '').trim());
  if (!match) return null;
  const length = Number(match[1]);
  const start = match[2] == null ? previousEnd : Number(match[2]);
  if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start) || start < 0) return null;
  return { start, length, end: start + length - 1 };
}

export function parseMediaPlaylist(text, baseUrl = '') {
  const rows = lines(text);
  let targetDuration = 0;
  let mediaSequence = 0;
  let endList = false;
  let playlistType = '';
  let initSegment = null;
  let pendingDuration = 0;
  let pendingTitle = '';
  let pendingByteRange = null;
  let pendingDiscontinuity = false;
  let currentKey = null;
  let byteRangeEndByUri = new Map();
  const segments = [];

  for (const line of rows) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(line.slice(line.indexOf(':') + 1)) || 0;
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSequence = Number(line.slice(line.indexOf(':') + 1)) || 0;
    else if (line === '#EXT-X-ENDLIST') endList = true;
    else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) playlistType = line.slice(line.indexOf(':') + 1).trim().toUpperCase();
    else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      const method = (attrs.METHOD || 'NONE').toUpperCase();
      currentKey = method === 'NONE' ? null : {
        method,
        uri: attrs.URI ? absolute(attrs.URI, baseUrl) : '',
        iv: attrs.IV || '',
        keyFormat: attrs.KEYFORMAT || '',
      };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      const uri = attrs.URI ? absolute(attrs.URI, baseUrl) : '';
      const previousEnd = byteRangeEndByUri.get(uri) || 0;
      const byteRange = attrs.BYTERANGE ? parseByteRange(attrs.BYTERANGE, previousEnd) : null;
      if (byteRange) byteRangeEndByUri.set(uri, byteRange.end + 1);
      initSegment = { uri, byteRange };
    } else if (line.startsWith('#EXTINF:')) {
      const value = line.slice(line.indexOf(':') + 1);
      const comma = value.indexOf(',');
      pendingDuration = Number(comma < 0 ? value : value.slice(0, comma)) || 0;
      pendingTitle = comma < 0 ? '' : value.slice(comma + 1);
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingByteRange = line.slice(line.indexOf(':') + 1).trim();
    } else if (line === '#EXT-X-DISCONTINUITY') {
      pendingDiscontinuity = true;
    } else if (!line.startsWith('#')) {
      const uri = absolute(line, baseUrl);
      let byteRange = null;
      if (pendingByteRange != null) {
        byteRange = parseByteRange(pendingByteRange, byteRangeEndByUri.get(uri) || 0);
        if (byteRange) byteRangeEndByUri.set(uri, byteRange.end + 1);
      }
      segments.push({
        uri,
        duration: pendingDuration,
        title: pendingTitle,
        sequence: mediaSequence + segments.length,
        byteRange,
        key: currentKey ? { ...currentKey } : null,
        discontinuity: pendingDiscontinuity,
      });
      pendingDuration = 0;
      pendingTitle = '';
      pendingByteRange = null;
      pendingDiscontinuity = false;
    }
  }

  return {
    targetDuration,
    mediaSequence,
    endList,
    playlistType,
    initSegment,
    segments,
    duration: segments.reduce((sum, segment) => sum + (segment.duration || 0), 0),
  };
}

function canonicalUrl(raw) {
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return String(raw || ''); }
}

export function segmentIdentity(segment) {
  return JSON.stringify({
    uri: canonicalUrl(segment?.uri),
    byteRange: segment?.byteRange || null,
    sequence: segment?.sequence || 0,
    key: segment?.key ? {
      method: segment.key.method,
      uri: canonicalUrl(segment.key.uri),
      iv: segment.key.iv || '',
    } : null,
  });
}

export function playlistIdentity(playlist) {
  const payload = JSON.stringify({
    init: playlist?.initSegment ? segmentIdentity(playlist.initSegment) : null,
    segments: (playlist?.segments || []).map(segmentIdentity),
  });
  return createHash('sha256').update(payload).digest('hex');
}
