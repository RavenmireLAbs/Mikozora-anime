import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Volume2, VolumeX } from 'lucide-react';
import { onlineSubtitleUrl } from './data.js';
import { formatPlaybackClock, normalizeOnlinePlayback, qualityCapLabel } from './online-playback.js';
import {
  OFFLINE_PLAYBACK_RATES,
  normalizeOfflinePlayback,
  offlineSubtitleStyle,
} from './offline-playback.js';

const ONLINE_SLEEP_KEY = 'moku.onlineSleepDeadline.v1';

function trackWanted(track, language) {
  const code = String(track?.language || '').toLowerCase();
  const label = String(track?.label || '').toLowerCase();
  if (language === 'indonesian') {
    return code === 'id' || code === 'in' || code === 'ind' || code.startsWith('id-')
      || label.includes('indonesia') || label.includes('bahasa');
  }
  return code === 'en' || code === 'eng' || code.startsWith('en-') || label.includes('english');
}

export function DirectOnlinePlayer({
  stream,
  episode,
  startSeconds = 0,
  onlinePrefs,
  playbackPrefs,
  onPlaybackRateChange = () => {},
  onVolumeChange = () => {},
  onPosition = () => {},
  onEnded = () => {},
  onFallback = () => {},
  notify = () => {},
}) {
  const cleanOnline = normalizeOnlinePlayback(onlinePrefs);
  const cleanPrefs = normalizeOfflinePlayback(playbackPrefs);
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const hlsRef = useRef(null);
  const lastSaveRef = useRef(0);
  const networkRecoveriesRef = useRef(0);
  const mediaRecoveriesRef = useRef(0);
  const endedRef = useRef(false);
  const onPositionRef = useRef(onPosition);
  const onEndedRef = useRef(onEnded);
  const [failed, setFailed] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(cleanPrefs.playbackRate);
  const [volume, setVolume] = useState(cleanPrefs.volume);
  const [muted, setMuted] = useState(false);
  const [sleepEndsAt, setSleepEndsAt] = useState(0);
  const [sleepRemaining, setSleepRemaining] = useState(0);

  const streamUrl = stream?.url || '';
  const streamKind = stream?.kind || '';
  const streamToken = stream?.token || '';
  const episodeUrl = episode?.url || '';
  const seekSeconds = cleanPrefs.seekSeconds;

  useEffect(() => { onPositionRef.current = onPosition; });
  useEffect(() => { onEndedRef.current = onEnded; });
  useEffect(() => {
    setPlaybackRate(cleanPrefs.playbackRate);
    if (videoRef.current) videoRef.current.playbackRate = cleanPrefs.playbackRate;
  }, [cleanPrefs.playbackRate]);

  useEffect(() => {
    setVolume(cleanPrefs.volume);
    if (videoRef.current) videoRef.current.volume = cleanPrefs.volume;
  }, [cleanPrefs.volume]);

  const savePosition = (ended = false) => {
    const video = videoRef.current;
    if (!video) return;
    const seconds = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    onPositionRef.current?.(seconds, duration, ended, video.playbackRate || playbackRate);
  };

  const selectSubtitles = () => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;
    const declared = Array.isArray(stream?.tracks) ? stream.tracks : [];
    let chosen = -1;
    let bestScore = -1;
    for (let i = 0; i < video.textTracks.length; i++) {
      const textTrack = video.textTracks[i];
      const matchingDeclared = declared.find(track => (
        String(track.label || '').toLowerCase() === String(textTrack.label || '').toLowerCase()
        && String(track.language || '').toLowerCase() === String(textTrack.language || '').toLowerCase()
      ));
      let score = 0;
      if (matchingDeclared?.preferred) score += 4;
      if (trackWanted({ language: textTrack.language, label: textTrack.label }, cleanOnline.subtitleLanguage)) score += 3;
      if (matchingDeclared && trackWanted(matchingDeclared, cleanOnline.subtitleLanguage)) score += 2;
      if (score > bestScore) {
        bestScore = score;
        chosen = i;
      }
    }
    if (chosen < 0) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      try { video.textTracks[i].mode = i === chosen ? 'showing' : 'hidden'; } catch { /* browser may own native HLS tracks */ }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return undefined;
    let disposed = false;
    setFailed('');
    endedRef.current = false;
    lastSaveRef.current = 0;
    networkRecoveriesRef.current = 0;
    mediaRecoveriesRef.current = 0;
    video.playbackRate = cleanPrefs.playbackRate;

    const start = Math.max(0, Number(startSeconds) || 0);
    const applyStart = () => {
      if (disposed || !videoRef.current) return;
      if (start > 5 && Number.isFinite(video.duration) && video.duration > start + 2) {
        try { video.currentTime = start; } catch { /* the stream may still be seeking */ }
      }
      video.playbackRate = cleanPrefs.playbackRate;
      video.volume = cleanPrefs.volume;
      selectSubtitles();
    };
    const onLoaded = () => {
      applyStart();
      window.setTimeout(() => { if (!disposed) selectSubtitles(); }, 350);
    };
    const onVideoError = () => {
      if (!disposed && !hlsRef.current) {
        savePosition(false);
        setFailed('This direct stream could not be played here.');
      }
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onVideoError);

    const canNativeHls = streamKind === 'hls'
      && (video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'));
    if (streamKind === 'hls' && !canNativeHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: 60,
        maxBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (disposed) return;
        const cap = cleanOnline.qualityCap;
        if (cap > 0 && Array.isArray(data?.levels)) {
          let capIndex = -1;
          data.levels.forEach((level, index) => {
            if (!level?.height || level.height <= cap) capIndex = index;
          });
          if (capIndex >= 0) hls.autoLevelCapping = capIndex;
        }
        video.play?.().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveriesRef.current < 2) {
          networkRecoveriesRef.current += 1;
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveriesRef.current < 1) {
          mediaRecoveriesRef.current += 1;
          hls.recoverMediaError();
          return;
        }
        savePosition(false);
        setFailed('This direct stream stopped before Mikozora could play it.');
      });
    } else if (streamKind === 'hls' && !canNativeHls && !Hls.isSupported()) {
      setFailed('This device cannot play this HLS stream directly.');
    } else {
      video.src = streamUrl;
      video.load();
      video.play?.().catch(() => {});
    }

    return () => {
      disposed = true;
      savePosition(false);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onVideoError);
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* already gone */ }
        hlsRef.current = null;
      }
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch { /* element is leaving the page */ }
    };
    // Stream identity is the URL/token/episode. Preference objects are read at
    // setup time so position saves do not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, streamKind, streamToken, episodeUrl, retryNonce, startSeconds]);

  useEffect(() => {
    if (cleanPrefs.sleepTimerMinutes <= 0) {
      setSleepEndsAt(0);
      setSleepRemaining(0);
      return;
    }
    let deadline = 0;
    try { deadline = Number(window.sessionStorage.getItem(ONLINE_SLEEP_KEY)) || 0; } catch { /* use this mount */ }
    if (deadline <= Date.now()) {
      deadline = Date.now() + cleanPrefs.sleepTimerMinutes * 60000;
      try { window.sessionStorage.setItem(ONLINE_SLEEP_KEY, String(deadline)); } catch { /* session only */ }
    }
    setSleepEndsAt(deadline);
    setSleepRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  }, [episodeUrl, cleanPrefs.sleepTimerMinutes]);

  useEffect(() => {
    if (!sleepEndsAt) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 1000));
      setSleepRemaining(remaining);
      if (remaining > 0) return;
      const video = videoRef.current;
      if (video) {
        savePosition(false);
        video.pause();
      }
      try { window.sessionStorage.removeItem(ONLINE_SLEEP_KEY); } catch { /* best effort */ }
      setSleepEndsAt(0);
      notify?.('Sleep timer paused playback');
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepEndsAt]);

  useEffect(() => {
    const saveWhenHidden = () => { if (document.hidden) savePosition(false); };
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => document.removeEventListener('visibilitychange', saveWhenHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeUrl]);

  const seekBy = seconds => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Number.POSITIVE_INFINITY;
    video.currentTime = Math.max(0, Math.min(duration, (video.currentTime || 0) + seconds));
    savePosition(false);
  };

  const restart = () => {
    const video = videoRef.current;
    if (!video) return;
    endedRef.current = false;
    video.currentTime = 0;
    video.play?.().catch(() => {});
    savePosition(false);
  };

  const applyRate = value => {
    const next = normalizeOfflinePlayback({ ...cleanPrefs, playbackRate: Number(value) }).playbackRate;
    setPlaybackRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
    onPlaybackRateChange?.(next);
    savePosition(false);
  };

  const applyVolume = value => {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    setVolume(next);
    if (videoRef.current) {
      videoRef.current.volume = next;
      if (next > 0 && videoRef.current.muted) {
        videoRef.current.muted = false;
        setMuted(false);
      }
    }
    onVolumeChange?.(next);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setMuted(videoRef.current.muted);
      if (!videoRef.current.muted && videoRef.current.volume === 0) {
        videoRef.current.volume = cleanPrefs.volume;
        setVolume(cleanPrefs.volume);
      }
    } else {
      setMuted(previous => !previous);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen?.();
    } catch { /* native video fullscreen remains available */ }
  };

  const pictureInPicture = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture?.();
    } catch { notify?.('Picture-in-picture is not available for this stream'); }
  };

  const cancelSleep = () => {
    try { window.sessionStorage.removeItem(ONLINE_SLEEP_KEY); } catch { /* best effort */ }
    setSleepEndsAt(0);
    setSleepRemaining(0);
    notify?.('Sleep timer off for this episode');
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const now = Date.now();
    if (now - lastSaveRef.current >= 5000) {
      lastSaveRef.current = now;
      savePosition(false);
    }
  };

  const handleEnded = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    savePosition(true);
    onEndedRef.current?.();
  };

  if (!streamUrl) {
    return <div className="direct-player-shell">
      <div className="direct-player-error" role="alert">
        <strong>No direct stream is available</strong>
        <p>This server can still be tried in the embedded player.</p>
        <button className="btn primary" type="button" onClick={onFallback}>Use embedded player</button>
      </div>
    </div>;
  }

  const streamLabel = [stream.serverLabel, stream.host].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(' · ');
  const tracks = (Array.isArray(stream.tracks) ? stream.tracks : [])
    .map(track => ({ ...track, src: onlineSubtitleUrl(stream, track) }))
    .filter(track => track.src);

  return <div className="direct-player-shell">
    <div className="direct-video-wrap" ref={wrapRef} style={offlineSubtitleStyle(cleanPrefs)}>
      <video
        ref={videoRef}
        className="direct-video"
        controls
        playsInline
        preload="metadata"
        aria-label={`Episode ${episode?.number || ''} direct stream`}
        onTimeUpdate={handleTimeUpdate}
        onPause={() => savePosition(false)}
        onSeeked={() => savePosition(false)}
        onRateChange={() => {
          const rate = videoRef.current?.playbackRate;
          if (rate && Math.abs(rate - playbackRate) > 0.001) setPlaybackRate(rate);
        }}
        onVolumeChange={() => {
          const v = videoRef.current?.volume;
          if (v !== undefined && Math.abs(v - volume) > 0.001) {
            setVolume(v);
            onVolumeChange?.(v);
          }
        }}
        onEnded={handleEnded}
      >
        {tracks.map(track => <track
          key={`${streamToken}-${track.index}-${track.label}`}
          kind="subtitles"
          src={track.src}
          srcLang={track.language || 'und'}
          label={track.label || 'Subtitles'}
        />)}
      </video>
      {failed && <div className="direct-player-error" role="alert">
        <strong>Direct playback stopped</strong>
        <p>{failed} You can retry the direct stream or use the server's embedded player.</p>
        <div>
          <button className="btn secondary" type="button" onClick={() => setRetryNonce(value => value + 1)}>Retry direct</button>
          <button className="btn primary" type="button" onClick={onFallback}>Use embedded player</button>
        </div>
      </div>}
    </div>
    <div className="direct-player-toolbar" aria-label="Direct player controls">
      <button className="btn secondary" type="button" onClick={() => seekBy(-seekSeconds)} aria-label={`Back ${seekSeconds} seconds`}>−{seekSeconds}s</button>
      <button className="btn secondary" type="button" onClick={restart}>Restart</button>
      <label className="direct-speed"><span>SPEED</span><select aria-label="Direct playback speed" value={playbackRate} onChange={event => applyRate(event.target.value)}>
        {OFFLINE_PLAYBACK_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
      </select></label>
      <div className="direct-volume">
        <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="btn secondary volume-toggle">
          {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => applyVolume(event.target.value)} aria-label="Volume" />
      </div>
      <button className="btn secondary" type="button" onClick={() => seekBy(seekSeconds)} aria-label={`Forward ${seekSeconds} seconds`}>+{seekSeconds}s</button>
      <button className="btn secondary" type="button" onClick={pictureInPicture}>Picture-in-picture</button>
      <button className="btn secondary" type="button" onClick={toggleFullscreen}>Fullscreen</button>
      <button className="btn secondary" type="button" onClick={onFallback}>Use embedded</button>
      {sleepRemaining > 0 && <span className="direct-sleep">Sleep in {formatPlaybackClock(sleepRemaining)} <button className="text-link" type="button" onClick={cancelSleep}>Cancel</button></span>}
    </div>
    <p className="direct-player-meta">
      <strong>Direct stream in Mikozora's player</strong>
      {streamLabel ? ` · ${streamLabel}` : ''}
      {stream.fixedHeight ? ` · ${stream.fixedHeight}p reported` : ''}
      {` · Quality: ${qualityCapLabel(cleanOnline.qualityCap)}`}
      {startSeconds > 5 ? ` · Resumed at ${formatPlaybackClock(startSeconds)}` : ' · Exact position is remembered on this device'}
      {stream.subtitleDescription ? ` · ${stream.subtitleDescription}` : ''}
    </p>
  </div>;
}
