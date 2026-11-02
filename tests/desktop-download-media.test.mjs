import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMasterPlaylist, parseMediaPlaylist, selectAudioRendition, selectSubtitleRenditions, selectVariant,
} from '../desktop/src/lib/hls.js';
import { downloadDirectFile, downloadHlsMedia } from '../desktop/src/lib/media-download.js';
import { isPublicAddress } from '../desktop/src/lib/safe-http.js';
import {
  mergeVttSegments, normalizeSubtitleSelection, srtToVtt, subtitleTrackOption,
} from '../desktop/src/lib/subtitles.js';

test('SafeHttp address policy rejects private and reserved addresses', () => {
  for (const address of ['10.0.0.5', '127.0.0.1', '172.16.4.2', '192.168.1.10', '100.64.1.2', '8.8.8.8']) {
    assert.equal(isPublicAddress(address), address === '8.8.8.8', address);
  }
  assert.equal(isPublicAddress('::1'), false);
  assert.equal(isPublicAddress('fd00::1'), false);
  assert.equal(isPublicAddress('fe80::1'), false);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('::ffff:192.168.1.5'), false);
});

test('HLS parser selects capped variants, audio, English subtitles and byte ranges', () => {
  const master = parseMasterPlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="French",LANGUAGE="fr",URI="fr.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360,AUDIO="aud",SUBTITLES="subs"
360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=300,RESOLUTION=3840x2160,AUDIO="aud",SUBTITLES="subs"
2160.m3u8
`, 'https://cdn.example/show/master.m3u8');
  const variant = selectVariant(master, 'best');
  assert.equal(variant.height, 1080);
  assert.equal(selectVariant(master, 'v:3840x2160').height, 2160);
  assert.equal(selectAudioRendition(master, variant)?.name, 'Japanese');
  assert.deepEqual(
    selectSubtitleRenditions(master, variant, { englishOnlySource: true }).map((item) => item.language),
    ['en'],
  );
  const frenchSelection = normalizeSubtitleSelection(
    'custom',
    [subtitleTrackOption({ label: 'French', language: 'fr' })],
    'sogo-server-0',
  );
  assert.deepEqual(
    selectSubtitleRenditions(master, variant, { englishOnlySource: true, subtitleSelection: frenchSelection }).map((item) => item.language),
    ['fr'],
  );
  assert.deepEqual(selectSubtitleRenditions(master, variant, { subtitleSelection: { mode: 'none', tracks: [] } }), []);

  const media = parseMediaPlaylist(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:40
#EXT-X-MAP:URI="init.mp4",BYTERANGE="100@20"
#EXTINF:2,first
#EXT-X-BYTERANGE:50@120
media.mp4
#EXTINF:2,second
#EXT-X-BYTERANGE:25
media.mp4
#EXT-X-ENDLIST
`, 'https://cdn.example/show/video.m3u8');
  assert.equal(media.initSegment.byteRange.start, 20);
  assert.deepEqual(media.segments.map((segment) => segment.sequence), [40, 41]);
  assert.deepEqual(media.segments.map((segment) => segment.byteRange), [
    { start: 120, length: 50, end: 169 },
    { start: 170, length: 25, end: 194 },
  ]);
});

test('subtitle text helpers convert SRT and merge segmented WebVTT', () => {
  assert.match(
    srtToVtt('1\n00:00:01,000 --> 00:00:02,500\nHello'),
    /^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:02\.500\nHello/,
  );
  const merged = mergeVttSegments([
    { offset: 0, text: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne\n' },
    { offset: 2, text: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTwo\n' },
  ]);
  assert.match(merged, /00:00:00\.000 --> 00:00:01\.000\nOne/);
  assert.match(merged, /00:00:02\.000 --> 00:00:03\.000\nTwo/);
});

test('direct downloads resume with a Range request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mikozora-direct-'));
  const destination = join(dir, 'episode.part');
  await writeFile(destination, 'abc');
  let seenRange = '';
  const result = await downloadDirectFile({
    url: 'https://cdn.example/episode.mp4',
    destination,
    refererFor: () => 'https://cdn.example/',
    safeFetchImpl: async (_url, options) => {
      seenRange = options.headers.Range || '';
      return {
        response: new Response('def', {
          status: 206,
          headers: { 'content-range': 'bytes 3-5/6', 'content-type': 'video/mp4' },
        }),
        url: new URL('https://cdn.example/episode.mp4'),
      };
    },
  });
  assert.equal(seenRange, 'bytes=3-');
  assert.equal(result.bytes, 6);
  assert.equal(await readFile(destination, 'utf8'), 'abcdef');
});

