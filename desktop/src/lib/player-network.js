// Player-network compatibility for the Windows web player.
//
// Android wraps each third-party embed in a page whose base URL is the
// actual source episode page and whose referrer policy is `origin`. The
// video host therefore sees a Referer from the source that supplied the
// embed (for example https://animesogo.to/). The desktop modal instead
// has the private mikozora://app origin; hotlink-protected hosts reject
// that unknown referrer with pages such as HTTP 410. The main process
// rewrites only the initial HTTPS sub-frame navigation to restore the
// Android semantics.
import { allowedSource } from './allowlist.js';

export function playerRefererForEpisode(episodeUrl) {
  if (!allowedSource(episodeUrl)) return '';
  try {
    return `${new URL(episodeUrl).origin}/`;
  } catch {
    return '';
  }
}

function existingReferer(headers) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === 'referer') return Array.isArray(value) ? String(value[0] || '') : String(value || '');
  }
  return '';
}

export const ONLINE_STREAM_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;

export function cleanOnlineStreamContext(value, now = Date.now()) {
  const rawUrl = typeof value === 'string' ? value : value?.url;
  const rawReferer = typeof value === 'string' ? '' : value?.referer;
  let url;
  let referer;
  try {
    url = new URL(String(rawUrl || ''));
    referer = new URL(String(rawReferer || ''));
  } catch { return null; }
  if (url.protocol !== 'https:' || referer.protocol !== 'https:' || url.href.length > 8192 || referer.href.length > 4096) return null;
  return {
    url: url.href,
    host: url.hostname.toLowerCase(),
    referer: referer.href,
    expiresAt: now + ONLINE_STREAM_CONTEXT_TTL_MS,
  };
}

export function onlineStreamHeaders(details, context, now = Date.now()) {
  const headers = { ...(details?.requestHeaders || {}) };
  const clean = context?.url && context?.referer && Number(context?.expiresAt) > now ? context : null;
  if (!clean || !['media', 'xhr', 'xmlhttprequest', 'other'].includes(details?.resourceType)) return headers;

  let target;
  try {
    target = new URL(details?.url || '');
  } catch {
    return headers;
  }
  const launchedFrom = [details?.initiatorOrigin, details?.referrer, existingReferer(headers)]
    .find((value) => typeof value === 'string' && value && value !== 'null') || '';
  if (target.protocol !== 'https:' || !launchedFrom.startsWith('mikozora://')) return headers;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'referer') delete headers[key];
  }
  headers.Referer = clean.referer;
  return headers;
}

export function onlineStreamResponseHeaders(details, context, now = Date.now()) {
  const headers = { ...(details?.responseHeaders || {}) };
  const clean = context?.url && context?.referer && Number(context?.expiresAt) > now ? context : null;
  if (!clean || !['media', 'xhr', 'xmlhttprequest', 'other'].includes(details?.resourceType)) return headers;

  let target;
  try {
    target = new URL(details?.url || '');
  } catch {
    return headers;
  }
  const launchedFrom = [details?.initiatorOrigin, details?.referrer]
    .find((value) => typeof value === 'string' && value && value !== 'null') || '';
  if (target.protocol !== 'https:' || !launchedFrom.startsWith('mikozora://')) return headers;

  // HLS.js must be able to read the playlist/segments it fetches from the
  // app's private origin. This permission is added only while one validated
  // direct-stream context is active and only for requests launched by the
  // Mikozora UI itself; embedded third-party frames do not qualify.
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'access-control-allow-origin' || lower === 'access-control-expose-headers') delete headers[key];
  }
  headers['Access-Control-Allow-Origin'] = ['*'];
  headers['Access-Control-Expose-Headers'] = ['Accept-Ranges, Content-Length, Content-Range, Content-Type'];
  return headers;
}

export function playerResponseHeaders(details, onlineContext, now = Date.now()) {
  return onlineStreamResponseHeaders(details, onlineContext, now);
}

export function playerRequestHeaders(details, playerReferer, onlineContext, now = Date.now()) {
  if (details?.resourceType === 'subFrame') return playerEmbedHeaders(details, playerReferer);
  return onlineStreamHeaders(details, onlineContext, now);
}

export function playerEmbedHeaders(details, playerReferer) {
  const headers = { ...(details?.requestHeaders || {}) };
  if (!playerReferer || details?.resourceType !== 'subFrame') return headers;

  let target;
  try {
    target = new URL(details?.url || '');
  } catch {
    return headers;
  }

  const launchedFrom = [details?.initiatorOrigin, details?.referrer, existingReferer(headers)]
    .find((value) => typeof value === 'string' && value && value !== 'null') || '';
  if (target.protocol !== 'https:' || !launchedFrom.startsWith('mikozora://')) return headers;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'referer') delete headers[key];
  }
  headers.Referer = playerReferer;
  return headers;
}

// Electron's default user agent advertises both the application and
// Electron itself. Some third-party players reject that fingerprint even
// when their embeds work in ordinary Chromium. Remove only those tokens
// and retain the platform/Chromium version supplied by Electron.
export function cleanUserAgent(userAgent) {
  return String(userAgent || '')
    .replace(/\s+(?:Mikozora|Electron)\/[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
