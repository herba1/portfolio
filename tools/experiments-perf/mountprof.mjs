// Usage: node mountprof.mjs <device> <label> [throttle] [only-slug-substring]
// Per tile: CPU-profiles the main thread from the moment the tile is brought
// to the middle of the screen until 1s after it goes live, then 2s of steady
// state, and symbolicates self time to original source files via the build's
// source maps. Also reports the longest animation frame in each window.
import { launch, sleep, BASE, CHUNKS } from "./lib.mjs";
import { SourceMapConsumer } from "source-map";
import fs from "node:fs";

const [device = "phone", label = "run", throttle = "4", only = ""] = process.argv.slice(2);
const maps = new Map();
async function consumer(file) {
  if (maps.has(file)) return maps.get(file);
  let c = null;
  try { const js = fs.readFileSync(CHUNKS + file, "utf8"); const mm = js.match(/sourceMappingURL=(\S+)\s*$/); c = await new SourceMapConsumer(JSON.parse(fs.readFileSync(CHUNKS + (mm ? mm[1] : file + ".map"), "utf8"))); } catch {}
  maps.set(file, c);
  return c;
}
async function symbolicate(cf) {
  const file = cf.url.split("/").pop();
  if (!file || !file.endsWith(".js")) return { src: cf.url ? file : "(native)", fn: cf.functionName || "(anon)" };
  const c = await consumer(file);
  if (!c) return { src: file, fn: cf.functionName };
  const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
  const src = (p.source || file).replace(/^.*?(src\/|node_modules\/)/, "$1").replace(/^turbopack:\/\/\/\[project\]\//, "");
  return { src, fn: p.name || cf.functionName || "(anon)", line: p.line };
}
async function summarize(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  profile.samples.forEach((id, i) => { const t = (profile.timeDeltas[i] || 0) / 1000; self.set(id, (self.get(id) || 0) + t); });
  const byFile = new Map(), byFn = new Map();
  for (const [id, t] of self) {
    const cf = byId.get(id).callFrame;
    if (["(idle)", "(program)", "(garbage collector)", "(root)"].includes(cf.functionName) && !cf.url) { byFile.set(cf.functionName, (byFile.get(cf.functionName) || 0) + t); continue; }
    const s = await symbolicate(cf);
    // native callee (e.g. getProgramParameter): charge to parent's source
    let src = s.src;
    if (!cf.url) { const parent = profile.nodes.find((n) => n.children?.includes(id)); if (parent) src = (await symbolicate(parent.callFrame)).src; }
    byFile.set(src, (byFile.get(src) || 0) + t);
    let k = `${s.fn} [${s.src}${s.line ? ":" + s.line : ""}]`;
    if (!cf.url) { const parent = profile.nodes.find((n) => n.children?.includes(id)); if (parent) { const ps = await symbolicate(parent.callFrame); k = `${cf.functionName} <- ${ps.fn} [${ps.src}${ps.line ? ":" + ps.line : ""}]`; } }
    byFn.set(k, (byFn.get(k) || 0) + t);
  }
  const top = (m, n) => [...m].filter(([k]) => k !== "(idle)").sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]);
  return { files: top(byFile, 8), fns: top(byFn, 10) };
}

const { browser, page, cdp } = await launch(device, { throttle: Number(throttle) });
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(8000);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
const slugs = (await page.evaluate(() => [...document.querySelectorAll(".xl-bento .xl-tile")].map((t) => t.dataset.slug))).filter((s) => !only || only.split(',').some((o) => s.endsWith(o)));
const rows = [];
for (const slug of slugs) {
  const sel = `.xl-tile[data-slug="${slug}"]`;
  await cdp.send("Profiler.start");
  const t0 = await page.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2); return performance.now(); }, sel);
  let live = null;
  for (let i = 0; i < 150; i++) { if (await page.evaluate((s) => !!document.querySelector(s + " .xl-live[data-live]"), sel)) { live = await page.evaluate(() => performance.now()); break; } await sleep(100); }
  await sleep(1000);
  const t1 = await page.evaluate(() => performance.now());
  const { profile: mountP } = await cdp.send("Profiler.stop");
  await cdp.send("Profiler.start");
  await sleep(2000);
  const { profile: steadyP } = await cdp.send("Profiler.stop");
  const t2 = await page.evaluate(() => performance.now());
  const loaf = await page.evaluate(({ t0, t1, t2 }) => { const w = (a, b) => { const l = window.__loaf.filter((x) => x.start >= a && x.start < b); return { longest: Math.round(Math.max(0, ...l.map((x) => x.dur))), block: Math.round(l.reduce((s, x) => s + x.block, 0)), n: l.length }; }; return { mount: w(t0, t1), steady: w(t1, t2) }; }, { t0, t1, t2 });
  const busy = (p) => Math.round(p.samples.reduce((s, id, i) => { const n = p.nodes.find((x) => x.id === id); return n.callFrame.functionName === "(idle)" ? s : s + (p.timeDeltas[i] || 0) / 1000; }, 0));
  const row = { slug, liveMs: live ? Math.round(live - t0) : null, mount: { busyMs: busy(mountP), ...loaf.mount, ...(await summarize(mountP)) }, steady: { busyMsPerS: Math.round(busy(steadyP) / 2), ...loaf.steady, ...(await summarize(steadyP)) } };
  rows.push(row);
  console.log(`${slug.padEnd(22)} live ${String(row.liveMs).padStart(5)} | mount busy ${String(row.mount.busyMs).padStart(5)} longest ${String(row.mount.longest).padStart(4)} | steady busy/s ${String(row.steady.busyMsPerS).padStart(4)} longest ${String(row.steady.longest).padStart(4)}\n    mount: ${row.mount.files.slice(0, 4).map(([k, v]) => `${v} ${k}`).join(" · ")}\n    steady: ${row.steady.files.slice(0, 3).map(([k, v]) => `${v} ${k}`).join(" · ")}\n    mountFns: ${row.mount.fns.slice(0, 6).map(([k, v]) => `${v} ${k}`).join("\n              ")}\n    steadyFns: ${row.steady.fns.slice(0, 4).map(([k, v]) => `${v} ${k}`).join("\n              ")}`);
}
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(`results/mountprof-${label}-${device}-x${throttle}.json`, JSON.stringify(rows, null, 2));
await browser.close();
