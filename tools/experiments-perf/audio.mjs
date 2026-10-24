// Usage: node audio.mjs <device> <label>
// Audio sentinel. Every sound source a page starts (media play, oscillator,
// buffer source) is logged with the source file that started it, via source
// maps. Three phases:
//   1. idle: load and walk the page without touching anything — nothing may sound.
//   2. tap each tile in turn — any sound must come from the tapped piece.
//   3. after a tap, scroll the tile far away — its sound must stop within 1s.
import { launch, sleep, BASE, CHUNKS } from "./lib.mjs";
import { SourceMapConsumer } from "source-map";
import fs from "node:fs";

const [device = "phone", label = "run"] = process.argv.slice(2);
const D = CHUNKS;
const maps = new Map();
async function origin(stack) {
  // first frame that maps into src/app/<piece>
  for (const m of stack.matchAll(/([\w.-]+\.js):(\d+):(\d+)/g)) {
    const [, file, line, col] = m;
    if (!maps.has(file)) { try { const js = fs.readFileSync(D + file, "utf8"); const mm = js.match(/sourceMappingURL=(\S+)\s*$/); maps.set(file, await new SourceMapConsumer(JSON.parse(fs.readFileSync(D + mm[1], "utf8")))); } catch { maps.set(file, null); } }
    const c = maps.get(file); if (!c) continue;
    const p = c.originalPositionFor({ line: +line, column: +col - 1 });
    const src = (p.source || "").replace("turbopack:///[project]/", "");
    const piece = src.match(/src\/app\/(lab\/[^/]+|[^/]+)\//);
    if (piece) return { piece: "/" + piece[1], src: `${src}:${p.line}` };
  }
  return { piece: "?", src: stack.slice(0, 120) };
}
const pieceOf = (slug) => slug; // tile slugs are "/scorch", "/lab/scope" — same shape as origin().piece

const { browser, page } = await launch(device);
await page.addInitScript(() => {
  // keep the full stack for attribution, and track whether a source is still sounding
  window.__live = 0;
  const wrap = (proto, name) => { const f = proto[name]; proto[name] = function (...a) { const st = new Error().stack; window.__stacks = window.__stacks || []; window.__stacks.push({ t: performance.now(), stack: st, kind: name }); return f.apply(this, a); }; };
  for (const N of ["AudioBufferSourceNode", "OscillatorNode"]) { const C = window[N]; if (!C) continue; const s = C.prototype.start; C.prototype.start = function (...a) { if (!(window.OfflineAudioContext && this.context instanceof OfflineAudioContext)) { window.__stacks = window.__stacks || []; window.__stacks.push({ t: performance.now(), stack: new Error().stack, kind: N, ctxTime: this.context.currentTime, when: a[0] || 0 }); } return s.apply(this, a); }; }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { if (!this.muted && this.volume > 0) { window.__stacks = window.__stacks || []; window.__stacks.push({ t: performance.now(), stack: new Error().stack, kind: "media.play" }); } return play.call(this); };
});
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(4000);
const take = async () => { const s = await page.evaluate(() => { const s = window.__stacks || []; window.__stacks = []; return s; }); const out = []; for (const e of s) out.push({ kind: e.kind, t: Math.round(e.t), ...(await origin(e.stack)) }); return out; };
const mediaPlaying = () => page.evaluate(() => [...document.querySelectorAll("audio,video")].filter((m) => !m.paused && !m.muted && m.volume > 0).map((m) => m.closest("[data-slug]")?.dataset.slug || "detached"));

const report = { idle: [], taps: [], problems: [] };
const slugs = await page.evaluate(() => [...document.querySelectorAll(".xl-bento .xl-tile")].map((t) => t.dataset.slug));
// 1. idle walk
for (const slug of slugs) {
  await page.evaluate((s) => { const el = document.querySelector(`.xl-tile[data-slug="${s}"]`); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2); }, slug);
  await sleep(1200);
}
await sleep(1500);
report.idle = await take();
for (const e of report.idle) report.problems.push({ phase: "idle", ...e });
const idleMedia = await mediaPlaying();
for (const m of idleMedia) report.problems.push({ phase: "idle", kind: "media still playing", piece: m });

// 2 + 3. tap each tile, then scroll it away
const touch = device === "phone" || device === "android";
for (const slug of slugs) {
  const sel = `.xl-tile[data-slug="${slug}"]`;
  await page.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2); }, sel);
  for (let i = 0; i < 60; i++) { if (await page.evaluate((s) => !!document.querySelector(s + " .xl-live[data-live]"), sel)) break; await sleep(100); }
  await sleep(600);
  await take();
  const box = await (await page.$(sel)).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height * 0.55;
  if (touch) await page.touchscreen.tap(x, y); else { await page.mouse.move(x, y); await page.mouse.down(); await sleep(80); await page.mouse.up(); }
  await sleep(1500);
  const afterTap = await take();
  for (const e of afterTap) if (e.piece !== pieceOf(slug)) report.problems.push({ phase: "tap", tapped: slug, ...e });
  // scroll far away: to the other end of the page
  await page.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const mid = scrollY + r.top; scrollTo(0, mid > document.documentElement.scrollHeight / 2 ? 0 : document.documentElement.scrollHeight); }, sel);
  await sleep(1000);
  await take();
  await sleep(1500);
  const lingering = await take();
  const media = await mediaPlaying();
  for (const e of lingering) report.problems.push({ phase: "away", tapped: slug, ...e });
  for (const m of media) report.problems.push({ phase: "away", tapped: slug, kind: "media still playing", piece: m });
  report.taps.push({ slug, sounds: [...new Set(afterTap.map((e) => `${e.kind}@${e.piece}`))], lingering: lingering.length, media });
  console.log(slug.padEnd(22), "tap→", JSON.stringify(report.taps.at(-1).sounds), "away→", lingering.length, media.length ? "MEDIA " + media : "");
}
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(`results/audio-${label}-${device}.json`, JSON.stringify(report, null, 2));
console.log("PROBLEMS", report.problems.length);
for (const p of report.problems.slice(0, 40)) console.log(JSON.stringify(p));
await browser.close();