test('HLS downloads decrypt, combine separate audio, save subtitles and resume segments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-hls-'));
  const workDir = join(root, 'work');
  const key = Buffer.alloc(16, 0x2a);
  const iv = Buffer.alloc(16);
  iv[15] = 1;
  const plainVideo = Buffer.from('video-segment-one!');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encryptedVideo = Buffer.concat([cipher.update(plainVideo), cipher.final()]);

  const bodies = new Map([
    ['https://cdn.example/show/master.m3u8', `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360,AUDIO="aud",SUBTITLES="subs"
video.m3u8
`],
    ['https://cdn.example/show/video.m3u8', `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001
#EXTINF:2,one
v1.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:2,two
v2.ts
#EXT-X-ENDLIST
`],
    ['https://cdn.example/show/audio.m3u8', `#EXTM3U
#EXTINF:2,one
a1.ts
#EXTINF:2,two
a2.ts
#EXT-X-ENDLIST
`],
    ['https://cdn.example/show/subs.m3u8', `#EXTM3U
#EXTINF:2,one
s1.vtt
#EXTINF:2,two
s2.vtt
#EXT-X-ENDLIST
`],
    ['https://cdn.example/show/init.mp4', Buffer.from('INIT')],
    ['https://cdn.example/show/v1.ts', encryptedVideo],
    ['https://cdn.example/show/v2.ts', Buffer.from('VIDEO-TWO')],
    ['https://cdn.example/show/a1.ts', Buffer.from('AUDIO-ONE')],
    ['https://cdn.example/show/a2.ts', Buffer.from('AUDIO-TWO')],
  ]);
  const textBodies = new Map([
    ['https://cdn.example/show/key.bin', key],
    ['https://cdn.example/show/s1.vtt', Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst line\n')],
    ['https://cdn.example/show/s2.vtt', Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSecond line\n')],
  ]);
  const segmentFetches = [];
  const safeFetchImpl = async (url) => {
    const href = String(url);
    if (/\/(?:init\.mp4|v\d\.ts|a\d\.ts)$/.test(href)) segmentFetches.push(href);
    if (!bodies.has(href)) throw new Error(`Unexpected URL ${href}`);
    const body = bodies.get(href);
    return { response: new Response(body), url: new URL(href) };
  };
  const safeGetImpl = async (url) => {
    const href = String(url);
    if (!textBodies.has(href)) throw new Error(`Unexpected subtitle/key URL ${href}`);
    return Buffer.from(textBodies.get(href));
  };
  const options = {
    url: 'https://cdn.example/show/master.m3u8',
    workDir,
    refererFor: () => 'https://cdn.example/',
    safeFetchImpl,
    safeGetImpl,
    englishOnlySource: true,
    concurrency: 2,
  };

  const first = await downloadHlsMedia(options);
  assert.equal(first.inputs.length, 2);
  assert.equal(first.separateAudio, true);
  assert.equal(await readFile(first.inputs[0], 'utf8'), 'INITvideo-segment-one!VIDEO-TWO');
  assert.equal(await readFile(first.inputs[1], 'utf8'), 'AUDIO-ONEAUDIO-TWO');
  assert.equal(first.subtitleTracks.length, 1);
  assert.match(first.subtitleTracks[0].content, /00:00:02\.000 --> 00:00:03\.000\nSecond line/);
  const firstSegmentFetchCount = segmentFetches.length;
  assert.equal(firstSegmentFetchCount, 5);

  const second = await downloadHlsMedia(options);
  assert.equal(second.bytes, first.bytes);
  assert.equal(segmentFetches.length, firstSegmentFetchCount, 'completed segments should be reused');

  const englishSelection = normalizeSubtitleSelection(
    'custom',
    [subtitleTrackOption({ label: 'English', language: 'en' })],
    'sogo-server-0',
  );
  const custom = await downloadHlsMedia({ ...options, subtitleSelection: englishSelection });
  assert.deepEqual(custom.subtitleRenditions.map((track) => track.language), ['en']);
  assert.equal(custom.subtitleTracks.length, 1);
  const noSubtitles = await downloadHlsMedia({ ...options, subtitleSelection: { mode: 'none', tracks: [] } });
  assert.deepEqual(noSubtitles.subtitleRenditions, []);
  assert.deepEqual(noSubtitles.subtitleTracks, []);
});
