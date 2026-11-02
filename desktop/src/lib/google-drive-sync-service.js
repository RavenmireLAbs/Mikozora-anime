// Windows Google Drive transport for device sync.
//
// This service is intentionally as narrow as the folder service: Google is
// asked only for the non-sensitive drive.file scope, Mikozora creates and
// uses one visible "Mikozora" folder, and only bounded files named
// mikozora-sync-<platform>-<16 hex>.json are read or replaced. OAuth tokens
// and Drive payloads never enter the renderer; src/device-sync.js still
// validates and merges every peer file.
import { createHash, randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  DEVICE_SYNC_FILE_PATTERN,
  DEVICE_SYNC_MAX_FILE_BYTES,
  DEVICE_SYNC_MAX_FILES,
  DEVICE_SYNC_MAX_TOTAL_BYTES,
} from './device-sync-service.js';

export const GOOGLE_DRIVE_SYNC_FOLDER_NAME = 'Mikozora';
export const GOOGLE_DRIVE_SYNC_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
];
export const GOOGLE_DRIVE_SETUP_MESSAGE = 'Google Drive is not configured in this Mikozora build yet.';
export const GOOGLE_DRIVE_RECONNECT_MESSAGE = 'Google Drive needs to be reconnected. Connect Google Drive again in Settings.';

const STORE_KEY = 'googleDriveSync';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const DEFAULT_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DEFAULT_API_BASE = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

