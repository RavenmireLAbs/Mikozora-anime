import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fallbackAudioRendition, parseMasterPlaylist, parseMediaPlaylist, selectAudioRendition, selectSubtitleRenditions, selectVariant,
} from '../desktop/src/lib/hls.js';
import { downloadDirectFile, downloadHlsMedia } from '../desktop/src/lib/media-download.js';
import { playableInApp, remuxToMp4 } from '../desktop/src/lib/ffmpeg.js';
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

// Regression: some hosts list an AUDIO rendition in the master playlist
// that the chosen variant never references. The variant then downloads
// without sound unless the default rendition is paired like a player would.
test('HLS downloads pair an unreferenced default audio rendition when the variant is silent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-hls-fallback-'));
  const bodies = new Map([
    ['https://cdn.example/show/master.m3u8', `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",DEFAULT=YES,URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360
video.m3u8
`],
    ['https://cdn.example/show/video.m3u8', `#EXTM3U
#EXTINF:2,one
v1.ts
#EXT-X-ENDLIST
`],
    ['https://cdn.example/show/audio.m3u8', `#EXTM3U
#EXTINF:2,one
a1.ts
#EXT-X-ENDLIST
`],
    ['https://cdn.example/show/v1.ts', Buffer.from('VIDEO-ONLY')],
    ['https://cdn.example/show/a1.ts', Buffer.from('AUDIO-TRACK')],
  ]);
  const fetched = [];
  const safeFetchImpl = async (url) => {
    const href = String(url);
    fetched.push(href);
    if (!bodies.has(href)) throw new Error(`Unexpected URL ${href}`);
    return { response: new Response(bodies.get(href)), url: new URL(href) };
  };
  const master = parseMasterPlaylist(bodies.get('https://cdn.example/show/master.m3u8'), 'https://cdn.example/show/master.m3u8');
  assert.equal(selectAudioRendition(master, master.variants[0]), null, 'the variant references no audio group');
  assert.equal(fallbackAudioRendition(master)?.uri, 'https://cdn.example/show/audio.m3u8');

  const base = {
    url: 'https://cdn.example/show/master.m3u8',
    refererFor: () => 'https://cdn.example/',
    safeFetchImpl,
    safeGetImpl: async () => { throw new Error('no keys in fixture'); },
  };

  // Probed silent -> the orphaned rendition is downloaded as separate audio.
  const silent = await downloadHlsMedia({
    ...base,
    workDir: join(root, 'silent'),
    probeFile: async () => ({ hasVideo: true, hasAudio: false }),
  });
  assert.equal(silent.separateAudio, true);
  assert.equal(silent.inputs.length, 2);
  assert.equal(await readFile(silent.inputs[0], 'utf8'), 'VIDEO-ONLY');
  assert.equal(await readFile(silent.inputs[1], 'utf8'), 'AUDIO-TRACK');
  assert.ok(fetched.includes('https://cdn.example/show/audio.m3u8'));

  // Probed with sound -> the rendition is left alone.
  fetched.length = 0;
  const muxed = await downloadHlsMedia({
    ...base,
    workDir: join(root, 'muxed'),
    probeFile: async () => ({ hasVideo: true, hasAudio: true }),
  });
  assert.equal(muxed.separateAudio, false);
  assert.equal(muxed.inputs.length, 1);
  assert.ok(!fetched.includes('https://cdn.example/show/audio.m3u8'));
});

test('the in-app player needs 8-bit H.264 with AAC/MP3 audio', () => {
  assert.equal(playableInApp({ hasVideo: true, hasAudio: true, videoCodec: 'h264 (High) (avc1 / 0x31637661)', audioCodec: 'aac (LC) (mp4a / 0x6134706D)' }), true);
  assert.equal(playableInApp({ hasVideo: true, hasAudio: false, videoCodec: 'h264 (High)', audioCodec: '' }), true);
  assert.equal(playableInApp({ hasVideo: true, hasAudio: true, videoCodec: 'hevc (Main) (hev1 / 0x31766568)', audioCodec: 'aac (LC)' }), false);
  assert.equal(playableInApp({ hasVideo: true, hasAudio: true, videoCodec: 'h264 (High 10) (avc1 / 0x31637661)', audioCodec: 'aac (LC)' }), false);
  assert.equal(playableInApp({ hasVideo: true, hasAudio: true, videoCodec: 'h264 (High)', audioCodec: 'ac3 (ac-3 / 0x332D6361)' }), false);
  assert.equal(playableInApp({ hasVideo: false, hasAudio: true, videoCodec: '', audioCodec: 'aac' }), false);
  assert.equal(playableInApp(null), false);
});

// Fake-ffmpeg harness: probes answer from a queue of stderr texts, copy and
// transcode runs just create the output file. This exercises remuxToMp4's
// decision logic without a real ffmpeg binary.
function fakeFfmpeg(probeTexts, runResults = []) {
  const queue = [...probeTexts];
  const results = [...runResults];
  const runs = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.stdout = new EventEmitter();
    child.kill = () => {};
    const text = queue.shift() || '';
    process.nextTick(() => {
      child.stderr.emit('data', text);
      child.emit('close', 1, null);
    });
    return child;
  };
  const runImpl = async (args) => {
    runs.push(args);
    await writeFile(args[args.length - 1], Buffer.alloc(256));
    return results.shift() || { code: 0, signal: '', stderr: '' };
  };
  return { spawnImpl, runImpl, runs, remaining: () => queue.length };
}

