import Dust, { AIR, REST } from "./eraseDust";
import { FAMILY, GRID, GRID_COLS, GRID_ROWS, bakeInk, bakeScene, coverage, coverageInto, defaultTitles, layoutHand, loadHand, makeCanvas, makeStamp, mulberry } from "./eraseBake";
import { ASPECT, LEDGE_DEPTH, LEDGE_FRONT, SHEET_H, SHEET_W } from "./eraseSetlist";

const MAX_DPR = 2;
const MASK_SCALE = 0.52;
const RADIUS = 34;
const SPACING = 0.28;
const RATE = 0.72;
const ERASE_CAP = 0.965;
const EMIT = 2.6;
const CRUMB_RATE = 1.3;
const HISTORY = 24;
const ERASER_W = 214;
const ERASER_H = 78;
const TIP_X = 10;
const TIP_Y = 39;
const BASE_ANGLE = -0.62;
const LEAN_W = 15;
const TAP_SLOP = 5;
const TAP_TIME = 450;
const TITLE_SIZE = 64;
const STRIP_PAD = 56;

export default class EraseEngine {
  constructor({ root, surface, scene, ink, pile, dust, eraser, ring, caret, embedded, onReady, onHistory, onEdit, onEditBox }) {
    this.root = root;
    this.surface = surface;
    this.sceneCanvas = scene;
    this.inkCanvas = ink;
    this.pileCanvas = pile;
    this.dustCanvas = dust;
    this.eraser = eraser;
    this.ring = ring;
    this.caret = caret;
    this.onEditBox = onEditBox;
    this.edit = null;
    this.embedded = embedded;
    this.onReady = onReady;
    this.onHistory = onHistory;
    this.onEdit = onEdit;
    this.titles = defaultTitles();
    this.editing = -1;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.rng = mulberry(9001);
    this.dust = new Dust();
    this.strokes = [];
    this.current = null;
    this.pointer = null;
    this.hover = null;
    this.auto = null;
    this.track = null;
    this.vel = { x: 0, y: 0 };
    this.lastVel = { x: 0, y: 0 };
    this.lean = 0;
    this.leanV = 0;
    this.press = 0;
    this.rubSign = 0;
    this.rubRun = 0;
    this.stampGap = 0;
    this.lastStamp = null;
    this.emitAcc = 0;
    this.crumbAcc = 0;
    this.raf = 0;
    this.last = 0;
    this.clock = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.maskDirty = false;
    this.dustShown = false;
    this.focusLine = -1;
    this.bakeTimer = 0;
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      leave: (e) => this.pointerLeave(e),
      visibility: () => this.checkVisibility(),
    };
  }

  start() {
    const s = this.surface;
    s.addEventListener("pointerdown", this.handlers.down);
    s.addEventListener("pointermove", this.handlers.move);
    s.addEventListener("pointerup", this.handlers.up);
    s.addEventListener("pointercancel", this.handlers.up);
    s.addEventListener("pointerleave", this.handlers.leave);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.root);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.root);
    loadHand().then((ok) => {
      if (this.destroyed) return;
      this.family = ok ? FAMILY : "sans-serif";
      this.setup();
    });
  }

  setup() {
    this.hand = layoutHand(this.family, this.titles);
    this.stampImg = makeStamp();
    const mw = Math.round(SHEET_W * MASK_SCALE);
    const mh = Math.round(SHEET_H * MASK_SCALE);
    this.maskSize = [mw, mh];
    this.baseMask = makeCanvas(mw, mh);
    this.maskAll = makeCanvas(mw, mh);
    this.maskCtx = this.maskAll.getContext("2d");
    this.geo = this.measure();
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.layout(true);
    this.preScrub();
    this.compose();
    this.rebakePile();
    this.ready = true;
    this.root.setAttribute("data-ready", "");
    this.onReady?.();
    this.emitHistory();
    this.resize();
  }

  measure() {
    const rect = this.root.getBoundingClientRect();
    const W = Math.max(1, rect.width);
    const H = Math.max(1, rect.height);
    const narrow = W < 640;
    const emb = this.embedded;
    const bottom = emb ? 64 : narrow ? 92 : 104;
    const ledge = (LEDGE_DEPTH + LEDGE_FRONT) / SHEET_W;
    const fit = (top) => Math.max(120, Math.min(W - (narrow || emb ? 32 : 96), (H - top - bottom) / (1 / ASPECT + ledge)));
    let top = emb ? 20 : 84;
    let sheetW = fit(top);
    if (!emb && H >= 640 && (W - sheetW) / 2 < 316) {
      top = narrow ? 140 : 148;
      sheetW = fit(top);
    }
    const k = sheetW / SHEET_W;
    const sheetH = SHEET_H * k;
    const ledgeT = LEDGE_DEPTH * k;
    const ledgeF = LEDGE_FRONT * k;
    const used = sheetH + ledgeT + ledgeF;
    const sheetY = Math.round(top + Math.max(0, (H - top - bottom - used) * 0.45));
    const sheetX = Math.round((W - sheetW) / 2);
    return { W, H, k, sheetX, sheetY, sheetW, sheetH, ledgeY: sheetY + sheetH, ledgeT, ledgeF };
  }

  layout(full) {
    const { W, H, sheetX, sheetY, sheetW, sheetH, k } = this.geo;
    const dpr = this.dpr;
    const ink = this.inkCanvas.style;
    ink.left = `${sheetX}px`;
    ink.top = `${sheetY}px`;
    ink.width = `${sheetW}px`;
    ink.height = `${sheetH}px`;
    const er = this.eraser.style;
    er.width = `${ERASER_W * k}px`;
    er.height = `${ERASER_H * k}px`;
    er.transformOrigin = `${TIP_X * k}px ${TIP_Y * k}px`;
    this.placeRing();
    this.placeCaret();
    if (this.editing >= 0) this.onEditBox?.(this.editBox());
    if (!full) {
      this.holdBaked();
      return;
    }
    this.baked = { ...this.geo };
    for (const c of [this.sceneCanvas, this.pileCanvas, this.dustCanvas]) {
      c.style.width = "";
      c.style.height = "";
      c.style.transform = "";
    }
    bakeScene(this.sceneCanvas, this.geo, dpr);
    for (const c of [this.pileCanvas, this.dustCanvas]) {
      c.width = Math.max(1, Math.round(W * dpr));
      c.height = Math.max(1, Math.round(H * dpr));
    }
    const pw = Math.max(8, Math.round(sheetW * dpr));
    const ph = Math.max(8, Math.round(sheetH * dpr));
    if (!this.tex || Math.abs(pw - this.tex.pw) / pw > 0.1) {
      const baked = bakeInk(this.hand, pw, ph, this.family);
      if (!this.cov) {
        const grid = coverage(baked.total, baked.blue, pw, ph, baked.s);
        this.cov0 = grid.cov;
        this.cov = new Float32Array(grid.cov);
        this.tint = grid.tint;
      }
      this.tex = { ink: baked.ink, fx: baked.fx, pw, ph };
      this.inkTmp = makeCanvas(pw, ph);
      this.fxTmp = makeCanvas(pw, ph);
      this.inkCanvas.width = pw;
      this.inkCanvas.height = ph;
      if (this.edit?.strip) this.edit.strip = this.bakeStrip(this.edit.index, this.edit.strip.text);
    }
    this.markDirty(0, 0, SHEET_W, SHEET_H);
    this.compose();
    this.rebakePile();
    this.dustShown = true;
    this.wake();
  }

  holdBaked() {
    const b = this.baked;
    if (!b) return;
    const { sheetX, sheetY, sheetW } = this.geo;
    const scale = sheetW / b.sheetW;
    const tx = sheetX - b.sheetX * scale;
    const ty = sheetY - b.sheetY * scale;
    const scene = this.sceneCanvas.style;
    scene.width = `${b.W}px`;
    scene.height = `${b.H}px`;
    scene.transformOrigin = "0 0";
    scene.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;
    for (const c of [this.pileCanvas, this.dustCanvas]) {
      c.style.width = `${b.W}px`;
      c.style.height = `${b.H}px`;
    }
    this.rebakePile();
    this.dustShown = true;
    this.wake();
  }

  resize() {
    if (!this.ready || this.destroyed) return;
    const geo = this.measure();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const g = this.geo;
    if (g && geo.W === g.W && geo.H === g.H && dpr === this.dpr) return;
    this.geo = geo;
    this.dpr = dpr;
    this.layout(false);
    clearTimeout(this.bakeTimer);
    this.bakeTimer = setTimeout(() => {
      if (!this.destroyed) this.layout(true);
    }, 140);
  }

  ensureStroke() {
    if (this.current) return this.current;
    const [mw, mh] = this.maskSize;
    const canvas = makeCanvas(mw, mh);
    const st = { canvas, ctx: canvas.getContext("2d"), alpha: 1, state: "live", parts: [], removed: new Map(), total: 0, arrived: 0, clock: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    this.strokes.push(st);
    this.current = st;
    return st;
  }

  endStroke() {
    const st = this.current;
    if (!st) return;
    this.current = null;
    st.state = "done";
    const done = this.strokes.filter((s) => s.state === "done");
    if (done.length > HISTORY) {
      const old = done[0];
      const ctx = this.baseMask.getContext("2d");
      ctx.drawImage(old.canvas, 0, 0);
      old.parts.length = 0;
      old.removed.clear();
      this.strokes.splice(this.strokes.indexOf(old), 1);
    }
    this.emitHistory();
  }

  emitHistory() {
    this.onHistory?.(this.strokes.filter((s) => s.state === "done").length);
  }

  toWorld(x, y) {
    const { sheetX, sheetY, k } = this.geo;
    return [(x - sheetX) / k, (y - sheetY) / k];
  }

  stamp(x, y, angle, strength, vx, vy) {
    const st = this.ensureStroke();
    const rng = this.rng;
    const c = st.ctx;
    c.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    c.translate(x, y);
    c.rotate(angle);
    c.globalAlpha = Math.min(0.6, strength * 1.15);
    c.drawImage(this.stampImg, -RADIUS, -RADIUS, RADIUS * 2, RADIUS * 2);
    this.markDirty(x - RADIUS - 4, y - RADIUS - 4, x + RADIUS + 4, y + RADIUS + 4);
    const b = st.bbox;
    b[0] = Math.min(b[0], x - RADIUS - 4);
    b[1] = Math.min(b[1], y - RADIUS - 4);
    b[2] = Math.max(b[2], x + RADIUS + 4);
    b[3] = Math.max(b[3], y + RADIUS + 4);
    const r = RADIUS;
    const c0 = Math.max(0, Math.floor((x - r) / GRID));
    const c1 = Math.min(GRID_COLS - 1, Math.floor((x + r) / GRID));
    const r0 = Math.max(0, Math.floor((y - r) / GRID));
    const r1 = Math.min(GRID_ROWS - 1, Math.floor((y + r) / GRID));
    const cov = this.cov;
    let lifted = 0;
    for (let row = r0; row <= r1; row += 1) {
      const dy = (row + 0.5) * GRID - y;
      for (let col = c0; col <= c1; col += 1) {
        const dx = (col + 0.5) * GRID - x;
        const d2 = (dx * dx + dy * dy) / (r * r);
        if (d2 >= 1) continue;
        const idx = row * GRID_COLS + col;
        const cv = cov[idx];
        if (cv < 0.003) continue;
        const w = Math.pow(1 - d2, 0.8);
        const rem = cv * Math.min(1, strength * w * 0.8);
        cov[idx] = cv - rem;
        st.removed.set(idx, (st.removed.get(idx) || 0) + rem);
        lifted += rem;
        this.emitAcc += rem * EMIT;
        while (this.emitAcc >= 1) {
          this.emitAcc -= 1;
          const p = this.dust.spawnDust(rng, (col + rng()) * GRID, (row + rng()) * GRID, vx, vy, st, this.tint[idx]);
          if (p) st.parts.push(p);
        }
      }
    }
    const inSheet = x > 0 && x < SHEET_W && y > 0 && y < SHEET_H;
    if (inSheet) {
      this.crumbAcc += strength * CRUMB_RATE * (0.45 + Math.min(1.2, lifted * 0.35));
      const dirx = Math.cos(angle);
      const diry = Math.sin(angle);
      while (this.crumbAcc >= 1) {
        this.crumbAcc -= 1;
        const side = (rng() - 0.5) * r * 1.5;
        const px = x - dirx * r * 0.55 - diry * side;
        const py = y - diry * r * 0.55 + dirx * side;
        const p = this.dust.spawnCrumb(rng, px, py, vx, vy, st, Math.min(1, lifted * 0.25 + rng() * 0.25), rng() < 0.05);
        if (p) st.parts.push(p);
      }
    }
    this.dust.knock(x, y, r * 0.9, vx, vy, rng);
  }

  rubTo(wx, wy, vx, vy, pressure) {
    const from = this.lastStamp;
    if (!from) {
      this.lastStamp = [wx, wy];
      this.stampGap = RADIUS * SPACING * 0.6;
      return;
    }
    const dx = wx - from[0];
    const dy = wy - from[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const angle = Math.atan2(dy, dx);
    const speed = Math.hypot(vx, vy);
    const strength = RATE * SPACING * pressure / (1 + speed / 9000);
    const step = RADIUS * SPACING;
    let d = this.stampGap;
    while (d <= dist) {
      this.stamp(from[0] + (dx * d) / dist, from[1] + (dy * d) / dist, angle, strength, vx, vy);
      d += step;
    }
    this.stampGap = d - dist;
    this.lastStamp = [wx, wy];
  }

  preScrub() {
    const line = this.hand.cut;
    const span = line.x1 - line.x0;
    const top = line.top + (line.bottom - line.top) * 0.22;
    const bottom = line.bottom - (line.bottom - line.top) * 0.18;
    const passes = [
      [line.x0 + span * 0.5, line.x1 + 10, 4, 1],
      [line.x0 + span * 0.38, line.x0 + span * 0.66, 2, 0.55],
    ];
    const dt = 1 / 60;
    let t = 0;
    const rng = mulberry(4242);
    for (const [a, b, count, pressure] of passes) {
      this.lastStamp = null;
      const length = (b - a) * count;
      const speed = 1050;
      const steps = Math.ceil(length / (speed * dt));
      for (let i = 0; i <= steps; i += 1) {
        const run = (i / steps) * count;
        const leg = Math.floor(run);
        const f = run - leg;
        const forward = leg % 2 === 0;
        const x = forward ? a + (b - a) * f : b - (b - a) * f;
        const y = top + (bottom - top) * (0.5 + 0.5 * Math.sin(run * 2.3 + rng() * 0.3)) + (rng() - 0.5) * 3;
        this.rubTo(x, y, forward ? speed : -speed, 0, pressure);
        this.dust.step(dt, t, this.rng);
        t += dt;
      }
      if (this.current) this.endStroke();
    }
    for (let i = 0; i < 900 && this.dust.moving.length; i += 1) {
      this.dust.step(dt, t, this.rng);
      t += dt;
    }
    this.mergeInitial();
    this.lastStamp = null;
  }

  mergeInitial() {
    const done = this.strokes.filter((s) => s.state === "done");
    if (done.length < 2) return;
    const [first, ...rest] = done;
    const ctx = first.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    for (const st of rest) {
      ctx.drawImage(st.canvas, 0, 0);
      first.parts.push(...st.parts);
      first.bbox = [Math.min(first.bbox[0], st.bbox[0]), Math.min(first.bbox[1], st.bbox[1]), Math.max(first.bbox[2], st.bbox[2]), Math.max(first.bbox[3], st.bbox[3])];
      for (const [idx, amt] of st.removed) first.removed.set(idx, (first.removed.get(idx) || 0) + amt);
      this.strokes.splice(this.strokes.indexOf(st), 1);
    }
  }

  undo() {
    if (!this.ready) return false;
    if (this.current) this.endStroke();
    if (this.auto) this.auto = null;
    let st = null;
    for (let i = this.strokes.length - 1; i >= 0; i -= 1) {
      if (this.strokes[i].state === "done") {
        st = this.strokes[i];
        break;
      }
    }
    if (!st) return false;
    st.state = "undo";
    st.arrived = 0;
    st.clock = 0;
    const alive = st.parts.filter((p) => p.state === AIR || p.state === REST);
    st.total = alive.length;
    let pile = false;
    const onHome = () => {
      st.arrived += 1;
    };
    for (const p of alive) {
      if (p.state === REST) pile = true;
      this.dust.sendHome(p, this.rng, this.reduced, onHome);
    }
    st.parts.length = 0;
    this.dust.stuck = this.dust.stuck.filter((p) => p.state === REST);
    for (const [idx, amt] of st.removed) this.cov[idx] = Math.min(this.cov0[idx], this.cov[idx] + amt);
    st.removed.clear();
    if (this.pointer) this.lastStamp = null;
    if (pile) this.dust.needsRebake = true;
    this.emitHistory();
    this.wake();
    return true;
  }

  scrubLine(index) {
    if (!this.ready || this.pointer) return;
    const line = this.hand.lines[index];
    if (!line) return;
    if (this.current) this.endStroke();
    this.auto = { line, t: 0, dur: this.reduced ? 1.2 : 1.9 };
    this.lastStamp = null;
    this.track = null;
    this.wake();
  }

  autoPos(a) {
    const { line } = a;
    const passes = 7;
    const run = a.t * passes;
    const leg = Math.floor(run);
    const f = run - leg;
    const ease = f * f * (3 - 2 * f);
    const tri = leg % 2 === 0 ? ease : 1 - ease;
    const x0 = line.x0 - 6;
    const x1 = Math.max(line.x0 + 60, line.x1 + 6);
    const top = line.top + (line.bottom - line.top) * 0.25;
    const bottom = line.bottom - (line.bottom - line.top) * 0.2;
    const x = x0 + (x1 - x0) * tri;
    const y = top + (bottom - top) * (0.5 + 0.45 * Math.sin(run * 2.1)) + line.slope * (x - line.startX);
    const { sheetX, sheetY, k } = this.geo;
    return [sheetX + x * k, sheetY + y * k];
  }

  moveFocus(delta) {
    const count = this.hand ? this.hand.lines.length : 0;
    if (!count) return;
    this.focusLine = this.focusLine < 0 ? 4 : (this.focusLine + delta + count) % count;
    this.placeRing();
  }

  clearFocus() {
    this.focusLine = -1;
    this.placeRing();
  }

  placeRing() {
    const ring = this.ring;
    if (!ring || !this.hand || !this.geo) return;
    const line = this.hand.lines[this.focusLine];
    if (!line) {
      ring.removeAttribute("data-shown");
      return;
    }
    const { sheetX, sheetY, k } = this.geo;
    const x0 = sheetX + (line.x0 - 18) * k;
    const x1 = sheetX + (line.key ? line.key.x1 + 14 : line.x1 + 18) * k;
    const y0 = sheetY + (line.top - 10) * k;
    const y1 = sheetY + (line.bottom + 10) * k;
    ring.style.transform = `translate3d(${x0.toFixed(1)}px, ${y0.toFixed(1)}px, 0)`;
    ring.style.width = `${(x1 - x0).toFixed(1)}px`;
    ring.style.height = `${(y1 - y0).toFixed(1)}px`;
    ring.setAttribute("data-shown", "");
  }

  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      this.moveFocus(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      if (this.focusLine < 0) this.moveFocus(0);
      this.onEdit?.(this.focusLine, true);
    } else if (e.key === "Delete" || e.key === "Backspace" || e.key === " ") {
      e.preventDefault();
      if (e.repeat) return;
      if (this.focusLine < 0) this.moveFocus(0);
      this.scrubLine(this.focusLine);
    } else if (e.key === "u") {
      e.preventDefault();
      this.undo();
    } else if (e.key === "Escape") {
      this.clearFocus();
    }
  }

  local(e) {
    const rect = this.root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  pointerDown(e) {
    if (!this.ready || (e.pointerType === "mouse" && e.button !== 0) || this.pointer) return;
    if (e.target.closest?.("button, a, input")) return;
    try {
      this.surface.setPointerCapture?.(e.pointerId);
    } catch {
      this.capture = false;
    }
    const [x, y] = this.local(e);
    if (this.auto) {
      this.auto = null;
      this.endStroke();
    }
    this.pointer = { id: e.pointerId, x, y, x0: x, y0: y, t0: e.timeStamp, moved: false, type: e.pointerType, pressure: e.pointerType === "pen" && e.pressure > 0 ? 0.55 + e.pressure : 1, queue: [] };
    this.lastStamp = null;
    this.track = null;
    this.clearFocus();
    this.root.setAttribute("data-pressed", "");
    this.showEraser(x, y);
    this.wake();
  }

  pointerMove(e) {
    const p = this.pointer;
    const [x, y] = this.local(e);
    if (!p && e.pointerType !== "touch") {
      this.hover = { x, y };
      this.showEraser(x, y);
      this.wake();
      return;
    }
    if (!p || p.id !== e.pointerId) return;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) {
      p.moved = true;
      this.rubTo(...this.toWorld(p.x0, p.y0), 0, 0, p.pressure);
    }
    const rect = this.root.getBoundingClientRect();
    const events = e.getCoalescedEvents?.() || [];
    for (const ev of events.length ? events : [e]) p.queue.push([ev.clientX - rect.left, ev.clientY - rect.top]);
    if (p.queue.length > 160) p.queue.splice(0, p.queue.length - 160);
    if (e.pointerType === "pen" && e.pressure > 0) p.pressure = 0.55 + e.pressure;
    p.x = x;
    p.y = y;
    this.hover = e.pointerType === "touch" ? null : { x, y };
    this.wake();
  }

  pointerUp(e) {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    this.flushQueue();
    this.pointer = null;
    this.endStroke();
    this.lastStamp = null;
    this.root.removeAttribute("data-pressed");
    if (e.pointerType === "touch") this.hideEraser();
    if (!p.moved && e.type === "pointerup" && e.timeStamp - p.t0 < TAP_TIME) {
      const index = this.lineAt(...this.toWorld(p.x0, p.y0));
      if (index >= 0) this.onEdit?.(index);
    }
    this.wake();
  }

  pointerLeave(e) {
    if (e.pointerType === "touch" || this.pointer) return;
    this.hover = null;
    if (!this.auto) this.hideEraser();
  }

  flushQueue() {
    const p = this.pointer;
    if (!p || !p.queue.length) return;
    if (!p.moved) {
      p.queue.length = 0;
      return;
    }
    const k = this.geo.k;
    for (const [qx, qy] of p.queue) this.rubTo(...this.toWorld(qx, qy), this.vel.x / k, this.vel.y / k, p.pressure);
    p.queue.length = 0;
  }

  showEraser(x, y) {
    this.eraserPos = [x, y];
    this.eraser.setAttribute("data-shown", "");
    this.placeEraser();
  }

  hideEraser() {
    this.eraser.removeAttribute("data-shown");
  }

  placeEraser() {
    if (!this.eraserPos || !this.geo) return;
    const [x, y] = this.eraserPos;
    const k = this.geo.k;
    const angle = BASE_ANGLE + this.lean;
    const scale = 1 - 0.035 * this.press;
    this.eraser.style.transform = `translate3d(${(x - TIP_X * k).toFixed(1)}px, ${(y - TIP_Y * k).toFixed(1)}px, 0) rotate(${angle.toFixed(4)}rad) scale(${scale.toFixed(4)})`;
  }

  markDirty(x0, y0, x1, y1) {
    const d = this.dirty;
    if (!d) this.dirty = [x0, y0, x1, y1];
    else {
      d[0] = Math.min(d[0], x0);
      d[1] = Math.min(d[1], y0);
      d[2] = Math.max(d[2], x1);
      d[3] = Math.max(d[3], y1);
    }
    this.maskDirty = true;
  }

  clipTo(ctx, scale) {
    const d = this.dirty;
    const x0 = Math.floor(Math.max(0, d[0]) * scale) - 2;
    const y0 = Math.floor(Math.max(0, d[1]) * scale) - 2;
    const x1 = Math.ceil(Math.min(SHEET_W, d[2]) * scale) + 2;
    const y1 = Math.ceil(Math.min(SHEET_H, d[3]) * scale) + 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  }

  compose() {
    if (!this.tex) return;
    if (!this.dirty) this.dirty = [0, 0, SHEET_W, SHEET_H];
    const m = this.maskCtx;
    const [mw, mh] = this.maskSize;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = "source-over";
    m.globalAlpha = 1;
    this.clipTo(m, mw / SHEET_W);
    m.drawImage(this.baseMask, 0, 0);
    for (const st of this.strokes) {
      if (st.alpha < 0.002) continue;
      m.globalAlpha = Math.min(1, st.alpha);
      m.drawImage(st.canvas, 0, 0);
    }
    m.globalAlpha = 1;
    m.restore();
    const { pw, ph } = this.tex;
    const ts = pw / SHEET_W;
    const f = this.fxTmp.getContext("2d");
    f.globalCompositeOperation = "source-over";
    this.clipTo(f, ts);
    f.drawImage(this.tex.fx, 0, 0);
    f.globalCompositeOperation = "destination-in";
    f.drawImage(this.maskAll, 0, 0, pw, ph);
    f.globalCompositeOperation = "source-over";
    f.restore();
    const i = this.inkTmp.getContext("2d");
    i.globalCompositeOperation = "source-over";
    i.globalAlpha = 1;
    this.clipTo(i, ts);
    i.drawImage(this.tex.ink, 0, 0);
    i.globalCompositeOperation = "destination-out";
    i.globalAlpha = ERASE_CAP;
    i.drawImage(this.maskAll, 0, 0, pw, ph);
    i.globalCompositeOperation = "source-over";
    i.globalAlpha = 1;
    i.restore();
    const out = this.inkCanvas.getContext("2d");
    this.clipTo(out, ts);
    out.drawImage(this.fxTmp, 0, 0);
    out.drawImage(this.inkTmp, 0, 0);
    const strip = this.edit?.strip;
    if (strip && strip.pw === pw) {
      const { px0, py0, px1, py1 } = strip.inner;
      const w = px1 - px0;
      const h = py1 - py0;
      const sx = px0 - strip.baked.x;
      const sy = py0 - strip.baked.y;
      out.clearRect(px0, py0, w, h);
      out.drawImage(strip.baked.fx, sx, sy, w, h, px0, py0, w, h);
      out.drawImage(strip.baked.ink, sx, sy, w, h, px0, py0, w, h);
    }
    out.restore();
    this.maskDirty = false;
    this.dirty = null;
  }

  worldTransform(ctx) {
    const { k, sheetX, sheetY } = this.geo;
    const d = this.dpr;
    ctx.setTransform(d * k, 0, 0, d * k, d * sheetX, d * sheetY);
  }

  rebakePile() {
    const ctx = this.pileCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pileCanvas.width, this.pileCanvas.height);
    this.worldTransform(ctx);
    this.dust.drawParts(ctx, this.dust.resting(), this.geo.k * this.dpr);
    this.dust.fresh.length = 0;
    this.dust.needsRebake = false;
  }

  drawFresh() {
    if (this.dust.needsRebake) {
      this.rebakePile();
      return;
    }
    if (!this.dust.fresh.length) return;
    const ctx = this.pileCanvas.getContext("2d");
    this.worldTransform(ctx);
    this.dust.drawParts(ctx, this.dust.fresh, this.geo.k * this.dpr);
    this.dust.fresh.length = 0;
  }

  drawDust() {
    const moving = this.dust.moving;
    if (!moving.length && !this.dustShown) return;
    const ctx = this.dustCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dustCanvas.width, this.dustCanvas.height);
    this.dustShown = moving.length > 0;
    if (!moving.length) return;
    this.worldTransform(ctx);
    this.dust.drawParts(ctx, moving, this.geo.k * this.dpr);
  }

  wake() {
    if (this.raf || this.destroyed || !this.ready || !this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  checkVisibility() {
    if (document.hidden || !this.visible) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.wake();
  }

  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.ready) return;
    const elapsed = this.last ? Math.min(0.1, Math.max(1 / 240, (now - this.last) / 1000)) : 1 / 60;
    const dt = Math.min(1 / 30, elapsed);
    this.last = now;
    this.clock += dt;
    const k = this.geo.k;

    if (this.auto) {
      const a = this.auto;
      a.t = Math.min(1, a.t + dt / a.dur);
      const [x, y] = this.autoPos(a);
      this.showEraser(x, y);
      this.trackVelocity(x, y, elapsed);
      this.rubTo(...this.toWorld(x, y), this.vel.x / k, this.vel.y / k, 1);
      if (a.t >= 1) {
        this.auto = null;
        this.endStroke();
        this.lastStamp = null;
        if (!this.hover) this.hideEraser();
      }
    } else if (this.pointer) {
      const p = this.pointer;
      this.trackVelocity(p.x, p.y, elapsed);
      this.flushQueue();
      this.eraserPos = [p.x, p.y];
    } else if (this.hover) {
      this.trackVelocity(this.hover.x, this.hover.y, elapsed);
      this.eraserPos = [this.hover.x, this.hover.y];
    } else {
      this.trackVelocity(null, null, elapsed);
    }

    const pressTarget = this.pointer || this.auto ? 1 : 0;
    this.press += (pressTarget - this.press) * (1 - Math.exp(-dt / 0.06));
    const leanTarget = this.reduced ? 0 : Math.max(-0.2, Math.min(0.2, this.vel.x * 0.00032 + this.vel.y * 0.00008));
    this.leanV += (LEAN_W * LEAN_W * (leanTarget - this.lean) - 2 * LEAN_W * this.leanV) * dt;
    this.lean += this.leanV * dt;
    this.placeEraser();
    const leaning = Math.abs(leanTarget - this.lean) > 0.0008 || Math.abs(this.leanV) > 0.002 || Math.abs(pressTarget - this.press) > 0.003;

    const moving = this.dust.step(dt, this.clock, this.rng);

    let undoing = false;
    for (let i = this.strokes.length - 1; i >= 0; i -= 1) {
      const st = this.strokes[i];
      if (st.state !== "undo") continue;
      st.clock += dt;
      const progress = st.total ? st.arrived / st.total : Math.min(1, st.clock / 0.45);
      const goal = 1 - progress;
      st.alpha += (goal - st.alpha) * (1 - Math.exp(-dt / 0.12));
      this.markDirty(...st.bbox);
      if (progress >= 1 && st.alpha < 0.004) {
        this.strokes.splice(i, 1);
        continue;
      }
      undoing = true;
    }

    if (this.maskDirty) this.compose();
    this.drawFresh();
    this.drawDust();
    this.dust.compact();

    const speed = Math.hypot(this.vel.x, this.vel.y);
    const busy = Boolean(this.pointer || this.auto) || moving > 0 || undoing || leaning || speed > 2 || this.dustShown;
    if (busy) this.raf = requestAnimationFrame(this.frame);
  }

  trackVelocity(x, y, elapsed) {
    if (x == null) {
      const decay = Math.exp(-elapsed / 0.05);
      this.vel.x *= decay;
      this.vel.y *= decay;
      this.track = null;
      return;
    }
    if (!this.track) {
      this.track = [x, y];
      return;
    }
    const rx = (x - this.track[0]) / elapsed;
    const ry = (y - this.track[1]) / elapsed;
    this.track = [x, y];
    const blend = 1 - Math.exp(-elapsed / 0.045);
    this.vel.x += (rx - this.vel.x) * blend;
    this.vel.y += (ry - this.vel.y) * blend;
    if (!this.pointer && !this.auto) return;
    const k = this.geo.k;
    const vx = this.vel.x / k;
    const sign = Math.abs(vx) > 140 ? Math.sign(vx) : 0;
    this.rubRun += (Math.abs(rx) * elapsed) / k;
    if (sign && this.rubSign && sign !== this.rubSign && this.rubRun > RADIUS && this.lastStamp) {
      const [wx, wy] = this.lastStamp;
      const st = this.current;
      const n = 1 + Math.floor(this.rng() * 3);
      for (let i = 0; i < n && st; i += 1) {
        const p = this.dust.spawnCrumb(this.rng, wx + this.rubSign * RADIUS * 0.7, wy + (this.rng() - 0.5) * RADIUS, this.lastVel.x * 1.4, this.lastVel.y - 60, st, 0.3 * this.rng(), false);
        if (p) st.parts.push(p);
      }
      this.rubRun = 0;
    }
    if (sign) {
      if (sign !== this.rubSign) this.rubRun = 0;
      this.rubSign = sign;
      this.lastVel = { x: vx, y: this.vel.y / k };
    }
  }

  lineAt(wx, wy) {
    if (!this.hand || wx < 80 || wx > SHEET_W - 60) return -1;
    for (const line of this.hand.lines) {
      if (wy >= line.y - TITLE_SIZE * 0.95 - 14 && wy <= line.y + TITLE_SIZE * 0.25 + 14) return line.index;
    }
    return -1;
  }

  titleBox(index) {
    const line = this.hand.lines[index];
    const right = line.key ? line.key.x0 - 20 : SHEET_W - 80;
    return [100, line.y - TITLE_SIZE * 0.95 - 10, right, line.y + TITLE_SIZE * 0.3 + 6];
  }

  stripCells(index) {
    const [x0, y0, x1, y1] = this.titleBox(index);
    return {
      c0: Math.max(0, Math.floor(x0 / GRID)),
      c1: Math.min(GRID_COLS - 1, Math.ceil(x1 / GRID) - 1),
      r0: Math.max(0, Math.floor(y0 / GRID)),
      r1: Math.min(GRID_ROWS - 1, Math.ceil(y1 / GRID) - 1),
    };
  }

  bakeStrip(index, text) {
    const { pw, ph } = this.tex;
    const s = pw / SHEET_W;
    const cells = this.stripCells(index);
    const px0 = Math.floor(cells.c0 * GRID * s);
    const py0 = Math.floor(cells.r0 * GRID * s);
    const px1 = Math.min(pw, Math.floor((cells.c1 + 1) * GRID * s));
    const py1 = Math.min(ph, Math.floor((cells.r1 + 1) * GRID * s));
    const pad = Math.ceil(STRIP_PAD * s) + 4;
    const rx = Math.max(0, px0 - pad);
    const ry = Math.max(0, py0 - pad);
    const region = { x: rx, y: ry, w: Math.min(pw, px1 + pad) - rx, h: Math.min(ph, py1 + pad) - ry };
    const titles = [...this.titles];
    titles[index] = text;
    const hand = layoutHand(this.family, titles);
    const baked = bakeInk(hand, pw, ph, this.family, region);
    return { text, pw, baked, cells, hand, inner: { px0, py0, px1, py1 } };
  }

  beginEdit(index) {
    if (!this.ready || !this.hand?.lines[index]) return null;
    if (this.editing >= 0 && this.editing !== index) this.endEdit(null);
    const title = this.titles[index];
    this.editing = index;
    this.edit = { index, original: title, text: title, a: 0, b: [...title].length, strip: null, line: this.hand.lines[index] };
    this.auto = null;
    this.hideEraser();
    this.placeCaret();
    return this.editBox();
  }

  setEditText(text, a, b) {
    const ed = this.edit;
    if (!ed || !this.tex) return;
    if (text !== ed.text) {
      ed.text = text;
      if (text === ed.original) {
        ed.strip = null;
        ed.line = this.hand.lines[ed.index];
      } else {
        ed.strip = this.bakeStrip(ed.index, text);
        ed.line = ed.strip.hand.lines[ed.index];
      }
      const [x0, y0, x1, y1] = this.titleBox(ed.index);
      this.markDirty(x0 - 8, y0 - 8, x1 + 8, y1 + 8);
      this.compose();
    }
    this.setEditSelection(a, b);
  }

  setEditSelection(a, b) {
    const ed = this.edit;
    if (!ed) return;
    const n = ed.line.stops.length - 1;
    const lo = Math.max(0, Math.min(n, Math.min(a, b)));
    const hi = Math.max(0, Math.min(n, Math.max(a, b)));
    if (lo === ed.a && hi === ed.b && this.caret?.hasAttribute("data-shown")) return;
    ed.a = lo;
    ed.b = hi;
    this.placeCaret(true);
  }

  placeCaret(moved = false) {
    const el = this.caret;
    if (!el || !this.geo) return;
    const ed = this.edit;
    if (!ed) {
      el.removeAttribute("data-shown");
      return;
    }
    const { sheetX, sheetY, k } = this.geo;
    const line = ed.line;
    const stops = line.stops;
    const x0 = stops[Math.min(ed.a, stops.length - 1)];
    const x1 = stops[Math.min(ed.b, stops.length - 1)];
    const size = Math.min(TITLE_SIZE, line.size || TITLE_SIZE);
    const base = line.base + line.slope * (x0 - line.startX);
    const range = ed.b > ed.a;
    const left = sheetX + (range ? x0 - 2 : x0 + 1) * k;
    const top = sheetY + (base - size * 0.86) * k;
    el.style.width = `${(range ? x1 - x0 + 4 : 3) * k}px`;
    el.style.height = `${size * 1.02 * k}px`;
    el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0) rotate(${Math.atan(line.slope).toFixed(4)}rad)`;
    el.dataset.mode = range ? "range" : "caret";
    el.setAttribute("data-shown", "");
    if (moved && !range) {
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
  }

  editBox() {
    if (this.editing < 0 || !this.geo) return null;
    const { sheetX, sheetY, k } = this.geo;
    const line = this.hand.lines[this.editing];
    const [x0, , x1] = this.titleBox(this.editing);
    const size = TITLE_SIZE * k;
    return {
      index: this.editing,
      title: line.title,
      left: sheetX + (118 - 4) * k,
      baseline: sheetY + line.y * k,
      width: (x1 - 118 + 4) * k,
      size,
      x0: sheetX + x0 * k,
    };
  }

  endEdit(text) {
    const index = this.editing;
    if (index < 0) return;
    const ed = this.edit;
    this.editing = -1;
    this.edit = null;
    this.placeCaret();
    const box = this.titleBox(index);
    if (text == null || text === this.titles[index] || !this.tex) {
      this.markDirty(box[0] - 8, box[1] - 8, box[2] + 8, box[3] + 8);
      this.compose();
      this.wake();
      return;
    }
    const strip = ed?.strip && ed.strip.text === text && ed.strip.pw === this.tex.pw ? ed.strip : this.bakeStrip(index, text);
    this.titles[index] = text;
    if (this.current) this.endStroke();
    this.auto = null;
    const base = this.baseMask.getContext("2d");
    const { cells, inner, baked } = strip;
    const x0 = cells.c0 * GRID;
    const y0 = cells.r0 * GRID;
    const x1 = (cells.c1 + 1) * GRID;
    const y1 = (cells.r1 + 1) * GRID;
    this.strokes = this.strokes.filter((st) => {
      st.ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
      st.ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      st.ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const idx of Array.from(st.removed.keys())) {
        const row = Math.floor(idx / GRID_COLS);
        const col = idx - row * GRID_COLS;
        if (row >= cells.r0 && row <= cells.r1 && col >= cells.c0 && col <= cells.c1) st.removed.delete(idx);
      }
      st.parts = st.parts.filter((pt) => !(pt.ox >= x0 && pt.ox < x1 && pt.oy >= y0 && pt.oy < y1));
      if (st.state === "undo" || st.removed.size || st.parts.length) return true;
      st.canvas.width = 1;
      st.canvas.height = 1;
      return false;
    });
    base.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    base.clearRect(cells.c0 * GRID, cells.r0 * GRID, (cells.c1 + 1 - cells.c0) * GRID, (cells.r1 + 1 - cells.r0) * GRID);
    base.setTransform(1, 0, 0, 1, 0, 0);
    this.hand = strip.hand;
    const w = inner.px1 - inner.px0;
    const h = inner.py1 - inner.py0;
    const sx = inner.px0 - baked.x;
    const sy = inner.py0 - baked.y;
    for (const [dst, src] of [[this.tex.ink, baked.ink], [this.tex.fx, baked.fx]]) {
      const c = dst.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(inner.px0, inner.py0, w, h);
      c.drawImage(src, sx, sy, w, h, inner.px0, inner.py0, w, h);
    }
    coverageInto(this.cov0, this.tint, baked, cells);
    for (let row = cells.r0; row <= cells.r1; row += 1) {
      for (let col = cells.c0; col <= cells.c1; col += 1) {
        const idx = row * GRID_COLS + col;
        this.cov[idx] = this.cov0[idx];
      }
    }
    this.markDirty(0, 0, SHEET_W, SHEET_H);
    this.compose();
    this.placeRing();
    this.emitHistory();
    this.wake();
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.bakeTimer);
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    const s = this.surface;
    s.removeEventListener("pointerdown", this.handlers.down);
    s.removeEventListener("pointermove", this.handlers.move);
    s.removeEventListener("pointerup", this.handlers.up);
    s.removeEventListener("pointercancel", this.handlers.up);
    s.removeEventListener("pointerleave", this.handlers.leave);
    for (const c of [this.inkTmp, this.fxTmp, this.maskAll, this.baseMask, this.tex?.ink, this.tex?.fx]) {
      if (!c) continue;
      c.width = 1;
      c.height = 1;
    }
    for (const st of this.strokes) {
      st.canvas.width = 1;
      st.canvas.height = 1;
    }
    this.strokes = [];
  }
}
