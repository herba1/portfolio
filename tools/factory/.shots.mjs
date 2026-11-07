import { launch, BASE, CHROME_CSS } from "./lib.mjs";
const b = await launch();
for (const r of process.argv.slice(2)) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await p.goto(BASE + r, { waitUntil: "networkidle", timeout: 90000 });
    await p.addStyleTag({ content: CHROME_CSS });
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `/tmp/claude-0/anchors/${r.replace(/\//g, "_")}.jpg`, quality: 85 });
  } catch (e) { console.log(r, e.message.slice(0, 80)); }
  await p.close();
}
await b.close();
