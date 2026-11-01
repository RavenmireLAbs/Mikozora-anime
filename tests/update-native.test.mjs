import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The update checker spans a JS/native contract: fetchLatestRelease rides the
// native document-host allowlist, and the Download action goes through the
// openExternal gate. Both sides must keep permitting this project's GitHub
// endpoints or the feature silently breaks (as it did before 0.18.0, when
// openExternal dropped github.com links without a trace).
test('native layer permits the GitHub endpoints the update checker uses', async () => {
  const network = await readFile('android/app/src/main/java/app/moku/anime/Network.java', 'utf8');
  const main = await readFile('android/app/src/main/java/app/moku/anime/MainActivity.java', 'utf8');
  // Fetch path: the API host stays on the document allowlist.
  assert.match(network, /DOCUMENT_HOSTS = new HashSet<>\(Arrays\.asList\([^)]*"api\.github\.com"/);
  // Open path: a releases-scoped exception exists and openExternal honors it.
  assert.match(network, /static boolean allowedProjectRelease\(/);
  assert.match(network, /"github\.com"\.equalsIgnoreCase\(u\.getHost\(\)\)/);
  assert.match(network, /\/RavenmireLAbs\/Mikozora-anime\/releases\//);
  assert.match(main, /allowedSource\(url\) && !Network\.allowedProjectRelease\(url\)/);
});
