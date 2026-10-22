// Usage: node tiles.mjs <device> <label> [dpr] [shots]
// Walks every tile: brings it to the middle of the screen, waits for it to go
// live, then records its frame cost alone on screen, whether it fills its box,
// whether anything in it overflows, and a screenshot.
import { launch, frameStats, sleep, BASE, DEVICES } from "./lib.mjs";
import fs from "node:fs";

const [device = "phone", label = "run", dpr, shots = "1"] = process.argv.slice(2);
if (dpr) DEVICES[device].deviceScaleFactor = Number(dpr);
const { browser, page } = await launch(device);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text().slice(0, 200)); });
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(4000);
const slugs = await page.evaluate(() => [...document.querySelectorAll(".xl-bento .xl-tile")].map((t) => t.dataset.slug));
const dir = `results/tiles-${label}-${device}`;
fs.mkdirSync(dir, { recursive: true });
const rows = [];
for (const slug of slugs) {
  const sel = `.xl-tile[data-slug="${slug}"]`;
  await page.evaluate((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2); }, sel);
  const t0 = await page.evaluate(() => performance.now());
  let liveAt = null;
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate((s) => !!document.querySelector(s + " .xl-live[data-live]"), sel)) { liveAt = (await page.evaluate(() => performance.now())) - t0; break; }
    await sleep(100);
  }
  await sleep(1200);
  const m0 = await page.evaluate(() => performance.now());
  await sleep(2500);
  const info = await page.evaluate(({ s, m0 }) => {
    const tile = document.querySelector(s);
    const box = tile.querySelector(".piece-box").getBoundingClientRect();
    const out = { box: [Math.round(box.width), Math.round(box.height)], overflow: [], canvases: [], frames: null, gl: window.__gl.created };
    // Overflow: visible elements whose box crosses the piece box, and text clipped by its own box.
    for (const el of tile.querySelectorAll(".xl-live *")) {
      if (el.closest(".xl-live__poster")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const pad = 1;
      const out1 = r.left < box.left - pad || r.right > box.right + pad || r.top < box.top - pad || r.bottom > box.bottom + pad;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const clipped = hasText && cs.overflow !== "visible" && (el.scrollWidth > el.clientWidth + 1) && cs.textOverflow !== "ellipsis";
      if ((out1 && hasText) || clipped) out.overflow.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text: el.textContent.trim().slice(0, 30), rect: [r.left - box.left, r.top - box.top, r.width, r.height].map(Math.round), clipped });
    }
    for (const c of tile.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      out.canvases.push({ css: [Math.round(r.width), Math.round(r.height)], buf: [c.width, c.height], cover: +((Math.min(r.right, box.right) - Math.max(r.left, box.left)) * (Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)) / (box.width * box.height)).toFixed(2) });
    }
    const f = window.__frames.filter((t) => t >= m0);
    const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    out.frameDeltas = d;
    out.loafBlock = Math.round(window.__loaf.filter((l) => l.start >= m0).reduce((a, l) => a + l.block, 0));
    return out;
  }, { s: sel, m0 });
  const fs2 = frameStats([0, ...info.frameDeltas].reduce((acc, x, i) => (acc.push(i ? acc[i - 1] + x : 0), acc), []));
  delete info.frameDeltas;
  if (shots === "1") {
    const el = await page.$(sel);
    await el.screenshot({ path: `${dir}/${slug.replace(/\//g, "_")}.png`, animations: "allow" }).catch(() => {});
  }
  const row = { slug, liveAt: liveAt == null ? null : Math.round(liveAt), ...info, frames: fs2 };
  rows.push(row);
  console.log(slug.padEnd(22), "live", String(row.liveAt).padStart(5), "p50", fs2.p50, "p95", fs2.p95, "drop", fs2.dropped, "block", info.loafBlock, "ovf", info.overflow.length, "cv", info.canvases.map((c) => c.cover + "@" + c.buf.join("x")).join(" "));
}
const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const audio = await page.evaluate(() => window.__audio);
fs.writeFileSync(`${dir}/report.json`, JSON.stringify({ rows, docOverflow, audio, errors: [...new Set(errors)] }, null, 2));
console.log("docOverflow", docOverflow, "audio", audio.length, "errors", [...new Set(errors)].length);
await browser.close();
