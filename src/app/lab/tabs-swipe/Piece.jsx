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
const OUT = 0.9; // share of the way off its old row at which a wrapping tab has faded out
const SHRINK = 0.06; // a wrapping tab is at 0.94 while it is between rows
const LABEL = 24; // caption under each tab: 8px gap + 16px line
const ROW_GAP = 24; // caption to the next row of tabs
const TALL = 1.32; // the tallest a tab gets: a phone page
const WIDE = 1.08; // the widest: past this the page reads as a box
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
  const labelRefs = useRef([]);

  useEffect(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    const box = root.closest(".piece-box") || root;
    const els = cardRefs.current;
    const labels = labelRefs.current;
    const params = new URLSearchParams(window.location.search);
    const stillT = params.has("t") ? Math.max(0, +params.get("t") || 0) : null;
    const stillCard = params.has("card") ? clamp(Math.round(+params.get("card") || 0), 0, PAGES.length - 1) : 2;

    const s = {
      w: 0, h: 0, k: 1,
      cols: 2, cw: 0, ch: 0, gap: 16, rowH: 0, padTop: 0, padBottom: 0, left: 0,
      sy: 0, svy: 0, wheelAt: -1,
      time: 0, last: 0, raf: 0, frozen: false,
      restoreAt: -1,
      g: null,
    };

    const cards = PAGES.map((_, i) => ({
      i,
      present: true, gone: false,
      lx: 0, ly: 0, lvx: 0, lvy: 0, tx: 0, ty: 0, pending: null,
      leg: null, vis: 1, vvis: 0, // changing rows: out along the old row, in along the new
      x: 0, vx: 0, mode: "rest", // rest | drag | fly | back
      dragV: 0, rot: 0, vrot: 0, pivot: 0,
      enter: 1, venter: 0, enterAt: 0,
    }));

    const order = () => cards.filter((c) => c.present);
    const slot = (k) => [
      (k % s.cols) * (s.cw + s.gap),
      s.padTop + Math.floor(k / s.cols) * s.rowH,
    ];
    const maxScroll = () => {
      const n = order().length;
      const rows = Math.ceil(n / s.cols);
      const content = s.padTop + Math.max(0, rows * s.rowH - ROW_GAP) + s.padBottom;
      return Math.max(0, content - s.h);
    };

    // Everyone in the grid gets a new slot. The ones nearest the gap move
    // first, in reading order, so the grid closes up like a wave rather than
    // all at once: along the row, then the first tab of the next row wraps
    // up to the end of this one, and so on down the sheet. Nothing moves
    // between rows in the open: see `go`.
    const reflow = (from, instant = false) => {
      const list = order();
      const at = list.findIndex((c) => c.i >= from);
      list.forEach((c, k) => {
        const [x, y] = slot(k);
        if (instant) {
          c.tx = c.lx = x; c.ty = c.ly = y; c.lvx = c.lvy = 0; c.pending = null;
          c.leg = null; c.vis = 1; c.vvis = 0;
          return;
        }
        if (x === c.tx && y === c.ty && !c.pending) return;
        if (c.leg && x === c.leg.x && y === c.leg.y && !c.pending) return;
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
      // The sheet fills the frame: two full rows of tabs top to bottom, and as
      // many columns across as fit at a page's proportions, two to four.
      s.padTop = r4(clamp(s.h * 0.06, 16, 56));
      s.padBottom = s.padTop;
      const padX = Math.round(clamp(s.w * 0.045, 16, 64));
      s.gap = s.w >= 720 ? 24 : 16;
      const fillH = Math.max(120, (s.h - s.padTop - s.padBottom - 2 * LABEL - ROW_GAP) / 2);
      const inner = s.w - 2 * padX;
      s.cols = clamp(Math.floor((inner + s.gap) / (fillH / TALL + s.gap)), 2, 4);
      // Columns take the width edge to edge; a very wide frame stops at WIDE and centres.
      const byW = (inner - (s.cols - 1) * s.gap) / s.cols;
      s.cw = Math.round(Math.max(96, Math.min(byW, fillH / WIDE)));
      s.ch = Math.max(128, Math.floor(Math.min(fillH, s.cw * TALL) / 4) * 4);
      s.rowH = s.ch + LABEL + ROW_GAP;
      s.left = Math.round((s.w - (s.cw * s.cols + s.gap * (s.cols - 1))) / 2);
      root.style.setProperty("--ts-cw", `${s.cw}px`);
      root.style.setProperty("--ts-ch", `${s.ch}px`);
      root.style.setProperty("--ts-scale", `${s.cw / PAGE_W}`);
      root.style.setProperty("--ts-page-h", `${(s.ch * PAGE_W) / s.cw}px`);
      reflow(0, true);
      s.sy = clamp(s.sy, 0, maxScroll());
      paint();
    };

    const flyTarget = (c) => -(s.left + c.lx + s.cw + 80);

    // A tab's move starts. Along its row it simply slides. To another row it
    // never cuts across the sheet: it keeps going the way the row is moving,
    // out past the end of its old row while it fades and shrinks to 0.94,
    // then comes in from one slot short of its new place and settles. Both
    // legs ride the same layout spring, so it stays part of the wave.
    const go = (c, x, y) => {
      if (y === c.ty) {
        c.leg = null;
        c.tx = x;
        return;
      }
      const step = s.cw + s.gap;
      // Up a row is backwards in reading order: out to the left, in from the right.
      const dir = y < c.ty ? -1 : 1;
      const out = dir < 0 ? -step : s.cols * step;
      c.leg = { out: true, dir, x, y, x0: c.lx, x1: out, vis0: c.vis };
      c.vvis = 0;
      c.tx = out;
    };

    const legStep = (c) => {
      const L = c.leg;
      const span = L.x1 - L.x0;
      const p = Math.abs(span) < 1 ? 1 : clamp((c.lx - L.x0) / span, 0, 1);
      if (L.out) {
        c.vis = L.vis0 * clamp(1 - p / OUT, 0, 1);
        if (p < OUT) return;
        // Gone from the old row: it reappears a slot short of its new one,
        // still moving the same way at the speed it left with.
        const from = L.x - L.dir * (s.cw + s.gap);
        L.out = false; L.x0 = from; L.x1 = L.x;
        c.lx = from; c.ly = L.y; c.lvy = 0;
        c.tx = L.x; c.ty = L.y;
        c.vis = 0;
        return;
      }
      c.vis = p;
      if (p > 0.995) c.leg = null;
    };

    const paint = () => {
      layer.style.transform = `translate3d(${s.left}px, ${-s.sy}px, 0)`;
      for (const c of cards) {
        const el = els[c.i];
        const lb = labels[c.i];
        if (!el || !lb) continue;
        if (c.gone) {
          el.style.visibility = lb.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = lb.style.visibility = "";
        const vis = clamp(c.vis, 0, 1);
        const sc = 1 - SHRINK * (1 - c.enter) - SHRINK * (1 - vis);
        el.style.transform =
          `translate3d(${(c.lx + c.x).toFixed(2)}px, ${c.ly.toFixed(2)}px, 0) rotate(${c.rot.toFixed(3)}deg) scale(${sc.toFixed(4)})`;
        const enter = clamp(c.enter, 0, 1) * vis;
        el.style.opacity = enter < 0.999 ? enter.toFixed(3) : "";
        // A tab pulled sideways lets go of its caption, so it never slides
        // across the neighbour's title; it comes back as the tab settles.
        const held = clamp(1 - Math.abs(c.x) / (s.cw * 0.4), 0, 1);
        const lo = enter * held;
        lb.style.opacity = lo < 0.999 ? lo.toFixed(3) : "";
        // The caption rides under the card but never tilts with it: the glass
        // leans, the type under it stays level. It keeps its gap to the glass
        // as the glass shrinks.
        const lift = (1 - sc) * s.ch * (0.5 - 0.5 * c.pivot);
        lb.style.transform =
          `translate3d(${(c.lx + c.x).toFixed(2)}px, ${(c.ly + s.ch - lift).toFixed(2)}px, 0)`;
        el.style.transformOrigin = `50% ${(50 + c.pivot * 50).toFixed(1)}%`;
        const lifted = c.mode === "drag" || c.mode === "fly";
        if (lifted !== (el.dataset.lifted !== undefined)) {
          if (lifted) el.dataset.lifted = "";
          else delete el.dataset.lifted;
        }
        // Only a tab in the hand, or on its way out or home, sits above the rest.
        el.style.zIndex = lb.style.zIndex = lifted || c.mode === "back" ? 1 : "";
      }
    };

    const advance = (dt) => {
      for (let t = 0; t < dt; t += STEP) {
        const h = Math.min(STEP, dt - t);
        s.time += h;
        for (const c of cards) {
          if (c.gone) continue;
          if (c.pending && s.time >= c.pending.at) {
            go(c, c.pending.x, c.pending.y);
            c.pending = null;
          }
          [c.lx, c.lvx] = stepSpring(c.lx, c.lvx, c.tx, LAYOUT, h);
          [c.ly, c.lvy] = stepSpring(c.ly, c.lvy, c.ty, LAYOUT, h);
          if (c.leg) legStep(c);
          else if (c.vis !== 1) {
            // A leg called off half way: it comes back to full on the same spring.
            [c.vis, c.vvis] = stepSpring(c.vis, c.vvis, 1, LAYOUT, h);
            if (Math.abs(1 - c.vis) < 0.001 && Math.abs(c.vvis) < 0.01) { c.vis = 1; c.vvis = 0; }
          }

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
        c.leg = null; c.vis = 1; c.vvis = 0;
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
          (c.mode !== "rest" || c.pending || c.leg || c.vis !== 1 || c.enter < 0.999 ||
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
      const el = e.target.closest?.(".ts-card, .ts-label");
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
          </div>
        ))}
        {PAGES.map(({ key, title, host, tint }, i) => (
          <div
            key={key}
            ref={(el) => (labelRefs.current[i] = el)}
            className="ts-label"
            data-index={i}
            aria-hidden="true"
          >
            <span className="ts-tag">
              <span className="ts-fav" style={{ background: tint }}>
                {host}
              </span>
              <span className="ts-title">{title}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
