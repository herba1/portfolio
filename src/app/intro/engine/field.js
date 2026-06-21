// ─────────────────────────────────────────────────────────────────────────
// GRAVITY FIELD — a reusable, framework- and renderer-agnostic motion engine.
//
// It's pure Newtonian physics and nothing else: it owns a set of particles and
// advances them under gravity. It never touches the DOM, React, or Three — it
// only mutates each particle's { x, y, vx, vy, rot, scale, age, alive }. Point
// any renderer at `field.particles` and draw them however you like:
//   • DOM   → write style.transform        (see DomLayer)
//   • R3F   → set mesh/group .position      (see SplatLayer / MeshLayer)
//   • canvas→ ctx.drawImage, etc.
//
// Coordinates are "field units" = pixels, origin top-left, y-down (DOM-native).
// 3D renderers map this to world space (flip Y, offset by half-bounds).
//
//   const field = createField({ count: 4, launch: 'side', onSpawn: (p,i)=>{…} })
//   field.resize(w, h)
//   field.step(dt)            // call once per frame from your render loop
//   field.particles           // read + draw
//   field.restart()           // replay
//   field.update({ gravity })  // live-tune; rebuilds only if count/onSpawn change
// ─────────────────────────────────────────────────────────────────────────

const rand = (a, b) => a + Math.random() * (b - a);
const srand = (a) => (Math.random() * 2 - 1) * a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutBack = (e) => {
  const c1 = 1.70158, c3 = c1 + 1, x = e - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};

export const LAUNCH_MODES = ["fountain", "side", "rain", "burst"];
export const SIDE_DIRS = ["random", "left", "right"];

export const FIELD_DEFAULTS = {
  count: 4,
  launch: "side",
  sideDir: "random",
  gravity: 2800, // px/s² downward acceleration
  power: 1700, // launch speed, px/s
  spread: 12, // lateral variance
  spin: 200, // angular velocity range, deg/s
  drag: 0.04, // air resistance, fraction/s
  stagger: 140, // ms between each particle's first launch
  scaleFx: true, // grow on entry, shrink on the way down
  entryT: 0.45, // seconds for the grow-in
  sizeMin: 84, // particle size range (px) — drives depth + offscreen margin
  sizeMax: 196,
  loop: false, // respawn after exit, or fire once
  onSpawn: null, // (particle, i) => void — attach appearance/data here
};

