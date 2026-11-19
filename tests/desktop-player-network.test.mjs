import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOnlineStreamContext,
  cleanUserAgent,
  onlineStreamHeaders,
  onlineStreamResponseHeaders,
  playerEmbedHeaders,
  playerRefererForEpisode,
  playerRequestHeaders,
  playerResponseHeaders,
} from '../desktop/src/lib/player-network.js';

test('player referer is the validated source origin, mirroring the Android wrapper', () => {
  assert.equal(playerRefererForEpisode('https://animesogo.to/watch/example/ep-3'), 'https://animesogo.to/');
  assert.equal(playerRefererForEpisode('https://animexin.dev/example-episode-3/'), 'https://animexin.dev/');
  assert.equal(playerRefererForEpisode('https://example.com/watch'), '');
  assert.equal(playerRefererForEpisode('http://animesogo.to/watch/example/ep-3'), '');
  assert.equal(playerRefererForEpisode('https://user@animesogo.to/watch/example/ep-3'), '');
  assert.equal(playerRefererForEpisode('not a url'), '');
});

test('only player sub-frames launched from the app get the source referer', () => {
  const details = {
    url: 'https://embed.example/play',
    resourceType: 'subFrame',
    referrer: 'mikozora://app/',
    requestHeaders: { referer: 'mikozora://app/', 'User-Agent': 'Chromium' },
  };
  assert.deepEqual(playerEmbedHeaders(details, 'https://animesogo.to/'), {
    Referer: 'https://animesogo.to/',
    'User-Agent': 'Chromium',
  });

  // Electron's initiator origin identifies the launch even if no header was sent.
  assert.equal(
    playerEmbedHeaders({ ...details, referrer: '', initiatorOrigin: 'mikozora://app', requestHeaders: {} }, 'https://animesogo.to/').Referer,
    'https://animesogo.to/',
  );

  // An opaque serialized initiator must not hide a real app referrer.
  assert.equal(
    playerEmbedHeaders({ ...details, initiatorOrigin: 'null' }, 'https://animesogo.to/').Referer,
    'https://animesogo.to/',
  );

  // Scripts/media inside the already-loaded embed keep their own referrer.
  assert.deepEqual(playerEmbedHeaders({ ...details, resourceType: 'media' }, 'https://animesogo.to/'), details.requestHeaders);
  // A frame launched by the embed itself is not a Mikozora player launch.
  assert.deepEqual(
    playerEmbedHeaders({ ...details, referrer: 'https://embed.example/play' }, 'https://animesogo.to/'),
    details.requestHeaders,
  );
  // No playback context: leave headers untouched.
  assert.deepEqual(playerEmbedHeaders(details, ''), details.requestHeaders);
});

test('Electron and application tokens are removed from the browser user agent', () => {
  assert.equal(
    cleanUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Mikozora/0.21.0 Chrome/140.0.0.0 Electron/45.2.1 Safari/537.36'),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  );
});

test('online stream context validates HTTPS URLs and scopes headers to the stream host', () => {
  const now = 1_000_000;
  const ctx = cleanOnlineStreamContext({ url: 'https://cdn.example/master.m3u8', referer: 'https://animesogo.to/' }, now);
  assert.equal(ctx.host, 'cdn.example');
  assert.equal(cleanOnlineStreamContext({ url: 'http://cdn.example/master.m3u8', referer: 'https://animesogo.to/' }, now), null);

  const req = onlineStreamHeaders({
    url: 'https://cdn.example/seg.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    requestHeaders: { Origin: 'mikozora://app', Referer: 'mikozora://app/' },
  }, ctx, now + 1000);
  assert.equal(req.Referer, 'https://animesogo.to/');
  assert.equal(req.Origin, undefined);

  const unrelated = onlineStreamHeaders({
    url: 'https://other.example/seg.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    requestHeaders: { Referer: 'mikozora://app/' },
  }, ctx, now + 1000);
  assert.equal(unrelated.Referer, 'mikozora://app/');

  const res = onlineStreamResponseHeaders({
    url: 'https://cdn.example/seg.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    responseHeaders: {},
  }, ctx, now + 1000);
  assert.deepEqual(res['Access-Control-Allow-Origin'], ['*']);
  assert.deepEqual(playerResponseHeaders({
    url: 'https://cdn.example/seg.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    responseHeaders: {},
  }, ctx, now + 1000)['Access-Control-Allow-Origin'], ['*']);
  assert.equal(playerRequestHeaders({
    url: 'https://cdn.example/seg.ts',
    resourceType: 'xhr',
    referrer: 'mikozora://app/',
    requestHeaders: {},
  }, 'https://animesogo.to/', ctx, now + 1000).Referer, 'https://animesogo.to/');
});
