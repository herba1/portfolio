// Records one lab piece being played and measures it.
//
//   node tools/factory/probe.mjs <slug> [--tag name] [--script file.json]
//
// The gesture script comes from --script, else the manifest's `probe`, else a
// default: idle, a slow drag across the middle, idle, a tap, idle.
// Writes tools/factory/out/<slug>/<tag>/: clip.mp4, sheet.jpg (12 frames),
// metrics.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, CHROME_CSS, INIT, OUT, ROOT, VIRTUAL, frameEnergy, launch, pct, play, timeline } from "./lib.mjs";

const args = process.argv.slice(2);
const slug = args[0];
if (!slug) {
  console.error("usage: probe.mjs <slug> [--tag name] [--script file.json] [--path /route]");
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : null;
};
const tag = flag("tag") || "latest";
const route = flag("path") || `/lab/${slug}`;
const manifestFile = join(ROOT, "src/app/lab", slug, "experiment.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};

const DEFAULT = [
  { idle: 1500 },
  { drag: [[0.3, 0.45], [0.5, 0.55], [0.7, 0.45]], ms: 1600 },
  { idle: 1800 },
  { tap: [0.5, 0.5] },
  { idle: 1800 },
];
const steps = flag("script") ? JSON.parse(readFileSync(flag("script"), "utf8")) : manifest.probe || DEFAULT;

const dir = join(OUT, slug, tag);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "frames"), { recursive: true });

const browser = await launch();
const errors = [];
const watch = (page) => {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/DevTools|Fast Refresh|\[HMR\]|favicon|net::ERR_|posthog|vercel|_vercel|speed-insights/i.test(text)) return;
    errors.push(text.slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
};

// Pass A, the recording: virtual time, one screenshot per 30fps frame.
const FRAME = 1000 / 30;
const tl = timeline(steps);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
watch(page);
await page.addInitScript(VIRTUAL);
await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 120000 });
await page.addStyleTag({ content: CHROME_CSS });
const el = await page.waitForSelector(".piece-box", { timeout: 30000 });
const box = await el.boundingBox();
// Warm up: let assets arrive in real time while the clock ticks.
for (let i = 0; i < 60; i++) {
  await page.evaluate((ms) => window.__step(ms), FRAME);
  await page.waitForTimeout(25);
}
await page.waitForTimeout(400);
const frames = [];
let wasDown = false;
let lastXY = null;
const px = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
for (let k = 0; k * FRAME <= tl.total; k++) {
  const t = k * FRAME;
  const st = tl.at(t);
  if (st.xy) {
    const [x, y] = px(st.xy);
    if (!lastXY || Math.abs(lastXY[0] - x) > 0.01 || Math.abs(lastXY[1] - y) > 0.01) {
      await page.mouse.move(x, y);
      lastXY = [x, y];
    }
  }
  if (st.down && !wasDown) await page.mouse.down();
  if (!st.down && wasDown) await page.mouse.up();
  wasDown = st.down;
  await page.evaluate((ms) => window.__step(ms), FRAME);
  const buf = await page.screenshot({ type: "jpeg", quality: 85, clip: box });
  frames.push({ data: buf.toString("base64"), t });
}
if (wasDown) await page.mouse.up();

// Visible text inside the piece is a gate failure: the lab is wordless.
const text = await page.evaluate(() => {
  const root = document.querySelector(".piece-box");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.textContent.trim();
    if (!s) continue;
    const parent = n.parentElement;
    const cs = getComputedStyle(parent);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") continue;
    const r = parent.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue;
    out += s + " ";
  }
  return out.trim();
});
await page.close();

// Pass B, frame pacing: the same gestures in real time.
const live = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
watch(live);
await live.addInitScript(INIT);
await live.goto(BASE + route, { waitUntil: "networkidle", timeout: 120000 });
await live.addStyleTag({ content: CHROME_CSS });
await live.waitForTimeout(1500);
const liveBox = await (await live.waitForSelector(".piece-box")).boundingBox();
const liveMarks = await play(live, liveBox, steps);
const rafs = await live.evaluate(() => window.__frames.map((t) => t + performance.timeOrigin));
await browser.close();
const recStart = 0;
const recEnd = tl.total;
const marks = tl.segs;

// Frame analysis.
const analysis = await (async () => {
  const b = await launch();
  const e = await frameEnergy(b, frames);
  await b.close();
  return e;
})();

