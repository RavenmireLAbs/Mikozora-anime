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
    streams.push(stream);
  }
  const video = streams.find((stream) => stream.type === 'video') || null;
  const audio = streams.find((stream) => stream.type === 'audio') || null;
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

async function validateOutput(ffmpegPath, file, { requireAudio = false, spawnImpl } = {}) {
  let size = 0;
  try { size = (await stat(file)).size; } catch { size = 0; }
  if (size < 128) throw new Error('The converted video was incomplete');
  const info = await probeMedia(ffmpegPath, file, { spawnImpl });
  if (!info.hasVideo || (requireAudio && !info.hasAudio)) {
    throw new Error('The converted video is missing a readable video or audio track');
  }
  return { ...info, bytes: size };
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
  const inputArgs = files.flatMap((file) => ['-i', file]);
  const mapArgs = separateAudio && files.length > 1
    ? ['-map', '0:v:0', '-map', '1:a:0']
    : ['-map', '0:v:0', '-map', '0:a?'];

  // TS audio commonly arrives as AAC in ADTS; probing locally lets us apply
  // the ASC bitstream filter only when the selected audio really is AAC.
  let useAacFilter = false;
  try {
    const probeInput = separateAudio && files[1] ? files[1] : files[0];
    const info = await probeMedia(ffmpegPath, probeInput, { spawnImpl });
    useAacFilter = /^aac\b/i.test(info.audioCodec || '');
    if (!duration && info.duration) duration = info.duration;
  } catch { /* copy/transcode below will surface a clearer failure */ }

  const common = ['-y', ...inputArgs, ...mapArgs, '-sn', '-dn'];
  const copyArgs = [
    ...common,
    '-c', 'copy',
    ...(useAacFilter ? ['-bsf:a', 'aac_adtstoasc'] : []),
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
  const copy = await run(copyArgs);
  if (copy.code === 0) {
    try {
      const info = await validateOutput(ffmpegPath, output, { requireAudio, spawnImpl });
      return { output, transcoded: false, ...info };
    } catch { /* fall through to a compatibility transcode */ }
  }
  if (signal?.aborted) throw abortError();
  await rm(output, { force: true }).catch(() => {});

  const transcodeArgs = [
    ...common,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-f', 'mp4', output,
  ];
  const transcoded = await run(transcodeArgs);
  if (transcoded.code !== 0) {
    await rm(output, { force: true }).catch(() => {});
    throw new Error('Could not convert this downloaded stream to MP4. The host format may be unsupported.');
  }
  const info = await validateOutput(ffmpegPath, output, { requireAudio, spawnImpl });
  return { output, transcoded: true, ...info };
}

export function createFfmpegProcessor(ffmpegPath, options = {}) {
  return {
    path: ffmpegPath || '',
    probe: (file) => probeMedia(ffmpegPath, file, options),
    remux: (args) => remuxToMp4({ ffmpegPath, spawnImpl: options.spawnImpl, ...args }),
  };
}
