// Pass 1: drive the real page through the reel's beats and record it.
//
// Frames come from the browser's own compositor (CDP screencast), each with
// the time it was painted. Every cursor sample, press, key, camera move and
// caption is written to a timeline on the same clock. Nothing is drawn on the
// page itself: the cursor, zoom and cards are added in pass 2 (compose.mjs),
// so the page under test behaves exactly as it does for a visitor.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./playwright.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const smoother = (p) => p * p * p * (p * (p * 6 - 15) + 10); // smootherstep: zero velocity and acceleration at both ends

const SOFT_GPU = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-gpu-rasterization"];

export async function capture(reel, format, dir, { base, headed = false, log = () => {} } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });

  // GPU=native uses the machine's real GPU (do this on a Mac for WebGL pieces);
  // the default emulates one in software, which works anywhere but is slow.
  const native = process.env.GPU === "native";
  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.CHANNEL || undefined,
    args: native ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : SOFT_GPU,
  });
  const vp = format.viewport;
  const context = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: format.dpr,
    colorScheme: reel.colorScheme || "light",
    reducedMotion: "no-preference",
  });
  // The site's own chrome-off mode: no nav, no footer clock, no dev tools.
  // Just the piece on its page. `chrome: true` in a reel keeps them.
  if (!reel.chrome) await context.addInitScript(() => { try { sessionStorage.setItem("herb:chrome-hidden", "1"); } catch {} });
  if (reel.storage) await context.addInitScript((s) => { for (const [k, v] of Object.entries(s)) try { localStorage.setItem(k, v); } catch {} }, reel.storage);
  // Hide dev-only chrome (the Next.js dev badge) plus anything the reel names.
  await context.addInitScript((css) => {
    const add = () => { const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add);
  }, `nextjs-portal { display: none !important; } ${reel.css ?? ""}`);
  // Recordings should not count as visits.
  await context.route(/posthog|vercel-insights|\/_vercel\/(insights|speed-insights)/, (r) => r.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const timeline = [];
  const frames = [];
  const fps = format.fps ?? 60;
  const lockstep = (reel.mode ?? "lockstep") === "lockstep";
  let pending = 0;
  const save = (t, b64) => {
    const file = `frames/${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ t: Math.round(t * 100) / 100, file });
    pending++;
    fs.writeFile(path.join(dir, file), Buffer.from(b64, "base64"), () => pending--);
  };

  // Two clocks. Lockstep (default) freezes the page's time and steps it one
  // frame at a time: timers, requestAnimationFrame, performance.now and every
  // CSS/Web animation advance exactly 1/fps per screenshot, so the clip is
  // perfectly smooth at 60fps however slow the machine renders (WebGL on a
  // software GPU included). Realtime records the screen as it paints; use it
  // for pieces driven by audio or video clocks, which cannot be frozen.
  let clock;
  if (lockstep) {
    const dt = 1000 / fps;
    let vt = 0, recording = false;
    await page.clock.install({ time: new Date("2026-01-01T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T12:00:01Z"));
    // CDP screenshots from our own session come out at 1x; ask for the
    // format's device scale explicitly so the camera has pixels to zoom into.
    const shot = { format: "jpeg", quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1 } };
    {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg" });
      const buf = Buffer.from(data, "base64");
      let w = vp.width;
      for (let i = 2; i < buf.length; i += 2 + buf.readUInt16BE(i + 2)) if (buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc2) { w = buf.readUInt16BE(i + 7); break; }
      shot.clip.scale = (vp.width * format.dpr) / w;
    }
    const frame = async () => {
      await page.clock.runFor(dt);
      await page.evaluate((dt) => {
        for (const a of document.getAnimations()) {
          if (a.playState === "finished" || a.playState === "idle") continue;
          const end = a.effect?.getComputedTiming().endTime ?? Infinity;
          if (a.playState === "running") a.pause();
          const next = (a.currentTime ?? 0) + dt * (a.playbackRate || 1);
          if (Number.isFinite(end) && next >= end) a.finish(); else a.currentTime = next;
        }
      }, dt).catch(() => {});
      vt += dt;
      if (recording) {
        const { data } = await cdp.send("Page.captureScreenshot", shot);
        save(vt, data);
      }
    };
    clock = {
      now: () => vt,
      tick: frame,
      wait: async (ms) => { const until = vt + ms; while (vt < until - 1e-6) await frame(); },
      waitFor: async (sel, timeout = 30000) => { const loc = page.locator(sel).first(); const until = Date.now() + timeout; while (!(await loc.isVisible().catch(() => false))) { if (Date.now() > until) throw new Error(`Timed out waiting for ${sel}`); await frame(); } },
      record: async () => { recording = true; },
      stop: async () => { recording = false; },
    };
  } else {
    const t0 = Date.now();
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      save(metadata.timestamp * 1000 - t0, data);
    });
    clock = {
      now: () => Date.now() - t0,
      tick: () => sleep(8),
      wait: (ms) => sleep(ms),
      waitFor: (sel, timeout = 30000) => page.locator(sel).first().waitFor({ state: "visible", timeout }),
      record: () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: vp.width * format.dpr, maxHeight: vp.height * format.dpr, everyNthFrame: 1 }),
      stop: () => cdp.send("Page.stopScreencast").catch(() => {}),
    };
  }
  const at = () => clock.now();
  const mark = (type, data = {}) => timeline.push({ t: at(), type, ...data });

  // --- cursor -----------------------------------------------------------
  const cur = { x: vp.width * (reel.cursor?.from?.[0] ?? 0.66), y: vp.height * (reel.cursor?.from?.[1] ?? 0.82), shown: false, down: false };

  const resolve = async (target, opts = {}) => {
    if (target == null || target === "cursor") return { x: cur.x, y: cur.y };
    if (Array.isArray(target)) {
      const [a, b] = target;
      return a <= 1 && b <= 1 ? { x: a * vp.width, y: b * vp.height } : { x: a, y: b };
    }
    if (typeof target === "object" && "x" in target) return target;
    const sel = typeof target === "string" ? target : target.sel;
    const within = (typeof target === "object" && target.at) || opts.at || [0.5, 0.5];
    const loc = page.locator(sel).first();
    await clock.waitFor(sel, 15000);
    const box = await loc.boundingBox();
    return { x: box.x + box.width * within[0], y: box.y + box.height * within[1] };
  };

  const show = () => { if (!cur.shown) { cur.shown = true; mark("cursor", { visible: true, x: cur.x, y: cur.y }); } };

  // An eased path on a gentle arc, like a wrist pivoting: it always bows
  // upward (or outward on a vertical move), never zig-zags. Samples follow the
  // capture clock, so a slow page never stretches the motion. The compositor
  // lerps the drawn pointer behind these samples for extra softness.
  const glide = async (to, duration = 900, arc = 0.2) => {
    show();
    const from = { x: cur.x, y: cur.y };
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const nx = -dy / dist, ny = dx / dist;
    const side = Math.abs(ny) > 0.2 ? Math.sign(-ny) : Math.sign(nx) || 1;
    const bow = arc * dist * side;
    const start = at();
    for (;;) {
      const p = Math.min(1, (at() - start) / duration);
      const e = smoother(p);
      const b = Math.sin(Math.PI * e) * bow;
      cur.x = from.x + dx * e + nx * b;
      cur.y = from.y + dy * e + ny * b;
      await page.mouse.move(cur.x, cur.y);
      mark("move", { x: +cur.x.toFixed(2), y: +cur.y.toFixed(2) });
      if (p >= 1) break;
      await clock.tick();
    }
  };
  const press = async () => { cur.down = true; mark("down", { x: cur.x, y: cur.y }); await page.mouse.down(); };
  const release = async () => { cur.down = false; mark("up", { x: cur.x, y: cur.y }); await page.mouse.up(); };

  // --- beats ------------------------------------------------------------
  const verbs = {
    wait: async (ms) => clock.wait(ms),
    waitFor: async (sel) => clock.waitFor(sel),
    move: async (target, b) => glide(await resolve(target, b), b.duration ?? 900, b.arc),
    click: async (target, b) => {
      if (target !== "cursor") await glide(await resolve(target, b), b.duration ?? 850, b.arc);
      await clock.wait(b.settle ?? 120);
      await press(); await clock.wait(b.hold ?? 160); await release();   // long enough for the press to read on screen
    },
    // Long press. `then` drags somewhere while still held (slide-to-choose).
    hold: async (target, b) => {
      if (target !== "cursor") await glide(await resolve(target, b), b.duration ?? 850, b.arc);
      await clock.wait(b.settle ?? 120);
      await press(); await clock.wait(b.press ?? 700);
      for (const step of [].concat(b.then ?? [])) { await glide(await resolve(step), b.dragDuration ?? 700, b.dragArc ?? 0.1); await clock.wait(b.between ?? 350); }
      await release();
    },
    drag: async (spec, b) => {
      const [from, ...rest] = Array.isArray(spec) && !(typeof spec[0] === "number") ? spec : [spec.from, spec.to];
      await glide(await resolve(from), b.approach ?? 800, b.arc);
      await clock.wait(b.settle ?? 100);
      await press();
      for (const to of rest) await glide(await resolve(to), b.duration ?? 900, b.dragArc ?? 0.06);
      await clock.wait(b.release ?? 60);
      await release();
    },
    key: async (key, b) => {
      for (let i = 0; i < (b.times ?? 1); i++) {
        mark("key", { key });
        await page.keyboard.press(key);
        if (i < (b.times ?? 1) - 1) await clock.wait(b.gap ?? 450);
      }
    },
    type: async (text, b) => { mark("type", { text }); await page.keyboard.type(text, { delay: b.delay ?? 70 }); },
    scroll: async (dy, b) => {
      if (b.at) await glide(await resolve(b.at), b.approach ?? 700);
      const steps = Math.max(1, Math.round((b.duration ?? 900) / 16));
      let done = 0;
      for (let i = 1; i <= steps; i++) {
        const want = dy * smoother(i / steps);
        await page.mouse.wheel(0, want - done);
        done = want;
        await clock.tick();
      }
    },
    // Camera directions are only logged; compose.mjs springs toward them.
    camera: async (spec) => {
      if (spec === "reset") return mark("camera", { zoom: 1 });
      const target = spec.on === undefined || spec.on === "cursor" ? null : await resolve(spec.on);
      mark("camera", { zoom: spec.zoom ?? 1.6, x: target?.x, y: target?.y, still: spec.follow === false, stiffness: spec.stiffness });
    },
    // Fine-grained hands: press, then any number of `move` beats (each with
    // its own duration, arc and pause) while the button stays down, then lift.
    press: async (target, b) => {
      if (target !== "cursor") await glide(await resolve(target, b), b.duration ?? 850, b.arc);
      await clock.wait(b.settle ?? 120);
      await press();
    },
    lift: async () => release(),
    hide: async () => { cur.shown = false; mark("cursor", { visible: false }); },
    run: async (fn) => fn({ page, mark, resolve, glide, wait: clock.wait }),
  };

  // --- go -----------------------------------------------------------------
  const url = new URL(reel.url, base).toString();
  log(`  ${format.name}: ${url} @ ${vp.width}x${vp.height} dpr ${format.dpr}`);
  mark("nav");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await clock.record();
  mark("start"); // the video opens here: the piece's own entrance is the intro
  // Feed rule: a hand on screen from frame one reads as "interactive" before anything happens.
  if (reel.cursor?.visible) show();
  if (reel.ready) await clock.waitFor(reel.ready);
  // The stage is what the camera frames at rest: the piece, not the page.
  if (reel.stage?.rect) {
    // A fixed region in viewport fractions [x, y, w, h], for pieces drawn on one canvas.
    const [x, y, w, h] = reel.stage.rect;
    mark("stage", { x: x * vp.width, y: y * vp.height, width: w * vp.width, height: h * vp.height, pad: reel.stage.pad ?? 0 });
  } else if (reel.stage) {
    const sel = typeof reel.stage === "string" ? reel.stage : reel.stage.sel;
    await clock.waitFor(sel);
    // Union of every match, so `.cell` frames a whole grid of cells even when
    // their container is wider than they are.
    const box = await page.locator(sel).evaluateAll((els) => {
      const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height && r.bottom > 0 && r.top < innerHeight);
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom))) - y };
    });
    mark("stage", { ...box, pad: reel.stage.pad ?? 0.12 });
  }
  await clock.wait(reel.intro?.hold ?? 1200);

  // tempo > 1 slows every motion and hold in the reel by that factor.
  const TIMED = ["duration", "pause", "settle", "hold", "press", "approach", "release", "between", "dragDuration", "gap", "delay"];
  const tempo = reel.tempo ?? 1;
  for (const raw of reel.beats) {
    const beat = { ...raw };
    for (const k of TIMED) if (typeof beat[k] === "number") beat[k] *= tempo;
    if (typeof beat.wait === "number") beat.wait *= tempo;
    const verb = Object.keys(verbs).find((k) => k in beat);
    if (!verb) throw new Error(`Beat has no verb: ${JSON.stringify(beat)}`);
    try {
      if (beat.zoom) await verbs.camera({ zoom: beat.zoom, on: beat.zoomOn ?? (typeof beat[verb] === "string" ? beat[verb] : "cursor"), follow: beat.follow });
      await verbs[verb](beat[verb], beat);
      if (beat.pause) await clock.wait(beat.pause);
    } catch (err) {
      // Leave a picture of where it got stuck next to the frames so far.
      await page.screenshot({ path: path.join(dir, "failed.png") }).catch(() => {});
      await browser.close();
      throw new Error(`Beat ${reel.beats.indexOf(raw) + 1} (${verb}) failed: ${err.message}\n  See ${path.join(dir, "failed.png")}`);
    }
  }
  mark("camera", { zoom: 1 });
  mark("end");
  await clock.wait(reel.outro?.hold ?? 1800);
  mark("stop");
  await clock.stop();
  while (pending) await clock.wait(20);

  const title = reel.title ?? (await page.title()).split("|")[0].trim();
  await browser.close();
  const meta = { reel: reel.name, format, url, title, viewport: vp, dpr: format.dpr, frames, timeline };
  fs.writeFileSync(path.join(dir, "capture.json"), JSON.stringify(meta));
  log(`  ${frames.length} frames over ${(at() / 1000).toFixed(1)}s (${lockstep ? "lockstep" : "realtime"}, ${(frames.length / (at() / 1000)).toFixed(0)} fps captured)`);
  return meta;
}