const probeText = ({ video = 'h264 (High) (avc1 / 0x31637661), yuv420p, 640x360', audio = 'aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo' } = {}) =>
  `Duration: 00:00:06.00, start: 0.000000, bitrate: 1000 kb/s\nStream #0:0: Video: ${video}\n${audio ? `Stream #0:1: Audio: ${audio}\n` : ''}`;

test('remux rejects a silent copy when the downloaded media had sound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-audio-'));
  const input = join(root, 'v-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(input, Buffer.alloc(64));
  const fake = fakeFfmpeg([
    probeText(), // input probe: muxed h264+aac
    probeText({ audio: '' }), // copy output lost the audio
    probeText(), // transcoded output is complete
  ]);
  const result = await remuxToMp4({ ffmpegPath: 'ffmpeg', inputs: [input], output, spawnImpl: fake.spawnImpl, runImpl: fake.runImpl });
  assert.equal(result.transcoded, true, 'a silent copy must fall through to the transcode');
  assert.equal(result.hasAudio, true);
  assert.equal(fake.runs.length, 2);
  assert.ok(fake.runs[1].includes('libx264'));
  assert.equal(fake.remaining(), 0);
});

test('remux transcodes codecs the in-app player cannot decode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-codec-'));
  const input = join(root, 'v-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(input, Buffer.alloc(64));
  const hevc = 'hevc (Main) (hev1 / 0x31766568), yuv420p, 640x360';
  const fake = fakeFfmpeg([
    probeText({ video: hevc }), // input probe
    probeText({ video: hevc }), // HEVC copy is not app-playable
    probeText(), // transcoded output
  ]);
  const result = await remuxToMp4({ ffmpegPath: 'ffmpeg', inputs: [input], output, spawnImpl: fake.spawnImpl, runImpl: fake.runImpl });
  assert.equal(result.transcoded, true);
  assert.match(result.videoCodec, /^h264/);
  assert.equal(fake.runs.length, 2);
});

test('remux still completes a genuinely silent source by stream copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-silent-'));
  const input = join(root, 'v-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(input, Buffer.alloc(64));
  const fake = fakeFfmpeg([
    probeText({ audio: '' }), // input has no audio to lose
    probeText({ audio: '' }), // copy output matches
  ]);
  const result = await remuxToMp4({ ffmpegPath: 'ffmpeg', inputs: [input], output, spawnImpl: fake.spawnImpl, runImpl: fake.runImpl });
  assert.equal(result.transcoded, false);
  assert.equal(result.hasAudio, false);
  assert.equal(fake.runs.length, 1);
});

test('remux transcodes only the audio when the video is already playable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-ac3-'));
  const input = join(root, 'v-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(input, Buffer.alloc(64));
  const ac3 = 'ac3 (ac-3 / 0x332D6361), 48000 Hz, 5.1(side)';
  const fake = fakeFfmpeg([
    probeText({ audio: ac3 }), // input probe
    probeText({ audio: ac3 }), // copy is complete but the player cannot decode AC3
    probeText(), // targeted output: copied video + AAC audio
  ]);
  const result = await remuxToMp4({ ffmpegPath: 'ffmpeg', inputs: [input], output, spawnImpl: fake.spawnImpl, runImpl: fake.runImpl });
  assert.equal(result.transcoded, true);
  assert.equal(fake.runs.length, 2);
  const targeted = fake.runs[1];
  assert.ok(targeted.includes('copy'), 'playable video is copied, not re-encoded');
  assert.ok(!targeted.includes('libx264'));
});

test('remux ignores a separate-audio file that carries no audio when the video is muxed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-junk-audio-'));
  const video = join(root, 'v-combined.media');
  const junk = join(root, 'a-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(video, Buffer.alloc(64));
  await writeFile(junk, Buffer.alloc(64));
  const fake = fakeFfmpeg([
    probeText(), // video file: muxed h264+aac
    'Duration: 00:00:06.00, start: 0.000000, bitrate: 10 kb/s\n', // "audio" file: no streams at all
    probeText(), // copy output
  ]);
  const result = await remuxToMp4({
    ffmpegPath: 'ffmpeg', inputs: [video, junk], output, separateAudio: true,
    spawnImpl: fake.spawnImpl, runImpl: fake.runImpl,
  });
  assert.equal(result.hasAudio, true);
  assert.equal(fake.runs.length, 1);
  assert.equal(fake.runs[0].filter((arg) => arg === '-i').length, 1, 'the junk second input is dropped');
  assert.ok(fake.runs[0].includes('0:a?'));
});

test('a conversion failure reports what ffmpeg actually said, without local paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mikozora-remux-failure-'));
  const input = join(root, 'v-combined.media');
  const output = join(root, 'episode.mp4');
  await writeFile(input, Buffer.alloc(64));
  const failure = {
    code: 1,
    signal: '',
    stderr: "[mpegts @ 0x1] Opening 'C:\\Users\\someone\\AppData\\episode.processing.mp4' for writing\n[libx264 @ 0x2] height not divisible by 2 (638x359)\nError while opening encoder\n",
  };
  const fake = fakeFfmpeg([probeText()], [failure, failure, failure]);
  await assert.rejects(
    remuxToMp4({ ffmpegPath: 'ffmpeg', inputs: [input], output, spawnImpl: fake.spawnImpl, runImpl: fake.runImpl }),
    (error) => {
      assert.match(error.message, /Could not convert this downloaded stream to MP4\./);
      assert.match(error.message, /Error while opening encoder/);
      assert.ok(!/someone|AppData|C:\\/.test(error.message), 'no local paths leak into the message');
      return true;
    },
  );
  assert.equal(fake.runs.length, 3, 'copy plus both transcode plans were attempted');
});
