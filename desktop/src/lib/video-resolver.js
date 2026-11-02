// Windows port of Android's VideoResolver.java.
//
// Only hosts/provider flows that publish a directly downloadable HLS/file
// URL are supported, exactly as on Android. Source pages use the allowlisted
// desktop HTTP port; provider pages/APIs and subtitle files use SafeHttp.
import { createDecipheriv, createHmac } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { allowedSource, isHttps, matchesSource, sourceBase, sourceName } from './allowlist.js';
import { getText } from './http.js';
import { safeText } from './safe-http.js';
import { hlsQualities } from './hls.js';
import { isEnglish, keepTrack } from './subtitles.js';

const LIMIT = 2 * 1024 * 1024;

function makeResult(patch = {}) {
  return {
    url: '', mime: '', referer: '', host: '', serverLabel: '', subtitleDescription: '',
    fixedHeight: -1, tracks: [], files: [], ...patch,
  };
}

function q(value) {
  return encodeURIComponent(String(value ?? ''))
    .replace(/%20/g, '+')
    .replace(/[!'()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hostIs(raw, host) {
  try { return isHttps(raw) && new URL(raw).hostname.toLowerCase() === host.toLowerCase(); }
  catch { return false; }
}

function doc(html) {
  return parseHTML(String(html || '')).document;
}

function ownText(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function allText(parent, selector) {
  return [...(parent?.querySelectorAll?.(selector) || [])].map(ownText).filter(Boolean).join(' ');
}

function htmlAttr(el, name) {
  return el?.getAttribute?.(name) || '';
}

function absolute(raw, base) {
  try { return new URL(String(raw || ''), base).href; } catch { return ''; }
}

function normalizedHttpUrl(raw, base) {
  const parsed = new URL(String(raw || '').trim(), base);
  if (parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
    parsed.port = '';
    parsed.username = '';
    parsed.password = '';
  }
  return parsed;
}

export function subtitleTracksForDownload(result, source) {
  return (result?.tracks || []).filter((track) => keepTrack(source, track.language, track.label));
}

export function validateSelection(server, quality) {
  if (!/^(?:auto|(?:sogo|suge|anikoto|rulz|waves|bash|xin|narul|stream|world)-[a-z0-9-]{1,90})$/.test(String(server || ''))) {
    throw new Error('Invalid download server');
  }
  if (!/^(?:best|v:[0-9]{2,5}x[0-9]{2,5}|f:[0-9]{3,4})$/.test(String(quality || ''))) {
    throw new Error('Invalid download quality');
  }
}

function slug(label) {
  let text = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!text) text = 'server';
  return text.length > 42 ? text.slice(0, 42) : text;
}

function stableId(prefix, label, counts) {
  const base = `${prefix}-${slug(label)}`;
  const next = counts.get(base) || 0;
  counts.set(base, next + 1);
  return `${base}-${next}`;
}

export function matchesLanguage(label, language) {
  const text = String(label || '').toLowerCase();
  if (language === 'indonesian') return text.includes('indonesia') || /\bindo\b/.test(text);
  return text.includes('english') || /\beng\b/.test(text);
}

function labelHeight(value) {
  const text = String(value || '').toLowerCase();
  const match = /(?<![0-9])([0-9]{3,4})\s*p?(?![0-9])/.exec(text);
  if (match) {
    const height = Number(match[1]);
    if (height >= 144 && height <= 4320) return height;
  }
  if (text.includes('full hd') || text === 'fhd') return 1080;
  if (text === 'hd') return 720;
  if (text === 'sd') return 480;
  return -1;
}

function chooseFile(files, quality) {
  if (String(quality).startsWith('v:')) throw new Error('This server provides fixed video files, not that adaptive quality');
  if (!files?.length) throw new Error('The server did not provide a video file');
  if (String(quality).startsWith('f:')) {
    const requested = Number(String(quality).slice(2));
    const exact = files.find((file) => file.height === requested);
    if (!exact) throw new Error('The chosen file quality is not available for this episode');
    return exact;
  }
  return [...files].sort((a, b) => b.height - a.height)[0];
}

export function fileQualities(files) {
  const values = [];
  for (const file of files || []) {
    if (file.height >= 144 && file.height <= 4320 && !values.includes(file.height)) values.push(file.height);
  }
  return values.sort((a, b) => b - a).map((height) => ({ id: `f:${height}`, label: `${height}p - source file` }));
}

function languageCode(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('arabic')) return 'ar';
  if (text.includes('french')) return 'fr';
  if (text.includes('german')) return 'de';
  if (text.includes('spanish')) return 'es';
  if (text.includes('portuguese')) return 'pt';
  if (text.includes('italian')) return 'it';
  if (text.includes('russian')) return 'ru';
  if (text.includes('japanese')) return 'ja';
  return 'und';
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

export function megaSource(data, nowMs = Date.now()) {
  let file = '';
  let decrypted = false;
  const enc = typeof data?.enc === 'string' ? data.enc : '';
  if (enc) {
    try {
      const key = Buffer.alloc(32);
      Buffer.from('i?LMTAx0Q6,:}50U', 'utf8').copy(key);
      const iv = Buffer.from("W0;27ToaUpl_P%'c", 'utf8');
      const encrypted = Buffer.from(enc.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      const decipher = createDecipheriv('aes-256-cbc', key, iv);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8').trim();
      if (plain.startsWith('{')) file = JSON.parse(plain)?.file || '';
      else if (plain.startsWith('[')) file = JSON.parse(plain)?.[0]?.file || '';
      decrypted = !!file;
    } catch {
      file = '';
      decrypted = false;
    }
  }
  if (!file) {
    const source = data?.sources;
    if (typeof source === 'string') file = source;
    else if (source && typeof source === 'object' && !Array.isArray(source)) file = source.file || '';
    else if (Array.isArray(source)) {
      const first = source[0];
      file = typeof first === 'string' ? first : first?.file || '';
    }
  }
  if (!decrypted || /[?&]token=/i.test(file)) return file;
  const match = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i.exec(file);
  if (!match) return file;
  const payload = `${Math.floor(nowMs / 1000) + 12 * 3600}|${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
  const signature = createHmac('sha256', 'MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s').update(payload, 'utf8').digest();
  const token = `${base64Url(Buffer.from(payload, 'utf8'))}.${base64Url(signature)}`;
  return `${file}${file.includes('?') ? '&' : '?'}token=${q(token)}`;
}

export function mediafireFiles(episode, language, base = 'https://animexin.dev/') {
  const document = typeof episode === 'string' ? doc(episode) : (episode?.nodeType ? episode : episode?.document || episode);
  const result = [];
  for (const group of document?.querySelectorAll?.('.soradlg, .soraddlx') || []) {
    if (!matchesLanguage(allText(group, '.sorattlx, h3, h4'), language)) continue;
    let rows = [...group.querySelectorAll('.soraurlx')];
    if (!rows.length) rows = [group];
    for (const row of rows) {
      const height = labelHeight(allText(row, 'strong'));
      for (const anchor of row.querySelectorAll('a[href]')) {
        const raw = absolute(htmlAttr(anchor, 'href'), base);
        if (!hostIs(raw, 'www.mediafire.com') && !hostIs(raw, 'mediafire.com')) continue;
        if (!result.some((prior) => prior.url === raw)) result.push({ url: raw, height });
      }
    }
  }
  return result;
}

export function mediafireFile(html, base = '') {
  const document = doc(html);
  const anchor = document.querySelector('#downloadButton[href]');
  if (!anchor) return '';
  const url = absolute(htmlAttr(anchor, 'href'), base);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (isHttps(url) && (host === 'mediafire.com' || host.endsWith('.mediafire.com'))
      && ['.mp4', '.m4v', '.webm', '.mkv'].some((ext) => path.endsWith(ext))) return url;
  } catch { /* unsupported */ }
  return '';
}

function decodeBase64Text(raw) {
  return Buffer.from(String(raw || '').replace(/\s+/g, ''), 'base64').toString('utf8');
}

export function createVideoResolver({
  sourceGetText = (url, options = {}) => getText(url, undefined, options),
  hostText = (url, referer, limit, options = {}) => safeText(url, referer, limit, options),
  now = Date.now,
} = {}) {
  async function sourceJson(url, signal) {
    return JSON.parse(await sourceGetText(url, { signal }));
  }

  async function hostJson(url, referer, signal, limit = LIMIT) {
    return JSON.parse(await hostText(url, referer, limit, { signal }));
  }

  async function candidates(item, episode, language, signal) {
    const source = String(item?.source || '');
    const episodeUrl = String(episode?.url || '');
    if (!allowedSource(episodeUrl)) throw new Error('Episode URL is not a configured source');
    if (!matchesSource(source, episodeUrl)) throw new Error('Episode source does not match its URL');
    if (['sogo', 'suge', 'anikoto'].includes(source)) return sogoCandidates(episode, source, signal);
    if (source === 'xin') return xinCandidates(episode, language, signal);
    if (source === 'bash') return bashCandidates(episode, signal);
    if (['rulz', 'narul', 'stream', 'world'].includes(source)) return wordpressCandidates(episode, source, signal);
    if (source === 'waves') return wavesCandidates(episode, signal);
    throw new Error('Episode source does not match its URL');
  }

  async function sogoCandidates(episode, source, signal) {
    const ids = String(episode?.ids || '');
    if (!ids || ids.length > 1000) throw new Error(`${sourceName(source)} did not provide server information`);
    const base = sourceBase(source);
    const list = await sourceJson(`${base}/ajax/server/list?servers=${q(ids)}`, signal);
    const document = doc(list?.result || '');
    const out = [];
    const counts = new Map();
    for (const group of document.querySelectorAll('.type')) {
      if ((htmlAttr(group, 'data-type') || '').toLowerCase() !== 'sub') continue;
      for (const anchor of group.querySelectorAll('[data-link-id]')) {
        if (out.length >= 12) break;
        const id = htmlAttr(anchor, 'data-link-id');
        const label = (ownText(anchor.querySelector('span')) || ownText(anchor) || 'Server').trim();
        if (!id || id.length > 1000) continue;
        out.push({ id: stableId(source, label, counts), label, provider: 'megaplay', reference: id, source, files: [] });
      }
    }
    if (!out.length) throw new Error(`No subtitled ${sourceName(source)} server was listed`);
    return out;
  }

  async function wavesCandidates(episode, signal) {
    const ids = String(episode?.ids || '');
    const parts = /^([0-9]{1,12})&eps=([0-9]{1,7}(?:\.[0-9]{1,3})?)$/.exec(ids);
    if (!parts) throw new Error('Aniwaves did not provide valid episode server information');
    const json = await sourceJson(`${sourceBase('waves')}/ajax/server/list?servers=${parts[1]}&eps=${parts[2]}`, signal);
    const document = doc(json?.result || '');
    const out = [];
    const counts = new Map();
    for (const group of document.querySelectorAll('.type[data-type]')) {
      if ((htmlAttr(group, 'data-type') || '').toLowerCase() !== 'sub') continue;
      for (const el of group.querySelectorAll('[data-link-id]')) {
        const id = htmlAttr(el, 'data-link-id');
        const label = ownText(el) || 'Server';
        if (!id || id.length > 1000 || out.length >= 12) continue;
        out.push({ id: stableId('waves', label, counts), label, provider: 'echo', reference: id, source: 'waves', files: [] });
      }
    }
    if (!out.length) throw new Error('No subtitled Aniwaves servers were listed');
    return out;
  }

  async function bashCandidates(episode, signal) {
    let url;
    try { url = new URL(episode?.url || ''); } catch { throw new Error('AnimeBash did not provide a valid episode'); }
    const match = /^\/anime\/([0-9]{1,10})\/([0-9]{1,7})\/?$/.exec(url.pathname);
    if (!match) throw new Error('AnimeBash did not provide a valid episode');
    const data = await sourceJson(`${sourceBase('bash')}/api/watch/${match[1]}/${match[2]}`, signal);
    const sub = data?.sub || null;
    const out = [];
    const counts = new Map();
    if (sub) {
      for (const key of ['MEG1', 'MEG2']) {
        const embed = String(sub[key] || '');
        let path = '';
        try { path = new URL(embed).pathname; } catch { /* unsupported */ }
        if (!hostIs(embed, 'megaplay.buzz') || !path.includes('/stream/')) continue;
        if (!out.some((old) => old.reference === embed)) {
          out.push({ id: stableId('bash', key, counts), label: key, provider: 'direct-mega', reference: embed, source: 'bash', files: [] });
        }
      }
    }
    if (!out.length) throw new Error('No compatible subtitled AnimeBash download server was listed');
    return out;
  }

  function addWordpressCandidate(out, counts, source, episodeUrl, label, raw) {
    if (!String(raw || '').trim() || out.length >= 12) return;
    try {
      const parsed = normalizedHttpUrl(raw, episodeUrl);
      const url = parsed.href;
      const host = parsed.hostname.toLowerCase();
      if (!isHttps(url)) return;
      const provider = host === 'dailymotion.com' || host.endsWith('.dailymotion.com') ? 'dailymotion'
        : host === 'ok.ru' || host === 'www.ok.ru' ? 'okru'
          : host === 'gogoanime.com.by' ? 'gogomega'
            : host === 'megaplay.buzz' ? 'direct-mega' : '';
      if (!provider || (source === 'rulz' && String(label || '').toLowerCase().includes('dub'))) return;
      if (out.some((old) => old.reference === url)) return;
      const title = String(label || '').trim() || 'Default server';
      out.push({ id: stableId(`${source}-${provider}`, title, counts), label: title, provider, reference: url, source, files: [] });
    } catch { /* unsupported candidate */ }
  }

  function addWordpressFragment(out, counts, source, url, label, encoded) {
    if (!String(encoded || '').trim()) return;
    try {
      const encodedText = String(encoded);
      const decoded = encodedText.startsWith('https://') || encodedText.startsWith('//')
        ? encodedText
        : decodeBase64Text(encodedText);
      const raw = decoded.trim();
      if (raw.startsWith('https://') || raw.startsWith('//')) {
        addWordpressCandidate(out, counts, source, url, label, raw);
        return;
      }
      const fragment = doc(decoded);
      for (const frame of fragment.querySelectorAll('iframe[src],iframe[data-src],iframe[data-litespeed-src],video[src],source[src]')) {
        const value = htmlAttr(frame, 'data-litespeed-src') || htmlAttr(frame, 'data-src') || htmlAttr(frame, 'src');
        addWordpressCandidate(out, counts, source, url, label, value);
      }
    } catch { /* unsupported fragment */ }
  }

  async function wordpressCandidates(episode, source, signal) {
    const url = String(episode?.url || '');
    const document = doc(await sourceGetText(url, { signal }));
    const out = [];
    const counts = new Map();
    for (const option of document.querySelectorAll('select.mirror option[value]')) {
      addWordpressFragment(out, counts, source, url, ownText(option), htmlAttr(option, 'value'));
    }
    for (const option of document.querySelectorAll('[data-hash]')) {
      addWordpressFragment(out, counts, source, url, ownText(option), htmlAttr(option, 'data-hash'));
    }
    const frame = document.querySelector('#pembed iframe');
    if (frame) {
      const raw = htmlAttr(frame, 'data-litespeed-src') || htmlAttr(frame, 'data-src') || htmlAttr(frame, 'src');
      addWordpressCandidate(out, counts, source, url, 'Default server', raw);
    }
    if (!out.length) throw new Error('No compatible download server was listed for this episode. Playback may still work.');
    return out;
  }

  async function xinCandidates(episode, language, signal) {
    const url = String(episode?.url || '');
    const document = doc(await sourceGetText(url, { signal }));
    const out = [];
    const counts = new Map();
    const files = mediafireFiles(document, language, url);
    if (files.length) {
      out.push({
        id: 'xin-mediafire',
        label: language === 'indonesian' ? 'MediaFire - Indonesian subtitles' : 'MediaFire - English subtitles',
        provider: 'mediafire', reference: '', source: '', files: [...files],
      });
    }
    for (const option of document.querySelectorAll('select.mirror option[value]')) {
      if (out.length >= 12) break;
      const label = ownText(option);
      if (!matchesLanguage(label, language)) continue;
      const value = htmlAttr(option, 'value').trim();
      if (!value) continue;
      try {
        const decoded = value.startsWith('https://') || value.startsWith('//') ? value : decodeBase64Text(value);
        let raw = decoded.trim();
        if (!raw.startsWith('https://') && !raw.startsWith('//')) {
          const fragment = doc(decoded);
          const frame = fragment.querySelector('iframe[src],iframe[data-src],iframe[data-lazy-src]');
          raw = htmlAttr(frame, 'src') || htmlAttr(frame, 'data-src') || htmlAttr(frame, 'data-lazy-src');
        }
        if (!raw) continue;
        const parsed = normalizedHttpUrl(raw, url);
        if (!isHttps(parsed.href)) continue;
        const host = parsed.hostname.toLowerCase();
        const provider = host === 'dailymotion.com' || host.endsWith('.dailymotion.com') ? 'dailymotion'
          : host === 'ok.ru' || host === 'www.ok.ru' ? 'okru' : '';
        if (!provider) continue;
        out.push({ id: stableId(`xin-${provider}`, label, counts), label, provider, reference: parsed.href, source: '', files: [] });
      } catch { /* unsupported candidate */ }
    }
    if (!out.length) throw new Error('No supported download server was listed for the selected subtitle language');
    return out;
  }

  async function megaPlay(embed, referer = 'https://animesogo.to/', signal) {
    if (!hostIs(embed, 'megaplay.buzz')) throw new Error('Unsupported MegaPlay host');
    const page = await hostText(embed, referer, LIMIT, { signal });
    const document = doc(page);
    let mediaId = htmlAttr(document.querySelector('[data-id]'), 'data-id');
    if (!mediaId) {
      const match = /File\s+(\d+)/i.exec(page);
      if (match) mediaId = match[1];
    }
    if (!mediaId || mediaId.length > 150) throw new Error('MegaPlay did not provide a media ID');
    const serverMatch = /(?:\?|&)s=([A-Za-z0-9_-]+)/.exec(embed);
    const server = serverMatch ? `&s=${q(serverMatch[1])}` : '';
    const data = await hostJson(`https://megaplay.buzz/stream/getSources?id=${q(mediaId)}${server}`, embed, signal);
    const file = megaSource(data, now());
    if (!isHttps(file)) throw new Error('MegaPlay did not provide a supported HLS stream');
    const result = makeResult({ url: file, mime: 'application/x-mpegURL', referer: 'https://megaplay.buzz/', host: 'MegaPlay' });
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    for (const track of tracks.slice(0, 30)) {
      if (!track || typeof track !== 'object') continue;
      const kind = String(track.kind || '');
      let label = String(track.label || '').trim();
      const url = String(track.file || '');
      const declared = String(track.language || track.lang || track.srclang || '').trim();
      if ((!/^captions$/i.test(kind) && !/^subtitles$/i.test(kind)) || !isHttps(url)) continue;
      const english = isEnglish(declared, label);
      if (!label) label = english ? 'English' : declared;
      if (!label) continue;
      const code = declared.toLowerCase().replaceAll('_', '-');
      const lang = english ? 'en'
        : code && code !== 'und' && code !== 'unknown' ? code
          : label.toLowerCase().includes('indones') ? 'id' : languageCode(label.toLowerCase());
      result.tracks.push({
        url,
        label,
        language: lang,
        mime: url.toLowerCase().includes('.srt') ? 'application/x-subrip' : 'text/vtt',
        preferred: !!track.default || english,
      });
    }
    result.subtitleDescription = result.tracks.length ? 'Available subtitle tracks' : 'No subtitle tracks provided';
    return result;
  }

  async function echoVideo(embed, signal) {
    if (!hostIs(embed, 'play.echovideo.ru')) throw new Error('This Aniwaves server is not a supported EchoVideo mirror');
    const url = new URL(embed);
    if (!/^\/embed-[0-9]{1,3}\/[A-Za-z0-9_-]{1,1000}\/?$/.test(url.pathname)) throw new Error('Unsupported EchoVideo embed');
    const page = doc(await hostText(embed, `${sourceBase('waves')}/`, LIMIT, { signal }));
    const id = htmlAttr(page.querySelector('#screen[data-id]'), 'data-id');
    if (!id || id.length > 1000) throw new Error('EchoVideo did not return a source ID');
    const endpoint = new URL(`getSources?id=${q(id)}`, url).href;
    if (!hostIs(endpoint, 'play.echovideo.ru')) throw new Error('Unsupported EchoVideo source endpoint');
    const data = await hostJson(endpoint, embed, signal);
    const file = megaSource(data, now());
    if (!isHttps(file)) throw new Error('EchoVideo did not return a supported video stream');
    const result = makeResult({ url: file, mime: 'application/x-mpegURL', host: 'EchoVideo', referer: 'https://play.echovideo.ru/' });
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    for (const track of tracks.slice(0, 60)) {
      if (!track || typeof track !== 'object') continue;
      const kind = String(track.kind || '');
      let label = String(track.label || '').trim();
      const declared = String(track.language || track.lang || track.srclang || '').trim();
      if (!/^captions$/i.test(kind) && !/^subtitles$/i.test(kind)) continue;
      const subtitle = absolute(track.file || '', url);
      if (!isHttps(subtitle)) continue;
      const english = isEnglish(declared, label);
      if (!label) label = english ? 'English' : declared;
      if (!label) continue;
      result.tracks.push({
        url: subtitle,
        label,
        language: english ? 'en' : declared || languageCode(label.toLowerCase()),
        mime: subtitle.toLowerCase().includes('.srt') ? 'application/x-subrip' : 'text/vtt',
        preferred: !!track.default || english,
      });
    }
    result.subtitleDescription = result.tracks.length ? 'Available subtitle tracks' : 'No separate subtitle tracks provided';
    return result;
  }

  async function okru(embed, quality, signal) {
    let parsed;
    try { parsed = new URL(embed); } catch { throw new Error('Unsupported OK.ru video'); }
    const host = parsed.hostname.toLowerCase();
    if (!isHttps(embed) || (host !== 'ok.ru' && host !== 'www.ok.ru') || !parsed.pathname.startsWith('/videoembed/')) {
      throw new Error('Unsupported OK.ru video');
    }
    const document = doc(await hostText(embed, 'https://animexin.dev/', LIMIT, { signal }));
    const element = document.querySelector('[data-options]');
    if (!element) throw new Error('OK.ru did not provide video metadata');
    const options = JSON.parse(htmlAttr(element, 'data-options'));
    const raw = options?.flashvars?.metadata;
    const metadata = raw && typeof raw === 'object' ? raw : typeof raw === 'string' ? JSON.parse(raw) : null;
    const files = [];
    for (const video of (Array.isArray(metadata?.videos) ? metadata.videos.slice(0, 20) : [])) {
      if (!video || typeof video !== 'object') continue;
      const file = String(video.url || '');
      const name = String(video.name || '').toLowerCase();
      if (!isHttps(file)) continue;
      const height = name === 'full' ? 1080 : name === 'hd' ? 720 : name === 'sd' ? 480
        : name === 'low' ? 360 : name === 'lowest' ? 240 : name === 'mobile' ? 144
          : name === 'ultra' || name === 'uhd' ? 2160 : labelHeight(name);
      files.push({ url: file, height });
    }
    const choice = chooseFile(files, quality);
    return makeResult({
      url: choice.url, mime: 'video/mp4', host: 'OK.ru', referer: 'https://ok.ru/',
      fixedHeight: choice.height, files: [...files],
    });
  }

  async function dailyMotion(embed, signal) {
    const match = /(?:[?&]video=|\/(?:embed\/video|video)\/)([A-Za-z0-9]+)/i.exec(String(embed || ''));
    if (!match) throw new Error('Dailymotion did not provide a video ID');
    const data = await hostJson(
      `https://www.dailymotion.com/player/metadata/video/${match[1]}`,
      'https://www.dailymotion.com/', signal,
    );
    if (data?.protected_delivery) throw new Error('This video is protected and cannot be downloaded');
    const auto = data?.qualities?.auto;
    if (Array.isArray(auto)) {
      for (const source of auto) {
        if (!source || typeof source !== 'object') continue;
        const file = String(source.url || '');
        const type = String(source.type || '');
        if (isHttps(file) && (/mpegurl/i.test(type) || file.includes('.m3u8'))) {
          return makeResult({ url: file, mime: 'application/x-mpegURL', host: 'Dailymotion', referer: 'https://www.dailymotion.com/' });
        }
      }
    }
    throw new Error('Dailymotion did not provide an unprotected HLS stream');
  }

  async function resolveCandidate(candidate, quality, signal) {
    let result;
    switch (candidate.provider) {
      case 'megaplay': {
        if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
        const base = sourceBase(candidate.source);
        if (!base) throw new Error('Unsupported source');
        const server = await sourceJson(`${base}/ajax/server?get=${q(candidate.reference)}`, signal);
        const embed = String(server?.result?.url || '');
        let path = '';
        try { path = new URL(embed).pathname; } catch { /* unsupported */ }
        if (!hostIs(embed, 'megaplay.buzz') || !path.includes('/stream/')) throw new Error('This server is not a supported MegaPlay mirror');
        result = await megaPlay(embed, `${base}/`, signal);
        break;
      }
      case 'echo': {
        if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
        const info = await sourceJson(`${sourceBase('waves')}/ajax/sources?id=${q(candidate.reference)}&asi=0&autoPlay=0`, signal);
        result = await echoVideo(String(info?.result?.url || ''), signal);
        break;
      }
      case 'direct-mega': {
        if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
        let path = '';
        try { path = new URL(candidate.reference).pathname; } catch { /* unsupported */ }
        if (!hostIs(candidate.reference, 'megaplay.buzz') || !path.includes('/stream/')) throw new Error('Unsupported MegaPlay mirror');
        result = await megaPlay(candidate.reference, `${sourceBase(candidate.source)}/`, signal);
        break;
      }
      case 'gogomega': {
        if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
        if (!hostIs(candidate.reference, 'gogoanime.com.by')) throw new Error('Unsupported GogoAnime mirror');
        const page = await hostText(candidate.reference, `${sourceBase(candidate.source)}/`, LIMIT, { signal });
        const wrapper = doc(page);
        const frame = wrapper.querySelector('iframe[src]');
        const embed = frame ? absolute(htmlAttr(frame, 'src'), candidate.reference) : '';
        let path = '';
        try { path = new URL(embed).pathname; } catch { /* unsupported */ }
        if (!hostIs(embed, 'megaplay.buzz') || !path.includes('/stream/')) throw new Error('This server did not return a supported video');
        result = await megaPlay(embed, candidate.reference, signal);
        break;
      }
      case 'mediafire': {
        const choice = chooseFile(candidate.files, quality);
        const html = await hostText(choice.url, 'https://animexin.dev/', 3 * 1024 * 1024, { signal });
        const file = mediafireFile(html, choice.url);
        if (!file) throw new Error('MediaFire did not return a supported video file');
        result = makeResult({
          url: file, mime: '', host: 'MediaFire', referer: 'https://www.mediafire.com/',
          fixedHeight: choice.height, files: [...candidate.files],
        });
        break;
      }
      case 'dailymotion':
        if (String(quality).startsWith('f:')) throw new Error('This server does not provide that file quality');
        result = await dailyMotion(candidate.reference, signal);
        break;
      case 'okru':
        result = await okru(candidate.reference, quality, signal);
        break;
      default:
        throw new Error('Unsupported download server');
    }
    result.serverLabel = candidate.label;
    if (candidate.source === 'xin' || !candidate.source) {
      if (candidate.provider !== 'megaplay') {
        result.subtitleDescription = candidate.label.toLowerCase().includes('indonesia')
          ? 'Indonesian subtitles burned in'
          : 'English subtitles burned in';
      }
    } else if (['dailymotion', 'okru', 'mediafire'].includes(candidate.provider)) {
      result.subtitleDescription = 'Subtitle availability depends on the selected server';
    }
    return result;
  }

  async function resolve(item, episode, language = 'english', server = 'auto', quality = 'best', options = {}) {
    validateSelection(server, quality);
    if (server === 'auto' && quality !== 'best') throw new Error('Choose a server before selecting a specific quality');
    const list = await candidates(item, episode, language, options.signal);
    let last = '';
    let found = false;
    for (const candidate of list) {
      if (server !== 'auto' && candidate.id !== server) continue;
      found = true;
      try {
        const result = await resolveCandidate(candidate, quality, options.signal);
        if (item?.source === 'xin') {
          result.subtitleDescription = language === 'indonesian' ? 'Indonesian subtitles burned in' : 'English subtitles burned in';
        }
        return result;
      } catch (error) {
        if (server !== 'auto' || options.signal?.aborted) throw error;
        last = String(error?.message || '');
      }
    }
    if (server !== 'auto' && !found) throw new Error('The chosen server is not available for this episode');
    throw new Error(last ? `No supported server could be resolved: ${last}` : 'No supported download server was available');
  }

  async function probeCandidate(candidate, signal) {
    const result = await resolveCandidate(candidate, 'best', signal);
    const qualities = [{ id: 'best', label: 'Best available' }];
    let note = '';
    if ((result.mime || '').toLowerCase() === 'application/x-mpegurl') {
      try {
        const variants = hlsQualities(await hostText(result.url, result.referer, LIMIT, { signal }));
        qualities.push(...variants);
        if (!variants.length) note = 'This server did not report separate video resolutions.';
      } catch {
        if (signal?.aborted) throw new Error('Server check superseded.');
        note = 'Individual video resolutions could not be checked; best available is still offered.';
      }
    } else {
      const variants = fileQualities(result.files);
      qualities.push(...variants);
      note = variants.length ? 'File resolutions are reported by the source.' : 'This server offers a file whose resolution is not reported.';
    }
    let label = candidate.label;
    if (['megaplay', 'direct-mega', 'gogomega'].includes(candidate.provider)) label += ' - MegaPlay SUB';
    return { id: candidate.id, label, qualities, note };
  }

  async function downloadOptions(item, episode, language = 'english', options = {}) {
    const list = await candidates(item, episode, language, options.signal);
    const count = Math.min(8, list.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? 50000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const results = Array(count).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < count) {
        const index = next++;
        try { results[index] = await probeCandidate(list[index], signal); }
        catch { results[index] = null; }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, Math.max(1, count)) }, worker));
    } finally {
      clearTimeout(timer);
    }
    const servers = results.filter(Boolean);
    return { servers, unavailable: count - servers.length };
  }

  return {
    candidates: (item, episode, language, options = {}) => candidates(item, episode, language, options.signal),
    resolve,
    downloadOptions,
    megaPlay: (embed, referer, options = {}) => megaPlay(embed, referer, options.signal),
    dailyMotion: (embed, options = {}) => dailyMotion(embed, options.signal),
    _resolveCandidate: resolveCandidate,
  };
}

export const defaultVideoResolver = createVideoResolver();
