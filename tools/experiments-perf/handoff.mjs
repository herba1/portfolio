// Usage: node handoff.mjs <device> <label> [only]
// The poster → live piece handoff, per tile. For each tile: a shot with the
// poster up, a shot ~350ms after the piece goes live (poster gone) and one
// 2.5s later. A tile whose "just live" shot is far flatter than its settled
// shot showed an empty box when the poster lifted — a flash.
import { launch, sleep, BASE, DEVICES } from "./lib.mjs";
import { PNG } from "pngjs";
import fs from "node:fs";
import { execSync } from "node:child_process";

const [device = "phone", label = "run", only = ""] = process.argv.slice(2);
DEVICES[device].deviceScaleFactor = 1;
const { browser, page } = await launch(device);
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(3000);
const dir = `results/handoff-${label}-${device}`;
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
function stats(buf) {
  const p = PNG.sync.read(buf); let s = 0, s2 = 0, n = 0;
  for (let i = 0; i < p.data.length; i += 16) { const l = 0.3 * p.data[i] + 0.59 * p.data[i + 1] + 0.11 * p.data[i + 2]; s += l; s2 += l * l; n++; }
  const m = s / n; return { mean: Math.round(m), std: Math.round(Math.sqrt(Math.max(0, s2 / n - m * m))) };
}
const slugs = (await page.evaluate(() => [...document.querySelectorAll(".xl-bento .xl-tile")].map((t) => t.dataset.slug))).filter((s) => !only || only.split(",").some((o) => s.endsWith(o)));
const rows = [];
for (const slug of slugs) {
  const sel = `.xl-tile[data-slug="${slug}"]`;
  const already = await page.evaluate((s) => !!document.querySelector(s + " .xl-live[data-live]"), sel);
  if (already) {
    // reload far away so this tile mounts fresh: jump to the opposite end, wait for eviction is unreliable — reload instead
    await page.goto(BASE + "/experiments", { waitUntil: "load" });
    await sleep(1500);
  }
  await page.evaluate((s) => { window.__liveAt = 0; const el = document.querySelector(s); const live = el.querySelector(".xl-live"); new MutationObserver(() => { if (live.hasAttribute("data-live") && !window.__liveAt) window.__liveAt = performance.now(); }).observe(live, { attributes: true }); const r = el.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2); }, sel);
  await sleep(150);
  const el = await page.$(sel);
  const posterShot = await el.screenshot();
  let liveAt = 0;
  for (let i = 0; i < 200 && !liveAt; i++) { liveAt = await page.evaluate(() => window.__liveAt); if (!liveAt) await sleep(30); }
  if (!liveAt) { rows.push({ slug, error: "never live" }); console.log(slug, "never live"); continue; }
  const now = await page.evaluate(() => performance.now());
  await sleep(Math.max(0, 350 - (now - liveAt)));
  const early = await el.screenshot();
  await sleep(2500);
  const late = await el.screenshot();
  const name = slug.replace(/\//g, "_");
  fs.writeFileSync(`${dir}/${name}-1poster.png`, posterShot);
  fs.writeFileSync(`${dir}/${name}-2early.png`, early);
  fs.writeFileSync(`${dir}/${name}-3late.png`, late);
  const s = { poster: stats(posterShot), early: stats(early), late: stats(late) };
  const flat = s.late.std > 12 && s.early.std < s.late.std * 0.45;
  rows.push({ slug, ...s, flat });
  console.log(slug.padEnd(22), JSON.stringify(s), flat ? "  <-- FLASH" : "");
}
fs.writeFileSync(`${dir}/report.json`, JSON.stringify(rows, null, 2));
try { execSync(`montage -geometry 120x150+2+2 -tile 12x -label '%t' -pointsize 8 ${dir}/*.png ${dir}.jpg`); } catch {}
console.log("flashes:", rows.filter((r) => r.flat).map((r) => r.slug).join(" ") || "none");
await browser.close();
