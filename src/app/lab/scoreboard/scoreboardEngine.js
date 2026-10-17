import { COL_E, COL_H, COL_R, ERRORS, HITS, INNINGS, RACK_DIGITS, TEAMS, colName, computeLayout, slotKey } from "./scoreboardGame";
import { bakeBoard, bakeGlow, bakeLight, bakeMote, bakePlate, bakeShadow, lightAt } from "./scoreboardPaint";

const MAX_DPR = 2;
const HOVER = 0.2;
const DROP_G = 34;
const SWING_K = 120;
const SWING_C = 13;
const REST_K = 260;
const REST_C = 7;
const FLY_K = 340;
const FLY_C = 30;
const MAX_ANGLE = 0.38;

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

export default class ScoreboardEngine {
  constructor({ host, canvas, insets, onReady, onStatus, onGrab }) {
    this.host = host;
    this.canvas = canvas;
    this.insets = insets;
    this.onReady = onReady;
    this.onStatus = onStatus;
    this.onGrab = onGrab;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.plates = [];
    this.slotPlate = new Map();
    this.rackPlate = new Map();
    this.totals = [null, null];
    this.totalCache = new Map();
    this.shake = { x: 0, y: 0, vx: 0, vy: 0 };
    this.dust = [];
    this.pointer = null;
    this.held = null;
    this.cursor = { team: 1, col: 5 };
    this.keyboard = false;
    this.visible = true;
    this.raf = 0;
    this.last = 0;
    this.destroyed = false;
    this.layout = null;
    this.bakeTimer = 0;
    this.accent = getComputedStyle(host).getPropertyValue("--color-accent").trim() || "rgb(255 220 160)";
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      key: (e) => this.keyDown(e),
      visibility: () => this.kick(),
    };
  }

  start() {
    this.createPlates();
    this.rebuild();
    this.host.addEventListener("pointerdown", this.handlers.down);
    window.addEventListener("pointermove", this.handlers.move);
    window.addEventListener("pointerup", this.handlers.up);
    window.addEventListener("pointercancel", this.handlers.up);
    this.host.addEventListener("keydown", this.handlers.key);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.kick();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => {
      const rect = this.host.getBoundingClientRect();
      if (this.layout && Math.round(rect.width) === this.layout.W && Math.round(rect.height) === this.layout.H) return;
      clearTimeout(this.bakeTimer);
      this.bakeTimer = setTimeout(() => this.rebuild(), this.layout ? 140 : 0);
    });
    this.resizer.observe(this.host);
    if (!this.reduced) this.seedDust();
    this.computeTotals(true);
    this.render();
    this.onReady?.();
    this.announce();
    this.kick();
  }

  createPlates() {
    let id = 0;
    const make = (text, loc) => {
      const plate = {
        id: id++,
        text,
        seed: 1000 + id * 7919,
        loc,
        x: 0,
        y: 0,
        a: 0,
        vx: 0,
        vy: 0,
        va: 0,
        lift: 0,
        mode: "rest",
        jx: (Math.random() - 0.5) * 0.03,
        jy: (Math.random() - 0.5) * 0.025,
        ja: (Math.random() - 0.5) * 0.022,
        img: null,
      };
      this.plates.push(plate);
      this.assign(plate, loc);
      return plate;
    };
    for (let team = 0; team < 2; team += 1) {
      INNINGS[team].forEach((runs, col) => {
        if (runs !== null) make(String(runs), { type: "slot", key: slotKey(team, col) });
      });
      make(String(HITS[team]), { type: "slot", key: slotKey(team, COL_H) });
      make(String(ERRORS[team]), { type: "slot", key: slotKey(team, COL_E) });
    }
    RACK_DIGITS.forEach((digit, index) => {
      if (digit !== null) make(digit, { type: "rack", index });
    });
  }

  assign(plate, loc) {
    if (plate.loc?.type === "slot" && this.slotPlate.get(plate.loc.key) === plate) this.slotPlate.delete(plate.loc.key);
    if (plate.loc?.type === "rack" && this.rackPlate.get(plate.loc.index) === plate) this.rackPlate.delete(plate.loc.index);
    plate.loc = loc;
    if (loc.type === "slot") this.slotPlate.set(loc.key, plate);
    else this.rackPlate.set(loc.index, plate);
  }

  slotOf(key) {
    return this.layout.slots.find((s) => s.key === key);
  }

  restPose(plate) {
    const L = this.layout;
    if (plate.loc.type === "slot") {
      const slot = this.slotOf(plate.loc.key);
      return { x: slot.x + plate.jx * L.u, y: slot.y + L.u * 0.025 + plate.jy * L.u, a: plate.ja };
    }
    const spot = L.rack[plate.loc.index];
    return { x: spot.x + plate.jx * L.u * 0.6, y: spot.y + plate.jy * L.u * 0.5, a: plate.ja * 1.4 };
  }

  rebuild() {
    if (this.destroyed) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const insets = this.insets?.() ?? { top: 16, bottom: 16 };
    const previous = this.layout;
    const L = computeLayout(width, height, insets);
    this.layout = L;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.board = bakeBoard(L, dpr);
    this.light = bakeLight(width, height);
    this.glow = bakeGlow(width, height, dpr);
    this.shadowSharp = bakeShadow({ pw: L.pw, ph: L.ph, u: L.u, dpr, blur: Math.max(0.6, L.u * 0.014) });
    this.shadowSoft = bakeShadow({ pw: L.pw, ph: L.ph, u: L.u, dpr, blur: L.u * 0.05 });
    this.mote = bakeMote();
    this.totalCache.clear();
    for (const plate of this.plates) {
      plate.img = bakePlate({ text: plate.text, seed: plate.seed, pw: L.pw, ph: L.ph, u: L.u, dpr });
      const pose = this.restPose(plate);
      if (plate.mode === "rest" || !previous) {
        plate.x = pose.x;
        plate.y = pose.y;
        plate.a = pose.a;
      } else if (previous) {
        const k = L.u / previous.u;
        plate.x *= k;
        plate.y *= k;
      }
    }
    for (const total of this.totals) {
      if (!total) continue;
      total.img = this.totalImage(total.text, total.seed);
      total.prevImg = total.prevText ? this.totalImage(total.prevText, total.prevSeed) : null;
    }
    this.render();
  }

  totalImage(text, seed) {
    const key = `${text}:${seed}`;
    if (!this.totalCache.has(key)) {
      const L = this.layout;
      this.totalCache.set(key, bakePlate({ text, seed, pw: L.pw, ph: L.ph, u: L.u, dpr: this.dpr }));
    }
    return this.totalCache.get(key);
  }

  runsFor(team) {
    let sum = 0;
    for (let col = 0; col < 9; col += 1) {
      const plate = this.slotPlate.get(slotKey(team, col));
      if (plate && plate.mode === "rest") sum += Number(plate.text);
    }
    return sum;
  }

  computeTotals(initial = false) {
    let changed = false;
    for (let team = 0; team < 2; team += 1) {
      const text = String(this.runsFor(team));
      const current = this.totals[team];
      if (current && current.text === text) continue;
      const seed = 50 + team * 31 + Number(text) * 13;
      if (!current || initial) {
        this.totals[team] = { text, seed, img: this.totalImage(text, seed), prevText: null, prevImg: null, o: 0, v: 0 };
        continue;
      }
      changed = true;
      current.prevText = current.text;
      current.prevSeed = current.seed;
      current.prevImg = current.img;
      current.text = text;
      current.seed = seed;
      current.img = this.totalImage(text, seed);
      current.o = current.o - 1;
      current.v = 0;
      if (this.reduced) {
        current.o = 0;
        current.prevImg = null;
      }
    }
    if (changed) this.kick();
    return changed;
  }

  kick() {
    if (this.destroyed || this.raf) return;
    if (!this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  frame(t) {
    this.raf = 0;
    if (this.destroyed || !this.visible || document.hidden) return;
    const dt = this.last ? clamp((t - this.last) / 1000, 1 / 240, 1 / 30) : 1 / 60;
    this.last = t;
    const active = this.step(dt);
    this.render(true);
    if (active) this.raf = requestAnimationFrame(this.frame);
  }

  step(dt) {
    const L = this.layout;
    let active = false;
    const p = this.pointer;
    if (p) {
      const rx = (p.x - p.px) / dt;
      const ry = (p.y - p.py) / dt;
      p.px = p.x;
      p.py = p.y;
      const k = 1 - Math.exp(-dt * 22);
      const nvx = p.vx + (rx - p.vx) * k;
      const nvy = p.vy + (ry - p.vy) * k;
      const ax = (nvx - p.vx) / dt;
      const ay = (nvy - p.vy) / dt;
      const ka = 1 - Math.exp(-dt * 16);
      p.ax += (ax - p.ax) * ka;
      p.ay += (ay - p.ay) * ka;
      p.vx = nvx;
      p.vy = nvy;
      active = true;
    }

    for (const plate of this.plates) {
      if (plate.mode === "held") this.stepHeld(plate, dt);
      else if (plate.mode === "fly") this.stepFly(plate, dt);
      else if (plate.mode === "drop") this.stepDrop(plate, dt);
      else this.stepRest(plate, dt);
      if (plate.mode !== "rest" || plate.moving) active = true;
    }

    for (const total of this.totals) {
      if (!total || (total.o === 0 && total.v === 0)) continue;
      const k = 300;
      const c = 2 * Math.sqrt(k) * 0.78;
      total.v += (-k * total.o - c * total.v) * dt;
      total.o += total.v * dt;
      if (Math.abs(total.o) < 0.0015 && Math.abs(total.v) < 0.02) {
        total.o = 0;
        total.v = 0;
        total.prevImg = null;
        total.prevText = null;
      } else active = true;
    }

    const s = this.shake;
    if (s.x || s.y || s.vx || s.vy) {
      const k = 1400;
      const c = 2 * Math.sqrt(k) * 0.32;
      s.vx += (-k * s.x - c * s.vx) * dt;
      s.vy += (-k * s.y - c * s.vy) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (Math.abs(s.x) + Math.abs(s.y) < 0.02 && Math.abs(s.vx) + Math.abs(s.vy) < 0.5) {
        s.x = 0;
        s.y = 0;
        s.vx = 0;
        s.vy = 0;
      } else active = true;
    }

    if (this.dust.length) {
      const W = L.W;
      const H = L.H;
      for (const d of this.dust) {
        d.age += dt;
        d.vx += (d.wx - d.vx) * (1 - Math.exp(-dt * d.drag));
        d.vy += (d.wy - d.vy) * (1 - Math.exp(-dt * d.drag));
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.wx += Math.sin(d.age * 0.9 + d.phase) * 2 * dt;
      }
      this.dust = this.dust.filter((d) => d.age < d.life && d.x > -20 && d.x < W + 20 && d.y > -20 && d.y < H + 20);
      if (this.dust.length) active = true;
    }
    return active;
  }

  stepRest(plate, dt) {
    const pose = this.restPose(plate);
    plate.x = pose.x;
    plate.y = pose.y + (plate.settle || 0);
    if (plate.settle) {
      plate.settleV = (plate.settleV || 0) + (-900 * plate.settle - 38 * plate.settleV) * dt;
      plate.settle += plate.settleV * dt;
      if (Math.abs(plate.settle) < 0.03 && Math.abs(plate.settleV) < 1) {
        plate.settle = 0;
        plate.settleV = 0;
      }
    }
    plate.lift += (0 - plate.lift) * (1 - Math.exp(-dt * 18));
    if (plate.lift < 0.002) plate.lift = 0;
    plate.va += (-REST_K * (plate.a - pose.a) - REST_C * plate.va) * dt;
    plate.a += plate.va * dt;
    const moving = Math.abs(plate.a - pose.a) > 0.0004 || Math.abs(plate.va) > 0.004 || plate.lift > 0 || plate.settle;
    if (!moving) {
      plate.a = pose.a;
      plate.va = 0;
    }
    plate.moving = Boolean(moving);
  }

  stepHeld(plate, dt) {
    const L = this.layout;
    const p = this.pointer;
    const h = plate.hold;
    h.offset += (h.offsetTarget - h.offset) * (1 - Math.exp(-dt * 12));
    const pivotX = p.x;
    const pivotY = p.y - h.offset;
    const s = 1 + 0.06 * plate.lift;
    const cos = Math.cos(plate.a);
    const sin = Math.sin(plate.a);
    const gx = -h.lx * s;
    const gy = -h.ly * s;
    let cx = pivotX + gx * cos - gy * sin;
    let cy = pivotY + gx * sin + gy * cos;
    const near = this.nearestSlot(cx, cy, 0.42);
    if (near) {
      const pull = 0.22 * (1 - near.d / (0.42 * L.u));
      cx += (near.slot.x - cx) * pull;
      cy += (near.slot.y - HOVER * 0.4 * L.u - cy) * pull;
    }
    plate.vx = (cx - plate.x) / dt;
    plate.vy = (cy - plate.y) / dt;
    plate.x = cx;
    plate.y = cy;
    const rx = (cx - pivotX) / L.ph;
    const ry = Math.max(0, (cy - pivotY) / L.ph) + 0.34;
    const ax = clamp(p.ax / L.ph, -900, 900);
    const ay = clamp(p.ay / L.ph, -900, 900);
    const gravity = 70;
    p.svx += (p.vx - p.svx) * (1 - Math.exp(-dt * 9));
    const lean = clamp((p.svx / L.ph) * 0.016, -0.3, 0.3);
    const torque = 0.12 * (rx * (gravity - ay) + ry * ax) + SWING_K * lean;
    plate.va += (torque - SWING_K * plate.a - SWING_C * plate.va) * dt;
    plate.a = clamp(plate.a + plate.va * dt, -MAX_ANGLE, MAX_ANGLE);
    plate.lift += (1 - plate.lift) * (1 - Math.exp(-dt * 16));
  }

  stepFly(plate, dt) {
    const L = this.layout;
    const pose = this.restPose(plate);
    const hoverY = pose.y - (plate.target === "slot" ? HOVER : HOVER * 0.6) * L.u;
    plate.vx += (-FLY_K * (plate.x - pose.x) - FLY_C * plate.vx) * dt;
    plate.vy += (-FLY_K * (plate.y - hoverY) - FLY_C * plate.vy) * dt;
    const speed = Math.hypot(plate.vx, plate.vy);
    const cap = 34 * L.u;
    if (speed > cap) {
      plate.vx *= cap / speed;
      plate.vy *= cap / speed;
    }
    plate.x += plate.vx * dt;
    plate.y += plate.vy * dt;
    plate.va += (-150 * (plate.a - pose.a) - 14 * plate.va) * dt;
    plate.a += plate.va * dt;
    plate.lift += (1 - plate.lift) * (1 - Math.exp(-dt * 12));
    const nearX = Math.abs(plate.x - pose.x) < 0.07 * L.u;
    const nearY = Math.abs(plate.y - hoverY) < 0.12 * L.u;
    if (nearX && nearY && speed < 6 * L.u) {
      plate.mode = "drop";
      plate.vy = Math.max(0, plate.vy);
      plate.dropFrom = Math.min(plate.y, hoverY);
    }
  }

  stepDrop(plate, dt) {
    const L = this.layout;
    const pose = this.restPose(plate);
    plate.vx += (-FLY_K * 1.5 * (plate.x - pose.x) - FLY_C * 1.2 * plate.vx) * dt;
    plate.x += plate.vx * dt;
    plate.vy += DROP_G * L.u * dt;
    plate.y += plate.vy * dt;
    plate.va += (-220 * (plate.a - pose.a) - 18 * plate.va) * dt;
    plate.a += plate.va * dt;
    const span = Math.max(1, pose.y - plate.dropFrom);
    plate.lift = clamp((pose.y - plate.y) / span, 0, 1);
    if (plate.y >= pose.y) this.land(plate, plate.vy);
  }

  land(plate, impactV) {
    const L = this.layout;
    const pose = this.restPose(plate);
    plate.mode = "rest";
    plate.x = pose.x;
    plate.y = pose.y;
    plate.vx = 0;
    plate.vy = 0;
    plate.lift = 0;
    const strength = clamp(impactV / (L.u * 3), 0, 1.4);
    plate.settle = 0;
    plate.settleV = -strength * L.u * 0.35;
    plate.va += (Math.random() < 0.5 ? -1 : 1) * strength * 0.5;
    const inSlot = plate.loc.type === "slot";
    if (!this.reduced) {
      this.shake.vy += strength * L.u * (inSlot ? 0.5 : 0.3);
      this.shake.vx += (Math.random() - 0.5) * strength * L.u * 0.2;
      this.puff(pose.x, pose.y + L.ph * 0.5, strength);
    }
    for (const other of this.plates) {
      if (other === plate || other.mode !== "rest") continue;
      const dx = Math.abs(other.x - pose.x) / L.u;
      const dy = Math.abs(other.y - pose.y) / L.u;
      if (dy > 2.2 || dx > 4) continue;
      other.va += (Math.random() < 0.5 ? -1 : 1) * strength * 0.12 / (1 + dx + dy);
      other.moving = true;
    }
    if (inSlot) {
      this.computeTotals();
      this.announce(plate);
    }
    this.kick();
  }

  puff(x, y, strength) {
    const L = this.layout;
    const n = Math.round(8 + strength * 14);
    for (let i = 0; i < n; i += 1) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.dust.push({
        x: x + side * (L.pw * 0.3 + Math.random() * L.pw * 0.3),
        y: y - Math.random() * L.u * 0.1,
        vx: side * (0.4 + Math.random()) * L.u * 0.9 * strength,
        vy: -(0.2 + Math.random() * 0.7) * L.u * strength,
        wx: (Math.random() - 0.2) * L.u * 0.18,
        wy: -Math.random() * L.u * 0.08,
        drag: 3 + Math.random() * 2,
        size: (0.6 + Math.random() * 1.4) * Math.max(0.7, L.u / 60),
        age: 0,
        life: 1.4 + Math.random() * 1.8,
        phase: Math.random() * 6,
        peak: 0.5 + Math.random() * 0.5,
      });
    }
  }

  seedDust() {
    const rect = this.host.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const unit = Math.max(1, Math.min(W, H) / 60);
    for (let i = 0; i < 46; i += 1) {
      const x = Math.random() * W * 0.75;
      const y = Math.random() * H;
      this.dust.push({
        x,
        y,
        vx: 0,
        vy: 0,
        wx: (0.5 + Math.random()) * unit * 0.8,
        wy: (Math.random() - 0.6) * unit * 0.5,
        drag: 0.6,
        size: (0.5 + Math.random() * 1.3) * Math.max(0.8, unit / 10),
        age: Math.random() * 1.5,
        life: 5 + Math.random() * 5,
        phase: Math.random() * 6,
        peak: 0.3 + Math.random() * 0.6,
      });
    }
  }

  nearestSlot(x, y, radius, exclude) {
    const L = this.layout;
    let best = null;
    for (const slot of L.slots) {
      if (slot.col === COL_R) continue;
      if (exclude && slot.key === exclude) continue;
      const d = Math.hypot((x - slot.x) * 1.1, (y - slot.y) * 0.85);
      if (d < radius * L.u && (!best || d < best.d)) best = { slot, d };
    }
    return best;
  }

  local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  hitPlate(x, y, touch) {
    const L = this.layout;
    const tol = touch ? L.u * 0.14 : L.u * 0.02;
    const order = [...this.plates].sort((a, b) => b.lift - a.lift);
    let best = null;
    for (const plate of order) {
      const s = 1 + 0.06 * plate.lift;
      const dx = x - plate.x;
      const dy = y - plate.y;
      const cos = Math.cos(-plate.a);
      const sin = Math.sin(-plate.a);
      const lx = (dx * cos - dy * sin) / s;
      const ly = (dx * sin + dy * cos) / s;
      if (Math.abs(lx) <= L.pw / 2 + tol && Math.abs(ly) <= L.ph / 2 + tol) {
        const d = Math.hypot(lx, ly);
        if (!touch) return { plate, lx, ly };
        if (!best || d < best.d) best = { plate, lx, ly, d };
      }
    }
    return best;
  }

  pointerDown(e) {
    if (!this.layout || this.held) return;
    if (e.button !== undefined && e.button !== 0) return;
    const { x, y } = this.local(e);
    const touch = e.pointerType !== "mouse";
    const hit = this.hitPlate(x, y, touch);
    this.keyboard = false;
    if (!hit) {
      this.render();
      return;
    }
    e.preventDefault();
    this.host.focus({ preventScroll: true });
    const plate = hit.plate;
    const origin = { ...plate.loc };
    plate.hold = {
      lx: clamp(hit.lx, -this.layout.pw / 2, this.layout.pw / 2),
      ly: clamp(hit.ly, -this.layout.ph / 2, this.layout.ph / 2),
      offset: 0,
      offsetTarget: touch ? this.layout.u * 0.32 : 0,
      origin,
      pointerId: e.pointerId,
    };
    plate.mode = "held";
    plate.settle = 0;
    plate.settleV = 0;
    this.held = plate;
    this.pointer = { x, y, px: x, py: y, vx: 0, vy: 0, ax: 0, ay: 0, svx: 0, id: e.pointerId };
    this.host.setAttribute("data-grabbing", "");
    this.onGrab?.(true);
    if (origin.type === "slot") this.computeTotals();
    this.kick();
  }

  pointerMove(e) {
    if (!this.pointer || e.pointerId !== this.pointer.id) {
      if (e.pointerType === "mouse" && this.layout && e.target === this.canvas) {
        const { x, y } = this.local(e);
        this.host.style.cursor = this.hitPlate(x, y, false) ? "grab" : "";
      }
      return;
    }
    const { x, y } = this.local(e);
    this.pointer.x = x;
    this.pointer.y = y;
  }

  pointerUp(e) {
    if (!this.pointer || e.pointerId !== this.pointer.id) return;
    const plate = this.held;
    const p = this.pointer;
    this.pointer = null;
    this.held = null;
    this.host.removeAttribute("data-grabbing");
    this.onGrab?.(false);
    if (!plate) return;
    const L = this.layout;
    let vx = p.vx;
    let vy = p.vy;
    const speed = Math.hypot(vx, vy);
    const cap = 40 * L.u;
    if (speed > cap) {
      vx *= cap / speed;
      vy *= cap / speed;
    }
    plate.vx = vx;
    plate.vy = vy;
    const projX = plate.x + vx * 0.08;
    const projY = plate.y + vy * 0.08;
    this.release(plate, projX, projY);
  }

  release(plate, x, y) {
    const L = this.layout;
    const origin = plate.hold?.origin ?? { ...plate.loc };
    plate.hold = null;
    const near = this.nearestSlot(x, y, 0.78) || this.nearestSlot(plate.x, plate.y, 0.7);
    let target = null;
    if (near) target = { type: "slot", key: near.slot.key };
    else if (y > L.rackTop - L.u * 0.7 && y < L.rackBottom + L.u * 0.8) {
      let best = null;
      for (const spot of L.rack) {
        const occupant = this.rackPlate.get(spot.index);
        if (occupant && occupant !== plate) continue;
        const d = Math.hypot(x - spot.x, (y - spot.y) * 0.6);
        if (!best || d < best.d) best = { spot, d };
      }
      if (best) target = { type: "rack", index: best.spot.index };
    }
    if (!target) target = origin;
    this.sendTo(plate, target, origin);
  }

  sendTo(plate, target, origin) {
    const occupant = target.type === "slot" ? this.slotPlate.get(target.key) : this.rackPlate.get(target.index);
    if (occupant && occupant !== plate) {
      this.assign(occupant, origin);
      occupant.mode = "fly";
      occupant.target = origin.type;
      occupant.vy -= this.layout.u * 4;
      occupant.va += (Math.random() - 0.5) * 2;
    }
    this.assign(plate, target);
    plate.mode = "fly";
    plate.target = target.type;
    if (this.reduced) {
      this.land(plate, 0);
      if (occupant && occupant !== plate) this.land(occupant, 0);
    }
    this.computeTotals();
    this.kick();
  }

  keyDown(e) {
    if (!this.layout) return;
    const cols = [0, 1, 2, 3, 4, 5, 6, 7, 8, COL_H, COL_E];
    let ci = cols.indexOf(this.cursor.col);
    if (ci < 0) ci = 0;
    let handled = true;
    if (e.key === "ArrowLeft") ci = Math.max(0, ci - 1);
    else if (e.key === "ArrowRight") ci = Math.min(cols.length - 1, ci + 1);
    else if (e.key === "ArrowUp") this.cursor.team = 0;
    else if (e.key === "ArrowDown") this.cursor.team = 1;
    else if (/^[0-9]$/.test(e.key)) this.placeDigit(e.key);
    else if (e.key === "Backspace" || e.key === "Delete") this.clearSlot();
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    this.cursor.col = cols[ci];
    this.keyboard = true;
    this.onStatus?.(this.describeCursor());
    this.render();
  }

  describeCursor() {
    const key = slotKey(this.cursor.team, this.cursor.col);
    const plate = this.slotPlate.get(key);
    const where = `${TEAMS[this.cursor.team].label}, ${colName(this.cursor.col)}`;
    return plate ? `${where}: ${plate.text}` : `${where}: empty`;
  }

  placeDigit(digit) {
    if (this.held) return;
    const key = slotKey(this.cursor.team, this.cursor.col);
    const current = this.slotPlate.get(key);
    if (current && current.text === digit) return;
    let plate = null;
    for (const [, p] of this.rackPlate) {
      if (p.text === digit && p.mode === "rest") {
        plate = p;
        break;
      }
    }
    if (!plate) {
      this.onStatus?.(`No ${digit} plate left on the rack`);
      return;
    }
    const origin = { ...plate.loc };
    plate.vy = -this.layout.u * 6;
    this.sendTo(plate, { type: "slot", key }, origin);
  }

  clearSlot() {
    if (this.held) return;
    const key = slotKey(this.cursor.team, this.cursor.col);
    const plate = this.slotPlate.get(key);
    if (!plate) return;
    for (const spot of this.layout.rack) {
      if (!this.rackPlate.get(spot.index)) {
        plate.vy = -this.layout.u * 3;
        this.sendTo(plate, { type: "rack", index: spot.index }, { ...plate.loc });
        this.computeTotals();
        return;
      }
    }
  }

  announce(plate) {
    const runs = [this.runsFor(0), this.runsFor(1)];
    const score = `${TEAMS[0].label} ${runs[0]}, ${TEAMS[1].label} ${runs[1]}`;
    if (!plate) {
      this.onStatus?.(`${score}, bottom of the 6th`);
      return;
    }
    const slot = this.slotOf(plate.loc.key);
    this.onStatus?.(`${TEAMS[slot.team].label} ${colName(slot.col)}: ${plate.text}. ${score}`);
  }

  plateBox(plate) {
    const L = this.layout;
    const r = Math.hypot(L.pw, L.ph) * 0.56 + 3;
    const reach = L.u * 0.85;
    return [plate.x - r, plate.y - r, plate.x + r + reach, plate.y + r + reach * 0.6];
  }

  dirtyRect() {
    const L = this.layout;
    const s = this.shake;
    if (s.x || s.y || s.vx || s.vy) return null;
    let box = null;
    const add = (b) => {
      if (!box) box = [...b];
      else {
        box[0] = Math.min(box[0], b[0]);
        box[1] = Math.min(box[1], b[1]);
        box[2] = Math.max(box[2], b[2]);
        box[3] = Math.max(box[3], b[3]);
      }
    };
    for (const plate of this.plates) {
      if (plate.mode !== "rest" || plate.moving) {
        const b = this.plateBox(plate);
        add(b);
        if (plate.prevBox) add(plate.prevBox);
        plate.prevBox = b;
      } else if (plate.prevBox) {
        add(plate.prevBox);
        plate.prevBox = null;
      }
    }
    for (let team = 0; team < 2; team += 1) {
      const total = this.totals[team];
      if (!total || (total.o === 0 && total.v === 0 && !total.flush)) continue;
      total.flush = total.o !== 0 || total.v !== 0;
      const slot = this.slotOf(slotKey(team, COL_R));
      add([slot.x - slot.w, slot.y - slot.h, slot.x + slot.w, slot.y + slot.h]);
    }
    for (const d of this.dust) {
      const r = d.size * 3 + 2;
      add([d.x - r, d.y - r, d.x + r, d.y + r]);
    }
    if (this.dustTail) {
      add(this.dustTail);
      this.dustTail = null;
    }
    if (this.dust.length) {
      let tail = null;
      for (const d of this.dust) {
        const r = d.size * 3 + 2;
        if (!tail) tail = [d.x - r, d.y - r, d.x + r, d.y + r];
        else {
          tail[0] = Math.min(tail[0], d.x - r);
          tail[1] = Math.min(tail[1], d.y - r);
          tail[2] = Math.max(tail[2], d.x + r);
          tail[3] = Math.max(tail[3], d.y + r);
        }
      }
      this.dustTail = tail;
    }
    if (!box) return { empty: true };
    const x0 = Math.max(0, Math.floor(box[0]));
    const y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(L.W, Math.ceil(box[2]));
    const y1 = Math.min(L.H, Math.ceil(box[3]));
    if (x1 <= x0 || y1 <= y0) return { empty: true };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  render(partial = false) {
    const L = this.layout;
    if (!L || !this.board) return;
    const clip = partial ? this.dirtyRect() : null;
    if (clip?.empty) return;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgb(40 70 52)";
    ctx.fillRect(0, 0, L.W, L.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    ctx.drawImage(this.board, 0, 0, L.W, L.H);

    for (let team = 0; team < 2; team += 1) this.drawTotal(team);

    const resting = [];
    const moving = [];
    for (const plate of this.plates) {
      if (plate.mode === "rest" && plate.lift < 0.01) resting.push(plate);
      else moving.push(plate);
    }
    moving.sort((a, b) => a.lift - b.lift || (a === this.held ? 1 : -1));
    for (const plate of resting) this.drawPlate(plate);
    for (const plate of moving) this.drawPlate(plate);

    if (this.keyboard && document.activeElement === this.host) {
      const slot = this.slotOf(slotKey(this.cursor.team, this.cursor.col));
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(slot.x - slot.w / 2 - 4, slot.y - slot.h / 2 - 4, slot.w + 8, slot.h + 8, 4);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalCompositeOperation = "multiply";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.light, 0, 0, L.W, L.H);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(this.glow, 0, 0, L.W, L.H);

    if (this.dust.length) {
      for (const d of this.dust) {
        const t = d.age / d.life;
        const env = Math.min(1, d.age / 0.5) * (1 - t) * (1 - t);
        const { lit, shade } = lightAt(d.x, d.y, L.W, L.H);
        const a = env * d.peak * lit * (1 - shade * 0.9) * 0.85;
        if (a < 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        const r = d.size * 3;
        ctx.drawImage(this.mote, d.x - r, d.y - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  drawTotal(team) {
    const total = this.totals[team];
    if (!total) return;
    const L = this.layout;
    const slot = this.slotOf(slotKey(team, COL_R));
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x - slot.w / 2, slot.y - slot.h / 2, slot.w, slot.h);
    ctx.clip();
    const travel = slot.h;
    const draw = (img, offset) => {
      const x = slot.x;
      const y = slot.y + L.u * 0.025 + offset * travel;
      this.drawShadow(this.shadowSharp, x + L.u * 0.15, y + L.u * 0.055, 0, 1, 0.72);
      ctx.drawImage(img.canvas, x - L.pw / 2 - img.pad, y - L.ph / 2 - img.pad, L.pw + img.pad * 2, L.ph + img.pad * 2);
    };
    if (total.prevImg) draw(total.prevImg, total.o + 1);
    draw(total.img, total.o);
    ctx.restore();
  }

  drawShadow(shadow, x, y, a, s, alpha) {
    if (alpha < 0.01) return;
    const L = this.layout;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.drawImage(shadow.canvas, -L.pw / 2 - shadow.pad, -L.ph / 2 - shadow.pad, L.pw + shadow.pad * 2, L.ph + shadow.pad * 2);
    ctx.restore();
  }

  drawPlate(plate) {
    const L = this.layout;
    const ctx = this.ctx;
    const lift = plate.lift;
    const s = 1 + 0.06 * lift;
    const dx = L.u * (0.15 + 0.5 * lift);
    const dy = L.u * (0.055 + 0.24 * lift);
    const inSlot = plate.loc.type === "slot" && plate.mode !== "held" && plate.mode !== "fly";
    if (inSlot && lift < 0.98) {
      const slot = this.slotOf(plate.loc.key);
      ctx.save();
      ctx.beginPath();
      ctx.rect(slot.x - slot.w / 2, slot.y - slot.h / 2, slot.w + L.u * 0.02, slot.h);
      ctx.clip();
      this.drawShadow(this.shadowSharp, plate.x + dx, plate.y + dy, plate.a, s, 0.72 * (1 - lift));
      ctx.restore();
    } else {
      this.drawShadow(this.shadowSharp, plate.x + dx, plate.y + dy, plate.a, s, 0.5 * (1 - lift));
    }
    this.drawShadow(this.shadowSoft, plate.x + dx, plate.y + dy, plate.a, s * 0.98, 0.58 * lift);
    ctx.save();
    ctx.translate(plate.x, plate.y);
    ctx.rotate(plate.a);
    ctx.scale(s, s);
    const img = plate.img;
    ctx.drawImage(img.canvas, -L.pw / 2 - img.pad, -L.ph / 2 - img.pad, L.pw + img.pad * 2, L.ph + img.pad * 2);
    ctx.restore();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.bakeTimer);
    this.host.removeEventListener("pointerdown", this.handlers.down);
    window.removeEventListener("pointermove", this.handlers.move);
    window.removeEventListener("pointerup", this.handlers.up);
    window.removeEventListener("pointercancel", this.handlers.up);
    this.host.removeEventListener("keydown", this.handlers.key);
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    this.plates = [];
    this.board = null;
    this.light = null;
    this.glow = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
