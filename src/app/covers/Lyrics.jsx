"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Plain lyrics from lrclib (via our proxy), shown as a free native scroller with
// a proximity-scaled focus: the line nearest the vertical centre swells to full
// size + opacity, lines further out shrink and fade (sharp Gaussian peak). Just
// scroll — nothing is clickable. Loading → loaded crossfades; the spinner never
// just pops out of existence.
export default function Lyrics({ artist, title, color = "#1a1a1a" }) {
  const [lines, setLines] = useState(null); // string[]
  const [status, setStatus] = useState("loading"); // loading | ready | none

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setLines(null);
    if (!title) {
      setStatus("none");
      return;
    }
    fetch(`/api/spotify/lyrics?artist=${encodeURIComponent(artist || "")}&title=${encodeURIComponent(title)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.plain) {
          setLines(d.plain.split("\n").map((t) => t.trim()));
          setStatus("ready");
        } else {
          setStatus("none");
        }
      })
      .catch(() => alive && setStatus("none"));
    return () => {
      alive = false;
    };
  }, [artist, title]);

  return (
    <div className="cv-lyrics-stage">
      {/* content sits in-flow (so the scroller gets a real flex height) */}
      <div className={`cv-lyrics-content ${status !== "loading" ? "is-on" : "is-off"}`}>
        {status === "none" ? (
          <div className="cv-lyrics--note">no lyrics found</div>
        ) : status === "ready" ? (
          <LyricScroller lines={lines} />
        ) : null}
      </div>

      {/* loader overlays on top, crossfades out — never unmounts mid-spin */}
      <div className={`cv-lyrics-loader ${status === "loading" ? "is-on" : "is-off"}`}>
        <Spinner color={color} />
      </div>
    </div>
  );
}

// ── proximity-scaled native scroller ────────────────────────────────────────
function LyricScroller({ lines }) {
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

  // Settle-snap: once scrolling stops, glide the nearest line to dead-centre (the
  // focal slot). Debounced so it never fights an active wheel/drag; once snapped,
  // the nearest line already sits at centre so it's a no-op and the loop rests.
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
      if (!best) return;
      const target = best.offsetTop + best.offsetHeight / 2 - sc.clientHeight / 2;
      if (Math.abs(target - sc.scrollTop) > 1) sc.scrollTo({ top: target, behavior: "smooth" });
    }, 130);
  }, []);

  const onScroll = useCallback(() => {
    scheduleSnap();
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      update();
    });
  }, [update, scheduleSnap]);

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
      if (sc.scrollHeight <= sc.clientHeight) return;
      const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sc.clientHeight : 1;
      sc.scrollTop += e.deltaY * step;
      e.preventDefault();
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  }, [lines]);

  return (
    <div ref={scrollRef} className="cv-lyrics" onScroll={onScroll}>
      <div className="cv-lyrics-pad" style={{ height: pad }} />
      {lines.map((text, i) => (
        <p
          key={i}
          ref={(el) => (lineRefs.current[i] = el)}
          className="cv-lyric"
          style={{ "--i": Math.min(i, 14) }}
        >
          <span className="cv-lyric-in">{text || "♪"}</span>
        </p>
      ))}
      <div className="cv-lyrics-pad" style={{ height: pad }} />
    </div>
  );
}

// ── custom spinner ─────────────────────────────────────────────────────────
// Vinyl-flavoured: two counter-rotating arcs around a pulsing core. Each part
// chains a one-shot scale-in into its infinite loop (loop delay = entry length),
// per the SVG-animation chaining pattern.
function Spinner({ color = "#1a1a1a" }) {
  return (
    <svg className="cv-spin" width="46" height="46" viewBox="0 0 48 48" fill="none" aria-label="loading lyrics" role="img">
      <style>{`
        @keyframes cvSpinEnter { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: scale(1); } }
        @keyframes cvSpinCW  { to { transform: rotate(360deg); } }
        @keyframes cvSpinCCW { to { transform: rotate(-360deg); } }
        @keyframes cvSpinPulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.55); opacity: 0.4; } }
        .cv-spin circle { transform-box: fill-box; transform-origin: center; }
        .cv-spin-track { opacity: 0.12; }
        .cv-spin-arc-a {
          animation: cvSpinEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1) both,
                     cvSpinCW 1.05s linear 0.4s infinite;
        }
        .cv-spin-arc-b {
          opacity: 0.55;
          animation: cvSpinEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.07s both,
                     cvSpinCCW 1.7s linear 0.47s infinite;
        }
        .cv-spin-dot {
          animation: cvSpinEnter 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.14s both,
                     cvSpinPulse 1.6s ease-in-out 0.54s infinite;
        }
      `}</style>
      <circle className="cv-spin-track" cx="24" cy="24" r="18" stroke={color} strokeWidth="2.5" />
      <circle className="cv-spin-arc-a" cx="24" cy="24" r="18" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="30 200" />
      <circle className="cv-spin-arc-b" cx="24" cy="24" r="11" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="16 120" />
      <circle className="cv-spin-dot" cx="24" cy="24" r="2.4" fill={color} />
    </svg>
  );
}
