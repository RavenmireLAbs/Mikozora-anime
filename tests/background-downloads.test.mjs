import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shared data layer exposes the background-downloads bridge contract', () => {
  const data = read('src/data.js');
  for (const method of ['hasBackgroundDownloads', 'getBackgroundStatus', 'setBackgroundDownloads', 'requestBackgroundExemption']) {
    assert.ok(data.includes(method), `feature check for ${method}`);
  }
  assert.match(data, /bridgeCall\('backgroundStatus'\)/);
  assert.match(data, /bridgeCall\('setBackgroundDownloads'/);
  assert.match(data, /bridgeCall\('requestBackgroundExemption'\)/);
  // The feature gate checks for the two methods the UI depends on.
  assert.match(data, /typeof window\.MokuBridge\.backgroundStatus === 'function'/);
  assert.match(data, /typeof window\.MokuBridge\.setBackgroundDownloads === 'function'/);
});

test('Android bridge wires background status, toggle and battery exemption', () => {
  const main = read('android/app/src/main/java/app/moku/anime/MainActivity.java');
  assert.match(main, /public void backgroundStatus\(String id\)/);
  assert.match(main, /public void setBackgroundDownloads\(String id, ?String payload\)/);
  assert.match(main, /public void requestBackgroundExemption\(String id\)/);
  assert.match(main, /BackgroundDownloads\.status\(MainActivity\.this\)/);
  assert.match(main, /BackgroundDownloads\.setEnabled\(MainActivity\.this, ?enabled\)/);
  assert.match(main, /BackgroundDownloads\.requestExemption\(MainActivity\.this\)/);
});

test('Android manifest allows the battery-optimization exemption request', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
});

test('Android recovers interrupted downloads and exports after a restart', () => {
  const store = read('android/app/src/main/java/app/moku/anime/OfflineStore.java');
  assert.match(store, /static JSONObject recover\(Context c, ?boolean startup\)/);
  assert.match(store, /static boolean hasPendingRecovery\(Context c\)/);
  assert.match(store, /RecoveryPlan\.shouldResetDownload/);
  assert.match(store, /RecoveryPlan\.shouldRequeueDownload/);
  assert.match(store, /RecoveryPlan\.shouldResetExport/);
  assert.match(store, /RecoveryPlan\.shouldRequeueExport/);
  assert.match(store, /RecoveryPlan\.shouldRescheduleCleanup/);
  assert.match(store, /enqueueUniqueWork\("moku-"\+id, ?ExistingWorkPolicy\.REPLACE, ?work\)/);
  // Startup refresh keeps the periodic recovery alive while work is pending.
  assert.match(store, /BackgroundDownloads\.refresh\(c\)/);

  const plan = read('android/app/src/main/java/app/moku/anime/RecoveryPlan.java');
  assert.match(plan, /static boolean isTerminal\(/);
  assert.match(plan, /static boolean shouldResetDownload\(/);
  assert.match(plan, /static boolean shouldRequeueDownload\(/);
  assert.match(plan, /static boolean isExportTerminal\(/);
  assert.match(plan, /static boolean shouldResetExport\(/);
  assert.match(plan, /static boolean shouldRequeueExport\(/);
  assert.match(plan, /static boolean shouldRescheduleCleanup\(/);
  // Paused and smart-stopped downloads wait; they are not auto-resumed.
  assert.match(plan, /"paused".equals\(storedStatus\)/);
  assert.match(plan, /"stopped".equals\(mediaState\)/);

  const worker = read('android/app/src/main/java/app/moku/anime/DownloadRecoveryWorker.java');
  assert.match(worker, /OfflineStore\.recover\(c, ?false\)/);
  assert.match(worker, /BackgroundDownloads\.refresh\(c\)/);

  const background = read('android/app/src/main/java/app/moku/anime/BackgroundDownloads.java');
  assert.match(background, /static String batteryStatus\(Context c\)/);
  assert.match(background, /static void requestExemption\(Context c\)/);
  assert.match(background, /static void refresh\(Context c\)/);
  assert.match(background, /Settings\.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(background, /DownloadRecoveryWorker\.class, ?15, ?TimeUnit\.MINUTES/);

  const application = read('android/app/src/main/java/app/moku/anime/MokuApplication.java');
  assert.match(application, /OfflineStore\.recover\(this, ?true\)/);
  assert.match(application, /BackgroundDownloads\.refresh\(this\)/);
});

test('Windows app keeps background downloads always available', () => {
  const preload = read('desktop/src/preload.cjs');
  assert.match(preload, /backgroundStatus: call\('backgroundStatus'\)/);
  assert.match(preload, /setBackgroundDownloads: call\('setBackgroundDownloads'\)/);
  assert.match(preload, /requestBackgroundExemption: call\('requestBackgroundExemption'\)/);
  const bridge = read('desktop/src/bridge.js');
  assert.match(bridge, /method === 'backgroundStatus'/);
  assert.match(bridge, /method === 'setBackgroundDownloads'/);
  assert.match(bridge, /method === 'requestBackgroundExemption'/);
});

test('UI shows the background-downloads setting and downloads-page indicator', () => {
  const main = read('src/main.jsx');
  assert.match(main, /BACKGROUND DOWNLOADS/);
  assert.match(main, /backgroundDownloads=\{backgroundDownloads\}/);
  assert.match(main, /changeBackgroundDownloads=\{changeBackgroundDownloads\}/);
  assert.match(main, /requestBackgroundAccess=\{requestBackgroundAccess\}/);
  // Downloads page banner confirms the queue keeps running.
  assert.match(main, /Downloads continue in the background after you close Mikozora/);
});
