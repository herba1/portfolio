// Usage: node load.mjs <device> <net: slow4g|fast4g|none> <throttle> <label> [runs]
// Cold load of /experiments. Reports TTFB, FCP, LCP, when the first-screen
// posters painted, when each first-screen tile went live, main-thread
// blocking until then, and bytes by type.
import { launch, sleep, BASE, NET } from "./lib.mjs";
import fs from "node:fs";

const [device = "phone", net = "fast4g", throttle = "4", label = "run", runs = "3"] = process.argv.slice(2);
const results = [];
for (let r = 0; r < Number(runs); r++) {
  const { browser, page, cdp } = await launch(device, { throttle: Number(throttle), network: net === "none" ? null : NET[net] });
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const bytes = {}; const reqs = [];
  cdp.on("Network.responseReceived", (e) => reqs.push({ id: e.requestId, url: e.response.url, type: e.type, t: e.timestamp }));
  cdp.on("Network.loadingFinished", (e) => { const q = reqs.find((x) => x.id === e.requestId); if (q) { q.bytes = e.encodedDataLength; q.end = e.timestamp; } });
  await page.addInitScript(() => {
    window.__lcp = 0; window.__fcp = 0; window.__live = {}; window.__mounted = {}; window.__hyd = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__fcp = e.startTime; }).observe({ type: "paint", buffered: true });
    const mo = new MutationObserver(() => { for (const el of document.querySelectorAll(".xl-live")) { const s = el.closest("[data-slug]")?.dataset.slug; if (s && !window.__mounted[s] && el.children.length > 1) window.__mounted[s] = performance.now(); } for (const el of document.querySelectorAll(".xl-live[data-live]")) { const s = el.closest("[data-slug]")?.dataset.slug; if (s && !window.__live[s]) window.__live[s] = performance.now(); } });
    document.addEventListener("DOMContentLoaded", () => mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-live"], childList: true }));
  });
  const t0 = Date.now();
  await page.goto(BASE + "/experiments", { waitUntil: "load", timeout: 120000 });
  const vh = page.viewportSize().height;
  // first-screen tiles = intersecting the first viewport
  const first = await page.evaluate((vh) => [...document.querySelectorAll(".xl-tile")].filter((t) => t.getBoundingClientRect().top < vh).map((t) => t.dataset.slug), vh);
  for (let i = 0; i < 300; i++) { const done = await page.evaluate((f) => f.every((s) => window.__live[s]), first); if (done) break; await sleep(100); }
  await sleep(1500);
  const m = await page.evaluate((f) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const posters = performance.getEntriesByType("resource").filter((e) => e.name.includes("/posters/"));
    const allLive = Math.max(...f.map((s) => window.__live[s] || Infinity));
    const block = window.__loaf.filter((l) => l.start < allLive).reduce((a, l) => a + l.block, 0);
    return { ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fcp: window.__fcp, lcp: window.__lcp, live: Object.fromEntries(f.map((s) => [s, Math.round(window.__live[s] || -1)])), mounted: Object.fromEntries(f.map((s) => [s, Math.round(window.__mounted[s] || -1)])), chunks: performance.getEntriesByType("resource").filter((e) => e.name.includes("/chunks/") && e.name.endsWith(".js")).map((e) => [Math.round(e.startTime), Math.round(e.responseEnd)]).sort((a, b) => b[1] - a[1]).slice(0, 3), allLive, blockUntilLive: block, posterEnd: Math.max(0, ...posters.map((p) => p.responseEnd)), longest: Math.max(0, ...window.__loaf.filter((l) => l.start < allLive).map((l) => l.dur)) };
  }, first);
  for (const q of reqs) { const k = q.type === "Script" ? "js" : q.type === "Image" ? "img" : q.type === "Stylesheet" ? "css" : q.type === "Document" ? "html" : q.type.toLowerCase(); bytes[k] = (bytes[k] || 0) + (q.bytes || 0); }
  const navStart = reqs.find((q) => q.type === "Document")?.t ?? 0;
  const jsBeforeLive = reqs.filter((q) => q.type === "Script" && q.end && (q.end - navStart) * 1000 < m.allLive).reduce((a, q) => a + (q.bytes || 0), 0);
  const row = { run: r, first, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v])), kb: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)])), jsKbBeforeLive: Math.round(jsBeforeLive / 1024), requests: reqs.length };
  results.push(row);
  console.log(JSON.stringify(row));
  await browser.close();
}
const med = (k) => { const v = results.map((r) => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
const summary = { label, device, net, throttle, ttfb: med("ttfb"), fcp: med("fcp"), lcp: med("lcp"), posterEnd: med("posterEnd"), allLive: med("allLive"), blockUntilLive: med("blockUntilLive"), longest: med("longest"), jsKbBeforeLive: med("jsKbBeforeLive"), kb: results[0].kb };
console.log("MEDIAN", JSON.stringify(summary));
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(`results/load-${label}-${device}-${net}-x${throttle}.json`, JSON.stringify({ summary, results }, null, 2));
