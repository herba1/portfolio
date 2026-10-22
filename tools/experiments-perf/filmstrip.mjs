// Screenshots during a cold load, every 250ms, into a strip.
import { launch, sleep, BASE, NET, DEVICES } from "./lib.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
const [device="phone", net="fast4g", thr="4", label="base"] = process.argv.slice(2);
DEVICES[device].deviceScaleFactor = 1;
const { browser, page, cdp } = await launch(device, { throttle: +thr, network: NET[net] });
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
const dir = `results/film-${label}-${device}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const frames = [];
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });
const t0 = Date.now();
cdp.on("Page.screencastFrame", async (f) => { frames.push({ t: Date.now() - t0, data: f.data }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {} });
await page.goto(BASE + "/experiments", { waitUntil: "commit" });
await sleep(9000);
await cdp.send("Page.stopScreencast");
// pick one frame per 300ms
const picks = []; for (let t = 0; t <= 9000; t += 400) { const f = [...frames].reverse().find((x) => x.t <= t); if (f) picks.push({ t, f }); }
picks.forEach(({ t, f }, i) => fs.writeFileSync(`${dir}/${String(i).padStart(2, "0")}-${t}.jpg`, Buffer.from(f.data, "base64")));
execSync(`montage -geometry 130x+2+2 -tile 11x -label '%t' -pointsize 10 ${dir}/*.jpg ${dir}.jpg`);
console.log(dir + ".jpg", frames.length);
await browser.close();
