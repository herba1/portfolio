"use client";

import { useEffect, useRef, useState } from "react";

import { createClicks } from "./cfAudio";
import { DECKS } from "./cfDecks";
import { createBlend } from "./cfGL";
import { css, glow, readPalette } from "./cfPalette";
import "./crossfade.css";

const COLUMN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function Slots({ count, refs, dot, blankLead }) {
  return (
    <span className="cf-slots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="cf-slot-wrap">
          {dot === i ? <span className="cf-slot-dot">.</span> : null}
          <span className="cf-slot">
            <span
              className="cf-slot-col"
              ref={(el) => {
                refs.current[i] = el;
              }}
            >
              {COLUMN.map((d, k) => (
                <span key={k} data-blank={blankLead && i === 0 && d === 0 ? "" : undefined}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}

function rollDigits(cols, value, scale) {
  const v = Math.max(0, value * scale);
  const n = cols.length;
  for (let i = 0; i < n; i += 1) {
    const place = 10 ** (n - 1 - i);
    const pos = place === 1 ? v % 10 : (Math.floor(v / place) % 10) + clamp((v % place) - (place - 1));
    if (cols[i]) cols[i].style.transform = `translateY(${((-pos * 100) / 11).toFixed(3)}%)`;
  }
}

function Deck({ side, deck, onPick, slotRefs }) {
  return (
    <section className="cf-deck" data-side={side} aria-label={`Deck ${side}`}>
      <h2 className="cf-deck-label">Deck {side}</h2>
      <div className="cf-picker" role="radiogroup" aria-label={`Record on deck ${side}`}>
        {DECKS.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={d.id === deck.id} aria-label={`${d.title}, ${d.album}`} className="cf-pick" onClick={() => onPick(d.id)}>
            <img src={d.cover} alt="" draggable={false} />
          </button>
        ))}
      </div>
      <div className="cf-deck-meta" key={deck.id}>
        <span className="cf-deck-title">{deck.title}</span>
        <span className="cf-deck-album">
          {deck.album} · {deck.year}
        </span>
      </div>
      <p className="cf-deck-bpm" aria-label={`${deck.bpm} BPM`}>
        <Slots count={3} refs={slotRefs} blankLead />
        <span className="cf-unit">BPM</span>
      </p>
    </section>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const capRef = useRef(null);
  const railRef = useRef(null);
  const titleARef = useRef(null);
  const titleBRef = useRef(null);
  const masterRefs = useRef([]);
  const deckARefs = useRef([]);
  const deckBRefs = useRef([]);
  const stateRef = useRef({ target: 0.28, x: 0.28, v: 0, bpmA: DECKS[0].bpm, bpmB: DECKS[1].bpm, shownA: DECKS[0].bpm, shownB: DECKS[1].bpm, vA: 0, vB: 0, master: 0, vM: 0, wake: null });
  const blendRef = useRef(null);
  const clicksRef = useRef(null);
  const [aId, setAId] = useState(DECKS[0].id);
  const [bId, setBId] = useState(DECKS[1].id);
  const [value, setValue] = useState(28);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  const deckA = DECKS.find((d) => d.id === aId);
  const deckB = DECKS.find((d) => d.id === bId);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.className = "cf-canvas";
    canvasRef.current.appendChild(canvas);
    const root = rootRef.current;
    let blend = null;
    try {
      blend = createBlend(canvas);
    } catch {
      blend = null;
    }
    if (!blend) {
      const t = setTimeout(() => setFailed(true), 0);
      return () => {
        clearTimeout(t);
        canvas.remove();
      };
    }
    blendRef.current = blend;
    clicksRef.current = createClicks();
    const s = stateRef.current;
    let raf = 0;
    let last = 0;
    let seen = true;
    let lastSide = Math.sign(s.x - 0.5);
    const started = performance.now();

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(2, Math.round(r.width * dpr));
      canvas.height = Math.max(2, Math.round(r.height * dpr));
    };

    const tick = (now) => {
      raf = 0;
      if (!seen || document.hidden) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      const steps = Math.max(1, Math.round(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        s.v += (-520 * (s.x - s.target) - 2 * Math.sqrt(520) * s.v) * h;
        s.x += s.v * h;
        s.vA += (-160 * (s.shownA - s.bpmA) - 2 * 0.86 * Math.sqrt(160) * s.vA) * h;
        s.shownA += s.vA * h;
        s.vB += (-160 * (s.shownB - s.bpmB) - 2 * 0.86 * Math.sqrt(160) * s.vB) * h;
        s.shownB += s.vB * h;
        const goal = Math.round((s.shownA + (s.shownB - s.shownA) * clamp(s.x)) * 10) / 10;
        if (!s.master) s.master = goal;
        s.vM += (-300 * (s.master - goal) - 2 * 0.9 * Math.sqrt(300) * s.vM) * h;
        s.master += s.vM * h;
      }
      const mix = clamp(s.x);
      const side = Math.sign(mix - 0.5);
      if (side !== lastSide && side !== 0) {
        clicksRef.current?.click(1.3, 0.05);
        lastSide = side;
      }
      blend.setMix(mix);
      blend.advance(dt);
      blend.render((now - started) / 1000);
      root.style.setProperty("--cf-mix", mix.toFixed(4));
      capRef.current.style.left = `${(mix * 100).toFixed(3)}%`;
      const fa = 1 - clamp((mix - 0.3) / 0.4);
      const fb = clamp((mix - 0.3) / 0.4);
      titleARef.current.style.opacity = String(fa);
      titleARef.current.style.filter = `blur(${((1 - fa) * 8).toFixed(2)}px)`;
      titleARef.current.style.transform = `translateX(${(-(1 - fa) * 16).toFixed(2)}px)`;
      titleBRef.current.style.opacity = String(fb);
      titleBRef.current.style.filter = `blur(${((1 - fb) * 8).toFixed(2)}px)`;
      titleBRef.current.style.transform = `translateX(${((1 - fb) * 16).toFixed(2)}px)`;
      rollDigits(masterRefs.current, s.master, 10);
      rollDigits(deckARefs.current, s.shownA, 1);
      rollDigits(deckBRefs.current, s.shownB, 1);
      raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf && seen && !document.hidden) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    s.wake = wake;
    const ro = new ResizeObserver(() => {
      size();
      wake();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      wake();
    });
    io.observe(root);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    size();
    wake();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      blend.destroy();
      canvas.remove();
      clicksRef.current?.destroy();
      blendRef.current = null;
      clicksRef.current = null;
    };
  }, []);

  useEffect(() => {
    blendRef.current?.setCover("A", deckA.cover);
    stateRef.current.bpmA = deckA.bpm;
    stateRef.current.wake?.();
  }, [deckA]);

  useEffect(() => {
    blendRef.current?.setCover("B", deckB.cover);
    stateRef.current.bpmB = deckB.bpm;
    stateRef.current.wake?.();
  }, [deckB]);

  useEffect(() => {
    let alive = true;
    Promise.all([readPalette(deckA.cover), readPalette(deckB.cover)]).then(([pa, pb]) => {
      const root = rootRef.current;
      if (!alive || !root) return;
      root.style.setProperty("--cf-a", css(glow(pa.colors[0])));
      root.style.setProperty("--cf-a2", css(glow(pa.colors[1])));
      root.style.setProperty("--cf-b", css(glow(pb.colors[0])));
      root.style.setProperty("--cf-b2", css(glow(pb.colors[1])));
    });
    return () => {
      alive = false;
    };
  }, [deckA.cover, deckB.cover]);

  const setTarget = (v, immediate) => {
    const s = stateRef.current;
    s.target = clamp(v);
    if (immediate) {
      s.x = s.target;
      s.v = 0;
    }
    setValue(Math.round(s.target * 100));
    s.wake?.();
  };

  const onFaderDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clicksRef.current?.wake();
    const rail = railRef.current;
    const rect = rail.getBoundingClientRect();
    const s = stateRef.current;
    const onCap = e.target.closest(".cf-cap");
    const offset = onCap ? (e.clientX - rect.left) / rect.width - s.x : 0;
    const at = (ev) => (ev.clientX - rect.left) / rect.width - offset;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    setTarget(at(e));
    const id = e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      setTarget(at(ev));
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      setDragging(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onFaderKey = (e) => {
    const s = stateRef.current;
    const step = e.shiftKey ? 0.25 : 0.05;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = s.target + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = s.target - step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    else if (e.key === " " || e.key === "Enter") next = s.target < 0.5 ? 1 : 0;
    if (next === null) return;
    e.preventDefault();
    clicksRef.current?.wake();
    setTarget(next);
  };

  return (
    <div className="crossfade" ref={rootRef} data-embedded={embedded ? "" : undefined} data-dragging={dragging ? "" : undefined} data-scroll-contain="">
      <div className="cf-glow" aria-hidden="true" />
      {embedded ? null : (
        <header className="cf-caption">
          <h1 className="cf-title">Crossfade</h1>
          <p className="cf-hint">Drag the fader to mix from one record to the other. Pick what is on each deck.</p>
        </header>
      )}
      <div className="cf-stage">
        <Deck side="A" deck={deckA} onPick={setAId} slotRefs={deckARefs} />
        <div className="cf-center">
          <div className="cf-canvas-wrap">
            <div ref={canvasRef} className="cf-canvas-host" aria-label={`${deckA.title} blended with ${deckB.title}`} role="img" />
            {failed ? <p className="cf-fallback">This blend needs WebGL 2.</p> : null}
          </div>
          <div className="cf-master">
            <div className="cf-titles">
              <span className="cf-mtitle" ref={titleARef}>
                <span className="cf-mtitle-song">{deckA.title}</span>
                <span className="cf-mtitle-album">{deckA.album}</span>
              </span>
              <span className="cf-mtitle" ref={titleBRef}>
                <span className="cf-mtitle-song">{deckB.title}</span>
                <span className="cf-mtitle-album">{deckB.album}</span>
              </span>
            </div>
            <p className="cf-master-bpm" aria-hidden="true">
              <Slots count={4} refs={masterRefs} dot={3} blankLead />
              <span className="cf-unit">BPM</span>
            </p>
          </div>
          <div className="cf-fader">
            <span className="cf-end">A</span>
            <div
              className="cf-track"
              role="slider"
              tabIndex={0}
              aria-label="Crossfader"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-valuetext={value < 50 ? `${100 - value}% ${deckA.title}` : `${value}% ${deckB.title}`}
              onPointerDown={onFaderDown}
              onKeyDown={onFaderKey}
              onDoubleClick={() => setTarget(0.5)}
            >
              <span className="cf-rail" ref={railRef}>
                <span className="cf-tick" data-at="0" />
                <span className="cf-tick" data-at="25" />
                <span className="cf-tick cf-tick-mid" data-at="50" />
                <span className="cf-tick" data-at="75" />
                <span className="cf-tick" data-at="100" />
                <span className="cf-cap" ref={capRef}>
                  <i />
                </span>
              </span>
            </div>
            <span className="cf-end">B</span>
          </div>
        </div>
        <Deck side="B" deck={deckB} onPick={setBId} slotRefs={deckBRefs} />
      </div>
    </div>
  );
}
