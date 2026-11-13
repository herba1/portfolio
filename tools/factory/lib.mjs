// Shared plumbing for the experiment factory: finding a browser, the gesture
// player, and the frame analysis that turns a recording into numbers.
import { execSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BASE = process.env.BASE || "http://localhost:3000";
export const ROOT = new URL("../../", import.meta.url).pathname;
export const OUT = process.env.FACTORY_OUT || join(ROOT, "tools/factory/out");

// Software GL by default, so numbers compare across machines without a GPU.
// GPU=native leaves the browser on the real GPU.
const SOFT_GPU = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=swiftshader"];

export async function chromium() {
  for (const id of ["playwright", "playwright-core"]) {
    try {
      return (await import(id)).chromium;
    } catch {}
  }
  const root = execSync("npm root -g").toString().trim();
  return (await import(pathToFileURL(join(root, "playwright", "index.mjs")).href)).chromium;
}

export async function launch() {
  const c = await chromium();
  return c.launch({ args: process.env.GPU === "native" ? [] : SOFT_GPU });
}

// Instrumentation injected before any page script: a frame clock and the
// times of every pointer event the page sees.
export const INIT = `(() => {
  const w = window;
  w.__frames = []; w.__input = [];
  const tick = (t) => { w.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  for (const type of ["pointerdown", "pointerup"]) addEventListener(type, (e) => w.__input.push({ type, t: e.timeStamp }), true);
})();`;

// Virtual time: the page's frame clock and performance.now only move when
// the probe steps them, so every recording is frame-exact on any machine.
export const VIRTUAL = `(() => {
  const w = window;
  let now = performance.now();
  const realNow = performance.now.bind(performance);
  performance.now = () => now;
  let id = 0;
  let queue = new Map();
  w.requestAnimationFrame = (cb) => { queue.set(++id, cb); return id; };
  w.cancelAnimationFrame = (i) => { queue.delete(i); };
  w.__step = (ms) => {
    now += ms;
    const run = queue; queue = new Map();
    for (const cb of run.values()) { try { cb(now); } catch (e) { console.error(e); } }
    return now;
  };
  w.__realNow = realNow;
})();`;

// Hide everything but the piece: site chrome, the piece's own heading.
export const CHROME_CSS = `
  body > *:not(:has(.piece-box)) { display: none !important; }
  nav, header, footer, [data-site-chrome] { display: none !important; }
  * { cursor: none !important; }
`;

// A hand starts quickly and slows into place.
const ease = (t) => 1 - Math.pow(1 - t, 2.2);

// Catmull-Rom through the given points, so a path bends instead of zig-zagging.
function along(points, t) {
  if (points.length === 1) return points[0];
  const n = points.length - 1;
  const f = Math.min(n - 1e-6, t * n);
  const i = Math.floor(f);
  const u = f - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
}

// Plays a probe script: a list of steps in fractions of the piece box.
//   { idle: ms }
//   { hover: [[x,y],...], ms }
//   { drag: [[x,y],...], ms, hold?: ms }   press at the first point, move, release
//   { tap: [x,y], hold?: ms }
// Turns a probe script into a timeline: where the pointer is and whether it
// is pressed at any time t (ms), plus the windows of each step.
export function timeline(steps) {
  const segs = [];
  let t = 0;
  for (const step of steps) {
    if (step.idle) {
      segs.push({ kind: "idle", start: t, end: t + step.idle });
      t += step.idle;
    } else if (step.tap) {
      const hold = step.hold ?? 90;
      segs.push({ kind: "tap", start: t, end: t + hold, path: [step.tap], press: true, approach: 120 });
      t += hold;
    } else {
      const ms = step.ms ?? 1200;
      const path = step.drag || step.hover;
      const hold = step.hold ?? 0;
      segs.push({ kind: step.drag ? "drag" : "hover", start: t, end: t + hold + ms, hold, path, press: !!step.drag });
      t += hold + ms;
    }
  }
  const at = (time) => {
    let last = null;
    for (const s of segs) {
      if (s.path) last = s;
      if (time < s.start || time >= s.end) continue;
      if (!s.path) break;
      if (s.kind === "tap") return { xy: s.path[0], down: true, seg: s };
      const u = Math.max(0, time - s.start - s.hold) / Math.max(1, s.end - s.start - s.hold);
      return { xy: along(s.path, ease(Math.min(1, u))), down: s.press, seg: s };
    }
    if (!last) return { xy: null, down: false };
    return { xy: last.kind === "tap" ? last.path[0] : last.path[last.path.length - 1], down: false };
  };
  return { segs, total: t, at };
}

// Returns the wall-clock windows of each step, for the analysis.
export async function play(page, box, steps) {
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
  const marks = [];
  for (const step of steps) {
    const start = Date.now();
    if (step.idle) {
      await page.waitForTimeout(step.idle);
      marks.push({ kind: "idle", start, end: Date.now() });
      continue;
    }
    if (step.tap) {
      await page.mouse.move(...at(step.tap), { steps: 4 });
      const down = Date.now();
      await page.mouse.down();
      await page.waitForTimeout(step.hold ?? 90);
      await page.mouse.up();
      marks.push({ kind: "tap", start: down, end: Date.now() });
      continue;
    }
    const path = step.drag || step.hover;
    const ms = step.ms ?? 1200;
    await page.mouse.move(...at(path[0]), { steps: 6 });
    const t0 = Date.now();
    if (step.drag) {
      await page.mouse.down();
      if (step.hold) await page.waitForTimeout(step.hold);
    }
    const begin = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - begin) / ms);
      await page.mouse.move(...at(along(path, ease(t))));
      if (t >= 1) break;
      await page.waitForTimeout(12);
    }
    if (step.drag) await page.mouse.up();
    marks.push({ kind: step.drag ? "drag" : "hover", start: t0, end: Date.now() });
  }
  return marks;
}

// Frame analysis runs in a blank page: decode each JPEG, shrink it to 160px
// wide in grey, and take the mean absolute difference from the frame before.
export async function frameEnergy(browser, frames) {
  const page = await browser.newPage();
  const out = await page.evaluate(async (list) => {
    const W = 160;
    const c = new OffscreenCanvas(W, 100);
    const g = c.getContext("2d", { willReadFrequently: true });
    let prev = null;
    const res = [];
    for (const f of list) {
      const img = await createImageBitmap(await (await fetch("data:image/jpeg;base64," + f.data)).blob());
      const H = Math.round((img.height / img.width) * W);
      c.height = H;
      g.drawImage(img, 0, 0, W, H);
      const px = g.getImageData(0, 0, W, H).data;
      const grey = new Float32Array(W * H);
      let lum = 0;
      for (let i = 0; i < W * H; i++) {
        grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        lum += grey[i];
      }
      let diff = 0;
      if (prev && prev.length === grey.length) for (let i = 0; i < grey.length; i++) diff += Math.abs(grey[i] - prev[i]);
      res.push({ t: f.t, energy: prev ? diff / grey.length : 0, lum: lum / grey.length });
      prev = grey;
    }
    return res;
  }, frames);
  await page.close();
  return out;
}

export const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
