// Windows folder access for device sync.
//
// This service is deliberately narrow: after the user chooses a folder, it
// can inspect that choice, read at most a bounded set of files named
// mikozora-sync-<platform>-<16 hex>.json, and atomically replace one such
// file. It never interprets sync payloads; src/device-sync.js validates and
// merges them in the renderer. The chosen folder is expected to be carried
// between devices by the user's own Syncthing/cloud/NAS setup.
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const DEVICE_SYNC_FILE_PATTERN = /^mikozora-sync-(android|windows)-[a-f0-9]{16}\.json$/;
export const DEVICE_SYNC_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const DEVICE_SYNC_MAX_FILES = 12;
export const DEVICE_SYNC_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

const STORE_KEY = 'deviceSyncFolder';

function cleanName(value, fallback = 'Selected folder') {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (name || fallback).slice(0, 100);
}

export class DeviceSyncService {
  constructor({ store = null, randomUUID = nodeRandomUUID } = {}) {
    this.store = store;
    this.randomUUID = typeof randomUUID === 'function' ? randomUUID : nodeRandomUUID;
    this.folderFallback = null;
  }

  folderRecord() {
    const saved = this.store ? this.store.get(STORE_KEY, null) : this.folderFallback;
    if (typeof saved === 'string') return { path: saved, name: cleanName(basename(saved) || saved) };
    if (!saved || typeof saved !== 'object') return null;
    const path = typeof saved.path === 'string' ? saved.path : '';
    return path ? { path, name: cleanName(saved.name || basename(path) || path) } : null;
  }

  async settings() {
    const saved = this.folderRecord();
    const path = saved?.path || '';
    let granted = false;
    if (path) {
      try {
        const info = await stat(path);
        if (info.isDirectory()) {
          await access(path, fsConstants.R_OK | fsConstants.W_OK);
          granted = true;
        }
      } catch { granted = false; }
    }
    return {
      configured: !!path,
      granted,
      name: path ? (saved.name || cleanName(basename(path) || path)) : '',
    };
  }

  async setFolder(path) {
    const selected = String(path || '').trim();
    if (!selected) throw new Error('The folder did not grant read and write access.');
    try {
      const info = await stat(selected);
      if (!info.isDirectory()) throw new Error('not a directory');
      await access(selected, fsConstants.R_OK | fsConstants.W_OK);
    } catch { throw new Error('The folder did not grant read and write access.'); }
    const value = { path: selected, name: cleanName(basename(selected) || selected) };
    if (this.store) {
      this.store.set(STORE_KEY, value);
      this.store.flush?.();
    } else {
      this.folderFallback = value;
    }
    return this.settings();
  }

  async clearFolder() {
    if (this.store) {
      this.store.set(STORE_KEY, null);
      this.store.flush?.();
    } else {
      this.folderFallback = null;
    }
    return this.settings();
  }

  async requireFolder() {
    const saved = this.folderRecord();
    if (!saved?.path) throw new Error('Choose a sync folder in Settings first.');
    const settings = await this.settings();
    if (!settings.granted) throw new Error('Sync folder access was lost. Choose the folder again in Settings.');
    return saved.path;
  }

  async readFolder() {
    const folder = await this.requireFolder();
    let names;
    try { names = await readdir(folder); }
    catch { throw new Error('Could not read the sync folder. Check that it is available and try again.'); }

    const candidates = [];
    for (const name of names) {
      if (!DEVICE_SYNC_FILE_PATTERN.test(name)) continue;
      try {
        const info = await stat(join(folder, name));
        if (!info.isFile() || info.size > DEVICE_SYNC_MAX_FILE_BYTES) continue;
        candidates.push({ name, size: info.size, modifiedAt: Math.floor(info.mtimeMs) || 0 });
      } catch { /* A sync provider may replace a file between listing and stat. */ }
    }

    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
    const selected = [];
    let total = 0;
    for (const candidate of candidates) {
      if (selected.length >= DEVICE_SYNC_MAX_FILES || total + candidate.size > DEVICE_SYNC_MAX_TOTAL_BYTES) continue;
      selected.push(candidate);
      total += candidate.size;
    }

    const files = [];
    for (const candidate of selected) {
      try {
        const text = await readFile(join(folder, candidate.name), 'utf8');
        // Re-check after reading in case a provider replaced the file after stat.
        if (Buffer.byteLength(text, 'utf8') > DEVICE_SYNC_MAX_FILE_BYTES) continue;
        files.push({ name: candidate.name, text, modifiedAt: candidate.modifiedAt });
      } catch { /* Skip a file that disappeared during the read. */ }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { files };
  }

  async writeFile(name, text) {
    const fileName = String(name || '');
    if (!DEVICE_SYNC_FILE_PATTERN.test(fileName)) throw new Error('Invalid device-sync file name.');
    const body = String(text ?? '');
    const bytes = Buffer.byteLength(body, 'utf8');
    if (!bytes || bytes > DEVICE_SYNC_MAX_FILE_BYTES) throw new Error('The device-sync file is too large.');

    const folder = await this.requireFolder();
    const target = join(folder, fileName);
    const temp = join(folder, `.${fileName}.tmp-${process.pid}-${this.randomUUID()}`);
    try {
      await writeFile(temp, body, 'utf8');
      await rename(temp, target);
    } catch {
      await rm(temp, { force: true }).catch(() => {});
      throw new Error('Could not write to the sync folder. Check that it is available and try again.');
    }
    return { written: true, name: fileName, bytes };
  }
}
