import photo from "./record-wall.jpg";
import { createCamSound } from "./camcorderAudio";
import { createCamGL } from "./camcorderGL";

const OPTICAL = 6;
const MAX_ZOOM = 24;
const MAX_CLIP = 15;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}

function noise1(t, seed) {
  return Math.sin(t * 1.13 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.07 + seed * 2.9) * 0.2;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function timecode(seconds) {
  const total = Math.max(0, seconds);
  const frames = Math.floor((total % 1) * 30);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function createCamcorder(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const rig = el("div", "camcorder-rig", stage);
  const screen = el("div", "camcorder-screen", rig);
  const canvas = el("canvas", "camcorder-canvas", screen);
  const gl = createCamGL(canvas);
  if (!gl) {
    rig.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }
  const osd = el("div", "camcorder-osd", screen);
  const tl = el("div", "camcorder-osd-tl", osd);
  const recDot = el("span", "camcorder-osd-dot", tl);
  const mode = el("span", "camcorder-osd-mode", tl);
  const tr = el("div", "camcorder-osd-tr", osd);
  const battery = el("span", "camcorder-osd-battery", tr);
  for (let i = 0; i < 3; i += 1) el("span", "camcorder-osd-cell", battery);
  const minutes = el("span", "camcorder-osd-min", tr);
  minutes.textContent = "60min";
  const zoomBar = el("div", "camcorder-osd-zoom", osd);
  const zw = el("span", "camcorder-osd-zl", zoomBar);
  zw.textContent = "W";
  const ztrack = el("span", "camcorder-osd-ztrack", zoomBar);
  const zdigital = el("span", "camcorder-osd-zdigital", ztrack);
  const zfill = el("span", "camcorder-osd-zfill", ztrack);
  const zt = el("span", "camcorder-osd-zl", zoomBar);
  zt.textContent = "T";
  const zlabel = el("span", "camcorder-osd-zlabel", zoomBar);
  const bl = el("div", "camcorder-osd-bl", osd);
  const dateLine = el("span", "camcorder-osd-line", bl);
  const timeLine = el("span", "camcorder-osd-line", bl);
  const br = el("div", "camcorder-osd-br", osd);
  const tcLine = el("span", "camcorder-osd-line", br);

  const controls = el("div", "camcorder-controls", rig);
  const recBtn = el("button", "camcorder-rec", controls);
  recBtn.type = "button";
  const recIcon = el("span", "camcorder-rec-icon", recBtn);
  recIcon.setAttribute("aria-hidden", "true");
  const recText = el("span", "camcorder-btn-text", recBtn);
  recText.textContent = "Record";
  const rocker = el("div", "camcorder-rocker", controls);
  rocker.setAttribute("role", "slider");
  rocker.setAttribute("aria-label", "Zoom");
  rocker.setAttribute("aria-valuemin", "1");
  rocker.setAttribute("aria-valuemax", String(MAX_ZOOM));
  rocker.tabIndex = 0;
  const rw = el("span", "camcorder-rocker-end", rocker);
  rw.textContent = "W";
  const rtrack = el("span", "camcorder-rocker-track", rocker);
  const thumb = el("span", "camcorder-rocker-thumb", rtrack);
  const rt = el("span", "camcorder-rocker-end", rocker);
  rt.textContent = "T";
  const playBtn = el("button", "camcorder-play", controls);
  playBtn.type = "button";
  playBtn.disabled = true;
  const playIcon = el("span", "camcorder-play-icon", playBtn);
  playIcon.setAttribute("aria-hidden", "true");
  const playText = el("span", "camcorder-btn-text", playBtn);
  playText.textContent = "Play";

  let sound = null;
  let W = 640;
  let H = 480;
  let lum = null;
  let keyLum = 0.1;
  let lumW = 0;
  let lumH = 0;
  let loaded = false;
  let readyAt = 0;
  const photoAspect = photo.width / photo.height;

  const cam = {
    cx: 0.5,
    cy: 0.5,
    tx: 0.5,
    ty: 0.5,
    vx: 0,
    vy: 0,
    flingX: 0,
    flingY: 0,
    zl: Math.log(1.3),
    ztl: Math.log(1.3),
    f: 0,
    fv: 0,
    ev: 0,
    gain: 0,
    lastCx: 0.5,
    lastCy: 0.5,
  };
  let rockerDefl = 0;
  let wasZooming = false;
  let rockerHeld = false;
  let keyZoom = 0;
  let zoomShowUntil = 0;
  let state = "stby";
  let clip = null;
  let recording = null;
  let playStart = 0;
  let tapeSeconds = 0;
  let drag = null;
  let pinch = null;
  const pointers = new Map();
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let layoutKey = "";
  let lastTick = 0;
  const osdCache = {};

  const setText = (node, key, text) => {
    if (osdCache[key] === text) return;
    osdCache[key] = text;
    node.textContent = text;
  };

  const spans = (zoom) => {
    const aspect = W / H;
    return [1 / zoom, photoAspect / aspect / zoom];
  };

  const clampCenter = (x, y, zoom) => {
    const [sx, sy] = spans(zoom);
    return [clamp(x, sx / 2, 1 - sx / 2), sy >= 1 ? 0.5 : clamp(y, sy / 2, 1 - sy / 2)];
  };

  const meter = (cx, cy, zoom) => {
    if (!lum) return 0.25;
    const [sx, sy] = spans(zoom);
    let sum = 0;
    let wsum = 0;
    for (let j = 0; j < 9; j += 1) {
      for (let i = 0; i < 9; i += 1) {
        const ox = (i / 8 - 0.5);
        const oy = (j / 8 - 0.5);
        const px = clamp(Math.floor((cx + ox * sx) * lumW), 0, lumW - 1);
        const py = clamp(Math.floor((cy + oy * sy) * lumH), 0, lumH - 1);
        const w = 1.4 - Math.hypot(ox, oy) * 1.6;
        sum += lum[py * lumW + px] * w;
        wsum += w;
      }
    }
    return sum / wsum;
  };

  const layout = () => {
    const srRaw = stage.getBoundingClientRect();
    const sr = { top: srRaw.top, left: srRaw.left, right: srRaw.right, bottom: srRaw.bottom, x: srRaw.x, y: srRaw.y, width: stage.clientWidth, height: stage.clientHeight };
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const narrow = sr.width < 700;
    const side = narrow ? 16 : 32;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${sr.width - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? capBottom + 24 : side;
    const bottom = caption ? (narrow ? 56 : 64) : side;
    const controlsH = 48 + 16;
    const availW = sr.width - side * 2;
    const availH = sr.height - top - bottom - controlsH;
    let w = Math.min(availW, (availH * 4) / 3, 1040);
    w = Math.max(240, Math.floor(w));
    const h = Math.round((w * 3) / 4);
    const left = Math.round((sr.width - w) / 2);
    const y = Math.round(top + Math.max(0, (availH - h) * 0.35));
    rig.style.left = `${left}px`;
    rig.style.top = `${y}px`;
    rig.style.width = `${w}px`;
    rig.style.setProperty("--cam-w", `${w}px`);
    if (w < 440) rig.dataset.narrow = "";
    else rig.removeAttribute("data-narrow");
    screen.style.height = `${h}px`;
    if (caption && !narrow) {
      caption.style.left = `${left}px`;
      caption.style.width = `${w}px`;
    }
    W = w;
    H = h;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    gl.resize(Math.round(w * scale), Math.round(h * scale));
    wake();
  };

  const zoomNow = () => Math.exp(cam.zl);

  const kickFocus = (amount) => {
    cam.f = clamp(cam.f + amount * (cam.f >= 0 ? 1 : -1), -1.2, 1.2);
    if (Math.abs(cam.f) < 0.05) cam.f = amount;
  };

  const startRec = () => {
    if (state === "play") stopPlay(false);
    state = "rec";
    recording = { start: performance.now(), frames: [] };
    sound?.clunk();
    sound?.beep(2);
    rig.dataset.state = "rec";
    recBtn.setAttribute("aria-pressed", "true");
    setText(recText, "rec", "Stop");
    onLive("Recording");
  };

  const stopRec = () => {
    if (state !== "rec") return;
    const dur = (performance.now() - recording.start) / 1000;
    state = "stby";
    if (recording.frames.length > 8) {
      clip = { frames: recording.frames, duration: dur, tapeStart: tapeSeconds };
      playBtn.disabled = false;
    }
    tapeSeconds += dur;
    recording = null;
    sound?.beep(1);
    sound?.clunk();
    rig.dataset.state = "stby";
    recBtn.setAttribute("aria-pressed", "false");
    setText(recText, "rec", "Record");
    onLive(clip ? `Recorded ${dur.toFixed(1)} seconds` : "Standby");
  };

  const startPlay = () => {
    if (!clip) return;
    if (state === "rec") stopRec();
    state = "play";
    playStart = performance.now();
    sound?.clunk();
    rig.dataset.state = "play";
    playBtn.setAttribute("aria-pressed", "true");
    setText(playText, "play", "Stop");
    onLive("Playing back");
    wake();
  };

  function stopPlay(announce = true) {
    if (state !== "play") return;
    state = "stby";
    rig.dataset.state = "stby";
    playBtn.setAttribute("aria-pressed", "false");
    setText(playText, "play", "Play");
    sound?.clunk();
    if (announce) onLive("Standby");
  }

  const toggleRec = () => {
    if (state === "rec") stopRec();
    else startRec();
    wake();
  };

  const togglePlay = () => {
    if (state === "play") stopPlay();
    else startPlay();
    wake();
  };

  const updateOsd = (now, view) => {
    const blink = Math.floor(now / 500) % 2 === 0;
    if (state === "rec") {
      setText(mode, "mode", "REC");
      recDot.dataset.on = "";
    } else if (state === "play") {
      setText(mode, "mode", "PLAY");
      recDot.removeAttribute("data-on");
    } else {
      setText(mode, "mode", "STBY");
      recDot.removeAttribute("data-on");
    }
    tl.dataset.state = state;
    const d = new Date(Date.now());
    const hr = d.getHours();
    setText(dateLine, "date", `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`);
    setText(timeLine, "time", `${hr % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} ${hr < 12 ? "AM" : "PM"}`);
    let tc = tapeSeconds;
    if (state === "rec") tc = tapeSeconds + (now - recording.start) / 1000;
    if (state === "play") tc = clip.tapeStart + Math.min(clip.duration, (now - playStart) / 1000);
    setText(tcLine, "tc", timecode(tc));
    const zoom = view.zoom;
    const showZoom = now < zoomShowUntil;
    zoomBar.dataset.on = showZoom ? "on" : "off";
    if (showZoom) {
      const frac = Math.log(zoom) / Math.log(MAX_ZOOM);
      zfill.style.transform = `scaleX(${frac.toFixed(4)})`;
      setText(zlabel, "zl", zoom > OPTICAL ? `${Math.round(zoom)}x D` : `${zoom.toFixed(1)}x`);
    }
    rocker.setAttribute("aria-valuenow", zoom.toFixed(1));
  };

  const live = (dt, now) => {
    const t = now / 1000;
    const zoomBefore = zoomNow();
    const rate = rockerDefl || keyZoom;
    if (rate) {
      cam.ztl = clamp(cam.ztl + rate * Math.abs(rate) * 1.5 * dt, 0, Math.log(MAX_ZOOM));
      zoomShowUntil = now + 1400;
    }
    const zk = 1 - Math.exp(-dt / 0.14);
    cam.zl += (cam.ztl - cam.zl) * zk;
    const zoom = zoomNow();
    const dzl = Math.abs(Math.log(zoom / zoomBefore));
    const zooming = dzl > 0.0006;
    if (zooming) kickFocus(Math.min(0.04, dzl * 1.5));
    if (wasZooming && !zooming) {
      kickFocus(0.55);
      cam.fv = 0;
    }
    wasZooming = zooming;

    if (!drag && !pinch) {
      cam.tx += cam.flingX * dt;
      cam.ty += cam.flingY * dt;
      const fd = Math.exp(-dt * 3.2);
      cam.flingX *= fd;
      cam.flingY *= fd;
    }
    [cam.tx, cam.ty] = clampCenter(cam.tx, cam.ty, zoom);
    const k = 70;
    const c = 2 * Math.sqrt(k);
    cam.vx += ((cam.tx - cam.cx) * k - cam.vx * c) * dt;
    cam.vy += ((cam.ty - cam.cy) * k - cam.vy * c) * dt;
    cam.cx += cam.vx * dt;
    cam.cy += cam.vy * dt;
    const [sx, sy] = spans(zoom);
    const panSpeed = Math.hypot(cam.vx / sx, cam.vy / sy);
    if (panSpeed > 0.6) kickFocus(Math.min(0.06, panSpeed * 0.01));

    const fk = 46;
    const fc = 2 * 0.36 * Math.sqrt(fk);
    cam.fv += (-cam.f * fk - cam.fv * fc) * dt;
    const fBefore = cam.f;
    cam.f += cam.fv * dt;
    if (Math.sign(fBefore) !== Math.sign(cam.f) && Math.abs(cam.fv) > 0.4 && now - lastTick > 90) {
      sound?.focusTick();
      lastTick = now;
    }

    const shake = 0.0026 * (1 + Math.min(zoom, 8) * 0.04);
    const hx = noise1(t * 0.9, 1.3) * shake + noise1(t * 7.1, 4.1) * shake * 0.12;
    const hy = noise1(t * 0.8, 7.7) * shake + noise1(t * 6.3, 2.2) * shake * 0.12;
    let [vcx, vcy] = clampCenter(cam.cx + hx, cam.cy + hy, zoom);

    const m = meter(vcx, vcy, zoom);
    const target = clamp(Math.log2((keyLum * 1.15) / Math.max(m, 0.002)) * 0.75, -1.8, 1.3);
    const brighter = target > cam.ev;
    const tau = brighter ? 0.9 : 0.5;
    cam.ev += (target - cam.ev) * (1 - Math.exp(-dt / tau));
    cam.gain = clamp((cam.ev - 0.3) * 0.8, 0, 1);

    const vx = clamp((vcx - cam.lastCx) / sx, -0.03, 0.03);
    const vy = clamp((vcy - cam.lastCy) / sy, -0.03, 0.03);
    cam.lastCx = vcx;
    cam.lastCy = vcy;
    return { cx: vcx, cy: vcy, zoom, digital: Math.max(1, zoom / OPTICAL), blur: clamp(Math.abs(cam.f) * 0.7, 0, 0.8), ev: cam.ev, gain: cam.gain, vx, vy, track: 0, play: 0, zoomRate: Math.abs(rate) > 0.02 && cam.ztl > 0 && cam.ztl < Math.log(MAX_ZOOM) ? Math.abs(rate) : Math.min(1, dzl * 40) };
  };

  const playback = (now) => {
    const t = (now - playStart) / 1000;
    if (t >= clip.duration + 0.25) {
      stopPlay();
      return null;
    }
    const frames = clip.frames;
    const ct = Math.min(t, clip.duration);
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].t <= ct) lo = mid;
      else hi = mid - 1;
    }
    const f = frames[lo];
    const intro = Math.max(0, 1 - t / 0.7);
    const outro = t > clip.duration ? Math.min(1, (t - clip.duration) / 0.25) : 0;
    return { ...f, track: Math.min(1, Math.max(intro * intro, outro)), play: 1 };
  };

  const frame = () => {
    raf = 0;
    if (destroyed || !visible || !onscreen) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const liveView = live(dt, now);
    let view = liveView;
    if (state === "rec") {
      const rt = (now - recording.start) / 1000;
      recording.frames.push({ t: rt, cx: liveView.cx, cy: liveView.cy, zoom: liveView.zoom, digital: liveView.digital, blur: liveView.blur, ev: liveView.ev, gain: liveView.gain, vx: liveView.vx, vy: liveView.vy });
      if (rt >= MAX_CLIP) stopRec();
    } else if (state === "play") {
      const pb = playback(now);
      if (pb) view = pb;
    }
    const ready = loaded ? clamp((now - readyAt) / 500, 0, 1) : 0;
    gl.render({ ...view, time: (now / 1000) % 1000, ready: ready * ready * (3 - 2 * ready) });
    updateOsd(now, view);
    sound?.update({ zoom: state === "play" ? 0 : liveView.zoomRate, tape: state !== "stby", hiss: state === "play" ? Math.max(view.track, 0.14) : 0 });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const panBy = (dx, dy) => {
    const [sx, sy] = spans(zoomNow());
    cam.tx -= (dx / W) * sx;
    cam.ty -= (dy / H) * sy;
  };

  const onDown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    screen.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state === "play") stopPlay();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.ztl };
      drag = null;
    } else {
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
      cam.flingX = 0;
      cam.flingY = 0;
    }
    screen.dataset.grab = "";
    wake();
  };

  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.ztl = clamp(pinch.z + Math.log(d / pinch.d), 0, Math.log(MAX_ZOOM));
      zoomShowUntil = performance.now() + 1400;
      return;
    }
    if (!drag) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dtm = Math.max(1, now - drag.t);
    drag.vx = drag.vx * 0.6 + (dx / dtm) * 0.4;
    drag.vy = drag.vy * 0.6 + (dy / dtm) * 0.4;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    panBy(dx, dy);
  };

  const onUp = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        drag = { x: p.x, y: p.y, t: performance.now(), vx: 0, vy: 0 };
      }
      return;
    }
    if (drag && pointers.size === 0) {
      const [sx, sy] = spans(zoomNow());
      const fx = clamp(-drag.vx * 1000 / W * sx, -1.2 * sx, 1.2 * sx);
      const fy = clamp(-drag.vy * 1000 / H * sy, -1.2 * sy, 1.2 * sy);
      if (performance.now() - drag.t < 80) {
        cam.flingX = fx;
        cam.flingY = fy;
      }
      drag = null;
      screen.removeAttribute("data-grab");
    }
  };

  const onWheel = (e) => {
    if (embedded && !e.ctrlKey) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    cam.ztl = clamp(cam.ztl - clamp(dy, -120, 120) * 0.004, 0, Math.log(MAX_ZOOM));
    zoomShowUntil = performance.now() + 1400;
    wake();
  };

  const rockerFrom = (e) => {
    const r = rtrack.getBoundingClientRect();
    const d = ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.1;
    return clamp(d, -1, 1);
  };

  const setRocker = (d) => {
    rockerDefl = d;
    thumb.style.setProperty("--d", d.toFixed(3));
  };

  const onRockerDown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    rocker.setPointerCapture(e.pointerId);
    rockerHeld = true;
    rocker.dataset.held = "";
    setRocker(rockerFrom(e));
    wake();
  };

  const onRockerMove = (e) => {
    if (!rockerHeld) return;
    setRocker(rockerFrom(e));
  };

  const onRockerUp = () => {
    if (!rockerHeld) return;
    rockerHeld = false;
    rocker.removeAttribute("data-held");
    setRocker(0);
  };

  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== document.body && t !== rocker && t.closest?.("input, textarea, a")) return;
    const k = e.key;
    if (k === "ArrowUp" || k === "t" || k === "T" || k === "=" || k === "+") {
      keyZoom = 0.75;
      setRocker(keyZoom);
    } else if (k === "ArrowDown" || k === "w" || k === "W" || k === "-") {
      keyZoom = -0.75;
      setRocker(keyZoom);
    } else if (k === "ArrowLeft") {
      panBy(60, 0);
    } else if (k === "ArrowRight") {
      panBy(-60, 0);
    } else if ((k === "r" || k === "R" || k === " ") && !t?.closest?.("button")) {
      toggleRec();
    } else if (k === "p" || k === "P") {
      togglePlay();
    } else return;
    e.preventDefault();
    wake();
  };

  const onKeyUp = (e) => {
    const k = e.key;
    if (["ArrowUp", "ArrowDown", "t", "T", "w", "W", "=", "+", "-"].includes(k)) {
      keyZoom = 0;
      if (!rockerHeld) setRocker(0);
    }
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  screen.addEventListener("pointerdown", onDown);
  screen.addEventListener("pointermove", onMove);
  screen.addEventListener("pointerup", onUp);
  screen.addEventListener("pointercancel", onUp);
  screen.addEventListener("wheel", onWheel, { passive: false });
  rocker.addEventListener("pointerdown", onRockerDown);
  rocker.addEventListener("pointermove", onRockerMove);
  rocker.addEventListener("pointerup", onRockerUp);
  rocker.addEventListener("pointercancel", onRockerUp);
  recBtn.addEventListener("click", toggleRec);
  playBtn.addEventListener("click", togglePlay);
  const keyTarget = embedded ? rig : window;
  keyTarget.addEventListener("keydown", onKeyDown);
  keyTarget.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(rig);

  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    if (destroyed) return;
    let source = img;
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const max = gl.maxSize || 4096;
    if (Math.max(w, h) > max) {
      const s = max / Math.max(w, h);
      const c = document.createElement("canvas");
      c.width = Math.floor(w * s);
      c.height = Math.floor(h * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      source = c;
      w = c.width;
      h = c.height;
    }
    gl.setPhoto(source, w, h);
    lumW = 48;
    lumH = Math.round(48 / photoAspect);
    const lc = document.createElement("canvas");
    lc.width = lumW;
    lc.height = lumH;
    const lx = lc.getContext("2d", { willReadFrequently: true });
    lx.drawImage(img, 0, 0, lumW, lumH);
    const px = lx.getImageData(0, 0, lumW, lumH).data;
    lum = new Float32Array(lumW * lumH);
    for (let i = 0; i < lum.length; i += 1) {
      const r = Math.pow(px[i * 4] / 255, 2.2);
      const g = Math.pow(px[i * 4 + 1] / 255, 2.2);
      const b = Math.pow(px[i * 4 + 2] / 255, 2.2);
      lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    keyLum = meter(cam.cx, cam.cy, zoomNow());
    cam.ev = 0.1;
    loaded = true;
    readyAt = performance.now();
    rig.dataset.ready = "";
    wake();
  };
  img.src = photo.src;
  rig.dataset.state = "stby";
  layout();

  return {
    async setSound(on) {
      if (on && !sound) sound = createCamSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      screen.removeEventListener("pointerdown", onDown);
      screen.removeEventListener("pointermove", onMove);
      screen.removeEventListener("pointerup", onUp);
      screen.removeEventListener("pointercancel", onUp);
      screen.removeEventListener("wheel", onWheel);
      rocker.removeEventListener("pointerdown", onRockerDown);
      rocker.removeEventListener("pointermove", onRockerMove);
      rocker.removeEventListener("pointerup", onRockerUp);
      rocker.removeEventListener("pointercancel", onRockerUp);
      recBtn.removeEventListener("click", toggleRec);
      playBtn.removeEventListener("click", togglePlay);
      keyTarget.removeEventListener("keydown", onKeyDown);
      keyTarget.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      rig.remove();
    },
  };
}
