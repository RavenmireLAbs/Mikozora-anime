// In-app update checker state and helpers. Mikozora ships as a sideloaded APK
// from GitHub Releases, so the app asks GitHub (politely, at most twice a
// day) whether a newer signed release exists and points the user at it. The
// helpers are pure so they can be unit-tested without DOM or network.
export const UPDATE_KEY = 'moku.update.v1';
export const RELEASES_API_URL = 'https://api.github.com/repos/RavenmireLAbs/Mikozora-anime/releases/latest';
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_UPDATE_STATE = { autoCheck: true, lastCheck: 0, latest: '', pageUrl: '', apkUrl: '', dismissed: '' };

// "v0.15.0" -> [0, 15, 0]. Missing parts default to 0; anything that does not
// start with digits is not a version Mikozora would ship.
export function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function httpsUrl(value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

// Shape a GitHub Releases API payload into {version, pageUrl, apkUrl}, or
// null when it is not recognizable as a release. The APK asset is preferred
// so the update action can start the download directly.
export function releaseFromApi(json) {
  if (!json || typeof json !== 'object') return null;
  const parsed = parseVersion(json.tag_name);
  if (!parsed) return null;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const apks = assets.filter(a => /\.apk$/i.test(String(a?.name || '')) && httpsUrl(a?.browser_download_url));
  const apk = apks.find(a => /android/i.test(a.name)) || apks[0];
  return {
    version: parsed.join('.'),
    pageUrl: httpsUrl(json.html_url),
    apkUrl: apk ? httpsUrl(apk.browser_download_url) : '',
  };
}

export function readUpdateState(storage) {
  try {
    const raw = JSON.parse(storage.getItem(UPDATE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_UPDATE_STATE };
    return {
      autoCheck: raw.autoCheck !== false,
      lastCheck: Number.isFinite(raw.lastCheck) ? raw.lastCheck : 0,
      latest: typeof raw.latest === 'string' ? raw.latest : '',
      pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : '',
      apkUrl: typeof raw.apkUrl === 'string' ? raw.apkUrl : '',
      dismissed: typeof raw.dismissed === 'string' ? raw.dismissed : '',
    };
  } catch { return { ...DEFAULT_UPDATE_STATE }; }
}

export function saveUpdateState(storage, state) {
  storage.setItem(UPDATE_KEY, JSON.stringify({ ...DEFAULT_UPDATE_STATE, ...state }));
}

export function shouldAutoCheck(state, now = Date.now()) {
  return !!state?.autoCheck && now - (state.lastCheck || 0) >= CHECK_INTERVAL_MS;
}

// Record a check attempt. On success `info` replaces the remembered release;
// on failure pass null to only stamp the time, so an offline device does not
// retry on every single app open.
export function withCheckResult(state, info, now = Date.now()) {
  const next = { ...DEFAULT_UPDATE_STATE, ...state, lastCheck: now };
  if (info) {
    next.latest = info.version || '';
    next.pageUrl = info.pageUrl || '';
    next.apkUrl = info.apkUrl || '';
  }
  return next;
}

// The update worth showing right now, or null. A dismissed version stays
// hidden until an even newer one appears.
export function visibleUpdate(state, currentVersion) {
  if (!state?.latest) return null;
  if (!isNewerVersion(state.latest, currentVersion)) return null;
  if (state.dismissed && compareVersions(state.latest, state.dismissed) <= 0) return null;
  return { version: state.latest, pageUrl: state.pageUrl || '', apkUrl: state.apkUrl || '' };
}

export function dismissUpdate(state) {
  return { ...DEFAULT_UPDATE_STATE, ...state, dismissed: state?.latest || '' };
}
