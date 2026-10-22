// Every synchronous GPU round trip, per tile, across a walk down the whole page.
import { launch, sleep, BASE, DEVICES } from "./lib.mjs";
import fs from "node:fs";
const [device = "phone", label = "run", dpr = "1"] = process.argv.slice(2);
DEVICES[device].deviceScaleFactor = Number(dpr);
const { browser, page } = await launch(device);
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(6000);
const H = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < H; y += 350) { await page.evaluate((y) => scrollTo(0, y), y); await sleep(900); }
const s = await page.evaluate(() => window.__sync);
const rows = Object.entries(s).filter(([k, v]) => !/ (compileShader|getContext|texImage2D|texSubImage2D|linkProgram)$/.test(k) || v.ms > 15).sort((a, b) => b[1].ms - a[1].ms);
console.log(rows.slice(0, 60).map(([k, v]) => `${v.ms.toFixed(0).padStart(6)}ms ${String(v.n).padStart(6)}x  ${k}`).join("\n"));
fs.writeFileSync(`results/syncs-${label}-${device}.json`, JSON.stringify(s, null, 1));
await browser.close();
