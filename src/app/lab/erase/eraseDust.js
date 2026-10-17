import { LEDGE_DEPTH, SHEET_H } from "./eraseSetlist";

export const AIR = 1;
export const REST = 2;
export const HOME = 3;
export const GONE = 0;

const GRAVITY = 2600;
const BIN = 3;
const BIN_X0 = -2400;
const BINS = 2400;
const REPOSE = 2.4;
const MAX_PARTS = 14000;

export const DUST_COLORS = [
  "rgba(30, 28, 38, 0.86)",
  "rgba(48, 45, 56, 0.72)",
  "rgba(74, 70, 80, 0.6)",
  "rgba(104, 100, 106, 0.5)",
  "rgba(40, 54, 128, 0.78)",
  "rgba(78, 90, 146, 0.58)",
  "rgba(150, 142, 130, 0.62)",
];

export const CRUMB_COLORS = ["#e9e3d7", "#dcd5c8", "#c9c2b8", "#aea8a6", "#8f8a90"];

const SHADOW = "rgba(66, 54, 40, 0.34)";
const HIGHLIGHT = "rgba(255, 255, 255, 0.55)";

function bezier(a, b, c, d, t) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

export default class Dust {
  constructor() {
    this.parts = [];
    this.moving = [];
    this.stuck = [];
    this.heights = new Float32Array(BINS);
    this.fresh = [];
    this.needsRebake = false;
    this.count = 0;
  }

  full() {
    return this.count >= MAX_PARTS;
  }

  add(p) {
    this.count += 1;
    this.parts.push(p);
    if (p.state === AIR) this.moving.push(p);
    return p;
  }

  spawnDust(rng, x, y, vx, vy, stroke, tint) {
    if (this.full()) return null;
    const size = 1.8 + rng() * rng() * 3;
    const dark = rng();
    const color = tint > 0.5 ? (dark < 0.55 ? 4 : 5) : dark < 0.32 ? 0 : dark < 0.62 ? 1 : dark < 0.86 ? 2 : 3;
    const angle = rng() * Math.PI * 2;
    const kick = 18 + rng() * 60;
    return this.add({
      kind: 0,
      state: AIR,
      x,
      y,
      ox: x,
      oy: y,
      vx: vx * (0.08 + rng() * 0.1) + Math.cos(angle) * kick,
      vy: vy * (0.08 + rng() * 0.1) + Math.sin(angle) * kick - 30,
      size,
      len: 0,
      color,
      drag: 7 + rng() * 6,
      couple: 0.8 + rng() * 0.5,
      phase: rng() * 6.28,
      z: 0.04 + rng() * rng() * 0.8,
      rot: 0,
      spin: 0,
      col: -1,
      inc: 0,
      stroke,
      alpha: 1,
    });
  }

  spawnCrumb(rng, x, y, vx, vy, stroke, ink, cling) {
    if (this.full()) return null;
    const len = 4 + rng() * rng() * 9;
    const th = 2.4 + rng() * 2;
    const color = Math.min(CRUMB_COLORS.length - 1, Math.floor(ink * 3.6 + rng() * 2.2));
    const angle = rng() * Math.PI * 2;
    const p = this.add({
      kind: 1,
      state: cling ? REST : AIR,
      x,
      y,
      ox: x,
      oy: y,
      vx: vx * (0.18 + rng() * 0.16) + Math.cos(angle) * 30,
      vy: vy * (0.18 + rng() * 0.16) + Math.sin(angle) * 30 - 40,
      size: th,
      len,
      color,
      drag: 2.6 + rng() * 1.4,
      couple: 0.25,
      phase: rng() * 6.28,
      z: 0.06 + rng() * 0.7,
      rot: rng() * Math.PI,
      spin: (rng() - 0.5) * 14,
      curl: (rng() - 0.5) * 1.4,
      col: -1,
      inc: 0,
      stroke,
      alpha: 1,
    });
    if (p && cling) {
      this.stuck.push(p);
      this.fresh.push(p);
    }
    return p;
  }

