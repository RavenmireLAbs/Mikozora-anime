import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('Android App Lock uses the system device credential and protects app surfaces', async () => {
  const [appLock, gate, application, manifest, bridge, ui, data] = await Promise.all([
    read('android/app/src/main/java/app/moku/anime/AppLock.java'),
    read('android/app/src/main/java/app/moku/anime/AppLockActivity.java'),
    read('android/app/src/main/java/app/moku/anime/MokuApplication.java'),
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/moku/anime/MainActivity.java'),
    read('src/main.jsx'),
    read('src/data.js'),
  ]);
  assert.match(appLock, /KeyguardManager/);
  assert.match(appLock, /isDeviceSecure\(\)/);
  assert.match(appLock, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(gate, /createConfirmDeviceCredentialIntent/);
  assert.match(gate, /RESULT_OK/);
  assert.match(application, /registerActivityLifecycleCallbacks/);
  assert.match(application, /AppLock\.requireUnlock/);
  assert.match(manifest, /\.AppLockActivity/);
  assert.match(bridge, /appLockSettings\(String id\)/);
  assert.match(bridge, /setAppLockEnabled\(String id,boolean enabled\)/);
  assert.match(ui, /Lock Mikozora/);
  assert.match(ui, /Recent-app screenshots and widget titles are hidden/);
  assert.match(data, /export function hasAppLock\(\)/);
});

test('Android Continue Watching widget is launcher-discoverable, updates privately, and opens Mikozora', async () => {
  const [manifest, info, layout, provider, bridge, ui] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/xml/home_widget_info.xml'),
    read('android/app/src/main/res/layout/home_widget.xml'),
    read('android/app/src/main/java/app/moku/anime/HomeWidgetProvider.java'),
    read('android/app/src/main/java/app/moku/anime/MainActivity.java'),
    read('src/main.jsx'),
  ]);
  assert.match(manifest, /\.HomeWidgetProvider/);
  assert.match(manifest, /android\.appwidget\.action\.APPWIDGET_UPDATE/);
  assert.match(info, /android:widgetCategory="home_screen"/);
  assert.match(info, /@layout\/home_widget/);
  assert.match(layout, /@\+id\/widget_title/);
  assert.match(layout, /@\+id\/widget_episode/);
  assert.match(provider, /PendingIntent\.getActivity/);
  assert.match(provider, /FLAG_ACTIVITY_NEW_TASK \| Intent\.FLAG_ACTIVITY_CLEAR_TOP/);
  assert.match(provider, /EXTRA_OPEN_ITEM/);
  assert.match(bridge, /takeOpenWidgetItem\(\)/);
  assert.match(bridge, /queueWidgetOpen\(intent\)/);
  assert.match(ui, /moku-open-widget/);
  assert.match(provider, /Unlock Mikozora to view your list/);
  assert.match(provider, /AppLock\.enabled\(context\)/);
  assert.match(bridge, /updateHomeWidget\(String payload\)/);
  assert.match(ui, /updateHomeWidget\(\{title:widgetTitle,episode:widgetEpisode,source:widgetItem\?\.source/);
  assert.match(ui, /Next · Episode/);
  assert.match(ui, /takeOpenWidgetItem/);
  assert.match(ui, /moku-open-widget/);
});
