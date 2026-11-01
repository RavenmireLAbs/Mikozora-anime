// Backup & restore for everything Mikozora keeps in WebView storage: the
// library, collections, history, watch progress and preferences. A backup is
// a single JSON file holding the raw stored strings, so a restore is a
// faithful point-in-time copy. Only the keys listed here ever round-trip — a
// backup file cannot smuggle arbitrary storage entries into the app.
// Downloaded videos are not included; they stay files on the device.
import { APP_VERSION, EXPERIENCE_KEY } from './releases.js';
import { COLLECTIONS_KEY } from './collections.js';
import { PROGRESS_KEY } from './progress.js';
import { APPEARANCE_KEY } from './appearance.js';
import { CONTENT_KEY } from './content.js';
import { UPDATE_KEY } from './update.js';

export const BACKUP_FORMAT = 'mikozora-backup';
export const BACKUP_VERSION = 1;
// Library/history keys are defined beside their state in main.jsx.
export const BACKUP_KEYS = [
  'moku.library.v1',
  COLLECTIONS_KEY,
  'moku.history.v1',
  PROGRESS_KEY,
  APPEARANCE_KEY,
  CONTENT_KEY,
  UPDATE_KEY,
  EXPERIENCE_KEY,
];

export function backupFileName(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `mikozora-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export function buildBackup(storage, now = Date.now()) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    try {
      const raw = storage.getItem(key);
      if (raw != null) data[key] = raw;
    } catch { /* storage can be unavailable; skip what cannot be read */ }
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(now).toISOString(), appVersion: APP_VERSION, data };
}

function parseJson(raw) {
  try { return JSON.parse(raw); } catch { return undefined; }
}

export function summarizeBackup(data) {
  const count = key => {
    const value = parseJson(data?.[key] || 'null');
    return Array.isArray(value) ? value.length : 0;
  };
  return {
    library: count('moku.library.v1'),
    collections: count(COLLECTIONS_KEY),
    history: count('moku.history.v1'),
    progress: count(PROGRESS_KEY),
  };
}

// Validate a backup file's text and return { createdAt, appVersion, data,
// summary }. Throws an Error with a user-facing message for anything that is
// not a plausible Mikozora backup.
export function parseBackup(text) {
  const parsed = parseJson(String(text ?? ''));
  if (!parsed || typeof parsed !== 'object' || parsed.format !== BACKUP_FORMAT
      || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('That file is not a Mikozora backup.');
  }
  if (Number(parsed.version) > BACKUP_VERSION) {
    throw new Error('This backup was created by a newer version of Mikozora. Update the app first, then restore it.');
  }
  const data = {};
  for (const key of BACKUP_KEYS) {
    const raw = parsed.data[key];
    if (raw == null) continue;
    if (typeof raw !== 'string' || parseJson(raw) === undefined) {
      throw new Error('That backup file looks damaged.');
    }
    data[key] = raw;
  }
  if (!Object.keys(data).length) throw new Error('That backup file is empty.');
  return {
    createdAt: String(parsed.createdAt || ''),
    appVersion: String(parsed.appVersion || ''),
    data,
    summary: summarizeBackup(data),
  };
}

// Replace this device's stored state with the backup's. Keys the backup does
// not contain are cleared, so the result matches the moment the backup was
// made. Callers reload the app afterwards so every store is re-read.
export function applyBackup(storage, data) {
  for (const key of BACKUP_KEYS) {
    try {
      if (data && key in data) storage.setItem(key, data[key]);
      else storage.removeItem(key);
    } catch { /* keep applying the rest */ }
  }
}

// Browser-preview file helpers (the Android app uses the native file picker
// via data.js instead).
export function downloadBackupInBrowser(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickBackupInBrowser() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await file.text() : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