  knock(x, y, r, vx, vy, rng) {
    if (!this.stuck.length) return;
    const r2 = r * r;
    let hit = false;
    this.stuck = this.stuck.filter((p) => {
      if (p.state !== REST) return false;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > r2) return true;
      p.state = AIR;
      p.vx = vx * 0.35 + (rng() - 0.5) * 60;
      p.vy = vy * 0.35 - 40 * rng();
      p.spin = (rng() - 0.5) * 16;
      this.moving.push(p);
      hit = true;
      return false;
    });
    if (hit) this.needsRebake = true;
  }

  settle(p, rng) {
    let col = Math.max(1, Math.min(BINS - 2, Math.floor((p.x - BIN_X0) / BIN)));
    const h = this.heights;
    for (let i = 0; i < 40; i += 1) {
      const left = h[col - 1];
      const right = h[col + 1];
      const low = Math.min(left, right);
      if (h[col] - low <= REPOSE) break;
      if (left < right) col -= 1;
      else if (right < left) col += 1;
      else col += rng() < 0.5 ? -1 : 1;
      col = Math.max(1, Math.min(BINS - 2, col));
    }
    const thick = p.kind ? p.size * 0.9 : p.size * 0.6;
    const area = p.kind ? p.len * p.size * 0.5 : p.size * p.size * 0.62;
    p.inc = (area * 2.6) / BIN;
    p.col = col;
    p.x = BIN_X0 + (col + rng()) * BIN;
    p.y = SHEET_H + p.z * LEDGE_DEPTH - h[col] - thick * 0.5;
    h[col] += p.inc;
    p.vx = 0;
    p.vy = 0;
    if (p.kind) p.rot = (rng() - 0.5) * 0.7;
    p.state = REST;
    this.fresh.push(p);
  }

  unsettle(p) {
    if (p.col >= 0) {
      this.heights[p.col] = Math.max(0, this.heights[p.col] - p.inc);
      p.col = -1;
    }
  }

  floorAt(p) {
    const col = Math.max(0, Math.min(BINS - 1, Math.floor((p.x - BIN_X0) / BIN)));
    return SHEET_H + p.z * LEDGE_DEPTH - this.heights[col];
  }

  step(dt, t, rng) {
    const list = this.moving;
    let write = 0;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (p.state === AIR) {
        const ax = 34 * Math.sin(p.y * 0.0061 + t * 0.83 + p.phase) + 20 * Math.sin(p.x * 0.0113 - p.y * 0.0047 + t * 1.61);
        const ay = 18 * Math.sin(p.x * 0.0079 + t * 1.07 + p.phase * 0.7);
        const k = 1 - Math.exp(-p.drag * dt);
        p.vx += (ax * p.couple - p.vx) * k;
        p.vy += (GRAVITY / p.drag + ay * p.couple - p.vy) * k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind) {
          p.rot += p.spin * dt;
          p.spin *= Math.exp(-dt * 0.8);
        }
        if (p.y >= this.floorAt(p)) {
          this.settle(p, rng);
          continue;
        }
        list[write] = p;
        write += 1;
      } else if (p.state === HOME) {
        if (p.delay > 0) {
          p.delay -= dt;
          list[write] = p;
          write += 1;
          continue;
        }
        p.t += dt / p.dur;
        if (p.t >= 1) {
          p.state = GONE;
          p.alpha = 0;
          this.count -= 1;
          p.home?.(p);
          continue;
        }
        const e = p.t < 0.5 ? 4 * p.t * p.t * p.t : 1 - Math.pow(-2 * p.t + 2, 3) / 2;
        p.x = bezier(p.hx, p.c1x, p.c2x, p.ox, e);
        p.y = bezier(p.hy, p.c1y, p.c2y, p.oy, e);
        p.alpha = p.fade ? 1 - p.t : p.t > 0.78 ? Math.max(0, 1 - (p.t - 0.78) / 0.22) : Math.min(1, 0.55 + p.t * 3);
        if (p.kind) p.rot += p.spin * dt * (1 - e);
        list[write] = p;
        write += 1;
      }
    }
    list.length = write;
    return write;
  }

  sendHome(p, rng, reduced, onHome) {
    const wasRest = p.state === REST;
    if (wasRest) this.unsettle(p);
    p.home = onHome;
    p.hx = p.x;
    p.hy = p.y;
    p.t = 0;
    p.fade = reduced;
    if (reduced) {
      p.c1x = p.x;
      p.c1y = p.y;
      p.c2x = p.x;
      p.c2y = p.y;
      p.ox = p.x;
      p.oy = p.y;
      p.dur = 0.42;
      p.delay = 0;
    } else {
      p.dur = 0.95 + rng() * 0.5;
      const lift = 140 + rng() * 220;
      if (p.state === AIR) {
        p.c1x = p.x + p.vx * p.dur * 0.33;
        p.c1y = p.y + p.vy * p.dur * 0.33;
        p.delay = 0;
      } else {
        p.c1x = p.x + (rng() - 0.5) * 50;
        p.c1y = p.y - lift;
        p.delay = rng() * 0.32 + (wasRest && p.col >= 0 ? 0 : 0.05);
      }
      p.c2x = p.ox + (rng() - 0.5) * 36;
      p.c2y = p.oy + 60 + rng() * 110;
    }
    p.state = HOME;
    this.moving.push(p);
  }

  drawParts(ctx, list, scale) {
    const min = 0.85 / scale;
    for (let c = 0; c < DUST_COLORS.length; c += 1) {
      ctx.fillStyle = DUST_COLORS[c];
      for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        if (p.kind || p.color !== c || p.state === GONE) continue;
        const s = Math.max(min, p.size * (p.state === HOME ? 0.4 + 0.6 * p.alpha : 1));
        if (ctx.globalAlpha !== p.alpha) ctx.globalAlpha = p.alpha;
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
      }
    }
    ctx.lineCap = "round";
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (!p.kind || p.state === GONE) continue;
      const cx = Math.cos(p.rot) * p.len * 0.5;
      const cy = Math.sin(p.rot) * p.len * 0.5;
      const w = Math.max(min, p.size);
      if (ctx.globalAlpha !== p.alpha) ctx.globalAlpha = p.alpha;
      ctx.lineWidth = w;
      const bx = -cy * p.curl;
      const by = cx * p.curl;
      ctx.strokeStyle = SHADOW;
      ctx.beginPath();
      ctx.moveTo(p.x - cx + w * 0.18, p.y - cy + w * 0.3);
      ctx.quadraticCurveTo(p.x + bx + w * 0.18, p.y + by + w * 0.3, p.x + cx + w * 0.18, p.y + cy + w * 0.3);
      ctx.stroke();
      ctx.strokeStyle = CRUMB_COLORS[p.color];
      ctx.beginPath();
      ctx.moveTo(p.x - cx, p.y - cy);
      ctx.quadraticCurveTo(p.x + bx, p.y + by, p.x + cx, p.y + cy);
      ctx.stroke();
      ctx.lineWidth = w * 0.34;
      ctx.strokeStyle = HIGHLIGHT;
      ctx.beginPath();
      ctx.moveTo(p.x - cx * 0.7 - w * 0.12, p.y - cy * 0.7 - w * 0.2);
      ctx.lineTo(p.x + cx * 0.5 - w * 0.12, p.y + cy * 0.5 - w * 0.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  resting() {
    return this.parts.filter((p) => p.state === REST);
  }

  compact() {
    if (this.parts.length > this.count * 1.5 + 2000) this.parts = this.parts.filter((p) => p.state !== GONE);
  }
}
