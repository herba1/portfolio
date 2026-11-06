// Pass 2: turn a capture into a finished clip.
//
// A headless page (compositor.html) redraws every output frame from the
// captured frames plus the timeline: the eased camera framing the piece, the
// lerped round pointer, and the fade in and out. No text, ever. Frames are
// piped straight into ffmpeg as PNG and encoded the way X, Instagram and
// TikTok want: H.264 High, yuv420p, faststart, constant frame rate.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "./playwright.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://showreel.local";

export async function compose(cap, dir, outFile, { fps = 60, reel = {}, log = () => {}, draft = false } = {}) {
  const { frames, timeline, format } = cap;
  const [W, H] = format.out;
  const tAt = (type) => timeline.find((e) => e.type === type)?.t;
  const start = tAt("start") + (reel.intro?.trim ?? 0);
  const end = tAt("end"), stop = tAt("stop");
  // Outro: let the camera settle back on the piece, then fade into its ground.
  // `outro: { fade: false }` ends on the live frame instead (for loops).
  const fades = reel.outro?.fade !== false;
  const outroStart = fades ? end + (reel.outro?.settle ?? 700) : Infinity;
  const finish = fades ? Math.min(stop, outroStart + (reel.outro?.fade ?? 700) + 150) : stop;
  const total = Math.ceil(((finish - start) / 1000) * fps);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/") return route.fulfill({ path: path.join(HERE, "compositor.html"), contentType: "text/html" });
    if (u.pathname.startsWith("/frames/")) return route.fulfill({ path: path.join(dir, u.pathname), contentType: "image/jpeg" });
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
  const cdp = await page.context().newCDPSession(page);

  // Ground colour for the fades and end card, from the settled last frame.
  const last = frames[frames.length - 1];
  const [r, g, b] = await page.evaluate((u) => window.sample(u), `${ORIGIN}/${last.file}`);
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  const look = reel.look ?? { bg: `rgb(${r},${g},${b})`, ink: dark ? "#fafafa" : "#18181b", ink2: dark ? "#a1a1aa" : "#52525b" };

  await page.evaluate((s) => window.setup(s), {
    out: [W, H], viewport: cap.viewport, dpr: cap.dpr, fps, timeline, intro: reel.intro, outro: reel.outro, look,
    cursorLag: reel.cursorLag, cursorSize: reel.cursorSize, maxBase: reel.maxBase,
  });

  const shot = draft ? { format: "jpeg", quality: 80, optimizeForSpeed: true } : { format: "png", optimizeForSpeed: true };
  const encode = draft ? ["-preset", "ultrafast", "-crf", "24"] : ["-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "4.2"];
  const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", draft ? "mjpeg" : "png", "-i", "-",
    "-c:v", "libx264", ...encode, "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", outFile], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

  const posterAt = reel.poster != null ? Math.round((reel.poster / 1000) * fps) : Math.round(total * 0.45);
  let fi = 0;
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const tOut = (i / fps) * 1000;
    const T = start + tOut;
    while (fi + 1 < frames.length && frames[fi + 1].t <= T) fi++;
    const phase = T >= outroStart ? "outro" : tOut < (reel.intro?.fade ?? 450) ? "intro" : "main";
    await page.evaluate((a) => window.render(a), { t: phase === "outro" ? T - outroStart : tOut, T, src: `${ORIGIN}/${frames[fi].file}`, phase });
    const { data } = await cdp.send("Page.captureScreenshot", shot);
    const buf = Buffer.from(data, "base64");
    if (i === posterAt && !draft) fs.writeFileSync(outFile.replace(/\.mp4$/, ".poster.png"), buf);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % fps === 0) log(`  composing ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  log(`  wrote ${outFile} (${(total / fps).toFixed(1)}s, ${W}x${H} @ ${fps}fps)`);
  return outFile;
}
