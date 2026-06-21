"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Loads a 30s preview for "artist – title" through our same-origin proxy,
// decodes it for a real waveform, and exposes play/seek + a (throttled)
// currentTime/progress that drives both the waveform and the synced lyrics.
export function useTrackAudio(artist, title) {
  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const scrubbingRef = useRef(false);
  const resumeRef = useRef(false); // was it playing when the scrub began?
  const [peaks, setPeaks] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("loading"); // loading | ready | none

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setStatus("loading");
    setPeaks(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (!title) {
      setStatus("none");
      return;
    }

    const src = `/api/spotify/preview?artist=${encodeURIComponent(artist || "")}&title=${encodeURIComponent(title)}`;
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error("no preview");
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([buf]));
        const a = new Audio(objectUrl);
        a.preload = "auto";
        a.addEventListener("ended", () => setPlaying(false));
        a.addEventListener("loadedmetadata", () => setDuration(a.duration || 0));
        audioRef.current = a;

        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = new AC();
          const audioBuf = await ctx.decodeAudioData(buf.slice(0));
          if (alive) {
            setPeaks(computePeaks(audioBuf, 40));
            setDuration(audioBuf.duration);
          }
          ctx.close();
        } catch {
          /* waveform optional */
        }
        if (alive) setStatus("ready");
      })
      .catch(() => alive && setStatus("none"));

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artist, title]);

  const tick = useCallback(() => {
    const a = audioRef.current;
    // While scrubbing the playhead is driven optimistically by `seek`; don't let
    // the (throttled, lagging) element time yank it backwards.
    if (a && !scrubbingRef.current)
      setCurrentTime((prev) => (Math.abs(a.currentTime - prev) > 0.04 ? a.currentTime : prev));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  }, [tick]);

  const seek = useCallback(
    (t) => {
      const a = audioRef.current;
      if (!a || !duration) return;
      const target = Math.max(0, Math.min(duration, t));
      a.currentTime = target; // element is paused mid-scrub, so this never glitches
      setCurrentTime(target);
    },
    [duration],
  );

  // Pause for the duration of a scrub — a paused element can be re-seeked as fast
  // as the finger moves with no audible artifacts — then resume from the new spot.
  const scrubStart = useCallback(() => {
    scrubbingRef.current = true;
    const a = audioRef.current;
    resumeRef.current = !!a && !a.paused;
    if (a) a.pause();
  }, []);
  const scrubEnd = useCallback(() => {
    scrubbingRef.current = false;
    const a = audioRef.current;
    if (a && resumeRef.current) a.play();
    resumeRef.current = false;
  }, []);

  const progress = duration ? currentTime / duration : 0;
  return { peaks, duration, currentTime, progress, playing, status, toggle, seek, scrubStart, scrubEnd };
}

function computePeaks(buf, n) {
  const data = buf.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / n));
  const peaks = new Array(n);
  let max = 0.0001;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[start + j] || 0);
      if (v > m) m = v;
    }
    peaks[i] = m;
    if (m > max) max = m;
  }
  return peaks.map((p) => p / max);
}
