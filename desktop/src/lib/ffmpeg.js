// Local MP4 remux/transcode helpers. Input files are always local by the
// time ffmpeg sees them (the download engine fetched and validated every
// remote segment itself), so ffmpeg needs no network protocol access.
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { rm } from 'node:fs/promises';

function abortError() {
  const error = new Error('Download was canceled');
  error.name = 'AbortError';
  return error;
}

function parseProgressLine(line, duration, onProgress) {
  if (!onProgress) return;
  const time = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!time || !duration) return;
  const seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
  onProgress(Math.max(0, Math.min(1, seconds / duration)));
}

export function runFfmpeg({
  ffmpegPath,
  args,
  signal,
  duration = 0,
  onProgress,
  timeoutMs = 3 * 60 * 60 * 1000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg is unavailable in this Windows build'));
      return;
    }
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let child;
    try {
      child = spawnImpl(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = '';
    let settled = false;
    const timer = timeoutMs ? setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }, timeoutMs) : null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish(reject, abortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', (chunk) => {
      const text = String(chunk);
      stderr = `${stderr}${text}`.slice(-30000);
      for (const line of text.split(/[\r\n]+/)) parseProgressLine(line, duration, onProgress);
    });
    child.stdout?.on?.('data', () => {});
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code, closeSignal) => {
      if (signal?.aborted) {
        finish(reject, abortError());
        return;
      }
      if (timer && code == null && closeSignal) {
        finish(reject, new Error('Video conversion took too long. Try again.'));
        return;
      }
      finish(resolve, { code: code ?? -1, signal: closeSignal || '', stderr });
    });
  });
}

export function parseFfmpegInfo(stderr) {
  const text = String(stderr || '');
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const streams = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^)]*\))?:\s*(Video|Audio|Subtitle|Data):\s*([^,\n]+)(.*)$/i.exec(line);
    if (!match) continue;
    const stream = {
      type: match[1].toLowerCase(),
      codec: match[2].trim(),
      detail: line.trim(),
    };
    if (stream.type === 'video') {
      const size = /, (\d{2,5})x(\d{2,5})(?:[ ,]|$)/.exec(line);
      if (size) {
        stream.width = Number(size[1]);
        stream.height = Number(size[2]);
      }
    }
    if (stream.type === 'audio') {
      // A transport stream can declare an audio PID in its PMT that never
      // carries a single frame (packagers that split audio into its own
      // rendition often leave the declaration behind in the video
      // variant). ffmpeg reports such a phantom with no sample rate and
      // "0 channels"; counting it as sound makes a silent variant look
      // muxed, suppresses separate-audio pairing, and sends conversion
      // after a stream it can neither mux nor encode.
      if (!/\b\d+\s*Hz\b/.test(line) || /,\s*0 channels\b/.test(line)) stream.phantom = true;
    }
    streams.push(stream);
  }
  const video = streams.find((stream) => stream.type === 'video') || null;
  const audio = streams.find((stream) => stream.type === 'audio' && !stream.phantom) || null;
  return {
    duration,
    streams,
    hasVideo: !!video,
    hasAudio: !!audio,
    hasSubtitle: streams.some((stream) => stream.type === 'subtitle'),
    videoCodec: video?.codec || '',
    audioCodec: audio?.codec || '',
    width: video?.width || 0,
    height: video?.height || 0,
  };
}

export async function probeMedia(ffmpegPath, file, options = {}) {
  const result = await runFfmpeg({
    ffmpegPath,
    args: ['-hide_banner', '-i', file],
    timeoutMs: 30000,
    spawnImpl: options.spawnImpl,
  });
  const info = parseFfmpegInfo(result.stderr);
  return { ...info, code: result.code };
}

// The offline player is Chromium's <video> element: inside an MP4 it
// reliably decodes 8-bit H.264 video with AAC/MP3 audio. A stream copy in
// any other codec (HEVC, AV1, 10-bit H.264, AC3…) would "complete" yet
// show a black or silent player, so such copies must be transcoded.
function videoPlayable(info) {
  return !!info?.hasVideo
    && /^h264\b/i.test(info.videoCodec || '')
    && !/high 10/i.test(info.videoCodec || '');
}

