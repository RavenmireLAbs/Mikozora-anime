import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('permanent signing is environment-driven and release publication cannot silently fall back to debug', async () => {
  const [gradle, workflow, gitignore, guide] = await Promise.all([
    read('android/app/build.gradle'),
    read('.github/workflows/android.yml'),
    read('.gitignore'),
    read('docs/SIGNING.md'),
  ]);

  for (const name of [
    'MIKOZORA_KEYSTORE_PATH',
    'MIKOZORA_KEYSTORE_PASSWORD',
    'MIKOZORA_KEY_ALIAS',
    'MIKOZORA_KEY_PASSWORD',
    'MIKOZORA_KEYSTORE_TYPE',
  ]) {
    assert.match(gradle, new RegExp(name));
  }
  assert.match(gradle, /signingConfigs\s*\{\s*release\s*\{/);
  assert.match(gradle, /storeFile file\(releaseKeystorePath\)/);
  assert.match(gradle, /storeType releaseKeystoreType/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.match(gradle, /applicationId 'app\.moku\.anime'/);

  for (const name of [
    'MIKOZORA_KEYSTORE_BASE64',
    'MIKOZORA_KEYSTORE_PASSWORD',
    'MIKOZORA_KEY_ALIAS',
    'MIKOZORA_KEY_PASSWORD',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${name}`));
    assert.match(guide, new RegExp(name));
  }
  assert.match(workflow, /Prepare permanent release signing/);
  assert.match(workflow, /Missing required GitHub Actions secret/);
  assert.match(workflow, /steps\.release\.outputs\.publish == 'true' && github\.event_name != 'pull_request'/);
  assert.match(workflow, /\.\/gradlew assembleRelease\n/);
  assert.match(workflow, /apksigner" verify --verbose --print-certs app\/build\/outputs\/apk\/Mikozora\.apk/);
  assert.match(workflow, /Prepare throwaway CI signing check/);
  assert.match(workflow, /\.\/gradlew assembleRelease assembleDebug/);
  assert.match(workflow, /cp release\/Mikozora\.apk "\$release_apk"/);
  assert.doesNotMatch(workflow, /cp release\/app-debug\.apk/);

  // Regression (v0.13.0 first publishing run): the alias secret's value
  // ("Mikozora") appears inside the release APK filename and the former temp
  // keystore filenames, and GitHub discards job outputs that may contain a
  // secret ("Skip output 'apk' since it may contain secret"). The asset name
  // must be derived inside the release job from the safe `tag` output, and
  // keystore locations must use fixed paths rather than step/job outputs.
  assert.doesNotMatch(workflow, /steps\.release\.outputs\.apk/);
  assert.doesNotMatch(workflow, /needs\.build\.outputs\.apk/);
  assert.doesNotMatch(workflow, /keystore_path/);
  assert.match(workflow, /release_apk="Mikozora-\$\{RELEASE_TAG\}-Android\.apk"/);
  assert.match(workflow, /MIKOZORA_KEYSTORE_PATH: \$\{\{ runner\.temp \}\}\/release-signing\.p12/);
  assert.match(workflow, /MIKOZORA_KEYSTORE_PATH: \$\{\{ runner\.temp \}\}\/ci-signing-test\.p12/);
  assert.match(workflow, /keytool -importkeystore -noprompt/);
  assert.match(workflow, /The permanent signing secrets do not open the key/);

  for (const pattern of ['*.jks', '*.keystore', '*.p12', '*.pfx', 'key.properties']) {
    assert.ok(gitignore.split(/\r?\n/).includes(pattern), `${pattern} is ignored`);
  }
  assert.match(guide, /Do not send the keystore or its passwords in chat/);
  assert.match(guide, /first permanently signed build must use\s+a new version/);
});