const rate = (from, to) => {
  const span = analysis.filter((f) => f.t > from && f.t <= to);
  const sum = span.reduce((a, f) => a + f.energy, 0);
  return sum / Math.max(0.001, (to - from) / 1000);
};
const firstIdle = marks.find((m) => m.kind === "idle");
const idleRate = firstIdle ? rate(firstIdle.start, firstIdle.end) : 0;
const active = marks.filter((m) => m.kind !== "idle");
const gestureRate = active.length ? active.reduce((a, m) => a + rate(m.start, m.end + (m.kind === "tap" ? 400 : 0)), 0) / active.length : 0;
const press = active.find((m) => m.kind === "drag" || m.kind === "tap") || active[0];
let latency = null;
if (press) {
  const idleFrames = firstIdle ? analysis.filter((f) => f.t > firstIdle.start + 200 && f.t <= firstIdle.end) : [];
  const mean = idleFrames.reduce((a, f) => a + f.energy, 0) / Math.max(1, idleFrames.length);
  const sd = Math.sqrt(idleFrames.reduce((a, f) => a + (f.energy - mean) ** 2, 0) / Math.max(1, idleFrames.length));
  const hit = analysis.find((f) => f.t >= press.start && f.energy > mean + Math.max(0.5, 2.5 * sd));
  latency = hit ? Math.round(hit.t - press.start + 33) : null;
}
const lastActive = active[active.length - 1];
let settle = null;
if (lastActive) {
  const floor = Math.max(idleRate * 1.6, 6);
  for (let t = lastActive.end; t < recEnd - 400; t += 50) {
    if (rate(t, t + 400) < floor) {
      settle = Math.round(t - lastActive.end);
      break;
    }
  }
}
const inActive = (t) => liveMarks.some((m) => m.kind !== "idle" && t >= m.start && t <= m.end + 300);
const deltas = [];
for (let i = 1; i < rafs.length; i++) if (inActive(rafs[i])) deltas.push(rafs[i] - rafs[i - 1]);
const metrics = {
  slug,
  tag,
  route,
  at: new Date().toISOString(),
  frames: frames.length,
  seconds: (recEnd - recStart) / 1000,
  idleRate: Math.round(idleRate),
  gestureRate: Math.round(gestureRate),
  latencyMs: latency,
  settleMs: settle,
  frameP50: deltas.length ? +pct(deltas, 50).toFixed(1) : null,
  frameP95: deltas.length ? +pct(deltas, 95).toFixed(1) : null,
  longFramePct: deltas.length ? +((100 * deltas.filter((d) => d > 34).length) / deltas.length).toFixed(1) : null,
  errors,
  text,
};

// Measured score, 30 points: responsiveness, motion, pacing.
const lerp = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
const sResp = latency == null ? 0 : 10 * (1 - lerp(latency, 60, 500));
const sMotion = 6 * lerp(gestureRate, 20, 400) + (settle == null ? 0 : 4 * (1 - lerp(settle, 1500, 5000)));
const sPace = metrics.frameP95 == null ? 0 : 10 * (1 - lerp(metrics.frameP95, 20, 120));
metrics.measured = { responsiveness: +sResp.toFixed(1), motion: +sMotion.toFixed(1), pacing: +sPace.toFixed(1), total: +(sResp + sMotion + sPace).toFixed(1) };
metrics.gates = {
  noErrors: errors.length === 0,
  noText: text.length === 0,
  pacing: metrics.frameP95 != null && metrics.frameP95 < 120,
};
metrics.pass = Object.values(metrics.gates).every(Boolean);

// Clip: one frame per 1/30s of virtual time.
frames.forEach((f, i) => writeFileSync(join(dir, "frames", `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(f.data, "base64")));
if (frames.length) {
  const ff = (a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a], { cwd: dir });
  ff(["-framerate", "30", "-i", "frames/f%05d.jpg", "-vf", "scale=1280:-2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "clip.mp4"]);
  // Contact sheet: twelve frames spread over the active part of the take.
  const from = (active[0]?.start ?? recStart) - 300;
  const to = Math.min(recEnd, (lastActive?.end ?? recEnd) + 1200);
  const picks = [];
  for (let k = 0; k < 12; k++) {
    const t = from + ((to - from) * k) / 11;
    let best = 0;
    frames.forEach((f, i) => {
      if (Math.abs(f.t - t) < Math.abs(frames[best].t - t)) best = i;
    });
    picks.push(best);
  }
  picks.forEach((p, k) => writeFileSync(join(dir, `s${String(k).padStart(2, "0")}.jpg`), Buffer.from(frames[p].data, "base64")));
  ff(["-i", "s%02d.jpg", "-vf", "scale=400:-2,tile=4x3:padding=4:color=white", "-frames:v", "1", "sheet.jpg"]);
  for (let k = 0; k < 12; k++) rmSync(join(dir, `s${String(k).padStart(2, "0")}.jpg`));
}
rmSync(join(dir, "frames"), { recursive: true, force: true });
writeFileSync(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify({ slug, tag, pass: metrics.pass, measured: metrics.measured, idleRate: metrics.idleRate, gestureRate: metrics.gestureRate, latencyMs: latency, settleMs: settle, frameP95: metrics.frameP95, errors: errors.length, text: text.slice(0, 80) }));