function audioPlayable(info) {
  return !info?.hasAudio || /^(aac|mp3)\b/i.test(info.audioCodec || '');
}

export function playableInApp(info) {
  return videoPlayable(info) && audioPlayable(info);
}

async function inspectOutput(ffmpegPath, file, { spawnImpl } = {}) {
  let size = 0;
  try { size = (await stat(file)).size; } catch { size = 0; }
  if (size < 128) return null;
  try {
    const info = await probeMedia(ffmpegPath, file, { spawnImpl });
    return { ...info, bytes: size };
  } catch { return null; }
}

// The last meaningful ffmpeg complaint, with local paths stripped, so a
// conversion failure tells the user (and us) what actually went wrong
// instead of a generic "unsupported format".
function conversionDetail(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // ffmpeg ends most failures with wrapper summaries such as "Conversion
  // failed!" or "Error while opening encoder". Those say nothing about the
  // underlying stream, so prefer the last specific complaint before them.
  const generic = /^(?:Conversion failed!?|Error (?:initializing output stream|while opening encoder|opening output file|submitting a packet to the muxer|muxing a packet)\b.*)$/i;
  const interesting = lines.filter((line) => !generic.test(line)
    && /error|invalid|unable|failed|matches no streams|not divisible|unknown|unsupported|could not|no such file|permission/i.test(line));
  // An input/decoding complaint is usually the root cause; encoder geometry
  // and muxing errors after it are often just downstream symptoms.
  const inputComplaint = interesting.find((line) => /invalid .*signature|inflate returned error|invalid data found|error while decoding stream/i.test(line));
  const raw = inputComplaint
    || interesting[interesting.length - 1]
    || lines.filter((line) => !generic.test(line)).at(-1)
    || lines[lines.length - 1]
    || '';
  return raw
    .replace(/'[^']*'/g, "'[file]'")
    .replace(/[A-Za-z]:[\\/][^\s]+/g, '[file]')
    .replace(/\/(?:[^\s/]+\/)+[^\s]*/g, '[file]')
    .slice(0, 120);
}

