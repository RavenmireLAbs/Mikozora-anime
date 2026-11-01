import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../android/app/src/main/java/app/moku/anime/MainActivity.java', import.meta.url), 'utf8');
const data = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');

test('native backup file pickers are wired to the bridge', () => {
  // Bridge entry points and the SAF intents behind them.
  assert.match(main, /saveBackupFile\(String id,String name,String text\)/);
  assert.match(main, /openBackupFile\(String id\)/);
  assert.match(main, /Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(main, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(main, /CREATE_BACKUP_FILE = 3182/);
  assert.match(main, /OPEN_BACKUP_FILE = 3183/);
  assert.match(main, /finishBackupSave\(int resultCode,Intent data\)/);
  assert.match(main, /finishBackupOpen\(int resultCode,Intent data\)/);
  // JS wrappers call the same methods and give the pickers the long timeout.
  assert.match(data, /bridgeCall\('saveBackupFile', name, text\)/);
  assert.match(data, /bridgeCall\('openBackupFile'\)/);
  assert.match(data, /method === 'saveBackupFile' \|\| method === 'openBackupFile'\) \? 300000/);
});
