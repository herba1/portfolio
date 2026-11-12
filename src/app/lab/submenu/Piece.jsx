"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { ALBUM, ICONS, TRACKS, menuFor } from "./menuData";

import "./submenu.css";

// Geometry. Every vertical number is on the 4px grid.
const ROW = 32;
const PAD = 4;
const SEP_H = 8;
const GAP = 4;
const EDGE = 16;
const WIDTHS = [232, 224, 216];
const TRACK_H = 40;
const HEAD_H = 72;
const LIST_W = 360;
const ANCHOR_X = LIST_W - 28; // the row's more button, where the default menu drops from
const CONTEXT_TRACK = 2; // Here Comes the Sun

// Intent prediction.
const MIN_SPEED = 0.12; // px per ms; slower than this reads as deliberate
const GRACE = 180; // ms a deferred hover waits for the pointer to keep going
const APEX_BACK = 12; // apex pulled back behind the pointer's exit point
const SLACK = 12; // heading may miss the submenu's corners by this much
const WINDOW = 64; // ms of pointer history used for velocity

// The highlight's two edges. The edge leading the move is stiffer than the
// one trailing, so the pill stretches in flight and closes up as it lands.
const LEAD = { k: 1100, zeta: 0.92 };
const TRAIL = { k: 520, zeta: 1 };

const EASE_OUT = [0.22, 1, 0.36, 1];

// The still's cut: unless ?aim names a point, a held cascade freezes the
// pointer here, relative to the root menu's top-left — over Go to, having
// crossed Share from Add to Playlist, heading for the submenu.
const AIM_STILL = { x: 186, y: 160 };
const AIM_ANGLE = 0.67; // the still's cut: px across per px down since the exit

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rowsOf(items) {
  let y = PAD;
  const rows = items.map((it) => {
    const r = { top: y, h: it.sep ? SEP_H : ROW };
    y += r.h;
    return r;
  });
  return { rows, h: y + PAD };
}

const selectable = (items) => items.map((it, i) => (it.sep ? -1 : i)).filter((i) => i >= 0);

// All panels for a menu state: the root at the pointer, flipped to stay in
// the box, and each submenu beside its parent row, its first row level with it.
function layoutFor(st, W, H) {
  const { menu, path } = st;
  if (!menu) return [];
  const out = [];
  const items0 = menu.items;
  const { rows, h } = rowsOf(items0);
  const w = WIDTHS[0];
  let x = menu.x;
  let dir = 1;
  if (x + w > W - EDGE && menu.x - w >= EDGE) {
    x = menu.x - w;
    dir = -1;
  }
  x = clamp(x, EDGE, Math.max(EDGE, W - EDGE - w));
  let y = menu.y;
  if (y + h > H - EDGE) y = menu.y - h >= EDGE ? menu.y - h : Math.max(EDGE, H - EDGE - h);
  out.push({ level: 0, key: menu.key, items: items0, rows, x, y, w, h, dir, origin: [menu.ox - x, menu.oy - y] });

  let keyPath = menu.key;
  for (let l = 0; l < path.length; l += 1) {
    const parent = out[l];
    const item = parent.items[path[l]];
    if (!item?.children) break;
    const cw = WIDTHS[l + 1] ?? WIDTHS[WIDTHS.length - 1];
    const lay = rowsOf(item.children);
    let d = parent.dir;
    const right = parent.x + parent.w + GAP;
    const left = parent.x - GAP - cw;
    let cx = d > 0 ? right : left;
    if (d > 0 && right + cw > W - EDGE && left >= EDGE) {
      cx = left;
      d = -1;
    } else if (d < 0 && left < EDGE && right + cw <= W - EDGE) {
      cx = right;
      d = 1;
    }
    const cy = clamp(parent.y + parent.rows[path[l]].top - PAD, EDGE, Math.max(EDGE, H - EDGE - lay.h));
    keyPath = `${keyPath}/${item.id}`;
    out.push({ level: l + 1, key: keyPath, items: item.children, rows: lay.rows, x: cx, y: cy, w: cw, h: lay.h, dir: d });
  }
  return out;
}

const inside = (p, x, y) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;

function rowAt(p, y) {
  const ly = y - p.y;
  for (let i = 0; i < p.rows.length; i += 1) {
    const r = p.rows[i];
    if (ly >= r.top && ly < r.top + r.h) return p.items[i].sep ? null : i;
  }
  return null;
}