export function createField(config = {}) {
  let cfg = { ...FIELD_DEFAULTS, ...config };
  let bounds = { w: config.width || 1280, h: config.height || 800 };
  let particles = [];

  function makeParticle(i) {
    const depth = Math.random();
    const size = Math.round(cfg.sizeMin + depth * (cfg.sizeMax - cfg.sizeMin));
    const p = {
      id: i, depth, size,
      x: 0, y: 0, vx: 0, vy: 0,
      rot: 0, vrot: 0, scale: 0, age: 0,
      alive: false, wait: (i * cfg.stagger) / 1000,
      data: null, // renderer-owned (emoji, color, asset…)
    };
    if (cfg.onSpawn) cfg.onSpawn(p, i);
    return p;
  }

  function rebuild() {
    particles = Array.from({ length: cfg.count }, (_, i) => makeParticle(i));
  }

  // Re-stagger every particle for a clean replay (keeps appearance/data).
  function restart() {
    particles.forEach((p, i) => {
      p.alive = false;
      p.age = 0;
      p.wait = (i * cfg.stagger) / 1000;
    });
  }

  // Set initial position + velocity for the chosen launch mode.
  function launch(p) {
    const { w: W, h: H } = bounds;
    const g = cfg.gravity;
    const big = p.size;
    p.vrot = srand(cfg.spin) * (Math.PI / 180); // deg/s → rad/s
    p.rot = srand(0.4);
    p.age = 0;

    switch (cfg.launch) {
      case "side": {
        const fromLeft =
          cfg.sideDir === "left" ? true
          : cfg.sideDir === "right" ? false
          : Math.random() < 0.5;
        p.x = fromLeft ? -big : W + big;
        p.y = rand(0.08, 0.38) * H;
        // gentle inward toss — gravity wins, it lands at the bottom
        p.vx = (fromLeft ? 1 : -1) * cfg.power * rand(0.35, 0.6);
        p.vy = -cfg.power * rand(0.05, 0.2);
        break;
      }
      case "burst": {
        p.x = W * rand(0.42, 0.58);
        p.y = H * rand(0.55, 0.72);
        const a = -Math.PI / 2 + srand(cfg.spread / 60 + 0.9);
        const speed = cfg.power * rand(0.7, 1.25);
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed;
        break;
      }
      case "rain": {
        p.x = rand(-0.02, 1.02) * W;
        p.y = -big - rand(0, 0.4) * H;
        p.vx = srand(cfg.spread * 4);
        p.vy = rand(0.1, 0.5) * cfg.power * 0.35;
        break;
      }
      case "fountain":
      default: {
        p.x = rand(0.06, 0.94) * W;
        p.y = H + big;
        const apexFrac = clamp(cfg.power / 2600, 0.25, 1.05);
        const h = apexFrac * (H + big * 0.5);
        p.vy = -Math.sqrt(2 * g * h); // real ballistics: v₀ = √(2gh)
        p.vx = srand(cfg.spread * 7);
        break;
      }
    }
    p.alive = true;
  }

  function scaleOf(p) {
    if (!cfg.scaleFx) return p.alive ? 1 : 0;
    if (!p.alive) return 0;
    const grow = 0.3 + 0.7 * easeOutBack(clamp01(p.age / cfg.entryT));
    const fall = 1 - clamp01((p.y - bounds.h * 0.4) / (bounds.h * 0.65)) * 0.55;
    return grow * fall;
  }

  // Advance the whole field by dt seconds.
  function step(dt) {
    const g = cfg.gravity;
    const k = cfg.drag > 0 ? Math.pow(1 - cfg.drag, dt) : 1;
    for (const p of particles) {
      if (!p.alive) {
        p.wait -= dt;
        if (p.wait <= 0) launch(p);
      } else {
        p.vy = (p.vy + g * dt) * k;
        p.vx *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        p.age += dt;
        const m = p.size * 1.6;
        const off = p.y - m > bounds.h || p.x + m < 0 || p.x - m > bounds.w;
        if (off && p.vy >= 0) {
          p.alive = false;
          p.wait = cfg.loop ? Math.random() * 0.45 : Infinity;
        }
      }
      p.scale = scaleOf(p);
    }
  }

  // Static scatter for prefers-reduced-motion — visible, no motion.
  function settleStatic() {
    particles.forEach((p, i) => {
      p.x = (0.12 + 0.76 * ((i * 0.3819) % 1)) * bounds.w;
      p.y = (0.2 + 0.6 * ((i * 0.618) % 1)) * bounds.h;
      p.rot = (i % 7) * 0.12 - 0.4;
      p.scale = 1;
      p.alive = true;
    });
  }

  rebuild();

  return {
    get particles() { return particles; },
    get cfg() { return cfg; },
    bounds: () => bounds,
    resize(w, h) { bounds = { w, h }; },
    step,
    restart,
    rebuild,
    settleStatic,
    // Live-tune. Rebuilds the particle set only when structure changes.
    update(partial) {
      const structural =
        ("count" in partial && partial.count !== cfg.count) ||
        ("onSpawn" in partial && partial.onSpawn !== cfg.onSpawn) ||
        ("sizeMin" in partial && partial.sizeMin !== cfg.sizeMin) ||
        ("sizeMax" in partial && partial.sizeMax !== cfg.sizeMax);
      cfg = { ...cfg, ...partial };
      if (structural) rebuild();
    },
  };
}
