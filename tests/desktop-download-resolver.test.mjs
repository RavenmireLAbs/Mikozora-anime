import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import {
  createVideoResolver, mediafireFile, megaSource, subtitleTracksForDownload, validateSelection,
} from '../desktop/src/lib/video-resolver.js';
import { hlsQualities } from '../desktop/src/lib/hls.js';

test('HLS quality labels mirror the Android parser', () => {
  const variants = hlsQualities(`#EXTM3U
#EXT-X-I-FRAME-STREAM-INF:RESOLUTION=3840x2160
#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360
a.m3u8
#EXT-X-STREAM-INF:RESOLUTION=1920x820,BANDWIDTH=3
b.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=640x360
c.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2
d.m3u8
`);
  assert.deepEqual(variants, [
    { id: 'v:1920x820', label: '1920 x 820' },
    { id: 'v:640x360', label: '360p - 640 x 360' },
  ]);
});

test('selection validation rejects path-like servers and malformed qualities', () => {
  assert.throws(() => validateSelection('sogo-invalid/../../x', 'best'), /Invalid download server/);
  assert.throws(() => validateSelection('auto', 'v:bad'), /Invalid download quality/);
  assert.doesNotThrow(() => validateSelection('sogo-server-0', 'v:1280x720'));
});

test('MegaPlay encrypted sources are decrypted and signed like Android', () => {
  const key = Buffer.alloc(32);
  Buffer.from('i?LMTAx0Q6,:}50U', 'utf8').copy(key);
  const iv = Buffer.from("W0;27ToaUpl_P%'c", 'utf8');
  const plain = JSON.stringify({
    file: `https://cdn.example/${'a'.repeat(32)}/${'b'.repeat(32)}/playlist.m3u8`,
  });
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64url');
  const signed = megaSource({ enc }, Date.UTC(2026, 0, 1));
  const url = new URL(signed);
  assert.equal(url.pathname, `/${'a'.repeat(32)}/${'b'.repeat(32)}/playlist.m3u8`);
  const token = url.searchParams.get('token') || '';
  const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  assert.match(payload, /^\d+\|a{32}\/b{32}$/);
  assert.equal(token.split('.').length, 2);
});

function sogoFixture() {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720.m3u8
`;
  const resolver = createVideoResolver({
    now: () => Date.UTC(2026, 0, 1),
    sourceGetText: async (url) => {
      if (url.includes('/ajax/server/list')) {
        return JSON.stringify({
          result: `<div class="type" data-type="sub"><a data-link-id="srv-1"><span>MegaPlay HD</span></a></div>
                   <div class="type" data-type="dub"><a data-link-id="dub-1"><span>Dub</span></a></div>`,
        });
      }
      if (url.includes('/ajax/server?get=')) {
        return JSON.stringify({ result: { url: 'https://megaplay.buzz/stream/example/1/sub?s=alpha' } });
      }
      throw new Error(`Unexpected source URL ${url}`);
    },
    hostText: async (url) => {
      if (url === 'https://megaplay.buzz/stream/example/1/sub?s=alpha') return '<main data-id="4242"></main>';
      if (url.startsWith('https://megaplay.buzz/stream/getSources')) {
        assert.match(url, /id=4242&s=alpha/);
        return JSON.stringify({
          sources: { file: 'https://cdn.example/master.m3u8' },
          tracks: [
            { kind: 'captions', label: 'English', language: 'en', file: 'https://cdn.example/en.vtt', default: true },
            { kind: 'captions', label: 'French', language: 'fr', file: 'https://cdn.example/fr.vtt' },
          ],
        });
      }
      if (url === 'https://cdn.example/master.m3u8') return master;
      throw new Error(`Unexpected host URL ${url}`);
    },
  });
  const item = { source: 'sogo' };
  const episode = { url: 'https://animesogo.to/watch/example-episode-1', ids: 'episode-token' };
  return { resolver, item, episode };
}

test('Sogo-family options and explicit resolution keep Android IDs and English filtering', async () => {
  const { resolver, item, episode } = sogoFixture();
  const options = await resolver.downloadOptions(item, episode, 'english');
  assert.equal(options.unavailable, 0);
  assert.equal(options.servers.length, 1);
  assert.equal(options.servers[0].id, 'sogo-megaplay-hd-0');
  assert.equal(options.servers[0].label, 'MegaPlay HD - MegaPlay SUB');
  assert.deepEqual(options.servers[0].qualities.map((q) => q.id), ['best', 'v:1280x720', 'v:640x360']);

  const resolved = await resolver.resolve(item, episode, 'english', 'sogo-megaplay-hd-0', 'v:1280x720');
  assert.equal(resolved.url, 'https://cdn.example/master.m3u8');
  assert.equal(resolved.host, 'MegaPlay');
  assert.deepEqual(subtitleTracksForDownload(resolved, 'sogo').map((track) => track.language), ['en']);

  await assert.rejects(
    resolver.resolve(item, episode, 'english', 'sogo-not-listed-0', 'best'),
    /not available/,
  );
  await assert.rejects(
    resolver.resolve(item, episode, 'english', 'sogo-megaplay-hd-0', 'f:1080'),
    /does not provide that file quality/,
  );
  await assert.rejects(
    resolver.resolve({ source: 'xin' }, episode, 'english'),
    /source does not match/,
  );
});

test('WordPress sources decode mirror fragments and resolve Dailymotion', async () => {
  const fragment = Buffer.from('<iframe src="https://www.dailymotion.com/embed/video/x8abc"></iframe>', 'utf8').toString('base64');
  const resolver = createVideoResolver({
    sourceGetText: async () => `<select class="mirror"><option value="${fragment}">Dailymotion</option></select>`,
    hostText: async (url) => {
      assert.equal(url, 'https://www.dailymotion.com/player/metadata/video/x8abc');
      return JSON.stringify({
        qualities: { auto: [{ url: 'https://cdn.example/dm/master.m3u8', type: 'application/x-mpegURL' }] },
      });
    },
  });
  const resolved = await resolver.resolve(
    { source: 'narul' },
    { url: 'https://naruldonghua.com/episode/example-1/' },
    'english',
  );
  assert.equal(resolved.host, 'Dailymotion');
  assert.equal(resolved.url, 'https://cdn.example/dm/master.m3u8');
  assert.equal(resolved.serverLabel, 'Dailymotion');
});

test('MediaFire file extraction only accepts direct media files', () => {
  assert.equal(
    mediafireFile('<a id="downloadButton" href="https://download.mediafire.com/file/example.mp4">Download</a>', 'https://www.mediafire.com/file/example'),
    'https://download.mediafire.com/file/example.mp4',
  );
  assert.equal(
    mediafireFile('<a id="downloadButton" href="https://example.com/file/example.mp4">Download</a>', 'https://www.mediafire.com/file/example'),
    '',
  );
});
