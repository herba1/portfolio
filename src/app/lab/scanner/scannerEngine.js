import { createScannerAudio } from "./scannerAudio";
import { composeScan, halftone, makeDust, slip } from "./scannerScan";
import skyPhoto from "./sky.jpg";
import wiresPhoto from "./wires.jpg";

const BED_W = 297;
const BED_H = 216;
const SUB = 1 / 240;
const SWEEP = 4.2;
const WARM = 0.4;
const RETURN = 1.1;

const DEFS = [
  { id: "sky", kind: "photo", src: skyPhoto.src, w: 196, h: 140, cell: 3.1, bed: { x: 140, y: 104, rot: -0.012 } },
  { id: "slip", kind: "slip", text: "it must be out there.", h: 12, bed: { x: 136, y: 92, rot: 0.008 } },
  { id: "cover", kind: "photo", src: "/tierlist/images/image-mqobr6yd.webp", w: 120, h: 120, cell: 2.6, fade: 0.94 },
  { id: "wires", kind: "photo", src: wiresPhoto.src, w: 98, h: 103, cell: 3, fade: 0.92 },
  { id: "slip2", kind: "slip", text: "how are you?", h: 12 },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function spring(s, key, velKey, target, omega, zeta, h) {
  const a = omega * omega * (target - s[key]) - 2 * zeta * omega * s[velKey];
  s[velKey] += a * h;
  s[key] += s[velKey] * h;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.decode().then(() => resolve(img), reject);
  });
}

