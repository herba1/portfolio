import { launch, sleep, BASE, NET } from "./lib.mjs";
const [device="phone", net="fast4g", thr="4"] = process.argv.slice(2);
const { browser, page, cdp } = await launch(device, { throttle: +thr, network: NET[net] });
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await page.goto(BASE + "/experiments", { waitUntil: "load" }); await sleep(5000);
const r = await page.evaluate(() => {
  const res = performance.getEntriesByType("resource").filter(e => !e.name.includes("/__fixture")).map(e => [Math.round(e.startTime), Math.round(e.responseEnd), e.name.replace(location.origin, "").slice(0, 60), Math.round(e.transferSize/1024)]);
  const loaf = window.__loaf.filter(l => l.start < 4000).map(l => [Math.round(l.start), Math.round(l.dur), l.scripts.slice(0,2).map(s => s.inv.slice(-40) + ":" + s.dur).join(" | ")]);
  const nav = performance.getEntriesByType("navigation")[0];
  return { res, loaf, dcl: Math.round(nav.domContentLoadedEventEnd), paints: performance.getEntriesByType("paint").map(p => [p.name, Math.round(p.startTime)]) };
});
console.log("dcl", r.dcl, JSON.stringify(r.paints));
for (const x of r.res.sort((a,b)=>a[0]-b[0])) console.log("RES", x.join("  "));
for (const x of r.loaf) console.log("LOAF", x.join("  "));
await browser.close();
