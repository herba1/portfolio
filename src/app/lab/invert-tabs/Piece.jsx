"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import "./invert-tabs.css";

const TABS = ["Albums", "Singles", "Live", "Demos"];

// Two edges, two springs. The edge moving toward the target is stiffer than
// the one trailing it, so the pill leads with one side and stretches a
// little in flight, then closes up as it lands. Both are slightly
// under-critical: a settle, not a bounce.
const LEAD = { k: 560, zeta: 0.92 };
const TRAIL = { k: 300, zeta: 0.96 };
// While a finger is on the bar the edges follow it almost directly.
const DRAG = { k: 2400, zeta: 1 };
const SLOP = 4;
const PROJECT = 0.14; // seconds of release velocity carried into the snap

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function step(s, target, { k, zeta }, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

export default function Piece() {
  const rootRef = useRef(null);
  const fitRef = useRef(0);
  const barRef = useRef(null);
  const rowRef = useRef(null);
  const inkRef = useRef(null);
  const probeRef = useRef(null);
  const bearRef = useRef(null);
  const tabRefs = useRef([]);
  // tabs: edges in row space. ox: the row's left edge in root space, and
  // W: the root's width, so the column's clip can be written against the
  // whole canvas while the springs keep working in row coordinates.
  const geo = useRef({ tabs: [], w: 0, h: 0, ox: 0, W: 0 });
  const springs = useRef({ l: { x: 0, v: 0 }, r: { x: 0, v: 0 } });
  const target = useRef({ l: 0, r: 0, drag: false });
  const drag = useRef(null);
  const raf = useRef(0);
  const last = useRef(0);
  const hold = useRef(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  const paint = useCallback(() => {
    const ink = inkRef.current;
    if (!ink) return;
    const { ox, W } = geo.current;
    const { l, r } = springs.current;
    // The ink layer is the whole canvas; the clip only bites left and right,
    // so the highlight is a square-edged column running top to bottom.
    const L = Math.round((ox + l.x) * 100) / 100;
    const R = Math.round((W - ox - r.x) * 100) / 100;
    ink.style.clipPath = `inset(0px ${R}px 0px ${L}px)`;
  }, []);

  // Geometry of the highlight at a fractional tab index: edges interpolate
  // between neighbouring tabs, so the pill changes width as it travels.
  const at = useCallback((t) => {
    const { tabs } = geo.current;
    const i = clamp(Math.floor(t), 0, tabs.length - 1);
    const j = Math.min(i + 1, tabs.length - 1);
    const f = clamp(t - i, 0, 1);
    const a = tabs[i];
    const b = tabs[j];
    return { l: a.l + (b.l - a.l) * f, r: a.r + (b.r - a.r) * f };
  }, []);

  // The highlight caught in flight. A hold at a fractional index runs the
  // real lead/trail springs from the tab behind it toward the tab ahead and
  // stops the clock when the centre crosses that index, so a still shows
  // the leading edge out in front and the trailing edge still catching up,
  // not a pill with matched edges.
  const flight = useCallback(
    (t) => {
      const { tabs } = geo.current;
      const i = clamp(Math.floor(t), 0, tabs.length - 1);
      if (t - i < 1e-3 || i >= tabs.length - 1) return at(t);
      const from = at(i);
      const to = at(i + 1);
      const goal = at(t);
      const cGoal = (goal.l + goal.r) / 2;
      const l = { x: from.l, v: 0 };
      const r = { x: from.r, v: 0 };
      for (let n = 0; n < 2400 && (l.x + r.x) / 2 < cGoal; n += 1) {
        step(l, to.l, TRAIL, 1 / 960);
        step(r, to.r, LEAD, 1 / 960);
      }
      return { l: l.x, r: r.x };
    },
    [at],
  );

  // Inverse: which fractional index sits under a centre x.
  const indexAt = useCallback((cx) => {
    const { tabs } = geo.current;
    const cs = tabs.map((t) => (t.l + t.r) / 2);
    if (cx <= cs[0]) return 0;
    for (let i = 0; i < cs.length - 1; i += 1) {
      if (cx <= cs[i + 1]) return i + (cx - cs[i]) / (cs[i + 1] - cs[i]);
    }
    return cs.length - 1;
  }, []);

  const tick = useCallback(
    function loop(now) {
      const dt = Math.min(1 / 30, (now - (last.current || now)) / 1000) || 1 / 120;
      last.current = now;
      const s = springs.current;
      const tg = target.current;
      // Fixed substeps keep the stiff drag spring stable at any frame rate.
      const n = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / n;
      const cNow = (s.l.x + s.r.x) / 2;
      const cTo = (tg.l + tg.r) / 2;
      const right = cTo >= cNow;
      for (let i = 0; i < n; i += 1) {
        step(s.l, tg.l, tg.drag ? DRAG : right ? TRAIL : LEAD, h);
        step(s.r, tg.r, tg.drag ? DRAG : right ? LEAD : TRAIL, h);
      }
      paint();
      const still =
        !tg.drag &&
        Math.abs(s.l.x - tg.l) < 0.02 &&
        Math.abs(s.r.x - tg.r) < 0.02 &&
        Math.abs(s.l.v) < 0.5 &&
        Math.abs(s.r.v) < 0.5;
      if (still) {
        s.l.x = tg.l;
        s.r.x = tg.r;
        s.l.v = s.r.v = 0;
        paint();
        raf.current = 0;
        last.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(loop);
    },
    [paint],
  );

  const wake = useCallback(() => {
    if (!raf.current && hold.current == null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const goTo = useCallback(
    (i) => {
      const g = at(i);
      target.current = { l: g.l, r: g.r, drag: false };
      activeRef.current = i;
      setActive(i);
      wake();
    },
    [at, wake],
  );

  // Side bearings of the row's first and last glyph, in em. Measured once
  // from the face itself (canvas ink bounds), so the flush edges are optical,
  // not the advance box's.
  const bearings = useCallback((row) => {
    if (bearRef.current) return bearRef.current;
    const cs = getComputedStyle(row);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    const px = 200;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
    const first = TABS[0][0];
    const lastWord = TABS[TABS.length - 1];
    const last = lastWord[lastWord.length - 1];
    const a = ctx.measureText(first);
    const b = ctx.measureText(last);
    const lsb = -a.actualBoundingBoxLeft / px;
    const rsb = (b.width - b.actualBoundingBoxRight) / px;
    if (!Number.isFinite(lsb) || !Number.isFinite(rsb)) return null;
    const out = { lsb: Math.round(lsb * 1e4) / 1e4, rsb: Math.round(rsb * 1e4) / 1e4 };
    if (document.fonts?.status === "loaded") bearRef.current = out;
    return out;
  }, []);

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const bear = bearings(row);
    if (bear && rootRef.current) {
      rootRef.current.style.setProperty("--it-lsb", String(bear.lsb));
      rootRef.current.style.setProperty("--it-rsb", String(bear.rsb));
    }
    // Fit the row to the canvas, edge to edge. Nearly everything in it is
    // in em, so its width per em is close to a constant of the face; the
    // tracking law's 12px term makes it drift a hair with size, so settle
    // it in a few passes here (each read forces layout) rather than across
    // ResizeObserver round trips.
    const root = rootRef.current;
    if (!root) return;
    for (let n = 0; n < 4; n += 1) {
      const size = parseFloat(getComputedStyle(row).fontSize);
      const fit = size ? Math.round((row.offsetWidth / size) * 10000) / 10000 : 0;
      if (!fit || Math.abs(fit - fitRef.current) < 0.0005) break;
      fitRef.current = fit;
      root.style.setProperty("--it-fit", String(fit));
    }
    // Sub-pixel offset of the row inside the root, in layout pixels (the
    // box may be scaled by its container, so divide the transform back out).
    const rb = root.getBoundingClientRect();
    const k = root.offsetWidth ? rb.width / root.offsetWidth : 1;
    // Hang the row from its baseline: the probe sits on it in the ink copy,
    // which lays out exactly like the live row.
    const probe = probeRef.current;
    const inkRow = probe?.closest(".it-row");
    if (probe && inkRow) {
      const drop = (inkRow.getBoundingClientRect().bottom - probe.getBoundingClientRect().top) / k;
      const cur = parseFloat(root.style.getPropertyValue("--it-drop")) || 0;
      if (Math.abs(drop - cur) > 0.01) root.style.setProperty("--it-drop", `${Math.round(drop * 100) / 100}px`);
    }
    const ox = (row.getBoundingClientRect().left - rb.left) / k;
    const W = root.offsetWidth;
    const tabs = tabRefs.current.map((el) => ({ l: el.offsetLeft, r: el.offsetLeft + el.offsetWidth }));
    // The outer edge of each end tab is the frame itself, so the column
    // bleeds off the canvas on Albums and Demos rather than stopping short.
    if (tabs.length) {
      tabs[0].l = -ox;
      tabs[tabs.length - 1].r = W - ox;
    }
    geo.current = { ox, W, w: row.offsetWidth, h: row.offsetHeight, tabs };
    const t = hold.current ?? activeRef.current;
    const g = hold.current != null ? flight(t) : at(t);
    target.current = { l: g.l, r: g.r, drag: false };
    springs.current = { l: { x: g.l, v: 0 }, r: { x: g.r, v: 0 } };
    paint();
  }, [at, bearings, flight, paint]);

  useLayoutEffect(() => {
    // ?t=0.5 holds the highlight in flight from Albums toward Singles, for a
    // still of the moment (any fractional index works).
    try {
      const t = parseFloat(new URLSearchParams(window.location.search).get("t"));
      if (Number.isFinite(t)) hold.current = clamp(t, 0, TABS.length - 1);
    } catch {}
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(rowRef.current);
    ro.observe(rootRef.current);
    document.fonts?.ready.then(measure);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [measure]);

  const localX = (e) => {
    const row = rowRef.current;
    const box = row.getBoundingClientRect();
    const k = row.offsetWidth ? box.width / row.offsetWidth : 1;
    return (e.clientX - box.left) / k;
  };

  const onDown = (e) => {
    if (e.button !== 0 || hold.current != null) return;
    const x = localX(e);
    const s = springs.current;
    drag.current = { id: e.pointerId, x0: x, off: x - (s.l.x + s.r.x) / 2, on: false, px: x, pt: performance.now(), v: 0 };
    barRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = localX(e);
    if (!d.on && Math.abs(x - d.x0) < SLOP) return;
    if (!d.on) {
      d.on = true;
      // Grab the pill where it is if the finger landed on it; otherwise
      // the pill comes to the finger.
      const s = springs.current;
      if (d.x0 < s.l.x || d.x0 > s.r.x) d.off = 0;
      barRef.current.dataset.dragging = "";
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.pt) / 1000;
    d.v = d.v * 0.6 + ((x - d.px) / dt) * 0.4;
    d.px = x;
    d.pt = now;
    const t = indexAt(x - d.off);
    const g = at(t);
    target.current = { l: g.l, r: g.r, drag: true };
    wake();
  };

  const onUp = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    delete barRef.current.dataset.dragging;
    if (!d.on) {
      const x = d.x0;
      const i = geo.current.tabs.findIndex((t) => x >= t.l && x <= t.r);
      if (i >= 0) {
        tabRefs.current[i].focus({ preventScroll: true });
        goTo(i);
      }
      return;
    }
    const s = springs.current;
    // Hand the drag's velocity to the springs and let it carry the snap.
    const fresh = performance.now() - d.pt < 80 ? d.v : 0;
    s.l.v = s.r.v = fresh;
    const c = (s.l.x + s.r.x) / 2 + fresh * PROJECT;
    goTo(Math.round(indexAt(c)));
  };

  const onKey = (e) => {
    const n = TABS.length;
    let i = null;
    if (e.key === "ArrowRight") i = (activeRef.current + 1) % n;
    else if (e.key === "ArrowLeft") i = (activeRef.current - 1 + n) % n;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    if (i == null) return;
    e.preventDefault();
    tabRefs.current[i].focus();
    goTo(i);
  };

  return (
    <div ref={rootRef} className="it">
      <div
        ref={barRef}
        className="it-bar"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div ref={rowRef} className="it-row" role="tablist" aria-label="Releases" onKeyDown={onKey}>
          {TABS.map((label, i) => (
            <button
              key={label}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              className="it-tab"
              aria-selected={active === i}
              tabIndex={active === i ? 0 : -1}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* The ink field: a full-canvas copy of the row set on black, laid out
          the same way as the live row so the words register exactly, then
          clipped to a vertical band. Not interactive; the row is the hit area. */}
      <div ref={inkRef} className="it-ink" aria-hidden="true">
        <div className="it-row">
          {TABS.map((label, i) => (
            <span key={label} className="it-tab">
              {label}
              {i === 0 && <span ref={probeRef} className="it-probe" />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