export function createScanner(root, { onReady, onBusy } = {}) {
  const q = (name) => root.querySelector(`[data-scanner="${name}"]`);
  const stage = q("stage");
  const device = q("device");
  const bed = q("bed");
  const light = q("light");
  const dustSvg = q("dust");
  const handle = q("handle");
  const led = q("led");
  const preview = q("preview");
  const canvas = q("canvas");
  const caption = q("caption");
  const scanButtons = [q("scan"), q("scan-key")];
  const saveButton = q("save");

  const view = { w: 1, h: 1, dpr: 1 };
  const lay = { k: 1.6, bedX: 0, bedY: 0, tray: { x: 0, y: 0, w: 0, h: 0 }, wide: true };
  const head = { x: 0, lamp: 0, mode: "idle", t: 0, from: 0 };
  const dust = makeDust();
  const pointer = { id: null, item: null, ox: 0, oy: 0, x: 0, y: 0, vx: 0, lastX: 0, lastT: 0, mode: null };
  let items = [];
  let zTop = 10;
  let pass = null;
  let dirty = true;
  let oldScan = null;
  let nextScan = null;
  let audio = null;
  let soundOn = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let ready = false;
  let previewKey = "";
  let busy = false;
  let lampOffAt = 0;
  let motorLevel = 0;
  let keyIdle = 0;

  function bedRect() {
    return { x: lay.bedX, y: lay.bedY, w: BED_W * lay.k, h: BED_H * lay.k };
  }

  function measure() {
    const rect = stage.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wide = view.w >= 900;
    lay.wide = wide;
    let top = 196;
    if (caption) top = Math.max(top, caption.getBoundingClientRect().bottom - rect.top + 56);
    let bodyX;
    let bodyW;
    let pvX;
    let pvY;
    let pvW;
    if (wide) {
      const leftW = (view.w - 144) * 0.56;
      const bedW = Math.min(leftW - 48, ((view.h - top - 40 - 96) * BED_W) / BED_H);
      lay.k = bedW / BED_W;
      bodyW = bedW + 48;
      bodyX = 48;
      pvX = bodyX + bodyW + 48;
      pvW = Math.min(view.w - 48 - pvX, 440);
      pvY = 88;
    } else {
      top = Math.max(top - 16, 180);
      bodyW = view.w - 32;
      bodyX = 16;
      lay.k = (bodyW - 24) / BED_W;
      pvX = 16;
      pvW = view.w - 32;
      pvY = 0;
    }
    const pad = wide ? 24 : 12;
    const bedH = BED_H * lay.k;
    const bodyH = bedH + pad + 28 + 44;
    device.style.transform = `translate(${bodyX}px, ${top}px)`;
    device.style.width = `${bodyW}px`;
    device.style.height = `${bodyH}px`;
    root.style.setProperty("--scanner-pad", `${pad}px`);
    root.style.setProperty("--scanner-bed-h", `${bedH}px`);
    lay.bedX = bodyX + pad;
    lay.bedY = top + pad;
    const pvH = (pvW * BED_H) / BED_W;
    let trayTop;
    if (wide) {
      trayTop = pvY + pvH + 36 + 56 + 32;
      lay.tray = { x: pvX, y: trayTop, w: view.w - 48 - pvX, h: view.h - 32 - trayTop };
    } else {
      trayTop = top + bodyH + 16;
      lay.tray = { x: 16, y: trayTop, w: view.w - 32, h: 104 };
      pvY = trayTop + 104 + 16;
    }
    preview.style.transform = `translate(${pvX}px, ${pvY}px)`;
    preview.style.width = `${pvW}px`;
    root.style.setProperty("--scanner-preview-h", `${wide ? pvH : Math.max(120, Math.min(pvH, view.h - pvY - 36 - 56 - 12))}px`);
    dustSvg.setAttribute("viewBox", `0 0 ${BED_W} ${BED_H}`);
    resizePreview();
    for (const it of items) paintDisplay(it);
    layoutTray(true);
    for (const it of items) if (it.onBed) place(it, true);
    applyItems();
    drawPreview(true);
    wake();
  }

  function resizePreview() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width * view.dpr));
    const h = Math.max(2, Math.round(r.height * view.dpr));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    if (ready) {
      const fresh = document.createElement("canvas");
      fresh.width = w;
      fresh.height = h;
      composeScan(fresh, { bedW: BED_W, bedH: BED_H, items: scanItems(), dust, seed: 3 });
      oldScan = fresh;
      nextScan = null;
      pass = null;
    }
  }

  function paintDisplay(it) {
    if (!it.bitmap || !it.display) return;
    const w = Math.max(2, Math.round(it.w * lay.k * view.dpr));
    const h = Math.max(2, Math.round(it.h * lay.k * view.dpr));
    if (it.display.width === w && it.display.height === h) return;
    it.display.width = w;
    it.display.height = h;
    const ctx = it.display.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    let src = it.bitmap;
    while (src.width > w * 2) {
      const half = document.createElement("canvas");
      half.width = Math.round(src.width / 2);
      half.height = Math.round(src.height / 2);
      const hctx = half.getContext("2d");
      hctx.imageSmoothingQuality = "high";
      hctx.drawImage(src, 0, 0, half.width, half.height);
      src = half;
    }
    ctx.drawImage(src, 0, 0, w, h);
  }

  function scanItems() {
    return items
      .filter((it) => it.onBed && it.bitmap)
      .sort((a, b) => a.z - b.z)
      .map((it) => ({ x: it.bx, y: it.by, w: it.w, h: it.h, rot: it.brot, bitmap: it.bitmap, halftone: it.def.kind === "photo" }));
  }

  function place(it, snap) {
    const px = lay.bedX + it.bx * lay.k;
    const py = lay.bedY + it.by * lay.k;
    it.tx = px;
    it.ty = py;
    it.trot = it.brot;
    it.tscale = 1;
    if (snap) {
      it.px = px;
      it.py = py;
      it.rot = it.brot;
      it.scale = 1;
    }
  }

  function layoutTray(snap) {
    const loose = items.filter((it) => !it.onBed && it !== pointer.item);
    if (!loose.length) return;
    const gap = 16;
    const t = lay.tray;
    const sumW = loose.reduce((a, it) => a + it.w * lay.k, 0);
    const maxH = Math.max(...loose.map((it) => it.h * lay.k));
    const s = Math.min(1, (t.w - gap * (loose.length - 1)) / sumW, (t.h - 8) / maxH);
    let x = t.x + Math.max(0, (t.w - (sumW * s + gap * (loose.length - 1))) / 2);
    loose.forEach((it, i) => {
      const w = it.w * lay.k * s;
      it.tx = x + w / 2;
      it.ty = t.y + t.h / 2 + (i % 2 ? 6 : -4) * s;
      it.tscale = s;
      it.trot = it.restRot;
      if (snap) {
        it.px = it.tx;
        it.py = it.ty;
        it.scale = s;
        it.rot = it.trot;
      }
      x += w + gap;
    });
  }

  function applyItems() {
    for (const it of items) {
      const w = it.w * lay.k;
      const h = it.h * lay.k;
      it.el.style.width = `${w}px`;
      it.el.style.height = `${h}px`;
      it.el.style.transform = `translate(${it.px - w / 2}px, ${it.py - h / 2}px) rotate(${it.rot}rad) scale(${it.scale})`;
      it.el.style.zIndex = String(it.z);
      it.el.toggleAttribute("data-lifted", pointer.item === it);
      if (it.onBed && head.lamp > 0.01) {
        const local = (lay.bedX + head.x * lay.k - it.px) / Math.max(0.2, Math.cos(it.rot));
        const inside = Math.abs(local) < w / 2 + 24;
        it.glow.style.transform = `translateX(${local + w / 2}px)`;
        it.glow.style.opacity = inside ? String(head.lamp * (it.def.kind === "slip" ? 0.55 : 0.3)) : "0";
      } else it.glow.style.opacity = "0";
    }
    light.style.transform = `translateX(${head.x * lay.k}px)`;
    light.style.setProperty("--scanner-lamp", head.lamp.toFixed(3));
    handle.style.transform = `translateX(${head.x * lay.k}px)`;
  }

  function startPass() {
    if (!ready) return;
    const w = canvas.width;
    const h = canvas.height;
    const snapshot = document.createElement("canvas");
    snapshot.width = w;
    snapshot.height = h;
    const sctx = snapshot.getContext("2d");
    if (oldScan) sctx.drawImage(oldScan, 0, 0, w, h);
    if (pass && nextScan) {
      const sx = Math.round((pass.split / BED_W) * w);
      if (sx > 0) sctx.drawImage(nextScan, 0, 0, sx, h, 0, 0, sx, h);
    }
    oldScan = snapshot;
    nextScan = document.createElement("canvas");
    nextScan.width = w;
    nextScan.height = h;
    composeScan(nextScan, { bedW: BED_W, bedH: BED_H, items: scanItems(), dust, seed: Math.floor(performance.now()) % 997 });
    pass = { split: head.x };
    dirty = false;
  }

  function finishPass() {
    if (!pass || !nextScan) return;
    oldScan = nextScan;
    nextScan = null;
    pass = null;
    previewKey = "";
  }

  function drawPreview(force) {
    if (!ready || !oldScan) return;
    const key = `${pass ? pass.split.toFixed(2) : "-"}|${head.lamp.toFixed(2)}|${head.x.toFixed(2)}`;
    if (!force && key === previewKey) return;
    previewKey = key;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(oldScan, 0, 0, w, h);
    if (pass && nextScan) {
      const sx = Math.round((pass.split / BED_W) * w);
      if (sx > 0) ctx.drawImage(nextScan, 0, 0, sx, h, 0, 0, sx, h);
    }
    if (head.lamp > 0.01) {
      const x = (head.x / BED_W) * w;
      const g = ctx.createLinearGradient(x - 28 * view.dpr, 0, x + 6 * view.dpr, 0);
      g.addColorStop(0, "rgba(200,240,255,0)");
      g.addColorStop(0.7, `rgba(210,244,255,${0.1 * head.lamp})`);
      g.addColorStop(0.94, `rgba(235,252,255,${0.55 * head.lamp})`);
      g.addColorStop(1, "rgba(235,252,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 28 * view.dpr, 0, 34 * view.dpr, h);
      ctx.fillStyle = `rgba(245,255,255,${0.9 * head.lamp})`;
      ctx.fillRect(x - view.dpr, 0, Math.max(1, 1.5 * view.dpr), h);
    }
  }

  function setBusy(b) {
    if (b === busy) return;
    busy = b;
    onBusy?.(b);
    root.toggleAttribute("data-busy", b);
  }

  function scan() {
    if (!ready || head.mode === "warm" || head.mode === "sweep") return;
    ensureAudio();
    if (dirty || !pass) {
      if (head.x > 0.5) {
        head.mode = "rewind";
        head.t = 0;
        head.from = head.x;
        setBusy(true);
        audio?.motor(0.9);
        wake();
        return;
      }
      startPass();
    }
    head.mode = "warm";
    head.t = 0;
    head.from = head.x;
    setBusy(true);
    audio?.lamp();
    wake();
  }

  function save() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scan.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }

  function local(e) {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    if (pointer.id !== null || !ready) return;
    if (e.button !== undefined && e.button !== 0) return;
    const itemEl = e.target.closest("[data-item]");
    const onHandle = e.target.closest("[data-scanner='handle']");
    const p = local(e);
    ensureAudio();
    if (itemEl && !busy) {
      const it = items.find((x) => x.el === itemEl);
      if (!it) return;
      e.preventDefault();
      pointer.id = e.pointerId;
      pointer.item = it;
      pointer.mode = "item";
      pointer.ox = p.x - it.px;
      pointer.oy = p.y - it.py;
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.lastX = p.x;
      pointer.lastT = performance.now();
      pointer.vx = 0;
      zTop += 1;
      it.z = zTop;
      it.tscale = 1.04;
      stage.setPointerCapture?.(e.pointerId);
      audio?.lift(it.def.kind === "slip");
      wake();
      return;
    }
    const bedR = bedRect();
    const nearBar = Math.abs(p.x - (bedR.x + head.x * lay.k)) < 22 && p.y > bedR.y && p.y < bedR.y + bedR.h + 32;
    if ((onHandle || nearBar) && (head.mode === "idle" || head.mode === "manual" || head.mode === "linger")) {
      e.preventDefault();
      pointer.id = e.pointerId;
      pointer.mode = "head";
      pointer.ox = p.x - (bedR.x + head.x * lay.k);
      pointer.lastX = p.x;
      pointer.lastT = performance.now();
      pointer.vx = 0;
      stage.setPointerCapture?.(e.pointerId);
      if (dirty || !pass) startPass();
      head.mode = "manual";
      setBusy(true);
      audio?.lamp();
      wake();
    }
  }

  function onMove(e) {
    if (pointer.id !== e.pointerId) return;
    const p = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - pointer.lastT) / 1000;
    pointer.vx = pointer.vx * 0.6 + ((p.x - pointer.lastX) / dt) * 0.4;
    pointer.lastX = p.x;
    pointer.lastT = now;
    pointer.x = p.x;
    pointer.y = p.y;
    if (pointer.mode === "head") {
      const bedR = bedRect();
      const target = clamp((p.x - pointer.ox - bedR.x) / lay.k, 0, BED_W);
      head.target = target;
    }
    wake();
  }

  function onUp(e) {
    if (pointer.id !== e.pointerId) return;
    const mode = pointer.mode;
    const it = pointer.item;
    pointer.id = null;
    pointer.item = null;
    pointer.mode = null;
    if (mode === "item" && it) {
      const bedR = bedRect();
      const cx = it.tx;
      const cy = it.ty;
      const inside = cx > bedR.x - 4 && cx < bedR.x + bedR.w + 4 && cy > bedR.y - 4 && cy < bedR.y + bedR.h + 4;
      if (inside) {
        it.onBed = true;
        it.bx = clamp((cx - bedR.x) / lay.k, 6, BED_W - 6);
        it.by = clamp((cy - bedR.y) / lay.k, 6, BED_H - 6);
        it.brot = it.rot + clamp(pointer.vx * 0.00002, -0.02, 0.02);
        place(it, false);
        audio?.drop(it.def.kind === "slip" ? 0.6 : 1, (cx / view.w) * 2 - 1);
      } else {
        it.onBed = false;
        audio?.drop(0.5, (cx / view.w) * 2 - 1);
      }
      dirty = true;
      layoutTray(false);
    } else if (mode === "head") {
      if (head.x > BED_W - 1) {
        finishPass();
        head.mode = "return";
        head.t = 0;
        head.from = head.x;
        audio?.done();
      } else {
        head.mode = "linger";
        lampOffAt = 0.9;
      }
    }
    wake();
  }

  function ensureAudio() {
    if (!soundOn || audio) return;
    audio = createScannerAudio();
  }

  function stepHead(dt) {
    if (head.mode === "warm") {
      head.t += dt;
      head.lamp = Math.min(1, head.t / WARM);
      if (head.t >= WARM) {
        head.mode = "sweep";
        head.t = 0;
        head.from = head.x;
      }
    } else if (head.mode === "sweep") {
      head.t += dt;
      const span = SWEEP * ((BED_W - head.from) / BED_W);
      const k = Math.min(1, head.t / Math.max(0.3, span));
      head.x = head.from + (BED_W - head.from) * ease(k);
      if (pass) pass.split = head.x;
      head.lamp = 1;
      motorTarget(0.45 + 0.5 * Math.sin(Math.PI * k));
      if (k >= 1) {
        finishPass();
        head.mode = "return";
        head.t = 0;
        head.from = head.x;
        audio?.done();
      }
    } else if (head.mode === "return" || head.mode === "rewind") {
      head.t += dt;
      const k = Math.min(1, head.t / (RETURN * Math.max(0.25, head.from / BED_W)));
      head.x = head.from * (1 - ease(k));
      head.lamp = head.mode === "rewind" ? 0 : Math.max(0, head.lamp - dt * 4);
      motorTarget(0.9 * Math.sin(Math.PI * k));
      if (k >= 1) {
        head.x = 0;
        if (head.mode === "rewind") {
          head.mode = "idle";
          motorTarget(0);
          scan();
          return;
        }
        head.mode = "idle";
        motorTarget(0);
        setBusy(false);
      }
    } else if (head.mode === "manual") {
      const target = head.target ?? head.x;
      const max = 260 * dt;
      const before = head.x;
      head.x += clamp(target - head.x, -max, max);
      if (pass) pass.split = head.x;
      head.lamp = Math.min(1, head.lamp + dt * 6);
      motorTarget(clamp(Math.abs(head.x - before) / dt / 120, 0, 1));
    } else if (head.mode === "linger") {
      lampOffAt -= dt;
      motorTarget(0);
      if (lampOffAt <= 0) {
        head.lamp = Math.max(0, head.lamp - dt * 3);
        if (head.lamp <= 0) {
          head.mode = "idle";
          setBusy(false);
        }
      }
    }
  }

  function motorTarget(level) {
    if (Math.abs(level - motorLevel) < 0.02) return;
    motorLevel = level;
    audio?.motor(level);
  }

  function stepItems(h) {
    for (const it of items) {
      if (pointer.item === it) {
        it.tx = pointer.x - pointer.ox;
        it.ty = pointer.y - pointer.oy;
        it.trot = it.restRot * 0.5 + clamp(pointer.vx * 0.00012, -0.06, 0.06) + (it.onBed ? it.brot * 0.5 : 0);
      }
      const held = pointer.item === it;
      spring(it, "px", "vx", it.tx, held ? 30 : 14, 0.9, h);
      spring(it, "py", "vy", it.ty, held ? 30 : 14, 0.9, h);
      spring(it, "rot", "vrot", it.trot, 14, 0.85, h);
      spring(it, "scale", "vscale", it.tscale, 18, 0.9, h);
    }
  }

  function moving() {
    if (pointer.id !== null) return true;
    if (head.mode !== "idle") return true;
    for (const it of items) {
      if (Math.abs(it.px - it.tx) + Math.abs(it.py - it.ty) > 0.2) return true;
      if (Math.abs(it.vx) + Math.abs(it.vy) > 0.5) return true;
      if (Math.abs(it.rot - it.trot) > 0.0005 || Math.abs(it.scale - it.tscale) > 0.0005) return true;
    }
    return false;
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    let acc = dt;
    while (acc > 1e-6) {
      const step = Math.min(SUB, acc);
      stepItems(step);
      acc -= step;
    }
    stepHead(dt);
    if (pointer.item && pointer.item.onBed) {
      const it = pointer.item;
      it.onBed = false;
      dirty = true;
      layoutTray(false);
    }
    applyItems();
    led.setAttribute("data-state", head.mode === "warm" ? "warm" : head.lamp > 0.05 ? "on" : "idle");
    drawPreview(false);
    if (moving() && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) return;
    if (active && /BUTTON|INPUT/.test(active.tagName) && active !== handle) return;
    if (e.key === "s" || e.key === "S") scan();
    if (active === handle && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      if (head.mode === "idle" || head.mode === "linger") {
        if (dirty || !pass) startPass();
        head.mode = "manual";
        setBusy(true);
      }
      head.target = clamp((head.target ?? head.x) + (e.key === "ArrowRight" ? 12 : -12), 0, BED_W);
      clearTimeout(keyIdle);
      keyIdle = setTimeout(() => {
        if (head.mode !== "manual") return;
        head.mode = "linger";
        lampOffAt = 0.6;
        wake();
      }, 700);
      wake();
    }
  }

  const scanClick = (e) => {
    e.preventDefault();
    scan();
  };
  scanButtons.forEach((b) => b?.addEventListener("click", scanClick));
  saveButton?.addEventListener("click", save);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => measure());
  ro.observe(stage);

  items = DEFS.map((def, i) => {
    const el = root.querySelector(`[data-item="${def.id}"]`);
    const restRot = [0, 0, -0.035, 0.05, -0.02][i];
    const it = {
      id: def.id,
      def,
      el,
      face: el.querySelector(".scanner-item-face"),
      glow: el.querySelector(".scanner-item-glow"),
      w: def.w || 100,
      h: def.h,
      onBed: Boolean(def.bed),
      bx: def.bed?.x ?? 0,
      by: def.bed?.y ?? 0,
      brot: def.bed?.rot ?? 0,
      restRot,
      px: 0, py: 0, vx: 0, vy: 0, rot: 0, vrot: 0, scale: 1, vscale: 0,
      tx: 0, ty: 0, trot: 0, tscale: 1,
      z: i + 1,
      bitmap: null,
    };
    el.setAttribute("data-kind", def.kind);
    return it;
  });
  zTop = items.length + 1;

  const circles = dust.specks
    .map((s) => `<circle cx="${(s.x * BED_W).toFixed(1)}" cy="${(s.y * BED_H).toFixed(1)}" r="${(s.r * 0.6).toFixed(2)}" />`)
    .join("");
  const hairPath = dust.hair.pts
    .map(([px, py], i) => `${i ? "L" : "M"}${(dust.hair.x * BED_W + px).toFixed(1)} ${(dust.hair.y * BED_H + py).toFixed(1)}`)
    .join(" ");
  dustSvg.innerHTML = `${circles}<path d="${hairPath}" />`;

  measure();

  const fonts = document.fonts?.load ? document.fonts.load("400 40px scanner-tinos").catch(() => {}) : Promise.resolve();
  Promise.all(DEFS.map((def) => (def.kind === "photo" ? loadImage(def.src) : Promise.resolve(null))).concat([fonts]))
    .then((loaded) => {
      if (destroyed) return;
      items.forEach((it, i) => {
        const def = it.def;
        let bitmap;
        if (def.kind === "photo") {
          const ppm = 6;
          bitmap = halftone(loaded[i], { width: def.w * ppm, height: def.h * ppm, cell: (def.cell * ppm) / 4.4, fade: def.fade ?? 0.88 });
        } else {
          bitmap = slip(def.text, { height: Math.round(def.h * 11) });
          it.w = (bitmap.width / bitmap.height) * def.h;
        }
        it.bitmap = bitmap;
        it.display = document.createElement("canvas");
        it.display.className = "scanner-item-bitmap";
        it.face.appendChild(it.display);
        paintDisplay(it);
      });
      ready = true;
      layoutTray(true);
      for (const it of items) if (it.onBed) place(it, true);
      applyItems();
      resizePreview();
      const first = document.createElement("canvas");
      first.width = canvas.width;
      first.height = canvas.height;
      composeScan(first, { bedW: BED_W, bedH: BED_H, items: scanItems(), dust, seed: 1 });
      oldScan = first;
      dirty = false;
      drawPreview(true);
      onReady?.();
      wake();
    })
    .catch(() => {
      ready = true;
      onReady?.();
    });

  return {
    async setSound(on) {
      soundOn = on;
      if (on) {
        if (!audio) audio = createScannerAudio();
        if (!audio) return false;
        return audio.setEnabled(true);
      }
      motorLevel = 0;
      if (audio) await audio.setEnabled(false);
      return false;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(keyIdle);
      ro.disconnect();
      scanButtons.forEach((b) => b?.removeEventListener("click", scanClick));
      saveButton?.removeEventListener("click", save);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      audio?.destroy();
    },
  };
}
