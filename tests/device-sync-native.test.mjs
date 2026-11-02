import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared data layer exposes the bounded device-sync bridge contract', () => {
  const data = read('src/data.js');
  const backup = read('src/backup.js');
  const engine = read('src/device-sync.js');

  for (const method of [
    'deviceSyncSettings',
    'chooseDeviceSyncFolder',
    'clearDeviceSyncFolder',
    'readDeviceSyncFolder',
    'writeDeviceSyncFile',
  ]) {
    assert.ok(data.includes(`typeof window.MokuBridge.${method} === 'function'`), `feature check for ${method}`);
    assert.ok(data.includes(`bridgeCall('${method}'`), `wrapper for ${method}`);
  }
  assert.match(data, /\['chooseDownloadFolder', 'chooseDeviceSyncFolder', 'saveBackupFile', 'openBackupFile'\]\.includes\(method\) \? 300000/);
  assert.match(data, /\['readDeviceSyncFolder', 'writeDeviceSyncFile'\]\.includes\(method\) \? 120000/);
  assert.match(data, /return \{ files: Array\.isArray\(result\?\.files\) \? result\.files : \[\] \}/);

  // Device identity, tombstones and publish state are per-installation data.
  // They must never travel through the manual backup format.
  assert.ok(engine.includes("export const DEVICE_SYNC_KEY = 'moku.deviceSync.v1'"));
  assert.ok(!backup.includes('moku.deviceSync.v1'));
});

