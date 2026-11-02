// In-app update checker state and helpers. Mikozora ships from GitHub
// Releases (a signed APK on Android, installers on Windows), so the app
// asks GitHub when it starts, again when it returns to the foreground,
// and periodically during long sessions whether a newer release exists.
// It then points the user at the build for their platform. The helpers
// are pure so they can be unit-tested without DOM or network.
export const UPDATE_KEY = 'moku.update.v1';
export const RELEASES_API_URL = 'https://api.github.com/repos/RavenmireLAbs/Mikozora-anime/releases/latest';
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const FOREGROUND_CHECK_INTERVAL_MS = 15 * 60 * 1000;
export const FAILED_CHECK_RETRY_MS = 5 * 60 * 1000;
export const DEFAULT_UPDATE_STATE = { autoCheck: true, lastCheck: 0, lastAttempt: 0, latest: '', pageUrl: '', apkUrl: '', downloadUrl: '', dismissed: '' };

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

// Shape a GitHub Releases API payload into {version, pageUrl, apkUrl,
// downloadUrl}, or null when it is not recognizable as a release.
// downloadUrl is the asset for the requesting platform, so the update
// action can start the right download directly.
export function releaseFromApi(json, platform = 'android') {
  if (!json || typeof json !== 'object') return null;
  const parsed = parseVersion(json.tag_name);
  if (!parsed) return null;
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const apks = assets.filter(a => /\.apk$/i.test(String(a?.name || '')) && httpsUrl(a?.browser_download_url));
  const apk = apks.find(a => /android/i.test(a.name)) || apks[0];
  const exes = assets.filter(a => /\.exe$/i.test(String(a?.name || '')) && httpsUrl(a?.browser_download_url));
  const exe = exes.find(a => /setup/i.test(a.name)) || exes[0];
  const apkUrl = apk ? httpsUrl(apk.browser_download_url) : '';
  return {
    version: parsed.join('.'),
    pageUrl: httpsUrl(json.html_url),
    apkUrl,
    // The Windows app downloads its installer; everywhere else keeps the APK.
    downloadUrl: platform === 'desktop' ? (exe ? httpsUrl(exe.browser_download_url) : '') : apkUrl,
  };
}

export function readUpdateState(storage) {
  try {
    const raw = JSON.parse(storage.getItem(UPDATE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_UPDATE_STATE };
    const lastCheck = Number.isFinite(raw.lastCheck) ? raw.lastCheck : 0;
    return {
      autoCheck: raw.autoCheck !== false,
      lastCheck,
      // Older state had no separate attempt timestamp; its lastCheck was
      // stamped for both successes and failures, so use it as the attempt.
      lastAttempt: Number.isFinite(raw.lastAttempt) ? raw.lastAttempt : lastCheck,
      latest: typeof raw.latest === 'string' ? raw.latest : '',
      pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : '',
      apkUrl: typeof raw.apkUrl === 'string' ? raw.apkUrl : '',
      downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : '',
      dismissed: typeof raw.dismissed === 'string' ? raw.dismissed : '',
    };
  } catch { return { ...DEFAULT_UPDATE_STATE }; }
}

export function saveUpdateState(storage, state) {
  storage.setItem(UPDATE_KEY, JSON.stringify({ ...DEFAULT_UPDATE_STATE, ...state }));
}

function lastAttemptOf(state) {
  return Math.max(0, Number(state?.lastAttempt) || 0, Number(state?.lastCheck) || 0);
}

// Each cold app launch gets one automatic check when the setting is on.
// The old 12-hour gate could hide a release published shortly after the
// previous successful check until the user visited Settings and checked
// manually.
export function shouldCheckOnLaunch(state) {
  return !!state?.autoCheck;
}

// Returning to an already-running app (Android recents or the Windows tray)
// should also surface a new release promptly, but repeated focus changes
// should not hammer GitHub. A failed attempt may retry after five minutes;
// a successful check is fresh for fifteen minutes.
export function shouldCheckOnForeground(state, now = Date.now()) {
  if (!state?.autoCheck) return false;
  return now - (state.lastCheck || 0) >= FOREGROUND_CHECK_INTERVAL_MS
    && now - lastAttemptOf(state) >= FAILED_CHECK_RETRY_MS;
}

// Long-running sessions retain the polite periodic interval, measured from
// the latest attempt rather than only the latest success.
export function shouldAutoCheck(state, now = Date.now()) {
  return !!state?.autoCheck && now - lastAttemptOf(state) >= CHECK_INTERVAL_MS;
}

// Record a check attempt. `lastAttempt` always advances, but `lastCheck`
// means the last *successful* check: an offline launch must not make the
// app claim it checked successfully or suppress the next launch's retry.
export function withCheckResult(state, info, now = Date.now()) {
  const next = { ...DEFAULT_UPDATE_STATE, ...state, lastAttempt: now, lastCheck: info ? now : (Number(state?.lastCheck) || 0) };
  if (info) {
    next.latest = info.version || '';
    next.pageUrl = info.pageUrl || '';
    next.apkUrl = info.apkUrl || '';
    // The platform-specific asset must survive persistence: before this was
    // recorded, the Windows banner fell back to apkUrl and downloaded the
    // Android build.
    next.downloadUrl = info.downloadUrl || '';
  }
  return next;
}

// The update worth showing right now, or null. A dismissed version stays
// hidden until an even newer one appears.
export function visibleUpdate(state, currentVersion) {
  if (!state?.latest) return null;
  if (!isNewerVersion(state.latest, currentVersion)) return null;
  if (state.dismissed && compareVersions(state.latest, state.dismissed) <= 0) return null;
  return { version: state.latest, pageUrl: state.pageUrl || '', apkUrl: state.apkUrl || '', downloadUrl: state.downloadUrl || '' };
}

// The URL the Download action should open for a visible update on this
// platform. Desktop must never fall back to the Android APK: state saved by
// older builds (or imported from an Android backup) may carry an apkUrl
// with no usable downloadUrl, and then the release page is the safe
// destination until the next check records the Windows installer.
export function updateDownloadUrl(update, platform = 'android') {
  if (!update) return '';
  const direct = String(update.downloadUrl || '');
  if (platform === 'desktop') {
    return direct && !/\.apk(?:$|[?#])/i.test(direct) ? direct : (update.pageUrl || '');
  }
  // Symmetric guard: a Windows backup restored on Android must not send
  // the phone an .exe when the release's APK is right there.
  const usable = direct && !/\.exe(?:$|[?#])/i.test(direct) ? direct : '';
  return usable || update.apkUrl || update.pageUrl || '';
}

export function dismissUpdate(state) {
  return { ...DEFAULT_UPDATE_STATE, ...state, dismissed: state?.latest || '' };
}
