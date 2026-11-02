import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GoogleDriveSyncService,
  GOOGLE_DRIVE_SYNC_FOLDER_NAME,
  pkceChallenge,
} from '../desktop/src/lib/google-drive-sync-service.js';
import { DEVICE_SYNC_MAX_FILE_BYTES } from '../desktop/src/lib/device-sync-service.js';

const TOKEN_URL = 'https://oauth.test/token';
const REVOKE_URL = 'https://oauth.test/revoke';
const USERINFO_URL = 'https://oauth.test/userinfo';
const API_BASE = 'https://drive.test/v3';
const UPLOAD_BASE = 'https://upload.test/v3';
const OWN_NAME = 'mikozora-sync-windows-aaaaaaaaaaaaaaaa.json';
const PEER_NAME = 'mikozora-sync-android-bbbbbbbbbbbbbbbb.json';

class MemoryStore {
  constructor() {
    this.values = new Map();
    this.flushes = 0;
  }

  get(key, fallback) { return this.values.has(key) ? this.values.get(key) : fallback; }
  set(key, value) { this.values.set(key, value); }
  flush() { this.flushes += 1; }
}

function response(body, status = 200, json = true) {
  const text = json ? JSON.stringify(body) : String(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return text; },
    async arrayBuffer() {
      const bytes = Buffer.from(text, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function apiFile(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType || 'application/json',
    size: String(Buffer.byteLength(file.content || '', 'utf8')),
    createdTime: file.createdTime || '2026-01-01T00:00:00.000Z',
    modifiedTime: file.modifiedTime || '2026-01-01T00:00:00.000Z',
    parents: [...(file.parents || [])],
  };
}

function multipartParts(options) {
  const contentType = options.headers?.['content-type'] || options.headers?.['Content-Type'] || '';
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] || '';
  const parts = String(options.body || '').split(`--${boundary}`);
  const contentOf = (part) => String(part || '').split('\r\n\r\n')[1]?.replace(/\r\n$/, '') || '';
  return { metadata: JSON.parse(contentOf(parts[1])), media: contentOf(parts[2]) };
}

function makeDrive(initial = {}) {
  const state = {
    folders: [...(initial.folders || [])],
    files: [...(initial.files || [])],
    calls: [],
    tokenCalls: [],
    revoked: [],
    challenge: '',
    folderSequence: initial.folders?.length || 0,
    fileSequence: initial.files?.length || 0,
    modifiedSequence: 2,
  };

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || 'GET').toUpperCase();
    state.calls.push({ url: url.toString(), method, options });

    if (url.toString() === TOKEN_URL) {
      const params = new URLSearchParams(String(options.body || ''));
      state.tokenCalls.push(params);
      if (params.get('grant_type') === 'authorization_code') {
        assert.equal(params.get('code'), 'auth-code');
        assert.equal(pkceChallenge(params.get('code_verifier')), state.challenge);
        return response({
          access_token: 'access-1',
          refresh_token: 'refresh-secret',
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/drive.file',
        });
      }
      if (params.get('grant_type') === 'refresh_token') {
        if (params.get('refresh_token') === 'bad-refresh') {
          return response({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
        }
        return response({ access_token: `access-refresh-${state.tokenCalls.length}`, expires_in: 3600 });
      }
      return response({ error: 'unsupported_grant_type' }, 400);
    }

    if (url.toString() === REVOKE_URL) {
      state.revoked.push(new URLSearchParams(String(options.body || '')).get('token'));
      return response({});
    }

    if (url.toString() === USERINFO_URL) {
      assert.match(String(options.headers?.authorization || ''), /^Bearer access-/);
      return response({ email: 'viewer@example.test', name: 'Viewer Example' });
    }

    const authorization = String(options.headers?.authorization || '');
    assert.match(authorization, /^Bearer access-/);

    if (`${url.origin}${url.pathname}` === `${API_BASE}/files` && method === 'GET') {
      const query = url.searchParams.get('q') || '';
      if (query.includes('application/vnd.google-apps.folder')) {
        return response({
          files: state.folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            createdTime: folder.createdTime,
            modifiedTime: folder.modifiedTime || folder.createdTime,
          })),
        });
      }
      const folderId = /^'([^']+)' in parents/.exec(query)?.[1] || '';
      return response({ files: state.files.filter((file) => file.parents?.includes(folderId)).map(apiFile) });
    }

    if (`${url.origin}${url.pathname}` === `${API_BASE}/files` && method === 'POST') {
      const metadata = JSON.parse(String(options.body || '{}'));
      assert.equal(metadata.name, GOOGLE_DRIVE_SYNC_FOLDER_NAME);
      assert.equal(metadata.mimeType, 'application/vnd.google-apps.folder');
      state.folderSequence += 1;
      const folder = {
        id: `folder-${state.folderSequence}`,
        name: metadata.name,
        createdTime: `2026-01-0${state.folderSequence}T00:00:00.000Z`,
        modifiedTime: `2026-01-0${state.folderSequence}T00:00:00.000Z`,
      };
      state.folders.push(folder);
      return response(folder);
    }

    const driveFilePath = /^\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (url.origin === 'https://drive.test' && driveFilePath && method === 'PATCH') {
      const file = state.files.find((entry) => entry.id === decodeURIComponent(driveFilePath[1]));
      assert.ok(file, 'moved file exists');
      const add = url.searchParams.get('addParents') || '';
      const remove = new Set((url.searchParams.get('removeParents') || '').split(',').filter(Boolean));
      file.parents = [...(file.parents || []).filter((parent) => !remove.has(parent)), add].filter(Boolean);
      return response({ id: file.id, parents: file.parents });
    }

    if (url.origin === 'https://drive.test' && driveFilePath && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const file = state.files.find((entry) => entry.id === decodeURIComponent(driveFilePath[1]));
      return file ? response(file.content || '', 200, false) : response({ error: { message: 'not found' } }, 404);
    }

    if (`${url.origin}${url.pathname}` === `${UPLOAD_BASE}/files` && method === 'POST') {
      const { metadata, media } = multipartParts(options);
      state.fileSequence += 1;
      state.modifiedSequence += 1;
      const file = {
        id: `file-${state.fileSequence}`,
        name: metadata.name,
        parents: metadata.parents,
        content: media,
        createdTime: `2026-02-0${state.fileSequence}T00:00:00.000Z`,
        modifiedTime: `2026-02-0${state.modifiedSequence}T00:00:00.000Z`,
      };
      state.files.push(file);
      return response({ id: file.id, name: file.name, parents: file.parents });
    }

    const uploadFilePath = /^\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (url.origin === 'https://upload.test' && uploadFilePath && method === 'PATCH') {
      const file = state.files.find((entry) => entry.id === decodeURIComponent(uploadFilePath[1]));
      if (!file) return response({ error: { message: 'not found' } }, 404);
      file.content = String(options.body || '');
      state.modifiedSequence += 1;
      file.modifiedTime = `2026-03-0${state.modifiedSequence}T00:00:00.000Z`;
      return response({ id: file.id, name: file.name, parents: file.parents });
    }

    throw new Error(`Unexpected fake Drive request: ${method} ${url}`);
  };

  return { state, fetchImpl };
}

