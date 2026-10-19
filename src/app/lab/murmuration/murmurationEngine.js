import { createFlock } from "./murmurationFlock";
import { paintLand, paintSky, skyColorAt } from "./murmurationSky";

const CAMERA = 700;
const INK = [34, 27, 42];
const DEPTH_BINS = 4;
const BATCHES = 3;

const HAWK_SHAPE = [
  [0.44, 0],
  [0.36, 0.05],
  [0.24, 0.1],
  [0.2, 0.42],
  [0.12, 0.76],
  [0.03, 0.98],
  [-0.06, 1],
  [-0.03, 0.9],
  [-0.12, 0.9],
  [-0.08, 0.8],
  [-0.17, 0.76],
  [-0.13, 0.66],
  [-0.21, 0.58],
  [-0.21, 0.32],
  [-0.15, 0.12],
  [-0.3, 0.1],
  [-0.58, 0.19],
  [-0.66, 0.07],
];

const damp = (from, to, lambda, dt) => from + (to - from) * (1 - Math.exp(-lambda * dt));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class MurmurationEngine {
  constructor({ sky, flock, land, box, embedded = false, onReady }) {
    this.skyCanvas = sky;
    this.canvas = flock;
    this.landCanvas = land;
    this.box = box;
    this.embedded = embedded;
    this.ctx = flock.getContext("2d");
    this.rand = mulberry(3);
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.time = 0;
    this.visible = true;
    this.inView = true;
    this.raf = 0;
    this.last = 0;
    this.pointer = null;
    this.keys = { x: 0, y: 0 };
    this.idle = embedded ? 3.2 : 4.5;
    this.patrol = null;
    this.glide = null;
    this.hawk = { x: -200, y: -200, vx: 0, vy: 0, heading: 0, active: 0, phase: 0, shown: 0 };
    this.batches = Array.from({ length: DEPTH_BINS * BATCHES }, () => []);
    this.colors = [];

    const count = this.pickCount();
    this.flock = createFlock(count, 11);
    for (let i = 0; i < 300; i += 1) this.flock.step(1 / 60);

    this.loop = this.loop.bind(this);
    this.onVisibility = () => {
      this.visible = document.visibilityState !== "hidden";
      this.wake();
    };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.io = new IntersectionObserver(([entry]) => {
      this.inView = entry.isIntersecting;
      this.wake();
    });
    this.io.observe(box);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(box);
    this.resize();
    this.render(0);
    onReady?.();
    this.wake();
  }

  pickCount() {
    const rect = this.box.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (this.embedded) return 1300;
    if (area < 500000) return 1300;
    return 2800;
  }

  resize() {
    const rect = this.box.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    const portrait = height > width * 1.1;
    this.horizon = portrait ? 0.92 : 0.915;
    this.viewHalf = portrait ? (300 * height) / width : Math.max(330, (420 * height) / width);
    this.focal = ((height * 0.5) / this.viewHalf) * CAMERA;
    this.centreY = height * (portrait ? 0.46 : 0.44);
    this.birdSize = portrait ? 3.8 : 2.6;
    this.flock.centre.ySquash = portrait ? 1.1 : 1.4;
    this.flock.centre.reach = portrait ? 110 : 200;
    this.flock.centre.wave = portrait ? 30 : 40;
    this.wander = portrait ? 0.04 : 0.28;
    paintSky(this.skyCanvas, width, height, this.horizon);
    paintLand(this.landCanvas, width, height, this.dpr, this.horizon);
    this.colors = [];
    for (let d = 0; d < DEPTH_BINS; d += 1) {
      const haze = skyColorAt(0.5);
      const t = (d / (DEPTH_BINS - 1)) * 0.34;
      const c = INK.map((v, i) => Math.round(v + (haze[i] - v) * t));
      this.colors.push(`rgb(${c[0]} ${c[1]} ${c[2]} / ${0.96 - d * 0.06})`);
    }
    this.render(0);
  }

  toWorld(sx, sy) {
    const k = this.focal / CAMERA;
    return { x: (sx - this.width / 2) / k, y: -(sy - this.centreY) / k };
  }

  pointerMove(x, y, kind) {
    this.pointer = { x, y, kind };
    this.patrol = null;
    this.idle = 0;
    if (this.hawk.shown < 0.05) {
      this.hawk.x = x;
      this.hawk.y = y;
      this.hawk.vx = 0;
      this.hawk.vy = 0;
    }
    this.wake();
  }

  pointerLeave() {
    if (this.pointer) {
      const hawk = this.hawk;
      const speed = Math.hypot(hawk.vx, hawk.vy);
      const heading = speed > 40 ? Math.atan2(hawk.vy, hawk.vx) : hawk.heading;
      const glide = Math.max(260, speed * 0.9);
      this.glide = { x: hawk.x + Math.cos(heading) * glide, y: hawk.y + Math.sin(heading) * glide - 40 };
    }
    this.pointer = null;
    this.idle = 0;
  }

  nudge(dx, dy) {
    if (!this.pointer) {
      const x = this.hawk.shown > 0.2 ? this.hawk.x : this.width * 0.5;
      const y = this.hawk.shown > 0.2 ? this.hawk.y : this.centreY;
      this.pointer = { x, y, kind: "key" };
      this.hawk.x = x;
      this.hawk.y = y;
    }
    this.patrol = null;
    this.idle = 0;
    this.pointer.x = Math.max(0, Math.min(this.width, this.pointer.x + dx));
    this.pointer.y = Math.max(0, Math.min(this.height, this.pointer.y + dy));
    this.wake();
  }

  stoop() {
    this.pointer = null;
    this.startPatrol();
  }

  startPatrol() {
    const fromLeft = this.rand() < 0.5;
    const w = this.width;
    const h = this.height;
    const cy = this.centreY;
    const startX = fromLeft ? -60 : w + 60;
    const endX = fromLeft ? w + 60 : -60;
    const bend = (this.rand() - 0.5) * h * 0.3;
    this.patrol = {
      t: 0,
      duration: 4.2 + this.rand() * 1.2,
      points: [
        [startX, cy - h * 0.26 + bend * 0.4],
        [w * (fromLeft ? 0.35 : 0.65), cy + bend * 0.5],
        [w * (fromLeft ? 0.62 : 0.38), cy - bend * 0.3],
        [endX, cy - h * 0.2 - bend * 0.2],
      ],
    };
    if (this.hawk.shown < 0.05) {
      this.hawk.x = startX;
      this.hawk.y = this.patrol.points[0][1];
    }
    this.idle = 0;
    this.wake();
  }

  patrolPoint(u) {
    const [a, b, c, d] = this.patrol.points;
    const v = 1 - u;
    return [
      v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0],
      v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1],
    ];
  }

  wake() {
    const running = this.visible && this.inView;
    if (running && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    } else if (!running && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  loop(now) {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render(dt);
    if (this.visible && this.inView) this.raf = requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const flock = this.flock;
    const halfWidth = (this.width / 2) / (this.focal / CAMERA);
    flock.centre.t = t;
    flock.centre.x = Math.sin(t * 0.043) * halfWidth * this.wander + Math.sin(t * 0.11 + 1.7) * halfWidth * 0.08;
    flock.centre.y = Math.sin(t * 0.07 + 0.4) * 26 + Math.sin(t * 0.19) * 8;
    flock.centre.z = Math.sin(t * 0.05 + 2.1) * 120;

    const hawk = this.hawk;
    let target = null;
    let leaving = false;
    if (this.pointer) {
      target = [this.pointer.x, this.pointer.y];
      this.glide = null;
    } else if (this.glide && hawk.shown > 0.02) {
      target = [this.glide.x, this.glide.y];
      leaving = true;
    } else if (this.patrol) {
      this.patrol.t += dt / this.patrol.duration;
      const u = Math.min(1, this.patrol.t);
      const eased = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      target = this.patrolPoint(0.15 * u + 0.85 * eased);
      if (this.patrol.t >= 1) this.patrol = null;
    } else {
      this.glide = null;
      this.idle += dt;
      if (this.idle > (this.embedded ? 5 : 9)) this.startPatrol();
    }

    const prevX = hawk.x;
    const prevY = hawk.y;
    if (target) {
      const lambda = leaving ? 1.6 : this.pointer?.kind === "touch" ? 9 : 6.5;
      hawk.x = damp(hawk.x, target[0], lambda, dt);
      hawk.y = damp(hawk.y, target[1], lambda, dt);
    }
    hawk.vx = damp(hawk.vx, (hawk.x - prevX) / dt, 10, dt);
    hawk.vy = damp(hawk.vy, (hawk.y - prevY) / dt, 10, dt);
    const speed = Math.hypot(hawk.vx, hawk.vy);
    if (speed > 30) {
      const want = Math.atan2(hawk.vy, hawk.vx);
      let d = want - hawk.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      hawk.heading += d * (1 - Math.exp(-dt * 7));
    }
    const onStage = hawk.x > -40 && hawk.x < this.width + 40 && hawk.y > -40 && hawk.y < this.height + 40;
    const present = Boolean(target) && onStage && !leaving;
    hawk.shown = damp(hawk.shown, present ? 1 : 0, present ? 8 : 3, dt);
    hawk.active = hawk.shown;
    hawk.phase += dt * (5 + Math.max(0, 1 - speed / 400) * 9);

    const world = this.toWorld(hawk.x, hawk.y);
    flock.hawk.x = world.x;
    flock.hawk.y = world.y;
    flock.hawk.active = hawk.active;
    flock.step(dt);
  }

  render() {
    const ctx = this.ctx;
    const flock = this.flock;
    const { width, height, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const k0 = this.focal;
    const cx = width / 2;
    const cy = this.centreY;
    const size = this.birdSize;
    const batches = this.batches;
    for (const b of batches) b.length = 0;

    const { px, py, pz, vx, vy, vz, phase, panic, bank, count } = flock;
    const out = this.points ?? (this.points = new Float32Array(count * 10));
    for (let i = 0; i < count; i += 1) {
      const depth = CAMERA - pz[i];
      if (depth < 60) continue;
      const k = k0 / depth;
      const sx = cx + px[i] * k;
      const sy = cy - py[i] * k;
      if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20) continue;
      const bx = vx[i];
      const by = vy[i];
      const bz = vz[i];
      const vl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const fx = bx / vl;
      const fy = by / vl;
      const fz = bz / vl;
      const hl = Math.sqrt(fx * fx + fz * fz) || 1;
      let wx = -fz / hl;
      let wy = 0;
      let wz = fx / hl;
      const ux = fy * wz - fz * wy;
      const uy = fz * wx - fx * wz;
      const uz = fx * wy - fy * wx;
      const b = bank[i] * 0.9;
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      const rwx = wx * cb + ux * sb;
      const rwy = wy * cb + uy * sb;
      const rwz = wz * cb + uz * sb;
      const rux = ux * cb - wx * sb;
      const ruy = uy * cb - wy * sb;
      wx = rwx;
      wy = rwy;
      wz = rwz;
      const flap = Math.sin(phase[i]);
      const s = size * k * (1 + panic[i] * 0.3);
      const span = s * (0.9 + 0.1 * Math.abs(flap));
      const lift = flap * s * 0.42;
      const len = s * 0.62;
      const o = i * 10;
      out[o] = sx + fx * len * 0.55;
      out[o + 1] = sy - fy * len * 0.55;
      out[o + 2] = sx - fx * len * 0.45;
      out[o + 3] = sy + fy * len * 0.45;
      const tipBackX = -fx * len * 0.5;
      const tipBackY = fy * len * 0.5;
      const sl = Math.hypot(fx, fy) || 1;
      const nxp = (-fy / sl) * 0.7;
      const nyp = (-fx / sl) * 0.7;
      out[o + 4] = sx + wx * span + rux * lift + tipBackX + nxp;
      out[o + 5] = sy - wy * span - ruy * lift + tipBackY + nyp;
      out[o + 6] = sx - wx * span + rux * lift + tipBackX - nxp;
      out[o + 7] = sy + wy * span - ruy * lift + tipBackY - nyp;
      out[o + 8] = sx;
      out[o + 9] = sy;
      const bin = Math.min(DEPTH_BINS - 1, Math.max(0, Math.floor(((pz[i] + 200) / 400) * DEPTH_BINS)));
      batches[(DEPTH_BINS - 1 - bin) * BATCHES + (i % BATCHES)].push(i);
    }

    for (let d = DEPTH_BINS - 1; d >= 0; d -= 1) {
      ctx.fillStyle = this.colors[d];
      for (let j = 0; j < BATCHES; j += 1) {
        const list = batches[d * BATCHES + j];
        if (!list.length) continue;
        ctx.beginPath();
        for (let n = 0; n < list.length; n += 1) {
          const o = list[n] * 10;
          ctx.moveTo(out[o], out[o + 1]);
          ctx.lineTo(out[o + 4], out[o + 5]);
          ctx.lineTo(out[o + 2], out[o + 3]);
          ctx.lineTo(out[o + 6], out[o + 7]);
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    this.drawHawk(ctx);
  }

  drawHawk(ctx) {
    const hawk = this.hawk;
    if (hawk.shown < 0.02) return;
    const portrait = this.height > this.width * 1.1;
    const span = (portrait ? 22 : 30) * (0.7 + 0.3 * hawk.shown);
    const flap = Math.sin(hawk.phase);
    const speed = Math.hypot(hawk.vx, hawk.vy);
    const sweep = Math.min(1, speed / 900);
    ctx.save();
    ctx.translate(hawk.x, hawk.y);
    ctx.rotate(hawk.heading);
    ctx.globalAlpha = hawk.shown;
    ctx.fillStyle = `rgb(${INK[0]} ${INK[1]} ${INK[2]})`;
    ctx.beginPath();
    const lateral = 1 - Math.max(0, flap) * 0.22 * (1 - sweep) - sweep * 0.18;
    HAWK_SHAPE.forEach(([x, y], index) => {
      const wingy = y > 0.2 ? x - sweep * 0.14 * y : x;
      const px = wingy * span;
      const py = y * span * lateral;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    for (let i = HAWK_SHAPE.length - 1; i >= 0; i -= 1) {
      const [x, y] = HAWK_SHAPE[i];
      const wingy = y > 0.2 ? x - sweep * 0.14 * y : x;
      ctx.lineTo(wingy * span, -y * span * lateral);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.io.disconnect();
    this.ro.disconnect();
  }
}
