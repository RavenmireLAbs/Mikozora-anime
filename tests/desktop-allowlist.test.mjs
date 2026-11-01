import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, allowedSource, allowedProjectRelease, isHttps, sourceBase, matchesSource, refererFor } from '../desktop/src/lib/allowlist.js';

test('desktop allowlist mirrors Network.java document/image host rules', () => {
  assert.equal(allowedSource('https://animesogo.to/home'), true);
  assert.equal(allowedSource('https://api.github.com/repos/x'), true);
  assert.equal(allowedSource('http://animesogo.to/home'), false); // https only
  assert.equal(allowedSource('https://user@animesogo.to/'), false); // no userinfo
  assert.equal(allowedSource('https://animesogo.to:8443/'), false); // port must be 443
  assert.equal(allowedSource('https://evil.animesogo.to/'), false); // exact hosts, no subdomains
  assert.equal(allowedSource('https://animesogo.to.evil.com/'), false);
  assert.equal(checkUrl('https://static.aniwaves.ru/a.jpg', false).hostname, 'static.aniwaves.ru');
  assert.throws(() => checkUrl('https://static.aniwaves.ru/a', true), /Unsupported source host/); // image-only host
  assert.throws(() => checkUrl('not a url', true), /Invalid source URL/);
});

test('desktop external-open rules stay scoped (source links + own releases)', () => {
  assert.equal(allowedProjectRelease('https://github.com/RavenmireLAbs/Mikozora-anime/releases/latest'), true);
  assert.equal(allowedProjectRelease('https://github.com/RavenmireLAbs/Mikozora-anime/releases/download/v1/x.exe'), true);
  assert.equal(allowedProjectRelease('https://github.com/RavenmireLAbs/Mikozora-anime/issues'), false);
  assert.equal(allowedProjectRelease('https://github.com/other/repo/releases/x'), false);
});

test('source base/name/matching and referer rules match Android', () => {
  assert.equal(sourceBase('sogo'), 'https://animesogo.to');
  assert.equal(sourceBase('nope'), '');
  assert.equal(matchesSource('sogo', 'https://animesogo.to/watch/x'), true);
  assert.equal(matchesSource('sogo', 'https://animesuge.cz/watch/x'), false);
  assert.equal(matchesSource('nope', 'https://animesogo.to/'), false);
  assert.equal(refererFor(new URL('https://animexin.dev/a')), 'https://animexin.dev/');
  assert.equal(refererFor(new URL('https://static.aniwaves.ru/a.jpg')), 'https://aniwaves.ru/');
  assert.equal(refererFor(new URL('https://image.tmdb.org/a.jpg')), 'https://animesogo.to/');
  assert.equal(isHttps('https://cdn.example.com/x.m3u8'), true);
  assert.equal(isHttps('https://192.168.1.1/x'), false);
  assert.equal(isHttps('https://localhost/x'), false);
});