function makeService({ store = new MemoryStore(), drive = makeDrive(), openExternal = null, clientId = 'desktop-client', clientSecret = 'desktop-secret' } = {}) {
  return new GoogleDriveSyncService({
    store,
    clientId,
    clientSecret,
    fetchImpl: drive.fetchImpl,
    openExternal,
    protectSecret: (value) => ({ protected: true, value: `enc:${Buffer.from(value).toString('base64')}` }),
    unprotectSecret: (record) => {
      const value = String(record?.value || '');
      return value.startsWith('enc:') ? Buffer.from(value.slice(4), 'base64').toString('utf8') : value;
    },
    randomBytes: (size) => Buffer.alloc(size, 7),
    randomUUID: () => 'fixed-boundary-id',
    authUrl: 'https://accounts.test/auth',
    tokenUrl: TOKEN_URL,
    revokeUrl: REVOKE_URL,
    userinfoUrl: USERINFO_URL,
    apiBaseUrl: API_BASE,
    uploadBaseUrl: UPLOAD_BASE,
  });
}

test('Windows Google Drive sync reports an unconfigured build without starting OAuth', async () => {
  const service = makeService({ clientId: '', clientSecret: '' });
  const settings = await service.settings();
  assert.equal(settings.needsSetup, true);
  assert.equal(settings.configured, false);
  assert.equal(settings.granted, false);
  assert.match(settings.setupMessage, /not configured/);
  await assert.rejects(service.connect(), /not configured/);
  await assert.rejects(service.readFiles(), /not configured/);
});