test('Android keeps the sync folder in a separate persisted SAF grant', () => {
  const main = read('android/app/src/main/java/app/moku/anime/MainActivity.java');
  const store = read('android/app/src/main/java/app/moku/anime/SyncStore.java');

  assert.match(main, /PICK_SYNC_FOLDER = 3184/);
  assert.match(main, /pendingSyncFolderRequest=state\.getString\("syncFolderRequestId"\)/);
  assert.match(main, /out\.putString\("syncFolderRequestId",pendingSyncFolderRequest\)/);
  assert.match(main, /deviceSyncSettings\(String id\)/);
  assert.match(main, /chooseDeviceSyncFolder\(String id\)/);
  assert.match(main, /clearDeviceSyncFolder\(String id\)/);
  assert.match(main, /readDeviceSyncFolder\(String id\)/);
  assert.match(main, /writeDeviceSyncFile\(String id,String name,String text\)/);
  assert.match(main, /finishSyncFolderPick\(int resultCode,Intent data\)/);
  assert.match(main, /SyncStore\.saveFolder\(this,tree\)/);
  assert.match(main, /SyncStore\.readFolder\(MainActivity\.this\)/);
  assert.match(main, /SyncStore\.writeFile\(MainActivity\.this,name,text\)/);
  assert.match(main, /Intent\.ACTION_OPEN_DOCUMENT_TREE/);
  assert.match(main, /takePersistableUriPermission\(tree,grants\)/);
  assert.match(main, /pendingFolderRequest!=null\|\|pendingSyncFolderRequest!=null/);
  assert.match(main, /pendingSyncFolderRequest!=null\|\|pendingFolderRequest!=null/);

  assert.match(store, /PREFS = "moku_device_sync_folder"/);
  assert.ok(!store.includes('moku_export_folder'), 'sync folder must not reuse the export-folder record');
  assert.match(store, /mikozora-sync-\(android\|windows\)-\[a-f0-9\]\{16\}/);
  assert.match(store, /MAX_FILE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(store, /MAX_FILES = 12/);
  assert.match(store, /MAX_TOTAL_BYTES = 24 \* 1024 \* 1024/);
  assert.match(store, /getPersistedUriPermissions/);
  assert.match(store, /buildChildDocumentsUriUsingTree/);
  assert.match(store, /createDocument\(context\.getContentResolver\(\), root, "application\/json", name\)/);
  assert.match(store, /openOutputStream\(target, "wt"\)/);
  assert.match(store, /deleteDocument\(context\.getContentResolver\(\), target\)/);
  assert.match(store, /Files already placed in the user's shared folder stay there/);
});

test('Windows exposes the same five calls through the isolated preload and service', () => {
  const preload = read('desktop/src/preload.cjs');
  const bridge = read('desktop/src/bridge.js');
  const main = read('desktop/src/main.js');
  const service = read('desktop/src/lib/device-sync-service.js');

  for (const method of [
    'deviceSyncSettings',
    'chooseDeviceSyncFolder',
    'clearDeviceSyncFolder',
    'readDeviceSyncFolder',
    'writeDeviceSyncFile',
  ]) {
    assert.ok(preload.includes(`${method}: call('${method}')`), `preload for ${method}`);
    assert.ok(bridge.includes(`method === '${method}'`), `dispatch for ${method}`);
  }
  assert.match(bridge, /downloadService = null, episodeService = null, deviceSyncService = null/);
  assert.match(bridge, /const requireDeviceSync = \(\) =>/);
  assert.match(bridge, /async function chooseDeviceSyncFolder\(win, service\)/);
  assert.match(bridge, /if \(folderPickerOpen\) throw new Error\('A folder picker is already open\.'\)/);
  assert.match(main, /import \{ DeviceSyncService \} from '\.\/lib\/device-sync-service\.js'/);
  assert.match(main, /deviceSyncService = new DeviceSyncService\(\{ store \}\)/);
  assert.match(main, /downloadService, episodeService, deviceSyncService\)/);

  assert.match(service, /const STORE_KEY = 'deviceSyncFolder'/);
  assert.ok(!service.includes("'downloadFolder'"), 'sync folder must not reuse the download-folder record');
  assert.match(service, /mikozora-sync-\(android\|windows\)-\[a-f0-9\]\{16\}/);
  assert.match(service, /DEVICE_SYNC_MAX_FILE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(service, /DEVICE_SYNC_MAX_FILES = 12/);
  assert.match(service, /DEVICE_SYNC_MAX_TOTAL_BYTES = 24 \* 1024 \* 1024/);
  assert.match(service, /await writeFile\(temp, body, 'utf8'\)/);
  assert.match(service, /await rename\(temp, target\)/);
  assert.match(service, /sort\(\(a, b\) => b\.modifiedAt - a\.modifiedAt/);
});

test('shared UI merges in place and publishes only after the native write succeeds', () => {
  const ui = read('src/main.jsx');

  assert.match(ui, /hasDeviceSync, getDeviceSyncSettings, chooseDeviceSyncFolder, clearDeviceSyncFolder, readDeviceSyncFolder, writeDeviceSyncFile/);
  assert.match(ui, /markDeviceSyncPublished, prepareDeviceSync, publicDeviceSyncMeta, readDeviceSyncMeta, setDeviceSyncAuto, stableStringify/);
  assert.match(ui, /function DeviceSyncSettings/);
  assert.match(ui, /Shared sync folder/);
  assert.match(ui, /Automatic sync/);
  assert.match(ui, /anyone or any service that can read this folder can see/);
  assert.match(ui, /Downloaded episodes and queues/);
  assert.match(ui, /<DeviceSyncSettings \{\.\.\.deviceSync\}\/>/);
  assert.match(ui, /deviceSync=\{\{available:deviceSyncAvailable,folder:deviceSyncFolder,meta:deviceSyncMeta,status:deviceSyncStatus,choose:chooseSyncFolder,disconnect:disconnectSyncFolder,syncNow:syncDevicesNow,changeAuto:changeDeviceSyncAuto\}\}/);

  for (const reason of ['startup', 'focus', 'periodic', 'change', 'manual', 'folder']) {
    assert.ok(ui.includes(`reason:'${reason}'`));
  }
  assert.match(ui, /flushDeviceSyncState\(\);\s*const prepared=prepareDeviceSync/);
  assert.match(ui, /await writeDeviceSyncFile\(prepared\.fileName,prepared\.payloadText\);\s*publishedIdentity=markDeviceSyncPublished/);

  const start = ui.indexOf('const runDeviceSync=');
  const end = ui.indexOf('deviceSyncRun.current=runDeviceSync;', start);
  assert.ok(start >= 0 && end > start);
  const run = ui.slice(start, end);
  assert.match(run, /applyDeviceSyncSnapshot\(prepared\.data\)/);
  assert.ok(!run.includes('window.location.reload()'), 'device sync must not disrupt the current screen with a reload');
});