export async function remuxToMp4({
  ffmpegPath,
  inputs,
  output,
  separateAudio = false,
  signal,
  duration = 0,
  onProgress,
  requireAudio = false,
  spawnImpl,
  runImpl,
} = {}) {
  const files = (inputs || []).filter(Boolean);
  if (!files.length) throw new Error('No downloaded media was available to convert');
  const run = runImpl || ((args, extra = {}) => runFfmpeg({ ffmpegPath, args, signal, duration, onProgress, spawnImpl, ...extra }));

  // Probe each input once. This decides the AAC bitstream filter, whether
  // the finished MP4 must contain sound (a video-only result once passed
  // validation and was marked ready to watch), and whether a supposed
  // separate-audio file really carries audio — if it does not but the
  // video file does, the video's muxed audio wins over a broken mapping.
  const probes = [];
  for (const file of files) {
    try { probes.push(await probeMedia(ffmpegPath, file, { spawnImpl })); }
    catch { probes.push(null); }
  }
  let useSeparate = separateAudio && files.length > 1;
  // A separate-audio file that probing shows carries no real audio (a junk
  // body, or only a declared-but-empty phantom stream) must never be
  // mapped: `1:a:0` would match nothing — or a frameless stream — and
  // every conversion attempt would fail. The video input then stands
  // alone; its own muxed audio wins when it has any.
  if (useSeparate && probes[1] && !probes[1].hasAudio) useSeparate = false;
  const activeFiles = useSeparate ? files.slice(0, 2) : [files[0]];
  const audioProbe = useSeparate ? probes[1] : probes[0];
  const inputHasAudio = audioProbe ? !!audioProbe.hasAudio : null;
  const mustKeepAudio = requireAudio || inputHasAudio === true;
  const useAacFilter = /^aac\b/i.test(audioProbe?.audioCodec || '');
  if (!duration) duration = probes[0]?.duration || audioProbe?.duration || 0;

  const inputArgs = activeFiles.flatMap((file) => ['-i', file]);
  // When the video input declares an audio stream that carries no frames
  // (the phantom probing already discounted), leave it unmapped: mapping
  // it makes the MP4 muxer/encoder choke on a channel-less, packet-less
  // stream even though the picture converts fine.
  const phantomOnlyAudio = !useSeparate && !!probes[0] && !probes[0].hasAudio
    && !!probes[0].streams?.some((stream) => stream.type === 'audio');
  const mapArgs = useSeparate
    ? ['-map', '0:v:0', '-map', '1:a:0']
    : phantomOnlyAudio
      ? ['-map', '0:v:0']
      : ['-map', '0:v:0', '-map', '0:a?'];
  const common = ['-y', ...inputArgs, ...mapArgs, '-sn', '-dn'];
  const tail = ['-movflags', '+faststart', '-f', 'mp4', output];
  // libx264 with yuv420p rejects odd frame sizes, which cropped encodes
  // do publish; scale to even dimensions (a no-op for normal sizes).
  const videoTranscode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const audioCopy = ['-c:a', 'copy', ...(useAacFilter ? ['-bsf:a', 'aac_adtstoasc'] : [])];
  const audioTranscode = ['-c:a', 'aac', '-b:a', '160k'];
  const audioTranscodeSafe = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000'];

  const complete = (info) => !!info?.hasVideo && (!mustKeepAudio || !!info.hasAudio);
  const acceptable = (info) => complete(info) && playableInApp(info);

  let lastDetail = '';
  const attempt = async (args) => {
    if (signal?.aborted) throw abortError();
    await rm(output, { force: true }).catch(() => {});
    const result = await run(args);
    if (signal?.aborted) throw abortError();
    if (result.code !== 0) {
      lastDetail = conversionDetail(result.stderr);
      return null;
    }
    const info = await inspectOutput(ffmpegPath, output, { spawnImpl });
    if (!info) lastDetail = conversionDetail(result.stderr) || 'the converted file could not be read back';
    return info;
  };

  // 1. Stream copy — the fast path most hosts need.
  let info = await attempt([...common, '-c', 'copy', ...(useAacFilter ? ['-bsf:a', 'aac_adtstoasc'] : []), ...tail]);
  let transcoded = false;
  if (!acceptable(info)) {
    // 2. Convert only what the player cannot handle (everything when the
    // copy came out incomplete), then 3. a hardened full transcode. Hosts
    // differ in odd ways — frame sizes and audio layouts a single rigid
    // fallback chokes on — so conversion gets more than one chance, and
    // the final failure says what ffmpeg actually complained about.
    const needsVideo = !videoPlayable(info) || !complete(info);
    const needsAudio = !audioPlayable(info) || !complete(info);
    const plans = [
      [...common, ...(needsVideo ? videoTranscode : ['-c:v', 'copy']), ...(needsAudio ? audioTranscode : audioCopy), ...tail],
      [...common, ...videoTranscode, ...audioTranscodeSafe, ...tail],
    ];
    const seen = new Set();
    for (const args of plans) {
      const key = args.join('\n');
      if (seen.has(key)) continue;
      seen.add(key);
      info = await attempt(args);
      transcoded = true;
      if (acceptable(info)) break;
    }
  }

  if (!acceptable(info)) {
    await rm(output, { force: true }).catch(() => {});
    if (info && !complete(info)) throw new Error('The converted video is missing a readable video or audio track');
    if (info) {
      const codec = (value) => String(value || '').split(/[\s(]/)[0] || 'none';
      throw new Error(`The converted video uses a format the in-app player cannot play (${codec(info.videoCodec)} video, ${codec(info.audioCodec)} audio)`);
    }
    throw new Error(`Could not convert this downloaded stream to MP4.${lastDetail ? ` ${lastDetail}` : ' The host format may be unsupported.'}`);
  }
  return { output, transcoded, ...info };
}

export function createFfmpegProcessor(ffmpegPath, options = {}) {
  return {
    path: ffmpegPath || '',
    probe: (file) => probeMedia(ffmpegPath, file, options),
    remux: (args) => remuxToMp4({ ffmpegPath, spawnImpl: options.spawnImpl, ...args }),
  };
}