test('Windows Google Drive sync connects with PKCE, protects the refresh token and creates its folder', async () => {
  const store = new MemoryStore();
  const drive = makeDrive();
  const service = makeService({
    store,
    drive,
    openExternal: async (rawUrl) => {
      const authUrl = new URL(rawUrl);
      assert.equal(authUrl.searchParams.get('client_id'), 'desktop-client');
      assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(authUrl.searchParams.get('access_type'), 'offline');
      assert.match(authUrl.searchParams.get('scope') || '', /drive\.file/);
      drive.state.challenge = authUrl.searchParams.get('code_challenge');
      const redirect = new URL(authUrl.searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'auth-code');
      redirect.searchParams.set('state', authUrl.searchParams.get('state'));
      const callback = await fetch(redirect);
      assert.equal(callback.ok, true);
      assert.match(await callback.text(), /Mikozora is connected/);
    },
  });

  const settings = await service.connect();
  assert.equal(settings.configured, true);
  assert.equal(settings.granted, true);
  assert.equal(settings.account, 'viewer@example.test');
  assert.equal(settings.displayName, 'Viewer Example');
  assert.equal(drive.state.folders.length, 1);
  assert.equal(drive.state.folders[0].name, GOOGLE_DRIVE_SYNC_FOLDER_NAME);
  const saved = JSON.stringify(store.get('googleDriveSync'));
  assert.equal(saved.includes('refresh-secret'), false, 'refresh token must go through the protection hook');
  assert.equal(store.get('googleDriveSync').refreshToken.protected, true);
});

test('Windows Google Drive sync reads a peer file, updates only its own file and leaves Drive files on disconnect', async () => {
  const folder = {
    id: 'folder-existing',
    name: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
    createdTime: '2026-01-01T00:00:00.000Z',
    modifiedTime: '2026-01-01T00:00:00.000Z',
  };
  const drive = makeDrive({
    folders: [folder],
    files: [{
      id: 'peer-file',
      name: PEER_NAME,
      parents: [folder.id],
      content: '{"peer":true}',
      createdTime: '2026-01-02T00:00:00.000Z',
      modifiedTime: '2026-01-02T00:00:00.000Z',
    }, {
      id: 'not-sync',
      name: 'notes.txt',
      parents: [folder.id],
      content: 'ignore me',
      createdTime: '2026-01-03T00:00:00.000Z',
      modifiedTime: '2026-01-03T00:00:00.000Z',
    }],
  });
  const store = new MemoryStore();
  store.set('googleDriveSync', {
    account: 'viewer@example.test',
    displayName: 'Viewer Example',
    folderId: folder.id,
    refreshToken: { protected: true, value: `enc:${Buffer.from('refresh-secret').toString('base64')}` },
    needsReconnect: false,
  });
  const service = makeService({ store, drive });

  await service.writeFile(OWN_NAME, '{"own":1}');
  let listed = await service.readFiles();
  assert.deepEqual(listed.files.map((file) => file.name), [PEER_NAME, OWN_NAME]);
  assert.deepEqual(listed.files.map((file) => file.text), ['{"peer":true}', '{"own":1}']);

  await service.writeFile(OWN_NAME, '{"own":2}');
  assert.equal(drive.state.files.filter((file) => file.name === OWN_NAME).length, 1);
  listed = await service.readFiles();
  assert.equal(listed.files.find((file) => file.name === OWN_NAME)?.text, '{"own":2}');

  await assert.rejects(service.writeFile('../mikozora-sync-windows-aaaaaaaaaaaaaaaa.json', '{}'), /Invalid device-sync file name/);
  await assert.rejects(service.writeFile(OWN_NAME, 'x'.repeat(DEVICE_SYNC_MAX_FILE_BYTES + 1)), /too large/);

  const disconnected = await service.disconnect();
  assert.equal(disconnected.configured, false);
  assert.deepEqual(drive.state.revoked, ['refresh-secret']);
  assert.equal(drive.state.files.some((file) => file.name === OWN_NAME), true, 'disconnect must not delete Drive files');
  await assert.rejects(service.readFiles(), /reconnected/);
});

