"use client";

import { useEffect, useRef } from "react";

import { PAGES, PAGE_W } from "./pages";

import "./tabs-swipe.css";

// Springs in UIKit terms: response (s) and damping ratio.
const spring = (response, damping) => ({
  k: (2 * Math.PI / response) ** 2,
  c: (4 * Math.PI * damping) / response,
});
const LAYOUT = spring(0.46, 0.84); // grid reflow
const BACK = spring(0.38, 0.8); // swipe cancelled, card returns
const AWAY = spring(0.5, 1); // card leaves; release velocity carried in
const TILT = spring(0.2, 0.9);
const ENTER = spring(0.5, 0.9);
const EDGE = spring(0.42, 1); // scroll rubber band returning
const STEP = 1 / 240;

const STAGGER = 0.034; // s between neighbours as the grid closes up
const SCROLL_DECAY = 0.998; // per ms, UIScrollView normal rate

// iOS rubber band: the further past the edge, the harder it pulls.
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;
const band = (v, lo, hi, d) => (v < lo ? lo - rubber(lo - v, d) : v > hi ? hi + rubber(v - hi, d) : v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = (v) => Math.round(v / 4) * 4;

const stepSpring = (p, v, target, sp, h) => {
  const a = -sp.k * (p - target) - sp.c * v;
  v += a * h;
  return [p + v * h, v];
};

export default function Piece() {
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  const cardRefs = useRef([]);

  useEffect(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    const box = root.closest(".piece-box") || root;
    const els = cardRefs.current;
    const params = new URLSearchParams(window.location.search);
    const stillT = params.has("t") ? Math.max(0, +params.get("t") || 0) : null;
    const stillCard = params.has("card") ? clamp(Math.round(+params.get("card") || 0), 0, PAGES.length - 1) : 2;

    const s = {
      w: 0, h: 0, k: 1,
      cw: 0, ch: 0, gap: 16, rowH: 0, padTop: 0, padBottom: 0, left: 0,
      sy: 0, svy: 0, wheelAt: -1,
      time: 0, last: 0, raf: 0, frozen: false,
      restoreAt: -1,
      g: null,
    };

    const cards = PAGES.map((_, i) => ({
      i,
      present: true, gone: false,
      lx: 0, ly: 0, lvx: 0, lvy: 0, tx: 0, ty: 0, pending: null,
      x: 0, vx: 0, mode: "rest", // rest | drag | fly | back
      dragV: 0, rot: 0, vrot: 0, pivot: 0,
      enter: 1, venter: 0, enterAt: 0,
    }));

    const order = () => cards.filter((c) => c.present);
    const slot = (k) => [
      (k % 2) * (s.cw + s.gap),
      s.padTop + Math.floor(k / 2) * s.rowH,
    ];
    const maxScroll = () => {
      const n = order().length;
      const rows = Math.ceil(n / 2);
      const content = s.padTop + Math.max(0, rows * s.rowH - 24) + s.padBottom;
      return Math.max(0, content - s.h);
    };

    // Everyone in the grid gets a new slot. The ones nearest the gap move
    // first, so the grid closes up like a wave rather than all at once.
    const reflow = (from, instant = false) => {
      const list = order();
      const at = list.findIndex((c) => c.i >= from);
      list.forEach((c, k) => {
        const [x, y] = slot(k);
        if (instant) {
          c.tx = c.lx = x; c.ty = c.ly = y; c.lvx = c.lvy = 0; c.pending = null;
          return;
        }
        if (x === c.tx && y === c.ty && !c.pending) return;
        const delay = at < 0 ? 0 : Math.max(0, k - at) * STAGGER;
        c.pending = { x, y, at: s.time + delay };
      });
    };

    const measure = () => {
      const r = box.getBoundingClientRect();
      const k = box.offsetWidth ? r.width / box.offsetWidth : 1;
      s.k = k;
      const w = box.offsetWidth || r.width;
      const h = box.offsetHeight || r.height;
      // The observer's first call repeats the size we already laid out at.
      if (w === s.w && h === s.h) return;
      s.w = w;
      s.h = h;
      const byW = (Math.min(s.w, 520) - 40 - s.gap) / 2;
      const byH = (s.h * 0.37 - 48) / 1.32;
      s.cw = Math.round(clamp(Math.min(byW, byH), 112, 200));
      s.ch = r4(s.cw * 1.32);
      s.rowH = s.ch + 24 + 24;
      s.padTop = r4(clamp(s.h * 0.08, 24, 72));
      s.padBottom = s.padTop + 16;
      s.left = Math.round((s.w - (s.cw * 2 + s.gap)) / 2);
      root.style.setProperty("--ts-cw", `${s.cw}px`);
      root.style.setProperty("--ts-ch", `${s.ch}px`);
      root.style.setProperty("--ts-scale", `${s.cw / PAGE_W}`);
      root.style.setProperty("--ts-page-h", `${(s.ch * PAGE_W) / s.cw}px`);
      reflow(0, true);
      s.sy = clamp(s.sy, 0, maxScroll());
      paint();
    };

    const flyTarget = (c) => -(s.left + c.lx + s.cw + 80);

    const paint = () => {
      layer.style.transform = `translate3d(${s.left}px, ${-s.sy}px, 0)`;
      for (const c of cards) {
        const el = els[c.i];
        if (!el) continue;
        if (c.gone) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "";
        const sc = 0.94 + 0.06 * c.enter;
        el.style.transform =
          `translate3d(${(c.lx + c.x).toFixed(2)}px, ${c.ly.toFixed(2)}px, 0) rotate(${c.rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
        el.style.opacity = c.enter < 0.999 ? clamp(c.enter, 0, 1).toFixed(3) : "";
        el.style.transformOrigin = `50% ${(50 + c.pivot * 50).toFixed(1)}%`;
        const lifted = c.mode === "drag" || c.mode === "fly";
        if (lifted !== (el.dataset.lifted !== undefined)) {
          if (lifted) el.dataset.lifted = "";
          else delete el.dataset.lifted;
        }
        // A tab changing rows travels over the ones sliding along a row.
        const crossing = Math.abs(c.ly - c.ty) > 1 || (c.pending && c.pending.y !== c.ty);
        el.style.zIndex = lifted ? 3 : c.mode === "back" ? 2 : crossing ? 1 : 0;
      }
    };

    const advance = (dt) => {
      for (let t = 0; t < dt; t += STEP) {
        const h = Math.min(STEP, dt - t);
        s.time += h;
        for (const c of cards) {
          if (c.gone) continue;
          if (c.pending && s.time >= c.pending.at) {
            c.tx = c.pending.x; c.ty = c.pending.y; c.pending = null;
          }
          [c.lx, c.lvx] = stepSpring(c.lx, c.lvx, c.tx, LAYOUT, h);
          [c.ly, c.lvy] = stepSpring(c.ly, c.lvy, c.ty, LAYOUT, h);

          let v = c.dragV;
          if (c.mode === "fly") {
            [c.x, c.vx] = stepSpring(c.x, c.vx, flyTarget(c), AWAY, h);
            v = c.vx;
            if (s.left + c.lx + c.x + s.cw * 1.2 < 0) {
              c.gone = true; c.mode = "rest"; c.x = 0; c.vx = 0; c.rot = 0; c.vrot = 0;
            }
          } else if (c.mode === "back") {
            [c.x, c.vx] = stepSpring(c.x, c.vx, 0, BACK, h);
            v = c.vx;
            if (Math.abs(c.x) < 0.2 && Math.abs(c.vx) < 4) {
              c.x = 0; c.vx = 0; c.mode = "rest";
            }
          } else if (c.mode === "rest") v = 0;
          // Tilt follows how fast it is moving, about the point that was held.
          const tilt = clamp(-v * 0.0032 * (0.35 + 0.65 * Math.abs(c.pivot)) * (c.pivot < 0 ? -1 : 1), -6, 6);
          [c.rot, c.vrot] = stepSpring(c.rot, c.vrot, tilt, TILT, h);

          if (s.time >= c.enterAt) [c.enter, c.venter] = stepSpring(c.enter, c.venter, 1, ENTER, h);
        }

        // Scroll: momentum inside the bounds, a spring past them.
        const g = s.g;
        if (!(g && g.axis === "y")) {
          const max = maxScroll();
          const wheeling = s.time - s.wheelAt < 0.14;
          if (!wheeling && (s.sy < 0 || s.sy > max)) {
            [s.sy, s.svy] = stepSpring(s.sy, s.svy, s.sy < 0 ? 0 : max, EDGE, h);
            if ((s.sy > -0.3 && s.sy < 0.3) || Math.abs(s.sy - max) < 0.3) {
              if (Math.abs(s.svy) < 6) { s.sy = clamp(s.sy, 0, max); s.svy = 0; }
            }
          } else if (!wheeling && s.svy) {
            s.svy *= Math.pow(SCROLL_DECAY, h * 1000);
            s.sy += s.svy * h;
            if (Math.abs(s.svy) < 4) s.svy = 0;
          }
        }
      }

      if (cards.every((c) => !c.present && c.gone) && s.restoreAt < 0) s.restoreAt = s.time + 0.9;
      if (s.restoreAt >= 0 && s.time >= s.restoreAt) restore();
    };

    const restore = () => {
      s.restoreAt = -1;
      cards.forEach((c, k) => {
        c.present = true; c.gone = false; c.mode = "rest";
        c.x = c.vx = c.rot = c.vrot = 0;
        c.enter = 0; c.venter = 0; c.enterAt = s.time + k * 0.05;
      });
      reflow(0, true);
      s.svy = 0;
    };

    const busy = () =>
      s.g ||
      s.restoreAt >= 0 ||
      s.svy !== 0 ||
      s.sy < 0 || s.sy > maxScroll() ||
      s.time - s.wheelAt < 0.3 ||
      cards.some(
        (c) =>
          !c.gone &&
          (c.mode !== "rest" || c.pending || c.enter < 0.999 ||
            Math.abs(c.rot) > 0.01 || Math.abs(c.vrot) > 0.05 ||
            Math.abs(c.lx - c.tx) > 0.1 || Math.abs(c.ly - c.ty) > 0.1 ||
            Math.abs(c.lvx) > 1 || Math.abs(c.lvy) > 1),
      );

    const tick = (now) => {
      const dt = Math.min(0.05, (now - s.last) / 1000 || 0);
      s.last = now;
      // While a finger holds a card, its velocity decays if the finger stops.
      if (s.g && s.g.axis === "x") {
        const c = cards[s.g.card];
        c.dragV = velocity()[0];
      }
      advance(dt);
      paint();
      s.raf = busy() ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (s.frozen || s.raf) return;
      s.last = performance.now();
      s.raf = requestAnimationFrame(tick);
    };

    const point = (e) => {
      const r = box.getBoundingClientRect();
      return [(e.clientX - r.left) / s.k, (e.clientY - r.top) / s.k];
    };
    const velocity = () => {
      const g = s.g;
      if (!g) return [0, 0];
      const now = performance.now();
      const pts = g.samples.filter((p) => now - p.t < 80);
      if (pts.length < 2) return [0, 0];
      const a = pts[0], b = pts[pts.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt < 0.008 || now - b.t > 60) return [0, 0];
      return [(b.x - a.x) / dt, (b.y - a.y) / dt];
    };

    const close = (c, vx, pivot) => {
      if (!c.present) return;
      c.present = false;
      c.mode = "fly";
      c.vx = vx;
      if (pivot !== undefined) c.pivot = pivot;
      reflow(c.i);
      kick();
    };
    const release = (c, vx) => {
      // Where would it be in ~150ms at this speed? Decide on that.
      const ahead = c.x + vx * 0.15;
      if (vx < -700 || (ahead < -s.cw * 0.5 && vx < 250)) close(c, Math.min(vx, -200));
      else {
        c.mode = "back";
        c.vx = vx;
      }
    };

    const cardAt = (e) => {
      const el = e.target.closest?.(".ts-card");
      if (!el) return null;
      return cards[+el.dataset.index] || null;
    };

    const onDown = (e) => {
      if (s.frozen || e.button !== 0 || s.g) return;
      if (e.target.closest?.(".ts-close")) return;
      const [px, py] = point(e);
      const c = cardAt(e);
      s.g = {
        id: e.pointerId, x0: px, y0: py, axis: null,
        card: c ? c.i : -1, cx0: c ? c.x : 0, sy0: s.sy,
        samples: [{ x: px, y: py, t: performance.now() }],
      };
      root.setPointerCapture(e.pointerId);
      // A finger on the glass stops the scroll where it is.
      s.svy = 0;
      if (c) {
        // Where the card was held: above or below its middle.
        const top = c.ly - s.sy;
        c.pivot = clamp(((py - top) / s.ch) * 2 - 1, -1, 1);
        if (c.mode === "fly" || c.mode === "back") {
          // Caught mid-flight: it stops in the hand, and the grid opens for it again.
          if (!c.present) {
            c.present = true;
            reflow(c.i);
          }
          c.mode = "drag";
          c.vx = 0;
          s.g.axis = "x";
          s.g.cx0 = c.x;
          root.dataset.dragging = "";
        }
      }
      kick();
    };

    const onMove = (e) => {
      const g = s.g;
      if (!g || e.pointerId !== g.id) return;
      const [px, py] = point(e);
      const dx = px - g.x0, dy = py - g.y0;
      g.samples.push({ x: px, y: py, t: performance.now() });
      while (g.samples.length > 2 && performance.now() - g.samples[0].t > 120) g.samples.shift();
      if (!g.axis) {
        if (Math.hypot(dx, dy) < 6) return;
        g.axis = g.card >= 0 && Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (g.axis === "x") {
          const c = cards[g.card];
          c.mode = "drag";
          c.vx = 0;
          g.cx0 = c.x;
          root.dataset.dragging = "";
        }
      }
      if (g.axis === "x") {
        const c = cards[g.card];
        const raw = g.cx0 + dx;
        c.x = raw > 0 ? rubber(raw, s.cw * 0.6) : raw;
        c.dragV = velocity()[0];
      } else {
        s.sy = band(g.sy0 - dy, 0, maxScroll(), s.h);
      }
      paint();
      kick();
    };

    const onUp = (e) => {
      const g = s.g;
      if (!g || e.pointerId !== g.id) return;
      const [vx, vy] = velocity();
      s.g = null;
      delete root.dataset.dragging;
      if (g.axis === "x") {
        const c = cards[g.card];
        c.dragV = 0;
        release(c, vx);
      } else if (g.axis === "y") {
        s.svy = clamp(-vy, -6000, 6000);
      }
      kick();
    };

    const onWheel = (e) => {
      if (s.frozen) return;
      e.preventDefault();
      const max = maxScroll();
      let d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const over = s.sy < 0 ? -s.sy : s.sy > max ? s.sy - max : 0;
      const outward = (s.sy <= 0 && d < 0) || (s.sy >= max && d > 0);
      if (outward) d *= 0.4 * Math.max(0, 1 - over / (s.h * 0.25));
      s.sy += d;
      s.svy = 0;
      s.wheelAt = s.time;
      kick();
    };

    const onClose = (e) => {
      const btn = e.target.closest?.(".ts-close");
      if (!btn || s.frozen) return;
      e.preventDefault();
      e.stopPropagation();
      const c = cards[+btn.dataset.index];
      // The same move the swipe makes, so the button teaches the gesture.
      if (c && c.present) close(c, -1500, -0.85);
    };
    const onKey = (e) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const c = cardAt(e);
      if (!c || !c.present) return;
      e.preventDefault();
      const next = els[order().find((o) => o.i > c.i)?.i ?? -1];
      close(c, -1500, 0);
      next?.focus({ preventScroll: true });
    };

    const ro = new ResizeObserver(measure);
    ro.observe(box);
    measure();

    if (stillT !== null) {
      // A held moment: card released mid-swipe with a flick, then t seconds.
      s.frozen = true;
      const c = cards[stillCard];
      c.pivot = 0.45;
      c.x = -s.cw * 0.42;
      c.dragV = -1400;
      for (let i = 0; i < 200; i++) {
        [c.rot, c.vrot] = stepSpring(c.rot, c.vrot, clamp(1400 * 0.0032 * (0.35 + 0.65 * 0.45), -6, 6), TILT, STEP);
      }
      c.dragV = 0;
      close(c, -1400);
      advance(stillT);
      paint();
    }

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("click", onClose, true);
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("keydown", onKey);
    root.dataset.ready = "";
    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("click", onClose, true);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className="ts-root">
      <div ref={layerRef} className="ts-layer">
        {PAGES.map(({ key, title, host, tint, Page }, i) => (
          <div
            key={key}
            ref={(el) => (cardRefs.current[i] = el)}
            className="ts-card"
            data-index={i}
            tabIndex={0}
            role="group"
            aria-label={`${title}. Swipe left or press Delete to close.`}
          >
            <div className="ts-thumb">
              <div className="ts-page" aria-hidden="true">
                <Page />
              </div>
              <button className="ts-close" data-index={i} aria-label={`Close ${title}`} type="button">
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3 L9 9 M9 3 L3 9" />
                </svg>
              </button>
            </div>
            <div className="ts-label">
              <span className="ts-fav" style={{ background: tint }}>
                {host}
              </span>
              <span className="ts-title">{title}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
