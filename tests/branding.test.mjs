import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Mikozora branding is consistent while the legacy Android identity is retained', async () => {
  const [pkgText, lockText, gradle, settings, manifest, strings, workflow, index, readme] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('android/app/build.gradle'),
    read('android/settings.gradle'),
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/values/strings.xml'),
    read('.github/workflows/android.yml'),
    read('index.html'),
    read('README.md'),
  ]);
  const pkg = JSON.parse(pkgText);
  const lock = JSON.parse(lockText);

  assert.equal(pkg.name, 'Mikozora');
  assert.equal(lock.name, 'Mikozora');
  assert.equal(lock.packages[''].name, 'Mikozora');
  assert.match(settings, /rootProject\.name = 'Mikozora'/);
  assert.match(strings, /<string name="app_name">Mikozora<\/string>/);
  assert.match(manifest, /android:icon="@drawable\/ic_mikozora"/);
  assert.match(manifest, /android:label="@string\/app_name"/);
  assert.doesNotMatch(manifest, /android:label="Moku"/);
  assert.match(index, /<title>Mikozora — your anime space<\/title>/);
  assert.match(readme, /^# Mikozora\n/);
  assert.match(readme, /Mikozora was previously called Moku/);
  assert.match(readme, /legacy `app\.moku\.anime` and `moku\.\*` values/);

  assert.match(workflow, /apk=Mikozora-\$\{tag\}-Android\.apk/);
  assert.equal((workflow.match(/name: Mikozora-Android-debug/g) || []).length, 2);
  assert.match(workflow, /--title "Mikozora \$RELEASE_TAG"/);
  assert.doesNotMatch(workflow, /Moku-(?:\$\{tag\}|Android)|--title "Moku /);

  // Android identity is not the same thing as the visible brand. Keeping the
  // pre-rebrand application ID preserves the in-place update/data boundary.
  assert.match(gradle, /namespace 'app\.moku\.anime'/);
  assert.match(gradle, /applicationId 'app\.moku\.anime'/);
});