function inTriangle(p, a, b, c) {
  const s = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(p, a, b);
  const d2 = s(p, b, c);
  const d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function stepEdge(s, target, { k, zeta }, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

function Icon({ d }) {
  return (
    <svg className="sm-ico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Kbd({ keys }) {
  return (
    <span className="sm-kbd" aria-hidden="true">
      {keys.map((k) =>
        k === "cmd" ? (
          <svg key={k} viewBox="0 0 24 24" className="sm-kbd-glyph">
            <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
          </svg>
        ) : k === "del" ? (
          <svg key={k} viewBox="0 0 24 24" className="sm-kbd-glyph">
            <path d="M9.5 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-10L3 12z M12.5 9.5l5 5M17.5 9.5l-5 5" />
          </svg>
        ) : (
          <span key={k}>{k}</span>
        ),
      )}
    </span>
  );
}

function Chevron() {
  return (
    <svg className="sm-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

// "186,160" → { x: 186, y: 160 }, or null.
function parsePt(v) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v ?? "");
  return m ? { x: +m[1], y: +m[2] } : null;
}

// The safe triangle for a panel and its open child: apex just behind where the
// pointer left the open row, base on the child's near edge.
function triFor(child, E) {
  const nx = child.dir > 0 ? child.x : child.x + child.w;
  return { nx, tri: [{ x: E.x - child.dir * APEX_BACK, y: E.y }, { x: nx, y: child.y - PAD }, { x: nx, y: child.y + child.h + PAD }] };
}

// "playlist.seasons.long-summer" → open each named submenu; a final leaf
// is the highlighted row.
function parseOpen(items, spec) {
  const path = [];
  const hl = [];
  let list = items;
  for (const id of spec.split(".").filter(Boolean)) {
    const i = list.findIndex((it) => it.id === id);
    if (i < 0) break;
    hl.push(i);
    if (!list[i].children) break;
    path.push(i);
    list = list[i].children;
  }
  if (hl.length === path.length) hl.push(-1);
  return { path, hl, deepest: list };
}

export default function Piece() {
  const rootRef = useRef(null);
  const debugRef = useRef({ tri: null, ray: null, dot: null });
  const aimRef = useRef({});
  const stillAim = useRef(null);
  const [box, setBox] = useState({ W: 0, H: 0 });
  const [st, setSt] = useState({ menu: null, path: [], hl: [], flash: null });
  const stRef = useRef(st);
  const [loved, setLoved] = useState(() => new Set());
  const [debug, setDebug] = useState(false);
  const reduce = useReducedMotion();

  const boxRef = useRef(box);
  const samples = useRef([]);
  const vel = useRef({ x: 0, y: 0 });
  const last = useRef(null);
  const exitPt = useRef([]);
  const grace = useRef(0);
  const fl = useRef(0);
  const typeBuf = useRef({ s: "", t: 0 });
  const wantFocus = useRef(false);
  const itemRefs = useRef(new Map());
  const panelRefs = useRef(new Map());
  const springs = useRef(new Map());
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const frozen = useRef(false);
  const counter = useRef(0);
  const booted = useRef(false);
  const timers = useRef([]);

  const commitState = useCallback((next) => {
    stRef.current = next;
    setSt(next);
  }, []);

  // ── The aim: the safe triangle, drawn while it holds the highlight ──
  // A hairline wedge from where the pointer left the open row to the
  // child's near edge, the cut travelled since, and where the current
  // heading meets that edge. It fades out as the pointer lands.
  const aimOff = useCallback(() => {
    aimRef.current.svg?.removeAttribute("data-on");
  }, []);

  const drawAim = useCallback((child, E, P, v) => {
    const R = aimRef.current;
    if (!R.svg) return;
    const { nx, tri } = triFor(child, E);
    const [, A, B] = tri;
    R.wedge.setAttribute("points", tri.map((q) => `${q.x},${q.y}`).join(" "));
    R.cut.setAttribute("d", `M${E.x} ${E.y}L${P.x} ${P.y}`);
    R.exit.setAttribute("cx", E.x);
    R.exit.setAttribute("cy", E.y);
    R.at.setAttribute("cx", P.x);
    R.at.setAttribute("cy", P.y);
    if (v.x * child.dir > 0) {
      const yh = clamp(P.y + (v.y * (nx - P.x)) / v.x, A.y, B.y);
      R.ray.setAttribute("d", `M${P.x} ${P.y}L${nx} ${yh}`);
      R.tick.setAttribute("d", `M${nx - 6} ${yh}h12`);
    } else {
      R.ray.setAttribute("d", "");
      R.tick.setAttribute("d", "");
    }
    R.svg.setAttribute("data-on", "");
  }, []);

  // ── Size against the piece box ──────────────────────────────────────
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const next = { W: el.offsetWidth, H: el.offsetHeight };
      boxRef.current = next;
      setBox(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The album side, placed so the full cascade (three panels) is centred.
  const listGeo = useMemo(() => {
    const { W, H } = box;
    const span = ANCHOR_X + WIDTHS[0] + GAP + WIDTHS[1] + GAP + WIDTHS[2];
    const x = W >= span + 2 * EDGE ? Math.round((W - span) / 2) : Math.max(EDGE, Math.round((W - LIST_W) / 2));
    const listH = HEAD_H + TRACKS.length * TRACK_H;
    const cascade = HEAD_H + (CONTEXT_TRACK + 1) * TRACK_H + 4 + 392;
    const y = Math.max(EDGE, Math.round((H - Math.max(listH, cascade)) / 8) * 4);
    return { x, y, w: Math.min(LIST_W, W - 2 * EDGE) };
  }, [box]);

  const panels = useMemo(() => layoutFor(st, box.W, box.H), [st, box]);

  const openAt = useCallback((trackIdx, x, y, ox = x, oy = y, extra = {}) => {
    counter.current += 1;
    const items = menuFor(TRACKS[trackIdx]);
    fl.current = 0;
    samples.current = [];
    exitPt.current = [];
    clearTimeout(grace.current);
    commitState({
      menu: { key: `m${counter.current}`, track: trackIdx, x: Math.round(x), y: Math.round(y), ox, oy, items, held: !!extra.held },
      path: extra.path ?? [],
      hl: extra.hl ?? [-1],
      flash: null,
    });
  }, [commitState]);

  const close = useCallback(() => {
    clearTimeout(grace.current);
    const root = rootRef.current;
    if (root && root.contains(document.activeElement)) root.focus({ preventScroll: true });
    commitState({ menu: null, path: [], hl: [], flash: null });
    aimOff();
    const d = debugRef.current;
    if (d.tri) d.tri.setAttribute("points", "");
    if (d.ray) d.ray.setAttribute("d", "");
  }, [aimOff, commitState]);

  // ── Boot: open by default, or hold the state the URL names ──────────
  useEffect(() => {
    if (booted.current || !box.W) return;
    booted.current = true;
    const q = new URLSearchParams(window.location.search);
    setDebug(q.get("debug") === "1");
    // As if the row's more button was pressed: the menu drops below it and
    // grows out of the button.
    const rowTop = listGeo.y + HEAD_H + CONTEXT_TRACK * TRACK_H;
    const ax = listGeo.x + ANCHOR_X;
    const ay = rowTop + TRACK_H + 4;
    const ox = ax + 12;
    const oy = rowTop + 32;
    const spec = q.get("open");
    if (spec) {
      const items = menuFor(TRACKS[CONTEXT_TRACK]);
      const { path, hl, deepest } = parseOpen(items, spec);
      openAt(CONTEXT_TRACK, ax, ay, ox, oy, { path, hl, held: true });
      fl.current = hl.length - 1;
      // The cut, held: ?aim=x,y (from the root menu's top-left) or the
      // default over Go to once a submenu is open; ?aim=none leaves it off.
      const aim = q.get("aim");
      if (aim !== "none" && path.length) stillAim.current = parsePt(aim) ?? AIM_STILL;
      const from = q.get("from");
      const t = parseFloat(q.get("t"));
      if (from && Number.isFinite(t)) {
        const fi = deepest.findIndex((it) => it.id === from);
        if (fi >= 0) frozen.current = { level: hl.length - 1, from: fi, t };
      }
    } else {
      openAt(CONTEXT_TRACK, ax, ay, ox, oy);
    }
    // On its own page the menu takes focus so the keyboard works at once.
    if (rootRef.current?.closest(".piece-box--viewport")) wantFocus.current = true;
  }, [box.W, listGeo, openAt]);

  // ── The highlight pill: two edge springs per panel ──────────────────
  const paintPill = (s) => {
    if (!s.el) return;
    const top = Math.round(s.top.x * 4) / 4;
    const h = Math.max(4, Math.round((s.bot.x - s.top.x) * 4) / 4);
    s.el.style.transform = `translateY(${top}px)`;
    s.el.style.height = `${h}px`;
  };

  const loop = useCallback(function frame(now) {
    const dt = Math.min(1 / 30, (now - (lastFrame.current || now)) / 1000) || 1 / 120;
    lastFrame.current = now;
    let moving = false;
    for (const s of springs.current.values()) {
      if (s.settled) continue;
      const steps = Math.ceil(dt / (1 / 240));
      const h = dt / steps;
      for (let n = 0; n < steps; n += 1) {
        stepEdge(s.top, s.tTop, s.tTop < s.top.x ? LEAD : TRAIL, h);
        stepEdge(s.bot, s.tBot, s.tBot > s.bot.x ? LEAD : TRAIL, h);
      }
      const done = Math.abs(s.top.x - s.tTop) < 0.05 && Math.abs(s.bot.x - s.tBot) < 0.05 && Math.abs(s.top.v) < 1 && Math.abs(s.bot.v) < 1;
      if (done) {
        s.top.x = s.tTop;
        s.bot.x = s.tBot;
        s.top.v = 0;
        s.bot.v = 0;
        s.settled = true;
      } else moving = true;
      paintPill(s);
    }
    raf.current = moving ? requestAnimationFrame(frame) : 0;
    if (!moving) lastFrame.current = 0;
  }, []);

  const kick = useCallback(() => {
    if (frozen.current) return;
    if (!raf.current) raf.current = requestAnimationFrame(loop);
  }, [loop]);

  const pillRef = useCallback((key) => (el) => {
    let s = springs.current.get(key);
    if (!el) {
      if (s) s.el = null;
      return;
    }
    if (!s) {
      s = { el, top: { x: 0, v: 0 }, bot: { x: ROW, v: 0 }, tTop: 0, tBot: ROW, on: false, settled: true };
      springs.current.set(key, s);
    }
    s.el = el;
    paintPill(s);
  }, []);

  useLayoutEffect(() => {
    const live = new Set();
    for (const p of panels) {
      live.add(p.key);
      const s = springs.current.get(p.key);
      if (!s) continue;
      const idx = st.hl[p.level] ?? -1;
      if (idx >= 0 && p.rows[idx]) {
        const r = p.rows[idx];
        s.tTop = r.top;
        s.tBot = r.top + ROW;
        if (!s.on || reduce) {
          s.top.x = s.tTop;
          s.bot.x = s.tBot;
          s.top.v = 0;
          s.bot.v = 0;
        }
        s.on = true;
        s.settled = false;
      } else s.on = false;
      if (s.el) s.el.toggleAttribute("data-on", s.on);
      paintPill(s);
    }
    for (const k of springs.current.keys()) if (!live.has(k) && !springs.current.get(k).el) springs.current.delete(k);

    // A held mid-glide still: run the spring from the named row for t ms.
    const f = frozen.current;
    if (f && typeof f === "object" && panels[f.level]) {
      const p = panels[f.level];
      const s = springs.current.get(p.key);
      if (s && p.rows[f.from]) {
        s.top.x = p.rows[f.from].top;
        s.bot.x = s.top.x + ROW;
        s.top.v = 0;
        s.bot.v = 0;
        const h = 1 / 240;
        for (let t = 0; t < f.t / 1000; t += h) {
          stepEdge(s.top, s.tTop, s.tTop < s.top.x ? LEAD : TRAIL, h);
          stepEdge(s.bot, s.tBot, s.tBot > s.bot.x ? LEAD : TRAIL, h);
        }
        paintPill(s);
        frozen.current = true;
      }
    }
    kick();

    // A held cut: the pointer frozen inside the triangle of the panel it is
    // over, having left that panel's open row on the angle that led here.
    const a = stillAim.current;
    if (a && panels.length > 1) {
      stillAim.current = null;
      const r0 = panels[0];
      const P = { x: r0.x + a.x, y: r0.y + a.y };
      const owner = panels.slice(0, -1).findLast((p) => inside(p, P.x, P.y));
      const row = owner && owner.rows[st.path[owner.level]];
      if (row) {
        const child = panels[owner.level + 1];
        const ey = owner.y + row.top + (P.y > owner.y + row.top ? ROW : 0);
        const E = { x: clamp(P.x - Math.abs(P.y - ey) * AIM_ANGLE * child.dir, owner.x + PAD, owner.x + owner.w - PAD), y: ey };
        const d = Math.hypot(P.x - E.x, P.y - E.y) || 1;
        const v = { x: (P.x - E.x) / d, y: (P.y - E.y) / d };
        drawAim(child, E, P, v);
        drawDebug(triFor(child, E).tri, true, P, v);
      }
    }

    if (wantFocus.current) {
      wantFocus.current = false;
      const level = Math.min(fl.current, panels.length - 1);
      const idx = st.hl[level] ?? -1;
      const el = (idx >= 0 && itemRefs.current.get(`${panels[level]?.key}:${idx}`)) || panelRefs.current.get(panels[level]?.key);
      el?.focus({ preventScroll: true });
    }
  }, [panels, st.hl, st.path, kick, reduce, drawAim]);

  const thaw = () => {
    if (frozen.current === true) {
      frozen.current = false;
      kick();
    }
  };

  // ── State transitions ────────────────────────────────────────────────
  const highlight = useCallback((level, i, { open = false, focus = true } = {}) => {
    const cur = stRef.current;
    const ps = layoutFor(cur, boxRef.current.W, boxRef.current.H);
    const item = ps[level]?.items[i];
    if (!item) return;
    let path = cur.path.slice(0, level);
    const hl = cur.hl.slice(0, level);
    hl.push(i);
    if (open && item.children) {
      path = [...path, i];
      hl.push(-1);
    }
    const same = path.length === cur.path.length && path.every((v, n) => v === cur.path[n]) && hl.length === cur.hl.length && hl.every((v, n) => v === cur.hl[n]);
    fl.current = level;
    if (focus) wantFocus.current = true;
    if (!same) commitState({ ...cur, path, hl });
    else if (focus) {
      const el = itemRefs.current.get(`${ps[level].key}:${i}`);
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    }
  }, [commitState]);

  const select = useCallback((level, i) => {
    const cur = stRef.current;
    const ps = layoutFor(cur, boxRef.current.W, boxRef.current.H);
    const item = ps[level]?.items[i];
    if (!item || !cur.menu) return;
    if (item.children) {
      highlight(level, i, { open: true });
      return;
    }
    const hl = cur.hl.slice(0, level).concat(i);
    commitState({ ...cur, hl, path: cur.path.slice(0, level), flash: `${ps[level].key}:${i}` });
    if (item.id === "love") {
      const t = cur.menu.track;
      setLoved((prev) => {
        const next = new Set(prev);
        if (next.has(t)) next.delete(t);
        else next.add(t);
        return next;
      });
    }
    timers.current.push(setTimeout(close, 160));
  }, [close, commitState, highlight]);

  // ── Pointer: velocity, hover, and the safe triangle ─────────────────
  const local = (e) => {
    const el = rootRef.current;
    const r = el.getBoundingClientRect();
    const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const drawDebug = (tri, active, p, v) => {
    const d = debugRef.current;
    if (!d.tri) return;
    if (!tri) {
      d.tri.setAttribute("points", "");
      d.ray.setAttribute("d", "");
      return;
    }
    d.tri.setAttribute("points", tri.map((q) => `${q.x},${q.y}`).join(" "));
    d.tri.toggleAttribute("data-active", active);
    const L = 120;
    const sp = Math.hypot(v.x, v.y);
    d.ray.setAttribute("d", sp > 0.01 ? `M${p.x} ${p.y}L${p.x + (v.x / sp) * L * Math.min(1, sp)} ${p.y + (v.y / sp) * L * Math.min(1, sp)}` : "");
  };

  const evaluate = useCallback((x, y, predict) => {
    const cur = stRef.current;
    if (!cur.menu || cur.flash) return;
    const ps = layoutFor(cur, boxRef.current.W, boxRef.current.H);
    let hit = null;
    for (let n = ps.length - 1; n >= 0; n -= 1) {
      if (inside(ps[n], x, y)) {
        hit = ps[n];
        break;
      }
    }

    // The triangle for the deepest panel that owns an open child.
    let tri = null;
    let active = false;
    const owner = ps.length > 1 ? ps[ps.length - 2] : null;
    if (owner) {
      const child = ps[ps.length - 1];
      const nx = child.dir > 0 ? child.x : child.x + child.w;
      const E = exitPt.current[owner.level] ?? { x, y };
      const apex = { x: E.x - child.dir * APEX_BACK, y: E.y };
      tri = [apex, { x: nx, y: child.y - PAD }, { x: nx, y: child.y + child.h + PAD }];
    }

    if (!hit) {
      clearTimeout(grace.current);
      const d = ps[ps.length - 1];
      if ((cur.hl[d.level] ?? -1) >= 0) commitState({ ...cur, hl: cur.hl.slice(0, d.level).concat(-1) });
      drawDebug(tri, false, { x, y }, vel.current);
      aimOff();
      return;
    }

    const l = hit.level;
    const i = rowAt(hit, y);
    const ownsChild = l < ps.length - 1;
    if (ownsChild && i === cur.path[l]) {
      exitPt.current[l] = { x, y };
      clearTimeout(grace.current);
      if (l === ps.length - 2 && (cur.hl[l + 1] ?? -1) >= 0) commitState({ ...cur, hl: cur.hl.slice(0, l + 1).concat(-1) });
      else if (l < ps.length - 2) commitState({ ...cur, path: cur.path.slice(0, l + 1), hl: cur.hl.slice(0, l + 1).concat(-1) });
      fl.current = l;
      drawDebug(tri, false, { x, y }, vel.current);
      aimOff();
      return;
    }
    if (i === null) {
      drawDebug(tri, false, { x, y }, vel.current);
      return;
    }

    if (ownsChild && predict) {
      const child = ps[l + 1];
      const nx = child.dir > 0 ? child.x : child.x + child.w;
      const v = vel.current;
      const sp = Math.hypot(v.x, v.y);
      let ok = sp >= MIN_SPEED && v.x * child.dir > 0;
      if (ok) {
        const yh = y + (v.y * (nx - x)) / v.x;
        ok = yh >= child.y - SLACK && yh <= child.y + child.h + SLACK;
      }
      // Triangle from where the pointer left the open row to the child's near edge.
      const E = exitPt.current[l] ?? { x, y };
      const [apex, A, B] = triFor(child, E).tri;
      if (ok) ok = inTriangle({ x, y }, apex, A, B);
      if (l === ps.length - 2) drawDebug([apex, A, B], ok, { x, y }, v);
      if (ok) {
        drawAim(child, E, { x, y }, v);
        clearTimeout(grace.current);
        grace.current = setTimeout(() => {
          const p = last.current;
          if (p) evaluate(p.x, p.y, false);
        }, GRACE);
        return;
      }
    } else drawDebug(tri, false, { x, y }, vel.current);

    clearTimeout(grace.current);
    aimOff();
    highlight(l, i, { open: true });
    exitPt.current[l] = { x, y };
  }, [aimOff, commitState, drawAim, highlight]);

  const onPointerMove = (e) => {
    if (e.pointerType === "touch") return;
    thaw();
    const p = local(e);
    const t = e.timeStamp || performance.now();
    const s = samples.current;
    s.push({ t, x: p.x, y: p.y });
    while (s.length > 2 && t - s[0].t > WINDOW) s.shift();
    const a = s[0];
    const dt = t - a.t;
    if (dt >= 8) vel.current = { x: (p.x - a.x) / dt, y: (p.y - a.y) / dt };
    last.current = p;
    evaluate(p.x, p.y, true);
  };

  const onPointerLeave = () => {
    const p = last.current;
    if (p) evaluate(-1e4, -1e4, false);
  };

  const hitPanel = (p) => {
    const ps = layoutFor(stRef.current, boxRef.current.W, boxRef.current.H);
    for (let n = ps.length - 1; n >= 0; n -= 1) if (inside(ps[n], p.x, p.y)) return ps[n];
    return null;
  };

  const onPointerDown = (e) => {
    thaw();
    if (e.button !== 0) return;
    const p = local(e);
    if (!stRef.current.menu) return;
    if (hitPanel(p)) return;
    if (e.target.closest("[data-trigger]")) return;
    close();
  };

  const onClick = (e) => {
    const p = local(e);
    const panel = hitPanel(p);
    if (!panel) return;
    const i = rowAt(panel, p.y);
    if (i === null) return;
    select(panel.level, i);
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    thaw();
    const p = local(e);
    if (stRef.current.menu && hitPanel(p)) return;
    const row = e.target.closest("[data-track]");
    if (!row) {
      close();
      return;
    }
    openAt(+row.dataset.track, p.x + 1, p.y + 1, p.x, p.y);
    wantFocus.current = true;
  };

  const onTrigger = (e, idx) => {
    e.stopPropagation();
    const el = e.currentTarget;
    const root = rootRef.current;
    const r = el.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    const k = root.offsetWidth ? b.width / root.offsetWidth : 1;
    const cx = (r.left + r.width / 2 - b.left) / k;
    const bottom = (r.bottom - b.top) / k;
    const left = (r.left - b.left) / k;
    const rowEl = el.closest("[data-track]").getBoundingClientRect();
    const rowBottom = (rowEl.bottom - b.top) / k;
    if (stRef.current.menu?.track === idx) {
      close();
      return;
    }
    openAt(idx, left, rowBottom + 4, cx, bottom);
    wantFocus.current = true;
  };

  // ── Keyboard: roving focus, submenus, typeahead ─────────────────────
  const onKeyDown = (e) => {
    const cur = stRef.current;
    if (!cur.menu || cur.flash) return;
    thaw();
    const ps = layoutFor(cur, boxRef.current.W, boxRef.current.H);
    const level = Math.min(fl.current, ps.length - 1);
    const p = ps[level];
    const idxs = selectable(p.items);
    const at = cur.hl[level] ?? -1;
    const pos = idxs.indexOf(at);
    const go = (i) => {
      e.preventDefault();
      clearTimeout(grace.current);
      highlight(level, i, { open: false });
    };
    switch (e.key) {
      case "ArrowDown":
        go(idxs[pos < 0 ? 0 : (pos + 1) % idxs.length]);
        return;
      case "ArrowUp":
        go(idxs[pos < 0 ? idxs.length - 1 : (pos - 1 + idxs.length) % idxs.length]);
        return;
      case "Home":
        go(idxs[0]);
        return;
      case "End":
        go(idxs[idxs.length - 1]);
        return;
      case "ArrowRight":
      case "ArrowLeft": {
        e.preventDefault();
        const inward = (e.key === "ArrowRight") === (p.dir > 0);
        if (inward) {
          if (at >= 0 && p.items[at].children) openChild(level, at);
        } else if (level > 0) back(level);
        return;
      }
      case "Enter":
      case " ":
        e.preventDefault();
        if (at < 0) return;
        if (p.items[at].children) openChild(level, at);
        else select(level, at);
        return;
      case "Escape":
        e.preventDefault();
        if (level > 0) back(level);
        else close();
        return;
      case "Tab":
        e.preventDefault();
        return;
      default:
        break;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
      e.preventDefault();
      const now = performance.now();
      const buf = typeBuf.current;
      buf.s = now - buf.t > 600 ? e.key.toLowerCase() : buf.s + e.key.toLowerCase();
      buf.t = now;
      const repeat = buf.s.length > 1 && buf.s.split("").every((c) => c === buf.s[0]);
      const q = repeat ? buf.s[0] : buf.s;
      const startPos = repeat || buf.s.length === 1 ? pos + 1 : Math.max(0, pos);
      for (let n = 0; n < idxs.length; n += 1) {
        const i = idxs[(startPos + n) % idxs.length];
        if (p.items[i].label.toLowerCase().startsWith(q)) {
          highlight(level, i, { open: false });
          return;
        }
      }
    }
  };

  const openChild = (level, i) => {
    const cur = stRef.current;
    const kids = layoutFor(cur, boxRef.current.W, boxRef.current.H)[level].items[i].children;
    const first = selectable(kids)[0];
    fl.current = level + 1;
    wantFocus.current = true;
    commitState({ ...cur, path: cur.path.slice(0, level).concat(i), hl: cur.hl.slice(0, level).concat(i, first) });
  };

  const back = (level) => {
    const cur = stRef.current;
    fl.current = level - 1;
    wantFocus.current = true;
    commitState({ ...cur, path: cur.path.slice(0, level - 1), hl: cur.hl.slice(0, level) });
  };

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    lastFrame.current = 0;
    clearTimeout(grace.current);
    timers.current.forEach(clearTimeout);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────
  const menuTrack = st.menu?.track;
  const sub = { type: "spring", visualDuration: 0.26, bounce: 0.12 };

  const renderPanel = (p) => {
    const hlIdx = st.hl[p.level] ?? -1;
    const openIdx = st.path[p.level];
    return (
      <div
        className="sm-panel"
        role="menu"
        tabIndex={-1}
        aria-orientation="vertical"
        ref={(el) => {
          if (el) panelRefs.current.set(p.key, el);
          else panelRefs.current.delete(p.key);
        }}
        style={{ width: p.w, height: p.h }}
      >
        <div className="sm-pill" ref={pillRef(p.key)} data-path={openIdx !== undefined ? "" : undefined} data-flash={st.flash?.startsWith(`${p.key}:`) ? "" : undefined} />
        {p.items.map((it, i) =>
          it.sep ? (
            <div key={`s${i}`} className="sm-sep" role="separator" />
          ) : (
            <div
              key={it.id}
              ref={(el) => {
                const k = `${p.key}:${i}`;
                if (el) itemRefs.current.set(k, el);
                else itemRefs.current.delete(k);
              }}
              className="sm-item"
              role="menuitem"
              tabIndex={hlIdx === i ? 0 : -1}
              aria-haspopup={it.children ? "menu" : undefined}
              aria-expanded={it.children ? openIdx === i : undefined}
              data-hl={hlIdx === i ? "" : undefined}
            >
              {it.avatar ? (
                <span className="sm-avatar" aria-hidden="true">
                  {it.avatar}
                </span>
              ) : it.icon ? (
                <Icon d={it.id === "love" && loved.has(menuTrack) ? ICONS.heart : it.icon} />
              ) : null}
              <span className="sm-label">{it.id === "love" && loved.has(menuTrack) ? "Loved" : it.label}</span>
              {it.meta ? <span className="sm-meta">{it.meta}</span> : null}
              {it.kbd ? <Kbd keys={it.kbd} /> : null}
              {it.children ? <Chevron /> : null}
            </div>
          ),
        )}
      </div>
    );
  };

  const root = panels[0];

  return (
    <div
      ref={rootRef}
      className="sm-root"
      tabIndex={-1}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {box.W ? (
        <div className="sm-side" style={{ left: listGeo.x, top: listGeo.y, width: listGeo.w }}>
          <div className="sm-album">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ALBUM.cover} alt="" width="48" height="48" />
            <div>
              <div className="sm-album-title">{ALBUM.title}</div>
              <div className="sm-album-sub">
                {ALBUM.artist} · {ALBUM.year}
              </div>
            </div>
          </div>
          <ol className="sm-tracks">
            {TRACKS.map((t, i) => (
              <li key={t.n} className="sm-track" data-track={i} data-context={menuTrack === i ? "" : undefined}>
                <span className="sm-n">{t.n}</span>
                <span className="sm-title">{t.title}</span>
                {loved.has(i) ? (
                  <svg className="sm-loved" viewBox="0 0 20 20" width="12" height="12" aria-label="Loved">
                    <path d={ICONS.heart} />
                  </svg>
                ) : null}
                <span className="sm-time">{t.time}</span>
                <button type="button" className="sm-more" data-trigger aria-label={`More for ${t.title}`} aria-haspopup="menu" aria-expanded={menuTrack === i} onClick={(e) => onTrigger(e, i)}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                    <path d="M5 10h.01M10 10h.01M15 10h.01" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {root ? (
          <motion.div key={root.key} className="sm-layer" exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE_OUT } }}>
            <motion.div
              className="sm-slot"
              style={{ left: root.x, top: root.y, transformOrigin: `${root.origin[0]}px ${root.origin[1]}px` }}
              initial={st.menu?.held ? false : { opacity: 0, scale: reduce ? 1 : 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
            >
              {renderPanel(root)}
            </motion.div>
            {[1, 2].map((level) => {
              const p = panels[level];
              return (
                <AnimatePresence key={level} initial={false}>
                  {p ? (
                    <motion.div
                      key={p.key}
                      className="sm-slot"
                      style={{ left: p.x, top: p.y, zIndex: level + 1 }}
                      initial={{ opacity: 0, x: reduce ? 0 : -6 * p.dir }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: reduce ? 0 : -2 * p.dir, transition: { duration: 0.1, ease: EASE_OUT } }}
                      transition={{ x: sub, opacity: { duration: 0.14, ease: EASE_OUT } }}
                    >
                      {renderPanel(p)}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {box.W ? (
        <svg
          className="sm-aim"
          width="100%"
          height="100%"
          aria-hidden="true"
          ref={(el) => {
            aimRef.current.svg = el;
          }}
        >
          <polygon className="sm-aim-wedge" ref={(el) => (aimRef.current.wedge = el)} points="" />
          <path className="sm-aim-cut" ref={(el) => (aimRef.current.cut = el)} d="" />
          <path className="sm-aim-ray" ref={(el) => (aimRef.current.ray = el)} d="" />
          <path className="sm-aim-tick" ref={(el) => (aimRef.current.tick = el)} d="" />
          <circle className="sm-aim-exit" ref={(el) => (aimRef.current.exit = el)} r="2.5" />
          <circle className="sm-aim-at" ref={(el) => (aimRef.current.at = el)} r="2.5" />
        </svg>
      ) : null}

      {debug ? (
        <svg className="sm-debug" width="100%" height="100%" aria-hidden="true">
          <polygon ref={(el) => (debugRef.current.tri = el)} points="" />
          <path ref={(el) => (debugRef.current.ray = el)} d="" />
        </svg>
      ) : null}
    </div>
  );
}
