"use client";

import { useEffect, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";

import { createVinylAudio } from "./vinylAudio";
import "./pull-vinyl.css";

const ORDER = [
  "abbey-road",
  "revolver",
  "rubber-soul",
  "sgt-pepper",
  "let-it-be",
  "help",
  "magical-mystery-tour",
  "a-hard-days-night",
  "white-album",
  "beatles-for-sale",
  "with-the-beatles",
  "please-please-me",
];
const POOL = (() => {
  const albums = ORDER.map((id) => ALBUMS.find((a) => a.id === id));
  const out = [];
  for (let j = 0; j < 7; j += 1) {
    albums.forEach((a) => {
      if (a.tracks[j]) out.push({ title: a.tracks[j], album: a });
    });
  }
  return out;
})();
const FIRST = 7;
const INITIAL = POOL.slice(0, FIRST).map((s, i) => ({
  ...s,
  key: `s${i}`,
  fresh: false,
}));
const THRESHOLD = 100;
const HOLD = 112;
const MAX = 170;

export default function Piece({ embedded = false }) {
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const zoneRef = useRef(null);
  const groupRef = useRef(null);
  const discRef = useRef(null);
  const sleeveRef = useRef(null);
  const haloRef = useRef(null);
  const engineRef = useRef(null);
  const nextRef = useRef(FIRST);
  const [items, setItems] = useState(INITIAL);
  const [phase, setPhase] = useState("idle");
  const [labelIndex, setLabelIndex] = useState(0);

  useEffect(() => {
    const scroller = scrollRef.current;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const audio = createVinylAudio();
    const st = {
      phase: "idle",
      pull: 0,
      y: 0,
      vy: 0,
      target: 0,
      out: 0,
      vout: 0,
      spin: 0,
      spinV: 0,
      armed: false,
      drag: null,
      wheelTimer: 0,
      timers: [],
      raf: 0,
      last: 0,
    };

    const go = (p) => {
      st.phase = p;
      setPhase(p);
    };

    const rubber = (d) => MAX * (1 - Math.exp(-Math.max(0, d) / 170));

    const paint = () => {
      const y = Math.max(0, st.y);
      listRef.current.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      const p = Math.min(1, y / THRESHOLD);
      const show = Math.min(1, y / 40);
      zoneRef.current.style.height = `${y.toFixed(2)}px`;
      groupRef.current.style.opacity = show.toFixed(3);
      groupRef.current.style.transform = `translate3d(0, ${(y / 2 - 40).toFixed(2)}px, 0) scale(${(0.7 + 0.3 * p).toFixed(3)})`;
      discRef.current.style.transform = `translate3d(${(st.out * 42).toFixed(2)}px, 0, 0) rotate(${st.spin.toFixed(1)}deg)`;
      sleeveRef.current.style.transform = `translate3d(${(-st.out * 22).toFixed(2)}px, 0, 0) rotate(${(-st.out * 4).toFixed(2)}deg)`;
      haloRef.current.style.opacity = (
        st.phase === "refreshing" ? 0.85 : p * 0.35
      ).toFixed(3);
      haloRef.current.style.transform = `translate3d(${(st.out * 42).toFixed(2)}px, 0, 0) scale(${(0.8 + Math.min(1, st.spinV / 600) * 0.5).toFixed(3)})`;
    };

    const loop = (now) => {
      const dt = Math.min(0.033, (now - st.last) / 1000);
      st.last = now;
      const following = st.phase === "pulling";
      if (following) {
        st.y = rubber(st.pull);
        st.vy = 0;
      } else {
        const k = 170;
        const c = 2 * Math.sqrt(k) * 0.95;
        const n = Math.max(1, Math.ceil(dt * 240));
        for (let i = 0; i < n; i += 1) {
          st.vy += ((k * (st.target - st.y) - c * st.vy) * dt) / n;
          st.y += (st.vy * dt) / n;
        }
      }
      const outTarget =
        st.phase === "refreshing"
          ? 1
          : Math.min(1, Math.max(0, st.y) / THRESHOLD);
      const ko = st.phase === "pulling" ? 900 : 240;
      const n2 = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < n2; i += 1) {
        st.vout +=
          ((ko * (outTarget - st.out) - 2 * Math.sqrt(ko) * st.vout) * dt) / n2;
        st.out += (st.vout * dt) / n2;
      }
      const spinTarget = st.phase === "refreshing" ? 620 : 0;
      st.spinV +=
        (spinTarget - st.spinV) *
        Math.min(1, dt * (st.phase === "refreshing" ? 2.6 : 3.4));
      st.spin += st.spinV * dt;
      if (st.phase === "pulling") st.spin = st.out * 140;
      if (st.phase === "pulling") {
        const armed = st.y >= THRESHOLD;
        if (armed !== st.armed) {
          st.armed = armed;
          if (armed) {
            audio.slide(0.035);
            if (navigator.vibrate) navigator.vibrate(6);
          }
          zoneRef.current.dataset.armed = armed ? "true" : "false";
        }
      }
      paint();
      const idle =
        st.phase === "idle" &&
        Math.abs(st.y) < 0.2 &&
        Math.abs(st.vy) < 0.5 &&
        st.out < 0.002 &&
        st.spinV < 1;
      if (idle) {
        st.y = 0;
        st.out = 0;
        st.spin = 0;
        paint();
        st.raf = 0;
        return;
      }
      st.raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(loop);
    };

    const later = (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      st.timers.push(id);
    };

    const refresh = () => {
      go("refreshing");
      st.target = HOLD;
      st.armed = false;
      zoneRef.current.dataset.armed = "false";
      audio.startCrackle();
      kick();
      later(
        () => {
          engineRef.current?.onLoaded();
          later(
            () => {
              audio.stopCrackle();
              audio.slide(0.02);
              go("idle");
              st.target = 0;
              kick();
            },
            reduce ? 0 : 280,
          );
        },
        reduce ? 300 : 1700,
      );
    };

    const release = () => {
      if (st.phase !== "pulling") return;
      if (st.y >= THRESHOLD) {
        st.vy = 0;
        refresh();
      } else {
        go(st.wasRefreshing ? "refreshing" : "idle");
        st.target = st.wasRefreshing ? HOLD : 0;
        kick();
      }
    };

    const begin = (startY) => {
      audio.wake();
      st.wasRefreshing = st.phase === "refreshing";
      if (st.wasRefreshing) return false;
      st.pull = Math.max(
        0,
        -170 * Math.log(1 - Math.min(0.999, Math.max(0, st.y) / MAX)),
      );
      st.drag = { y: startY, base: st.pull, active: false };
      return true;
    };

    const moveTo = (clientY) => {
      const d = st.drag.base + (clientY - st.drag.y);
      if (!st.drag.active) {
        if (clientY - st.drag.y < 4 || scroller.scrollTop > 0) return false;
        st.drag.active = true;
        go("pulling");
        kick();
      }
      st.pull = Math.max(0, d);
      return true;
    };

    const onPointerDown = (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      if (scroller.scrollTop > 0) return;
      if (!begin(e.clientY)) return;
      st.drag.id = e.pointerId;
    };
    const onPointerMove = (e) => {
      if (!st.drag || st.drag.id !== e.pointerId) return;
      if (moveTo(e.clientY) && !scroller.hasPointerCapture(e.pointerId))
        scroller.setPointerCapture(e.pointerId);
    };
    const onPointerUp = (e) => {
      if (!st.drag || st.drag.id !== e.pointerId) return;
      st.drag = null;
      release();
    };

    const onTouchStart = (e) => {
      if (scroller.scrollTop > 0 || e.touches.length !== 1) return;
      if (!begin(e.touches[0].clientY)) return;
      st.drag.id = "touch";
    };
    const onTouchMove = (e) => {
      if (!st.drag || st.drag.id !== "touch") return;
      if (moveTo(e.touches[0].clientY)) e.preventDefault();
    };
    const onTouchEnd = () => {
      if (!st.drag || st.drag.id !== "touch") return;
      st.drag = null;
      release();
    };

    const onWheel = (e) => {
      if (scroller.scrollTop > 0 || st.phase === "refreshing") return;
      if (e.deltaY >= 0 && st.phase !== "pulling") return;
      e.preventDefault();
      audio.wake();
      if (st.phase !== "pulling") {
        st.pull = 0;
        go("pulling");
        kick();
      }
      st.pull = Math.max(0, st.pull - e.deltaY * 0.9);
      window.clearTimeout(st.wheelTimer);
      st.wheelTimer = window.setTimeout(release, 160);
    };

    engineRef.current = {
      ...engineRef.current,
      trigger() {
        if (st.phase !== "idle") return;
        audio.wake();
        audio.slide(0.035);
        st.vy = 520;
        refresh();
      },
    };

    paint();
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", onPointerUp);
    scroller.addEventListener("pointercancel", onPointerUp);
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(st.raf);
      st.timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(st.wheelTimer);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("pointercancel", onPointerUp);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
      audio.destroy();
    };
  }, []);

  useEffect(() => {
    engineRef.current = {
      ...engineRef.current,
      onLoaded() {
        const start = nextRef.current;
        const fresh = [0, 1, 2].map((i) => {
          const s = POOL[(start + i) % POOL.length];
          return { ...s, key: `s${start + i}`, fresh: true };
        });
        nextRef.current = start + 3;
        setItems((prev) =>
          [...fresh, ...prev.map((it) => ({ ...it, fresh: false }))].slice(
            0,
            30,
          ),
        );
        setLabelIndex((i) => i + 1);
      },
    };
  }, []);

  const label = POOL[(labelIndex * 3 + FIRST) % POOL.length].album;
  const Root = embedded ? "div" : "main";

  return (
    <Root className="pull-vinyl" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : (
        <header className="pull-vinyl-head">
          <h1 className="pull-vinyl-title">Pull Vinyl</h1>
          <p className="pull-vinyl-hint">
            Pull the list down past the line and let go.
          </p>
        </header>
      )}

      <section className="pull-vinyl-screen" data-phase={phase}>
        <div className="pull-vinyl-bar">
          <h2 className="pull-vinyl-h">Recently added</h2>
          <button
            type="button"
            className="pull-vinyl-refresh"
            aria-label="Refresh"
            onClick={() => engineRef.current?.trigger()}
            disabled={phase !== "idle"}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="pull-vinyl-scroll"
          data-scroll-contain=""
        >
          <div
            ref={zoneRef}
            className="pull-vinyl-zone"
            data-armed="false"
            aria-hidden="true"
          >
            <div ref={groupRef} className="pull-vinyl-group">
              <div ref={haloRef} className="pull-vinyl-halo">
                <img src={label.cover} alt="" draggable={false} />
              </div>
              <div ref={discRef} className="pull-vinyl-disc">
                <span className="pull-vinyl-label">
                  <img src={label.cover} alt="" draggable={false} />
                </span>
                <span className="pull-vinyl-sheen" />
              </div>
              <div ref={sleeveRef} className="pull-vinyl-sleeve">
                <img src={label.cover} alt="" draggable={false} />
              </div>
            </div>
          </div>

          <ul ref={listRef} className="pull-vinyl-list" aria-live="polite">
            {items.map((it) => (
              <li
                key={it.key}
                className="pull-vinyl-item"
                data-fresh={it.fresh ? "" : undefined}
              >
                <div className="pull-vinyl-clip">
                  <div className="pull-vinyl-row">
                    <img src={it.album.cover} alt="" draggable={false} />
                    <span className="pull-vinyl-text">
                      <span className="pull-vinyl-song">{it.title}</span>
                      <span className="pull-vinyl-meta">
                        {it.album.title} · {it.album.year}
                      </span>
                    </span>
                    {it.fresh ? (
                      <span className="pull-vinyl-new">New</span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Root>
  );
}
