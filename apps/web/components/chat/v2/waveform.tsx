'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from '@/components/icons';

/** Playable voice-note waveform. Decodes the audio once (WebAudio) to draw peak
 *  bars; falls back to a plain <audio> element if decoding fails (codec/CORS).
 *  Site crews send voice constantly, so this is a first-class message body. */
export function VoiceNote({ url, durationSeconds }: { url: string; durationSeconds: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [duration, setDuration] = useState(durationSeconds ?? 0);

  const BARS = 44;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        if (cancelled) return;
        const data = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const out: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let max = 0;
          const start = i * step;
          for (let j = start; j < Math.min(start + step, data.length); j += 32) {
            const v = Math.abs(data[j] ?? 0);
            if (v > max) max = v;
          }
          out.push(max);
        }
        const top = Math.max(...out, 0.01);
        setPeaks(out.map((v) => Math.max(0.12, v / top)));
        if (!durationSeconds) setDuration(audio.duration);
      } catch {
        if (!cancelled) setDecodeFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, durationSeconds]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => el.duration && setProgress(el.currentTime / el.duration);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    const onMeta = () => Number.isFinite(el.duration) && el.duration > 0 && setDuration(el.duration);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('loadedmetadata', onMeta);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  if (decodeFailed) {
    return <audio src={url} controls className="h-10 w-64 max-w-full" />;
  }

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex w-72 max-w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {playing ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
      </button>
      <button
        type="button"
        aria-label="Seek"
        onClick={(e) => {
          const el = audioRef.current;
          if (!el || !el.duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
        }}
        className="flex h-8 flex-1 items-center gap-[2px]"
      >
        {(peaks ?? Array.from({ length: BARS }, () => 0.3)).map((p, i) => {
          const played = i / BARS <= progress;
          return (
            <span
              key={i}
              className={`w-[3px] flex-1 rounded-full ${played ? 'bg-brand-600 dark:bg-brand-400' : 'bg-zinc-300 dark:bg-zinc-600'}`}
              style={{ height: `${Math.round(p * 100)}%` }}
            />
          );
        })}
      </button>
      <span className="shrink-0 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">{fmt(duration)}</span>
    </div>
  );
}
