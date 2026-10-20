"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FPS, SHOTS, TOTAL, frameOf, frameTransform, shotIndexAt, spokenTime, timecode } from "./film";
import "./thumb-scrubber.css";

const START = SHOTS[5].start + 4.5;
const START_SHOT = shotIndexAt(START);
const TIERS = [
  { max: 40, gain: 1, label: "Hi-speed scrubbing" },
  { max: 104, gain: 0.5, label: "Half-speed scrubbing" },
  { max: 168, gain: 0.25, label: "Quarter-speed scrubbing" },
  { max: Infinity, gain: 0.1, label: "Fine scrubbing" },
];
const HYSTERESIS = 10;
const RESPONSE = 0.22;
const DAMPING_RATIO = 0.92;
const STIFFNESS = (2 * Math.PI / RESPONSE) ** 2;
const DAMPING = (4 * Math.PI * DAMPING_RATIO) / RESPONSE;
const SUBSTEP = 1 / 240;
const pad = (n) => String(n).padStart(2, "0");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function tierFor(offset, current) {
  let next = TIERS.findIndex((tier) => offset < tier.max);
  if (current != null && next < current && offset > TIERS[next].max - HYSTERESIS) next = current;
  return next;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const headRef = useRef(null);
  const hoverRef = useRef(null);
  const cardRef = useRef(null);
  const cardInnerRef = useRef(null);
  const cardTimeRef = useRef(null);
  const cardTitleRef = useRef(null);
  const timeRef = useRef(null);
  const shotNumRef = useRef(null);
  const shotTitleRef = useRef(null);
  const frameRefs = useRef([]);
  const cardFrameRefs = useRef([]);
  const stateRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [tier, setTier] = useState(null);

  if (stateRef.current === null) {
    stateRef.current = {
      t: START,
      hoverT: START,
      mode: null,
      playing: false,
      resume: false,
      drag: null,
      rect: null,
      trackW: 0,
      cardW: 0,
      cardX: 0,
      cardV: 0,
      cardOn: false,
      cardSnap: true,
      shot: START_SHOT,
      cardShot: START_SHOT,
      frame: -1,
      cardFrame: -1,
      second: -1,
      lastT: -1,
      lastCardT: -1,
      raf: 0,
      last: 0,
      reduced: false,
      keyTimer: 0,
      render: null,
      kick: null,
    };
  }

  const setPlay = useCallback((next) => {
    const st = stateRef.current;
    if (next && st.t >= TOTAL - 1 / FPS) st.t = 0;
    st.playing = next;
    setPlaying(next);
    if (next) st.kick?.();
  }, []);

  useLayoutEffect(() => {
    const st = stateRef.current;
    const track = trackRef.current;
    const card = cardRef.current;
    const root = rootRef.current;
    if (!track || !card || !root) return undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    st.reduced = motion.matches;

    const render = () => {
      const t = st.t;
      const frames = frameRefs.current;
      const i = shotIndexAt(t);
      if (i !== st.shot) {
        frames[st.shot].style.opacity = "0";
        frames[i].style.opacity = "1";
        st.shot = i;
        shotNumRef.current.textContent = pad(i + 1);
        shotTitleRef.current.textContent = SHOTS[i].title;
      }
      if (t !== st.lastT) {
        st.lastT = t;
        frames[i].style.transform = frameTransform(i, t, st.reduced);
        headRef.current.style.transform = `translate3d(${((t / TOTAL) * st.trackW).toFixed(2)}px, 0, 0)`;
        const f = frameOf(t);
        if (f !== st.frame) {
          st.frame = f;
          timeRef.current.textContent = timecode(t);
        }
        const sec = Math.floor(t);
        if (sec !== st.second) {
          st.second = sec;
          track.setAttribute("aria-valuenow", String(sec));
          track.setAttribute("aria-valuetext", spokenTime(t));
        }
      }
      if (st.mode === "hover") hoverRef.current.style.transform = `translate3d(${((st.hoverT / TOTAL) * st.trackW).toFixed(2)}px, 0, 0)`;
      if (!st.cardOn) return;
      const ct = st.mode === "hover" ? st.hoverT : t;
      if (ct === st.lastCardT) return;
      st.lastCardT = ct;
      const cardFrames = cardFrameRefs.current;
      const ci = shotIndexAt(ct);
      if (ci !== st.cardShot) {
        cardFrames[st.cardShot].style.opacity = "0";
        cardFrames[ci].style.opacity = "1";
        st.cardShot = ci;
        cardTitleRef.current.textContent = SHOTS[ci].title;
      }
      cardFrames[ci].style.transform = frameTransform(ci, ct, st.reduced);
      const cf = frameOf(ct);
      if (cf !== st.cardFrame) {
        st.cardFrame = cf;
        cardTimeRef.current.textContent = timecode(ct);
      }
    };

    const stepCard = (dt) => {
      if (!st.cardOn) return true;
      const ct = st.mode === "hover" ? st.hoverT : st.t;
      const anchor = (ct / TOTAL) * st.trackW;
      const target = clamp(anchor - st.cardW / 2, 0, Math.max(0, st.trackW - st.cardW));
      if (st.cardSnap || st.reduced) {
        st.cardSnap = false;
        st.cardX = target;
        st.cardV = 0;
      } else {
        const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
        const h = dt / steps;
        for (let k = 0; k < steps; k += 1) {
          const a = -STIFFNESS * (st.cardX - target) - DAMPING * st.cardV;
          st.cardV += a * h;
          st.cardX += st.cardV * h;
        }
      }
      const settled = Math.abs(st.cardX - target) < 0.2 && Math.abs(st.cardV) < 4;
      if (settled) {
        st.cardX = target;
        st.cardV = 0;
      }
      card.style.transform = `translate3d(${st.cardX.toFixed(2)}px, 0, 0)`;
      return settled;
    };

    const tick = (now) => {
      const dt = Math.min(0.064, Math.max(0, (now - st.last) / 1000));
      st.last = now;
      if (st.playing) {
        st.t = Math.min(TOTAL, st.t + dt);
        if (st.t >= TOTAL) {
          st.playing = false;
          setPlaying(false);
        }
      }
      render();
      const settled = stepCard(dt);
      if (st.playing || !settled) st.raf = requestAnimationFrame(tick);
      else st.raf = 0;
    };

    const kick = () => {
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(tick);
    };

    const measure = () => {
      st.trackW = track.clientWidth;
      st.cardW = card.offsetWidth;
      st.lastT = -1;
      st.lastCardT = -1;
      st.cardSnap = true;
      render();
      stepCard(0);
    };

    st.render = render;
    st.kick = kick;
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(track);
    ro.observe(card);

    const halt = () => {
      if (!st.playing) return;
      st.playing = false;
      setPlaying(false);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) halt();
    });
    io.observe(root);
    const onVisibility = () => {
      if (document.hidden) halt();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => {
      st.reduced = motion.matches;
      st.lastT = -1;
      render();
    };
    motion.addEventListener("change", onMotion);

    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      cancelAnimationFrame(st.raf);
      clearTimeout(st.keyTimer);
      st.raf = 0;
      st.kick = null;
      st.render = null;
    };
  }, []);

  useEffect(() => {
    const st = stateRef.current;
    if (playing) st.kick?.();
  }, [playing]);

  const showCard = (mode) => {
    const st = stateRef.current;
    if (!st.cardOn) {
      st.cardOn = true;
      st.cardSnap = true;
      st.lastCardT = -1;
      cardInnerRef.current.dataset.on = "true";
    }
    st.mode = mode;
    hoverRef.current.dataset.on = mode === "hover" ? "true" : "false";
    st.kick?.();
  };

  const hideCard = () => {
    const st = stateRef.current;
    st.cardOn = false;
    st.mode = null;
    cardInnerRef.current.dataset.on = "false";
    hoverRef.current.dataset.on = "false";
  };

  const timeAt = (clientX) => {
    const r = stateRef.current.rect;
    return clamp((clientX - r.left) / r.width, 0, 1) * TOTAL;
  };

  const onPointerEnter = (e) => {
    if (e.pointerType !== "mouse" || stateRef.current.drag) return;
    const st = stateRef.current;
    st.rect = trackRef.current.getBoundingClientRect();
    st.hoverT = timeAt(e.clientX);
    showCard("hover");
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const st = stateRef.current;
    st.rect = trackRef.current.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    st.resume = st.playing;
    if (st.playing) setPlay(false);
    const t = timeAt(e.clientX);
    st.t = t;
    st.drag = { id: e.pointerId, anchorX: e.clientX, anchorT: t, tier: 0 };
    setTier(0);
    showCard("drag");
  };

  const onPointerMove = (e) => {
    const st = stateRef.current;
    const drag = st.drag;
    if (drag && e.pointerId === drag.id) {
      const r = st.rect;
      const offset = Math.max(0, Math.abs(e.clientY - (r.top + r.height / 2)) - r.height / 2);
      const next = tierFor(offset, drag.tier);
      if (next !== drag.tier) {
        drag.tier = next;
        drag.anchorX = e.clientX;
        drag.anchorT = st.t;
        setTier(next);
      }
      st.t = clamp(drag.anchorT + ((e.clientX - drag.anchorX) / r.width) * TOTAL * TIERS[next].gain, 0, TOTAL);
      st.kick?.();
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (st.mode !== "hover") st.rect = trackRef.current.getBoundingClientRect();
    st.hoverT = timeAt(e.clientX);
    if (st.mode !== "hover") showCard("hover");
    st.kick?.();
  };

  const endDrag = (e, cancelled) => {
    const st = stateRef.current;
    if (!st.drag || e.pointerId !== st.drag.id) return;
    st.drag = null;
    setTier(null);
    const r = st.rect;
    const inside = !cancelled && e.pointerType === "mouse" && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside) {
      st.hoverT = timeAt(e.clientX);
      showCard("hover");
    } else hideCard();
    if (st.resume) setPlay(true);
    st.resume = false;
  };

  const onPointerLeave = () => {
    const st = stateRef.current;
    if (!st.drag && st.mode === "hover") hideCard();
  };

  const seek = (t) => {
    const st = stateRef.current;
    st.t = clamp(t, 0, TOTAL);
    showCard("key");
    clearTimeout(st.keyTimer);
    st.keyTimer = setTimeout(() => {
      if (stateRef.current.mode === "key") hideCard();
    }, 1100);
  };

  const onKeyDown = (e) => {
    const st = stateRef.current;
    const fine = 1 / FPS;
    const i = shotIndexAt(st.t);
    const keys = {
      ArrowRight: () => seek(st.t + (e.shiftKey ? fine : 1)),
      ArrowLeft: () => seek(st.t - (e.shiftKey ? fine : 1)),
      ".": () => seek(st.t + fine),
      ",": () => seek(st.t - fine),
      Home: () => seek(0),
      End: () => seek(TOTAL),
      PageDown: () => seek(i < SHOTS.length - 1 ? SHOTS[i + 1].start : TOTAL),
      PageUp: () => seek(st.t - SHOTS[i].start > 0.5 || i === 0 ? SHOTS[i].start : SHOTS[i - 1].start),
      " ": () => setPlay(!st.playing),
      k: () => setPlay(!st.playing),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const onBlur = () => {
    if (stateRef.current.mode === "key") hideCard();
  };

  const shot = SHOTS[START_SHOT];

  return (
    <div ref={rootRef} className="ts" data-embedded={embedded ? "true" : "false"}>
      {!embedded && (
        <header className="ts-head">
          <h1 className="ts-title text-heading">Scorch</h1>
          <p className="ts-sub text-ui-lg">A short film in seven shots</p>
        </header>
      )}
      <div className="ts-player">
        <button type="button" className="ts-viewer" onClick={() => setPlay(!stateRef.current.playing)} aria-label={playing ? "Pause" : "Play"} tabIndex={-1}>
          {SHOTS.map((s, i) => (
            <span
              key={s.id}
              ref={(el) => {
                frameRefs.current[i] = el;
              }}
              className="ts-frame"
              style={{ backgroundImage: `url(${s.src})`, opacity: i === START_SHOT ? 1 : 0, transform: frameTransform(i, START) }}
            />
          ))}
          <span className="ts-grain" aria-hidden="true" />
        </button>
        <div className="ts-bar">
          <div className="ts-row">
            <button type="button" className="ts-play" data-playing={playing ? "true" : "false"} onClick={() => setPlay(!playing)} aria-label={playing ? "Pause" : "Play"}>
              <svg className="ts-icon ts-icon-play" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6.5 4.6v10.8c0 .6.6.9 1.1.6l8.4-5.4a.7.7 0 0 0 0-1.2L7.6 4c-.5-.3-1.1 0-1.1.6Z" />
              </svg>
              <svg className="ts-icon ts-icon-pause" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="4" width="3.6" height="12" rx="1" />
                <rect x="11.4" y="4" width="3.6" height="12" rx="1" />
              </svg>
            </button>
            <p className="ts-clock font-mono text-ui-lg">
              <span ref={timeRef} className="ts-now">{timecode(START)}</span>
              <span className="ts-total"> / {timecode(TOTAL)}</span>
            </p>
            <p className="ts-shot text-ui-lg">
              <span ref={shotNumRef} className="ts-shot-num font-mono">{pad(START_SHOT + 1)}</span>
              <span ref={shotTitleRef} className="ts-shot-title">{shot.title}</span>
            </p>
          </div>
          <div className="ts-scrub">
            <div ref={cardRef} className="ts-card" aria-hidden="true">
              <div ref={cardInnerRef} className="ts-card-inner" data-on="false">
                <div className="ts-tier" data-on={tier === null ? "false" : "true"}>
                  {tier !== null && (
                    <span key={tier} className="ts-tier-label text-ui-sm">
                      {TIERS[tier].label}
                    </span>
                  )}
                </div>
                <div className="ts-card-frame">
                  {SHOTS.map((s, i) => (
                    <span
                      key={s.id}
                      ref={(el) => {
                        cardFrameRefs.current[i] = el;
                      }}
                      className="ts-frame"
                      style={{ backgroundImage: `url(${s.src})`, opacity: i === START_SHOT ? 1 : 0 }}
                    />
                  ))}
                </div>
                <div className="ts-card-meta">
                  <span ref={cardTimeRef} className="ts-card-time font-mono text-ui-sm">{timecode(START)}</span>
                  <span ref={cardTitleRef} className="ts-card-title text-ui-sm">{shot.title}</span>
                </div>
              </div>
            </div>
            <div
              ref={trackRef}
              className="ts-track"
              role="slider"
              tabIndex={0}
              aria-label="Timeline"
              aria-valuemin={0}
              aria-valuemax={Math.floor(TOTAL)}
              aria-valuenow={Math.floor(START)}
              aria-valuetext={spokenTime(START)}
              onPointerEnter={onPointerEnter}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endDrag(e, false)}
              onPointerCancel={(e) => endDrag(e, true)}
              onLostPointerCapture={(e) => endDrag(e, true)}
              onPointerLeave={onPointerLeave}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
            >
              <div className="ts-strip">
                {SHOTS.map((s) => (
                  <span key={s.id} className="ts-seg" style={{ flexGrow: s.dur, backgroundImage: `url(${s.src})` }} />
                ))}
              </div>
              <span ref={hoverRef} className="ts-hover" data-on="false" />
              <span ref={headRef} className="ts-head-line" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