test('Windows Google Drive sync canonicalizes duplicate Mikozora folders', async () => {
  const oldest = {
    id: 'folder-old',
    name: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
    createdTime: '2026-01-01T00:00:00.000Z',
    modifiedTime: '2026-01-01T00:00:00.000Z',
  };
  const duplicate = {
    id: 'folder-new',
    name: GOOGLE_DRIVE_SYNC_FOLDER_NAME,
    createdTime: '2026-01-02T00:00:00.000Z',
    modifiedTime: '2026-01-02T00:00:00.000Z',
  };
  const drive = makeDrive({
    folders: [duplicate, oldest],
    files: [{
      id: 'own-file',
      name: OWN_NAME,
      parents: [duplicate.id],
      content: '{"own":1}',
      createdTime: '2026-01-03T00:00:00.000Z',
      modifiedTime: '2026-01-03T00:00:00.000Z',
    }, {
      id: 'peer-file',
      name: PEER_NAME,
      parents: [duplicate.id],
      content: '{"peer":true}',
      createdTime: '2026-01-04T00:00:00.000Z',
      modifiedTime: '2026-01-04T00:00:00.000Z',
    }],
  });
  const store = new MemoryStore();
  store.set('googleDriveSync', {
    account: 'viewer@example.test',
    displayName: '',
    folderId: duplicate.id,
    refreshToken: { protected: false, value: 'refresh-secret' },
    needsReconnect: false,
  });
  const service = makeService({ store, drive });

  await service.writeFile(OWN_NAME, '{"own":2}');
  const own = drive.state.files.find((file) => file.name === OWN_NAME);
  assert.deepEqual(own.parents, [oldest.id], 'the existing own file should move to the oldest Mikozora folder');
  assert.equal(store.get('googleDriveSync').folderId, oldest.id);
  assert.deepEqual((await service.readFiles()).files.map((file) => file.name), [PEER_NAME, OWN_NAME]);
});

test('Windows Google Drive sync marks an invalid refresh token as needing reconnect', async () => {
  const store = new MemoryStore();
  store.set('googleDriveSync', {
    account: 'viewer@example.test',
    displayName: 'Viewer Example',
    folderId: 'folder-existing',
    refreshToken: { protected: false, value: 'bad-refresh' },
    needsReconnect: false,
  });
  const service = makeService({ store });

  await assert.rejects(service.readFiles(), /reconnected/);
  const settings = await service.settings();
  assert.equal(settings.configured, true);
  assert.equal(settings.granted, false);
  assert.equal(settings.needsReconnect, true);
  assert.equal(store.get('googleDriveSync').refreshToken.value, '');
});
