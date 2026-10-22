// Usage: node scroll.mjs <device> <throttle> <label> [path]
// Loads the page, waits for the first screen, then scrolls the whole page
// fast down, back up fast, then slow down — the way a person flicks through
// it — and reports main-thread frame pacing, long-frame blocking, GPU
// contexts, heap and any sound that started.
import { launch, frameStats, sleep, BASE } from "./lib.mjs";
import fs from "node:fs";

const [device = "phone", throttle = "4", label = "run", path = "/experiments", dpr] = process.argv.slice(2);
import { DEVICES } from "./lib.mjs";
if (dpr) DEVICES[device].deviceScaleFactor = Number(dpr);
const { browser, page, cdp } = await launch(device, { throttle: Number(throttle) });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.goto(BASE + path, { waitUntil: "load" });
await sleep(7000);

const touch = device === "phone" || device === "android";
const vp = page.viewportSize();
async function gesture(dy, speed) {
  if (touch) {
    await cdp.send("Input.synthesizeScrollGesture", { x: vp.width / 2, y: vp.height / 2, yDistance: dy, speed, gestureSourceType: "touch", preventFling: false });
  } else {
    const steps = Math.ceil(Math.abs(dy) / 120);
    const gap = (120 / speed) * 1000;
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, Math.sign(-dy) * 120); await sleep(gap); }
  }
}
await page.mouse.move(vp.width / 2, vp.height / 2);
const height = await page.evaluate(() => document.documentElement.scrollHeight);
const windows = {};
async function pass(name, dir, speed) {
  const t0 = await page.evaluate(() => performance.now());
  const target = dir > 0 ? height : 0;
  const tStart = Date.now();
  for (let guard = 0; guard < 60 && Date.now() - tStart < 120000; guard++) {
    const y = await page.evaluate(() => scrollY);
    if ((dir > 0 && y + vp.height >= height - 4) || (dir < 0 && y <= 4)) break;
    await gesture(-dir * Math.min(2400, Math.abs(target - y)), speed);
  }
  const t1 = await page.evaluate(() => performance.now());
  windows[name] = [t0, t1];
  await sleep(1500);
}
await pass("fastDown", 1, 4000);
await pass("fastUp", -1, 4000);
await pass("slowDown", 1, 1200);
await sleep(1500);

const raw = await page.evaluate(() => ({ frames: window.__frames, loaf: window.__loaf, gl: window.__gl, audio: window.__audio, heap: performance.memory?.usedJSHeapSize }));
const out = { label, device, throttle: Number(throttle), height, gl: raw.gl, heapMB: +(raw.heap / 1048576).toFixed(1), audio: raw.audio, errors: [...new Set(errors)].slice(0, 20), windows: {} };
for (const [name, [a, b]] of Object.entries(windows)) {
  const loaf = raw.loaf.filter((l) => l.start >= a && l.start <= b);
  out.windows[name] = { ms: Math.round(b - a), ...frameStats(raw.frames, a, b), loafBlockMs: Math.round(loaf.reduce((s, l) => s + l.block, 0)), loafCount: loaf.length };
}
const all = Object.values(windows);
const aLoaf = raw.loaf.filter((l) => all.some(([a, b]) => l.start >= a && l.start <= b)).sort((x, y) => y.dur - x.dur).slice(0, 12);
out.worstLoaf = aLoaf;
out.loafAll = raw.loaf.filter((l) => all.some(([a, b]) => l.start >= a && l.start <= b));
const totals = Object.values(out.windows).reduce((s, w) => ({ frames: s.frames + w.frames, dropped: s.dropped + w.dropped, block: s.block + w.loafBlockMs }), { frames: 0, dropped: 0, block: 0 });
out.totals = totals;
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(`results/scroll-${label}-${device}-x${throttle}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ label, device, throttle, totals, windows: out.windows, gl: out.gl, heapMB: out.heapMB, audio: out.audio.length, errors: out.errors.length }, null, 1));
await browser.close();
