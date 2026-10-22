// Usage: node initiator.mjs <device>  — which script requested each big chunk
import { launch, sleep, BASE } from "./lib.mjs";
const [device = "phone"] = process.argv.slice(2);
const { browser, page, cdp } = await launch(device);
await cdp.send("Network.enable");
const reqs = {};
cdp.on("Network.requestWillBeSent", (e) => { if (/chunks\/.*\.js/.test(e.request.url)) reqs[e.requestId] = { url: e.request.url.split("/").pop(), t: e.timestamp, init: (e.initiator.stack?.callFrames || []).slice(0, 4).map((f) => `${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`).join(" < ") || e.initiator.type }; });
cdp.on("Network.loadingFinished", (e) => { if (reqs[e.requestId]) reqs[e.requestId].kb = Math.round(e.encodedDataLength / 1024); });
await page.goto(BASE + "/experiments", { waitUntil: "load" });
await sleep(6000);
const live = await page.evaluate(() => [...document.querySelectorAll(".xl-live[data-live]")].map((e) => e.closest("[data-slug]").dataset.slug));
const t0 = Math.min(...Object.values(reqs).map((r) => r.t));
for (const r of Object.values(reqs).sort((a, b) => a.t - b.t)) if ((r.kb || 0) > 20) console.log(String(Math.round((r.t - t0) * 1000)).padStart(6), String(r.kb).padStart(5) + "k", r.url, "<=", r.init);
console.log("live:", live.join(" "));
await browser.close();
