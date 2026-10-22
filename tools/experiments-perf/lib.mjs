import { chromium } from "playwright-core";

// CHROME: a browser binary; CHANNEL=chrome uses the installed Google Chrome.
// GPU=native leaves Chrome on the machine's real GPU; the default emulates one
// in software (SwiftShader) for machines without a GPU, where GPU work is
// many times slower than any phone and timings are only good for comparison.
export const CHROME = process.env.CHROME || undefined;
const SOFT_GPU = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-gpu-rasterization", "--enable-gpu-compositing"];
export const BASE = process.env.BASE || "http://prod.test:3100";
// The build's chunks and source maps, for attributing work to source files.
export const CHUNKS = process.env.CHUNKS || new URL("../../.next/static/chunks/", import.meta.url).pathname;

export const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" },
  // Mid Android: DPR 2.625 like a Pixel, used for the throttled runs
  android: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  laptop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

// Instrumentation injected before any page script: frame clock, long
// animation frames, WebGL context count, and every way a page makes sound.
export const INIT = `(() => {
  const w = window;
  w.__frames = []; w.__loaf = []; w.__gl = { created: 0, lost: 0 }; w.__audio = []; w.__gesture = [];
  const tick = (t) => { w.__frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__loaf.push({ start: e.startTime, dur: e.duration, block: e.blockingDuration, scripts: (e.scripts||[]).map(s => ({ src: (s.sourceURL||'').split('/').pop(), fn: s.sourceFunctionName, pos: s.sourceCharPosition, inv: s.invoker, dur: Math.round(s.duration), fl: Math.round(s.forcedStyleAndLayoutDuration||0) })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}

  w.__draws = {};
  const slugOfCanvas = (c) => { if (!c || !c.closest) return 'offdom'; if (c.__slug) return c.__slug; const t = c.closest('[data-slug]'); const s = t ? t.dataset.slug : (c.isConnected ? location.pathname : 'detached'); if (t) c.__slug = s; return s; };
  const count = (proto, names, kind) => { if (!proto) return; for (const n of names) { const f = proto[n]; if (!f) continue; proto[n] = function (...a) { const k = slugOfCanvas(this.canvas) + ' ' + kind; w.__draws[k] = (w.__draws[k] || 0) + 1; return f.apply(this, a); }; } };
  count(w.WebGLRenderingContext && WebGLRenderingContext.prototype, ['drawArrays','drawElements'], 'gl');
  count(w.WebGL2RenderingContext && WebGL2RenderingContext.prototype, ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'], 'gl');
  count(w.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['drawImage','putImageData','fillRect','fill','stroke','fillText'], '2d');

  w.__sync = {};
  const timeit = (proto, names, kind) => { if (!proto) return; for (const n of names) { const f = proto[n]; if (!f) continue; proto[n] = function (...a) { const t = performance.now(); const r = f.apply(this, a); const k = slugOfCanvas(this.canvas) + ' ' + n; const e = w.__sync[k] || (w.__sync[k] = { n: 0, ms: 0 }); e.n++; e.ms += performance.now() - t; return r; }; } };
  const SYNC = ['getError','checkFramebufferStatus','getProgramParameter','getShaderParameter','readPixels','finish','getBufferSubData','clientWaitSync','getShaderInfoLog','getProgramInfoLog','linkProgram','compileShader','texImage2D','texSubImage2D','getContext'];
  timeit(w.WebGLRenderingContext && WebGLRenderingContext.prototype, SYNC, 'gl');
  timeit(w.WebGL2RenderingContext && WebGL2RenderingContext.prototype, SYNC, 'gl');
  timeit(w.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['getImageData'], '2d');
  const tileOf = (el) => { const t = el && el.closest && el.closest('[data-slug]'); return t ? t.dataset.slug : (location.pathname); };
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const had = this.__ctxType;
    const ctx = gc.call(this, type, ...rest);
    if (ctx && !had && /webgl/.test(type)) { this.__ctxType = type; w.__gl.created++; this.addEventListener('webglcontextlost', () => w.__gl.lost++); }
    return ctx;
  };
  const log = (kind, where) => w.__audio.push({ kind, where, stack: (new Error().stack||'').split('\\n').slice(2,5).map(l => l.trim().replace(/https?:\\/\\/[^/]+\\/_next\\/static\\/chunks\\//,'')).join(' | '), t: performance.now(), sinceGesture: w.__lastGesture ? performance.now() - w.__lastGesture.t : null, gestureTile: w.__lastGesture?.tile ?? null });
  for (const ev of ['pointerdown','keydown','touchstart']) addEventListener(ev, (e) => { w.__lastGesture = { t: performance.now(), tile: tileOf(e.target) }; w.__gesture.push(w.__lastGesture); }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { if (!this.muted && this.volume > 0) log('media.play', tileOf(this.isConnected ? this : null)); return play.call(this); };
  for (const N of ['AudioBufferSourceNode','OscillatorNode','ConstantSourceNode']) {
    const C = w[N]; if (!C) continue; const s = C.prototype.start;
    C.prototype.start = function (...a) { if (!(w.OfflineAudioContext && this.context instanceof OfflineAudioContext)) log(N + '.start', null); return s.apply(this, a); };
  }
  const AC = w.AudioContext;
  if (AC) { const r = AC.prototype.resume; AC.prototype.resume = function () { log('ctx.resume', null); return r.call(this); }; }
})();`;

export async function launch(deviceName, { throttle = 1, network = null } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    channel: process.env.CHANNEL,
    headless: !process.env.HEADED,
    args: [...(process.env.GPU === "native" ? ["--ignore-gpu-blocklist"] : SOFT_GPU), "--autoplay-policy=no-user-gesture-required", "--host-resolver-rules=MAP prod.test 127.0.0.1", "--no-proxy-server", "--enable-features=LongAnimationFrameTiming"],
  });
  const context = await browser.newContext({ ...DEVICES[deviceName] });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  if (network) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...network });
  }
  return { browser, context, page, cdp };
}

export const NET = {
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast4g: { latency: 40, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
};

export function frameStats(frames, from = 0, to = Infinity) {
  const f = frames.filter((t) => t >= from && t <= to);
  const d = [];
  for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
  const budget = 1000 / 60;
  let dropped = 0;
  for (const x of d) dropped += Math.max(0, Math.round(x / budget) - 1);
  const sorted = [...d].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
  return { frames: d.length, dropped, p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), p99: +pct(0.99).toFixed(1), max: +(sorted.at(-1) ?? 0).toFixed(1), over50: d.filter((x) => x > 50).length };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