function cleanText(value, fallback = '') {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (text || fallback).slice(0, 320);
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(String(verifier || ''), 'utf8').digest('base64url');
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function errorWithStatus(message, status, code = '') {
  const error = new Error(cleanText(message, 'Google Drive could not complete that request.'));
  error.status = Number(status) || 0;
  if (code) error.code = String(code).slice(0, 80);
  return error;
}

function parseJson(text) {
  try { return JSON.parse(String(text || '')); } catch { return null; }
}

function googleError(body) {
  const parsed = parseJson(body);
  const error = parsed?.error;
  if (typeof error === 'string') return { code: error, message: parsed.error_description || '' };
  return {
    code: String(error?.status || error?.code || ''),
    message: String(error?.message || parsed?.error_description || ''),
    reason: String(error?.errors?.[0]?.reason || ''),
  };
}

function friendlyApiError(status, body) {
  const detail = googleError(body);
  if (status === 401) return errorWithStatus(GOOGLE_DRIVE_RECONNECT_MESSAGE, status, detail.code || detail.reason);
  if (status === 403) {
    return errorWithStatus(
      'Google Drive did not allow Mikozora to use its sync folder. Reconnect Google Drive and grant the Drive permission.',
      status,
      detail.code || detail.reason,
    );
  }
  if (status === 404) return errorWithStatus('A Google Drive sync file was moved or deleted. Sync again.', status, detail.code || detail.reason);
  if (status === 429 || status >= 500) return errorWithStatus('Google Drive is busy or unavailable. Try again in a moment.', status, detail.code || detail.reason);
  return errorWithStatus('Google Drive could not complete that request. Try again.', status, detail.code || detail.reason);
}

function htmlPage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:3rem;line-height:1.5;color:#17211a}main{max-width:34rem;margin:auto}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

export class GoogleDriveSyncService {
  constructor({
    store = null,
    clientId = '',
    clientSecret = '',
    fetchImpl = globalThis.fetch,
    openExternal = null,
    protectSecret = (value) => ({ protected: false, value: String(value || '') }),
    unprotectSecret = (record) => String(record?.value || ''),
    randomBytes = nodeRandomBytes,
    randomUUID = nodeRandomUUID,
    now = () => Date.now(),
    authTimeoutMs = 5 * 60 * 1000,
    requestTimeoutMs = 30 * 1000,
    authUrl = DEFAULT_AUTH_URL,
    tokenUrl = DEFAULT_TOKEN_URL,
    revokeUrl = DEFAULT_REVOKE_URL,
    userinfoUrl = DEFAULT_USERINFO_URL,
    apiBaseUrl = DEFAULT_API_BASE,
    uploadBaseUrl = DEFAULT_UPLOAD_BASE,
  } = {}) {
    this.store = store;
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '').trim();
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.openExternal = typeof openExternal === 'function' ? openExternal : null;
    this.protectSecret = typeof protectSecret === 'function' ? protectSecret : ((value) => ({ protected: false, value: String(value || '') }));
    this.unprotectSecret = typeof unprotectSecret === 'function' ? unprotectSecret : ((record) => String(record?.value || ''));
    this.randomBytes = typeof randomBytes === 'function' ? randomBytes : nodeRandomBytes;
    this.randomUUID = typeof randomUUID === 'function' ? randomUUID : nodeRandomUUID;
    this.now = typeof now === 'function' ? now : (() => Date.now());
    this.authTimeoutMs = Math.max(1000, Number(authTimeoutMs) || 5 * 60 * 1000);
    this.requestTimeoutMs = Math.max(1000, Number(requestTimeoutMs) || 30 * 1000);
    this.authUrl = String(authUrl || DEFAULT_AUTH_URL);
    this.tokenUrl = String(tokenUrl || DEFAULT_TOKEN_URL);
    this.revokeUrl = String(revokeUrl || DEFAULT_REVOKE_URL);
    this.userinfoUrl = String(userinfoUrl || DEFAULT_USERINFO_URL);
    this.apiBaseUrl = String(apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, '');
    this.uploadBaseUrl = String(uploadBaseUrl || DEFAULT_UPLOAD_BASE).replace(/\/$/, '');
    this.recordFallback = null;
    this.accessTokenCache = null;
    this.connectPromise = null;
  }

  record() {
    const saved = this.store ? this.store.get(STORE_KEY, null) : this.recordFallback;
    if (!saved || typeof saved !== 'object') return null;
    return {
      account: cleanText(saved.account),
      displayName: cleanText(saved.displayName),
      folderId: cleanText(saved.folderId),
      refreshToken: saved.refreshToken && typeof saved.refreshToken === 'object'
        ? { protected: saved.refreshToken.protected === true, value: String(saved.refreshToken.value || '') }
        : { protected: false, value: '' },
      needsReconnect: saved.needsReconnect === true,
    };
  }

  saveRecord(record) {
    const value = record ? {
      account: cleanText(record.account),
      displayName: cleanText(record.displayName),
      folderId: cleanText(record.folderId),
      refreshToken: record.refreshToken && typeof record.refreshToken === 'object'
        ? { protected: record.refreshToken.protected === true, value: String(record.refreshToken.value || '') }
        : { protected: false, value: '' },
      needsReconnect: record.needsReconnect === true,
    } : null;
    if (this.store) {
      this.store.set(STORE_KEY, value);
      this.store.flush?.();
    } else {
      this.recordFallback = value;
    }
    return value;
  }

  updateRecord(patch) {
    return this.saveRecord({ ...(this.record() || {}), ...patch });
  }

  refreshToken() {
    try { return String(this.unprotectSecret(this.record()?.refreshToken) || ''); }
    catch { return ''; }
  }

  saveRefreshToken(token) {
    const value = String(token || '');
    let wrapped;
    try { wrapped = value ? this.protectSecret(value) : { protected: false, value: '' }; }
    catch { wrapped = { protected: false, value }; }
    return this.updateRecord({
      refreshToken: { protected: wrapped?.protected === true, value: String(wrapped?.value || '') },
      needsReconnect: !value,
    });
  }

  configuredClient() {
    return !!this.clientId && !!this.clientSecret;
  }

  async settings() {
    const record = this.record();
    const hasRefreshToken = !!this.refreshToken();
    const needsSetup = !this.configuredClient();
    const needsReconnect = !!record?.needsReconnect || (!!record?.account && !hasRefreshToken);
    const configured = hasRefreshToken || !!record?.account;
    return {
      transport: 'google',
      available: true,
      configured,
      granted: configured && hasRefreshToken && !needsReconnect && !needsSetup,
      needsSetup,
      setupMessage: needsSetup ? GOOGLE_DRIVE_SETUP_MESSAGE : '',
      needsReconnect,
      account: record?.account || '',
      displayName: record?.displayName || '',
      name: record?.account || 'Google Drive',
      folderName: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
    };
  }

  async connect() {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce();
    try { return await this.connectPromise; }
    finally { this.connectPromise = null; }
  }

  authReceiver(state) {
    let resolveReady;
    let rejectReady;
    let resolveResult;
    let rejectResult;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    let settled = false;
    let timer = null;
    const server = createServer((request, response) => {
      const finishResponse = (status, title, body) => {
        response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(htmlPage(title, body));
      };
      try {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (url.pathname !== '/oauth2callback') {
          finishResponse(404, 'Not found', 'This local page only completes a Mikozora Google sign-in.');
          return;
        }
        if (!sameSecret(url.searchParams.get('state'), state)) {
          finishResponse(400, 'Sign-in could not be verified', 'Return to Mikozora and try connecting Google Drive again.');
          settle(new Error('Google sign-in could not be verified. Try connecting again.'));
          return;
        }
        const oauthError = url.searchParams.get('error') || '';
        if (oauthError) {
          if (oauthError === 'access_denied') {
            finishResponse(200, 'Google sign-in canceled', 'You can close this tab and return to Mikozora.');
            settle(null, { canceled: true });
          } else {
            finishResponse(400, 'Google sign-in failed', 'Return to Mikozora and try connecting Google Drive again.');
            settle(new Error('Google sign-in did not finish. Try connecting again.'));
          }
          return;
        }
        const code = url.searchParams.get('code') || '';
        if (!code) {
          finishResponse(400, 'Google sign-in failed', 'Google did not return an authorization code. Return to Mikozora and try again.');
          settle(new Error('Google sign-in did not return an authorization code. Try connecting again.'));
          return;
        }
        finishResponse(200, 'Mikozora is connected', 'You can close this tab and return to Mikozora.');
        settle(null, { code });
      } catch {
        finishResponse(400, 'Google sign-in failed', 'Return to Mikozora and try connecting Google Drive again.');
        settle(new Error('Google sign-in did not finish. Try connecting again.'));
      }
    });
    const close = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try { server.close(); } catch { /* already closed */ }
    };
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      close();
      if (error) rejectResult(error);
      else resolveResult(value);
    };
    timer = setTimeout(() => settle(new Error('Google sign-in timed out. Try connecting again.')), this.authTimeoutMs);
    server.once('error', (error) => {
      rejectReady(error);
      settle(new Error('Mikozora could not start the local Google sign-in page. Try again.'));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        rejectReady(new Error('No loopback port'));
        settle(new Error('Mikozora could not start the local Google sign-in page. Try again.'));
        return;
      }
      resolveReady(`http://127.0.0.1:${port}/oauth2callback`);
    });
    // The timeout/error paths may settle before callers attach to result.
    result.catch(() => {});
    return { ready, result, close: () => settle(new Error('Google sign-in was canceled.')) };
  }

  buildAuthUrl({ redirectUri, state, challenge }) {
    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_DRIVE_SYNC_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('include_granted_scopes', 'true');
    return url.toString();
  }

  async connectOnce() {
    if (!this.configuredClient()) throw new Error(GOOGLE_DRIVE_SETUP_MESSAGE);
    if (!this.openExternal) throw new Error('Mikozora could not open a browser for Google sign-in.');
    const state = base64Url(this.randomBytes(32));
    const verifier = base64Url(this.randomBytes(48));
    const receiver = this.authReceiver(state);
    try {
      const redirectUri = await receiver.ready;
      const authUrl = this.buildAuthUrl({ redirectUri, state, challenge: pkceChallenge(verifier) });
      await this.openExternal(authUrl);
      const outcome = await receiver.result;
      if (outcome?.canceled) return { ...(await this.settings()), canceled: true };

      const tokens = await this.tokenRequest({
        code: outcome.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (!tokens.refresh_token) {
        throw new Error('Google did not return offline access. Remove Mikozora from your Google Account permissions, then connect again.');
      }
      this.cacheAccessToken(tokens);
      const grantedScopes = String(tokens.scope || '').split(/\s+/);
      if (grantedScopes.length && !grantedScopes.includes('https://www.googleapis.com/auth/drive.file')) {
        throw new Error('Google Drive permission was not granted. Connect again and allow Mikozora to use files it creates.');
      }
      const profile = await this.fetchProfile(tokens.access_token).catch(() => ({}));
      this.saveRecord({
        ...(this.record() || {}),
        account: cleanText(profile.email),
        displayName: cleanText(profile.name),
        needsReconnect: false,
      });
      this.saveRefreshToken(tokens.refresh_token);
      await this.ensureFolders(true);
      return this.settings();
    } finally {
      receiver.close();
    }
  }

  async disconnect() {
    const token = this.refreshToken() || this.accessTokenCache?.token || '';
    if (token && this.fetchImpl) {
      try {
        await this.fetchImpl(this.revokeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
          signal: this.requestSignal(),
        });
      } catch { /* Disconnecting this device still succeeds locally. */ }
    }
    this.accessTokenCache = null;
    this.saveRecord(null);
    // The visible Mikozora folder and sync files stay in Drive; only this
    // device's stored authorization is removed.
    return this.settings();
  }

  requestSignal() {
    try {
      return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(this.requestTimeoutMs)
        : undefined;
    } catch { return undefined; }
  }

  async rawFetch(url, options = {}) {
    if (!this.fetchImpl) throw new Error('Could not reach Google Drive. Check your internet connection and try again.');
    try {
      return await this.fetchImpl(url, { ...options, signal: options.signal || this.requestSignal() });
    } catch {
      throw new Error('Could not reach Google Drive. Check your internet connection and try again.');
    }
  }

  async responseText(response, maxBytes = DEVICE_SYNC_MAX_TOTAL_BYTES) {
    if (typeof response?.text === 'function') {
      const text = String(await response.text());
      if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Google Drive returned more data than Mikozora can safely read.');
      return text;
    }
    const bytes = await this.responseBytes(response, maxBytes);
    return Buffer.from(bytes).toString('utf8');
  }

  async responseBytes(response, maxBytes = DEVICE_SYNC_MAX_FILE_BYTES) {
    if (typeof response?.arrayBuffer === 'function') {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new Error('A Google Drive sync file is too large for Mikozora to read.');
      return buffer;
    }
    if (typeof response?.text === 'function') {
      const buffer = Buffer.from(String(await response.text()), 'utf8');
      if (buffer.length > maxBytes) throw new Error('A Google Drive sync file is too large for Mikozora to read.');
      return buffer;
    }
    throw new Error('Google Drive returned an unreadable response.');
  }

  async tokenRequest(params) {
    const response = await this.rawFetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const text = await this.responseText(response, 1024 * 1024);
    const parsed = parseJson(text) || {};
    if (!response.ok || !parsed.access_token) {
      const detail = googleError(text);
      const code = String(parsed.error || detail.code || '');
      if (code === 'invalid_grant') throw errorWithStatus(GOOGLE_DRIVE_RECONNECT_MESSAGE, response.status, code);
      if (code === 'invalid_client' || code === 'unauthorized_client') {
        throw errorWithStatus('The Google Drive client in this Mikozora build is not valid. A newer or correctly configured build is needed.', response.status, code);
      }
      throw errorWithStatus('Google sign-in could not be completed. Try connecting again.', response.status, code);
    }
    return parsed;
  }

  cacheAccessToken(tokens) {
    const seconds = Math.max(30, Math.floor(Number(tokens?.expires_in) || 3600));
    this.accessTokenCache = {
      token: String(tokens?.access_token || ''),
      expiresAt: this.now() + (seconds * 1000),
    };
    return this.accessTokenCache.token;
  }

  async accessToken(force = false) {
    if (!force && this.accessTokenCache?.token && this.accessTokenCache.expiresAt > this.now() + 30000) {
      return this.accessTokenCache.token;
    }
    if (!this.configuredClient()) throw new Error(GOOGLE_DRIVE_SETUP_MESSAGE);
    const refreshToken = this.refreshToken();
    if (!refreshToken) throw new Error(GOOGLE_DRIVE_RECONNECT_MESSAGE);
    try {
      const tokens = await this.tokenRequest({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      if (tokens.refresh_token && tokens.refresh_token !== refreshToken) this.saveRefreshToken(tokens.refresh_token);
      else {
        const record = this.record();
        if (record?.needsReconnect) this.updateRecord({ needsReconnect: false });
      }
      return this.cacheAccessToken(tokens);
    } catch (error) {
      if (error?.code === 'invalid_grant' || error?.message === GOOGLE_DRIVE_RECONNECT_MESSAGE) {
        const record = this.record();
        if (record) this.saveRecord({ ...record, refreshToken: { protected: false, value: '' }, needsReconnect: true });
        this.accessTokenCache = null;
      }
      throw error;
    }
  }

  async fetchProfile(accessToken) {
    const response = await this.rawFetch(this.userinfoUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const text = await this.responseText(response, 256 * 1024);
    if (!response.ok) return {};
    const parsed = parseJson(text) || {};
    return { email: cleanText(parsed.email), name: cleanText(parsed.name) };
  }

  async requireConnected() {
    const settings = await this.settings();
    if (settings.needsSetup) throw new Error(GOOGLE_DRIVE_SETUP_MESSAGE);
    if (!settings.configured || settings.needsReconnect || !this.refreshToken()) throw new Error(GOOGLE_DRIVE_RECONNECT_MESSAGE);
    return settings;
  }

  async driveFetch(url, options = {}, retry = true) {
    await this.requireConnected();
    const token = await this.accessToken(false);
    const response = await this.rawFetch(url, {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retry) {
      this.accessTokenCache = null;
      return this.driveFetch(url, options, false);
    }
    if (!response.ok) {
      const body = await this.responseText(response, 1024 * 1024).catch(() => '');
      const error = friendlyApiError(response.status, body);
      if (response.status === 401) {
        const record = this.record();
        if (record) this.updateRecord({ needsReconnect: true });
      }
      throw error;
    }
    return response;
  }

  async driveJson(url, options = {}) {
    const response = await this.driveFetch(url, options);
    const text = await this.responseText(response, 4 * 1024 * 1024);
    return parseJson(text) || {};
  }

  filesUrl(fields, params = {}) {
    const url = new URL(`${this.apiBaseUrl}/files`);
    url.searchParams.set('fields', fields);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async listFolders() {
    const q = `name = '${escapeDriveQuery(GOOGLE_DRIVE_SYNC_FOLDER_NAME)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const response = await this.driveJson(this.filesUrl('files(id,name,createdTime,modifiedTime)', {
      q,
      spaces: 'drive',
      pageSize: 20,
      orderBy: 'createdTime',
    }));
    const folders = (Array.isArray(response.files) ? response.files : [])
      .filter((file) => file && typeof file.id === 'string' && file.name === GOOGLE_DRIVE_SYNC_FOLDER_NAME)
      .map((file) => ({
        id: file.id,
        name: file.name,
        createdTime: String(file.createdTime || ''),
        modifiedTime: String(file.modifiedTime || ''),
      }))
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
    return folders;
  }

  async ensureFolders(create = true) {
    let folders = await this.listFolders();
    if (!folders.length && create) {
      const created = await this.driveJson(this.filesUrl('id,name,createdTime,modifiedTime'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
          mimeType: FOLDER_MIME,
          appProperties: { mikozoraSync: '1' },
        }),
      });
      if (!created?.id) throw new Error('Google Drive did not create the Mikozora sync folder.');
      folders = [{
        id: String(created.id),
        name: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
        createdTime: String(created.createdTime || ''),
        modifiedTime: String(created.modifiedTime || ''),
      }];
    }
    const canonical = folders[0] || null;
    if (canonical && this.record()?.folderId !== canonical.id) this.updateRecord({ folderId: canonical.id });
    return { folders, canonical };
  }

  async listSyncFiles(folders) {
    const all = [];
    for (const folder of folders) {
      let pageToken = '';
      for (let page = 0; page < 3; page += 1) {
        const q = `'${escapeDriveQuery(folder.id)}' in parents and trashed = false`;
        const response = await this.driveJson(this.filesUrl('nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)', {
          q,
          spaces: 'drive',
          pageSize: 100,
          pageToken: pageToken || undefined,
        }));
        for (const file of Array.isArray(response.files) ? response.files : []) {
          if (!file || typeof file.id !== 'string' || typeof file.name !== 'string') continue;
          if (!DEVICE_SYNC_FILE_PATTERN.test(file.name) || file.mimeType === FOLDER_MIME) continue;
          const size = Math.max(0, Math.floor(Number(file.size) || 0));
          all.push({
            id: file.id,
            name: file.name,
            size,
            createdTime: String(file.createdTime || ''),
            modifiedTime: String(file.modifiedTime || ''),
            modifiedAt: Date.parse(file.modifiedTime || '') || 0,
            parents: Array.isArray(file.parents) ? file.parents.map(String) : [folder.id],
          });
        }
        pageToken = String(response.nextPageToken || '');
        if (!pageToken) break;
      }
    }
    return all;
  }

  async readFiles() {
    const { folders } = await this.ensureFolders(true);
    const candidates = (await this.listSyncFiles(folders))
      .filter((file) => !file.size || file.size <= DEVICE_SYNC_MAX_FILE_BYTES)
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));

    const selected = [];
    let estimatedTotal = 0;
    for (const candidate of candidates) {
      if (selected.length >= DEVICE_SYNC_MAX_FILES) break;
      if (candidate.size && estimatedTotal + candidate.size > DEVICE_SYNC_MAX_TOTAL_BYTES) continue;
      selected.push(candidate);
      estimatedTotal += candidate.size || 0;
    }

    const files = [];
    let actualTotal = 0;
    for (const candidate of selected) {
      try {
        const response = await this.driveFetch(`${this.apiBaseUrl}/files/${encodeURIComponent(candidate.id)}?alt=media`);
        const bytes = await this.responseBytes(response, DEVICE_SYNC_MAX_FILE_BYTES);
        if (actualTotal + bytes.length > DEVICE_SYNC_MAX_TOTAL_BYTES) continue;
        actualTotal += bytes.length;
        files.push({ name: candidate.name, text: bytes.toString('utf8'), modifiedAt: candidate.modifiedAt });
      } catch (error) {
        // A peer file can be trashed between listing and download. Other
        // errors are connection/authorization problems and should surface.
        if (error?.status !== 404 && error?.status !== 410) throw error;
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { files };
  }

  async createFile(folderId, name, text) {
    const boundary = `mikozora-${this.randomUUID()}`;
    const metadata = JSON.stringify({
      name,
      parents: [folderId],
      mimeType: 'application/json',
      appProperties: { mikozoraSync: '1' },
    });
    const body = `--${boundary}\r\n`
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + `${metadata}\r\n`
      + `--${boundary}\r\n`
      + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
      + `${text}\r\n`
      + `--${boundary}--\r\n`;
    return this.driveJson(`${this.uploadBaseUrl}/files?uploadType=multipart&fields=id,name,parents`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async writeFile(name, text) {
    const fileName = String(name || '');
    if (!DEVICE_SYNC_FILE_PATTERN.test(fileName)) throw new Error('Invalid device-sync file name.');
    const body = String(text ?? '');
    const bytes = Buffer.byteLength(body, 'utf8');
    if (!bytes || bytes > DEVICE_SYNC_MAX_FILE_BYTES) throw new Error('The device-sync file is too large.');

    const { folders, canonical } = await this.ensureFolders(true);
    if (!canonical) throw new Error('Google Drive did not provide the Mikozora sync folder.');
    const matches = (await this.listSyncFiles(folders))
      .filter((file) => file.name === fileName)
      .sort((a, b) => {
        const aCanonical = a.parents.includes(canonical.id) ? 0 : 1;
        const bCanonical = b.parents.includes(canonical.id) ? 0 : 1;
        return aCanonical - bCanonical || b.modifiedAt - a.modifiedAt || a.id.localeCompare(b.id);
      });
    const existing = matches[0] || null;

    if (!existing) {
      const created = await this.createFile(canonical.id, fileName, body);
      return { written: true, name: fileName, bytes, id: String(created?.id || '') };
    }

    if (!existing.parents.includes(canonical.id)) {
      const removable = existing.parents.filter((parent) => folders.some((folder) => folder.id === parent) && parent !== canonical.id);
      if (removable.length) {
        const moveUrl = new URL(`${this.apiBaseUrl}/files/${encodeURIComponent(existing.id)}`);
        moveUrl.searchParams.set('addParents', canonical.id);
        moveUrl.searchParams.set('removeParents', removable.join(','));
        moveUrl.searchParams.set('fields', 'id,parents');
        await this.driveJson(moveUrl.toString(), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }).catch(() => ({ /* Updating the same file in place still works. */ }));
      }
    }

    try {
      const updated = await this.driveJson(`${this.uploadBaseUrl}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,parents`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body,
      });
      return { written: true, name: fileName, bytes, id: String(updated?.id || existing.id) };
    } catch (error) {
      if (error?.status !== 404) throw error;
      const created = await this.createFile(canonical.id, fileName, body);
      return { written: true, name: fileName, bytes, id: String(created?.id || '') };
    }
  }
}
