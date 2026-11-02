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
