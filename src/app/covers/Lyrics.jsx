"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { guessOffsetMs, publishOffset, resolveOffset, writeOverride } from "./lib/lyricOffsets";

// Lyrics from /api/spotify/lyrics, in one of two modes.
//
// SYNCED — the route returned timed lines AND we know where this preview sits
// inside the recording (see lib/lyricOffsets). The panel then follows playback:
// the active line rides the focal slot and, when the source gave us word-level
// timing, each word inks in as it's sung. Scrolling by hand hands control back
// for a couple of seconds, then the music takes it again.
//
// MANUAL — anything else. A free native scroller with a proximity-scaled focus:
// the line nearest the vertical centre swells to full size + opacity, lines
// further out shrink and fade (sharp Gaussian peak). This is the safe default,
// because lyrics that move to the WRONG beat read as broken in a way that
// lyrics which simply don't move never do.
//
// Loading → loaded crossfades through a skeleton of the lines themselves, never
// a spinner: the wait is shaped like the answer.
export default function Lyrics({
  artist,
  title,
  isrc,
  durationSec,
  previewMs = 0,
  playing = false,
}) {
  const [data, setData] = useState(null); // { plain, lines, level }
  const [status, setStatus] = useState("loading"); // loading | ready | none
  const [nudgeMs, setNudgeMs] = useState(null); // dev calibration, ms

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setData(null);
    setNudgeMs(null);
    if (!title && !isrc) {
      setStatus("none");
      return;
    }
    // isrc pins the exact recording; artist/title stay as the fallback the route
    // falls back THROUGH, so a track without an ISRC still resolves the old way.
    const q = new URLSearchParams({ artist: artist || "", title: title || "" });
    if (isrc) q.set("isrc", isrc);
    if (durationSec) q.set("duration", String(durationSec));
    fetch(`/api/spotify/lyrics?${q}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.plain) {
          setData(d);
          setStatus("ready");
        } else {
          setStatus("none");
        }
      })
      .catch(() => alive && setStatus("none"));
    return () => {
      alive = false;
    };
  }, [artist, title, isrc, durationSec]);

  // Timed lines are what make sync POSSIBLE; the offset is what makes it TRUE —
  // and the offset can only be TOLD to us. Deriving it from the audio was tried
  // twice (loudness envelope, then spectral flux cross-checked against a second
  // provider's clip) and neither survived: a song's choruses repeat, so a fit
  // lands on the wrong one of them and looks every bit as confident as a right
  // one. So the order of trust stops at things a human confirmed — a live nudge,
  // then a calibrated value. Absent both, the panel scrolls by hand, which is
  // honest in a way that a drifting highlight is not.
  const timed = data?.lines?.length ? data.lines : null;
  const savedOffset = useMemo(() => resolveOffset(isrc), [isrc]);
  const offsetMs = nudgeMs !== null ? nudgeMs : savedOffset;

  // Click-to-sync: while the preview plays, clicking the line you can hear says
  // "this is playing now", which is the whole offset in one gesture — no hunting
  // with arrow keys, and accurate to about as well as you can click.
  //
  // Live in EVERY environment, not just dev. It's the one thing that can't be
  // derived (see lib/lyricOffsets), so the gesture that supplies it shouldn't be
  // walled off: a visitor who taps the line they're hearing gets that track
  // synced for the rest of the session (and their next visit, via localStorage).
  // In dev the same tap is also POSTed to the source map, which is how a track
  // ends up synced in production for everyone without a second gesture.
  const calibrating = !!timed;
  const onCalibrate = useCallback(
    (i) => {
      if (!calibrating || !timed?.[i] || timed[i].start == null) return;
      const next = Math.max(0, Math.round(timed[i].start - previewMs));
      setNudgeMs(next);
      writeOverride(isrc, next);
      publishOffset(isrc, next, `${artist} — ${title}`);
    },
    [calibrating, timed, previewMs, isrc, artist, title],
  );
  const synced = !!timed && offsetMs !== null;
  const trackMs = previewMs + (offsetMs || 0);

  const lines = useMemo(() => {
    if (timed) return timed;
    return (data?.plain || "").split("\n").map((t) => ({ text: t.trim() }));
  }, [timed, data]);

  const activeIndex = useMemo(() => {
    if (!synced) return null;
    let lo = 0;
    let hi = timed.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timed[mid].start <= trackMs) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }, [synced, timed, trackMs]);

  useLyricCalibration({ enabled: !!timed, isrc, timed, offsetMs, setNudgeMs, playing });

  return (
    <div className="cv-lyrics-stage">
      {/* content sits in-flow (so the scroller gets a real flex height) */}
      <div className={`cv-lyrics-content ${status !== "loading" ? "is-on" : "is-off"}`}>
        {status === "none" ? (
          <div className="cv-lyrics--note">no lyrics found</div>
        ) : status === "ready" ? (
          <LyricScroller
            lines={lines}
            activeIndex={activeIndex}
            trackMs={trackMs}
            follow={synced && playing}
            onCalibrate={calibrating ? onCalibrate : null}
          />
        ) : null}
      </div>

      {/* skeleton overlays on top and crossfades out, so the bars appear to
          resolve into the words rather than being replaced by them */}
      <div
        className={`cv-lyrics-sk-layer ${status === "loading" ? "is-on" : "is-off"}`}
        role="status"
        aria-label="Loading lyrics"
      >
        <LyricSkeleton />
      </div>
    </div>
  );
}

// ── proximity-scaled scroller, optionally driven by playback ────────────────
function LyricScroller({ lines, activeIndex, trackMs, follow, onCalibrate }) {
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);
  const rafRef = useRef(0);
  const [pad, setPad] = useState(140);

  // Map each line's distance-from-centre → scale + opacity, with a sharp Gaussian
  // peak so the dead-centre line reads MUCH larger than its neighbours (distance
  // in line-pitch units, so the feel holds at any size).
  const update = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const mid = sc.scrollTop + sc.clientHeight / 2;
    const els = lineRefs.current;
    const present = els.filter(Boolean);
    const pitch =
      present.length > 1 ? Math.abs(present[1].offsetTop - present[0].offsetTop) || 30 : present[0]?.offsetHeight || 30;
    const SIGMA = 1.05;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el) continue;
      const c = el.offsetTop + el.offsetHeight / 2;
      const u = (c - mid) / pitch;
      const w = Math.exp(-(u * u) / (SIGMA * SIGMA));
      el.style.setProperty("--ls", (0.64 + 0.62 * w).toFixed(3)); // 0.64 → 1.26
      el.style.setProperty("--lo", (0.16 + 0.84 * w).toFixed(3)); // 0.16 → 1
    }
  }, []);

  const centreOn = useCallback((el, smooth = true) => {
    const sc = scrollRef.current;
    if (!sc || !el) return;
    const target = el.offsetTop + el.offsetHeight / 2 - sc.clientHeight / 2;
    if (Math.abs(target - sc.scrollTop) > 1) {
      sc.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    }
  }, []);

  // Settle-snap: once MANUAL scrolling stops, glide the nearest line to dead-
  // centre. Debounced so it never fights an active wheel/drag. Under playback the
  // active line owns the focal slot instead, so this stays out of the way.
  const snapTimer = useRef(0);
  const scheduleSnap = useCallback(() => {
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      const mid = sc.scrollTop + sc.clientHeight / 2;
      let best = null;
      let bestD = Infinity;
      for (const el of lineRefs.current) {
        if (!el) continue;
        const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      }
      centreOn(best);
    }, 130);
  }, [centreOn]);

  // A hand on the wheel outranks the music, but only briefly — otherwise reading
  // ahead one line would strand you out of sync for the rest of the song.
  const holdUntil = useRef(0);
  const grab = useCallback(() => {
    holdUntil.current = performance.now() + 2500;
  }, []);

  const onScroll = useCallback(() => {
    if (!follow || performance.now() < holdUntil.current) scheduleSnap();
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      update();
    });
  }, [update, scheduleSnap, follow]);

  // Playback drives the focal slot. Only on a CHANGE of line, so a smooth scroll
  // is never interrupted by the next frame's identical target.
  const lastActive = useRef(-1);
  useEffect(() => {
    if (!follow || activeIndex == null || activeIndex < 0) {
      lastActive.current = -1;
      return;
    }
    if (activeIndex === lastActive.current) return;
    if (performance.now() < holdUntil.current) return;
    lastActive.current = activeIndex;
    centreOn(lineRefs.current[activeIndex]);
  }, [activeIndex, follow, centreOn]);

  // Spacers above/below let the first and last lines reach the centre. Keep them
  // honest with the live container height, and re-run the proximity pass.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const measure = () => {
      setPad(Math.max(60, sc.clientHeight / 2 - 26));
      update();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    const t = setTimeout(measure, 120); // after the panel's blur-in settles
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [lines, update]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(snapTimer.current);
    },
    [],
  );

  // Drive the wheel ourselves with a NON-passive listener: React attaches wheel
  // listeners passively (so e.preventDefault is ignored), and we want to be 100%
  // certain the lyrics scroll and that the wheel never leaks to the grid canvas
  // behind the modal. Touch uses native pan-y (touch-action on .cv-lyrics).
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e) => {
      e.stopPropagation();
      grab();
      if (sc.scrollHeight <= sc.clientHeight) return;
      const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.clientHeight : 1;
      sc.scrollTop += e.deltaY * step;
      e.preventDefault();
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    sc.addEventListener("touchstart", grab, { passive: true });
    sc.addEventListener("pointerdown", grab, { passive: true });
    return () => {
      sc.removeEventListener("wheel", onWheel);
      sc.removeEventListener("touchstart", grab);
      sc.removeEventListener("pointerdown", grab);
    };
  }, [lines, grab]);

  return (
    <div ref={scrollRef} className="cv-lyrics" onScroll={onScroll}>
      <div className="cv-lyrics-pad" style={{ height: pad }} />
      {lines.map((line, i) => (
        <p
          key={i}
          ref={(el) => (lineRefs.current[i] = el)}
          className={`cv-lyric${activeIndex === i ? " is-active" : ""}${onCalibrate ? " is-tappable" : ""}`}
          style={{ "--i": Math.min(i, 14) }}
          onClick={onCalibrate ? () => onCalibrate(i) : undefined}
        >
          <span className="cv-lyric-in">
            {activeIndex === i && line.words?.length ? (
              <Sung words={line.words} trackMs={trackMs} />
            ) : (
              line.text || "♪"
            )}
          </span>
        </p>
      ))}
      <div className="cv-lyrics-pad" style={{ height: pad }} />
    </div>
  );
}

// Word-level ink-in for the line being sung. The words array carries the spaces
// between words as their own timed entries, so rendering it verbatim under
// pre-wrap reproduces the original spacing without any rejoining guesswork.
function Sung({ words, trackMs }) {
  return (
    <span className="cv-lyric-words">
      {words.map((w, i) => (
        <span key={i} className={`cv-lyric-w${trackMs >= w.start ? " is-sung" : ""}`}>
          {w.text}
        </span>
      ))}
    </span>
  );
}

// ── dev calibration ────────────────────────────────────────────────────────
// The preview offset can't be fetched or derived (both were tried and measured),
// so it gets dialled in by ear, once, and committed to PREVIEW_OFFSETS_MS. This
// hook is the dial: it seeds from the densest-singing guess, moves on [ and ],
// and prints a paste-ready line. Compiles out of production entirely.
function useLyricCalibration({ enabled, isrc, timed, offsetMs, setNudgeMs, playing }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!enabled || !isrc || !timed?.length) return;

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? 50 : 250;
      let next = null;
      if (e.key === "[") next = (offsetMs ?? guessOffsetMs(timed)) - step;
      else if (e.key === "]") next = (offsetMs ?? guessOffsetMs(timed)) + step;
      else if (e.key === "\\") next = guessOffsetMs(timed);
      else if (e.key === "'") {
        // eslint-disable-next-line no-console
        console.log(`"${isrc}": ${Math.round(offsetMs ?? guessOffsetMs(timed))},`);
        return;
      } else return;

      e.preventDefault();
      next = Math.max(0, next);
      setNudgeMs(next);
      writeOverride(isrc, next);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, isrc, timed, offsetMs, setNudgeMs, playing]);
}

// ── loading skeleton ───────────────────────────────────────────────────────
// A spinner says "wait"; this says "lines are coming, and here is where they
// will be". Same left edge, same 30px pitch and same focal swell in the middle
// slot the first sung line takes, so the crossfade reads as the bars resolving
// into words rather than as one element being swapped for another.
//
// Ragged widths, not uniform ones — lyrics are short lines of unequal length,
// and a stack of identical bars reads as a table. The shimmer is one slow 3s
// sweep (Polymarket's skeleton rule: calm, so a loading panel never strobes).
const SK_ROWS = [0.86, 0.62, 0.94, 0.7, 0.5, 0.88, 0.66, 0.8, 0.58];
const SK_MID = (SK_ROWS.length - 1) / 2;
// Gentler than the live scroller's SIGMA of 1.05: there, everything but the
// focal line is meant to recede because you can scroll to it. Here nothing is
// reachable yet, so every row stays legible as a row.
const SK_SIGMA = 2.6;

function LyricSkeleton() {
  return (
    <div className="cv-lyrics-skeleton" aria-hidden="true">
      {SK_ROWS.map((w, i) => {
        const u = (i - SK_MID) / SK_SIGMA;
        const g = Math.exp(-u * u);
        return (
          <div
            key={i}
            className="cv-lyric-sk"
            style={{ "--ls": (0.72 + 0.34 * g).toFixed(3), "--lo": (0.16 + 0.84 * g).toFixed(3) }}
          >
            {/* the entry animation rides the BAR, not the row — the row is
                already spending its opacity on the proximity falloff, and an
                animation on the same property would win and erase it */}
            <span
              className="cv-lyric-sk-bar"
              style={{ "--sw": `${Math.round(w * 100)}%`, "--i": Math.abs(i - SK_MID) }}
            />
          </div>
        );
      })}
    </div>
  );
}
