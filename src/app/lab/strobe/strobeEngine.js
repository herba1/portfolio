import { createDeckAudio } from "./strobeAudio";
import { createStrobeGL } from "./strobeGL";
import { drawLabel, drawPrint } from "./strobePrint";

const TAU = Math.PI * 2;
const OMEGA33 = (TAU * (100 / 3)) / 60;
const OMEGA45 = TAU * 0.75;
const FLASH = 120;
const ROWS = [216, 180, 160, 133];
const R_PLAT = 166;
const Y_REC = 28.8;
const XF = 214;
const ZF0 = 140;
const HT = 50;
const CAP = [11.5, 7, 8.5];
const RANGE = 0.08;
const T_MAX = 6.5;
const K_MOTOR = 30;
const BRAKE = 4.6;
const KS = 3200;
const CS = 95;
const HAND_MAX = 600;
const KF = 2400;
const CF = 92;
const F_FRIC = 9;
const DETENT = 0.045;
const DETENT_F = 70;
const SUB = 1 / 1000;
const LAMP_C = [30, 198];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapHalf = (x) => x - Math.round(x);
const fract = (x) => x - Math.floor(x);
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function formatPitch(p) {
  const v = p * 100;
  if (Math.abs(v) < 0.005) return "0.00%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

export function createStrobeEngine({ box, stage, canvas, tag, meter, insets, embedded, onSound, onReady, onFail, onAnnounce, onState }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, quality: 1, focal: 800, center: [0, 0], cam: null };
  const audio = createDeckAudio("/blog/audio/friday-beat.wav");
  const plat = { phi: 0.9, w: 0, motor: !reduced, speed: 33 };
  const fader = { u: 0.06, v: 0, held: false, target: 0.06, grab: 0, id: null, locked: false, inDetent: false, glow: 0 };
  const hand = { id: null, active: false, phiT: 0, phiPrev: 0, w: 0, theta: 0, jog: 0 };
  const rows = { a: ROWS.map(() => 0), d: ROWS.map(() => 0), lastPhi: 0 };
  let simT = 0;
  let nextFlash = 1 / FLASH;
  let lastFlashT = 0;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let soundState = "off";
  let userMuted = false;
  let lock = 0;
  let tagText = "";
  let tagShown = false;
  let tagHold = 0;
  let cursor = "";
  let interval = 16;
  let slowFrames = 0;
  let readySent = false;
  let lockedAnnounced = false;
  let meterLevels = [0, 0, 0, 0];
  let meterShown = "";
  let clock = 0;

  plat.w = plat.motor ? targetOmega() : 0;
  rows.lastPhi = plat.phi;
  ROWS.forEach((n, i) => {
    rows.a[i] = fract((n * plat.phi) / TAU);
    rows.d[i] = wrapHalf((n * plat.w) / (FLASH * TAU));
  });

  function pitch() {
    return fader.locked ? 0 : fader.u * RANGE;
  }

  function nominal() {
    return plat.speed === 45 ? OMEGA45 : OMEGA33;
  }

  function targetOmega() {
    return nominal() * (1 + pitch());
  }

  function setSound(next) {
    if (next === soundState) return;
    soundState = next;
    onSound(next);
  }

  function startAudio() {
    if (userMuted) return;
    if (!audio.started) {
      audio.start();
      setSound("on");
      onAnnounce("Sound on.");
    } else audio.wake();
  }

  function toggleSound() {
    if (!audio.started) {
      userMuted = false;
      startAudio();
      wake();
      return;
    }
    userMuted = soundState === "on";
    audio.setMuted(userMuted);
    setSound(userMuted ? "muted" : "on");
    onAnnounce(userMuted ? "Sound off." : "Sound on.");
    wake();
  }

  function camera(az, el, dist, target) {
    const pos = add3(target, mul3([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], dist));
    const fwd = norm3(sub3(target, pos));
    const right = norm3(cross3(fwd, [0, 1, 0]));
    const up = cross3(right, fwd);
    return { pos, fwd, right, up };
  }

  function project(cam, p, focal, center) {
    const v = sub3(p, cam.pos);
    const z = dot3(v, cam.fwd);
    if (z < 1) return null;
    return [center[0] + (dot3(v, cam.right) / z) * focal, center[1] - (dot3(v, cam.up) / z) * focal];
  }

  function fitPoints(k) {
    const pts = [];
    const from = 26 + 30 * k;
    const span = 75 - 47 * k;
    for (let i = 0; i <= 10; i++) {
      const th = ((from + (i / 10) * span) * Math.PI) / 180;
      pts.push([Math.cos(th) * R_PLAT, 3, Math.sin(th) * R_PLAT]);
      pts.push([Math.cos(th) * R_PLAT, Y_REC, Math.sin(th) * R_PLAT]);
    }
    if (k < 0.5) pts.push([LAMP_C[0] + 4, 0, LAMP_C[1] + 12]);
    if (k < 0.5) pts.push([0, Y_REC, -R_PLAT * 0.9]);
    pts.push([XF + 30 - 14 * k, 0, ZF0 - HT - 12], [XF + 30 - 14 * k, 0, ZF0 + HT + 14], [XF - 26 + 8 * k, 0, ZF0 + HT + 14]);
    return pts;
  }

  function layout() {
    const pad = insets();
    const W = view.width;
    const H = view.height;
    const safe = { l: pad.left, t: pad.top, r: W - pad.right, b: H - pad.bottom };
    const sw = Math.max(80, safe.r - safe.l);
    const sh = Math.max(80, safe.b - safe.t);
    const aspect = sw / sh;
    const k = clamp((1.25 - aspect) / 0.75, 0, 1);
    const az = (38 - 6 * k) * (Math.PI / 180);
    const el = (13 + 14 * k) * (Math.PI / 180);
    const vfov = (26 + 16 * k) * (Math.PI / 180);
    const target = [90, 14, 150];
    const focal = H / 2 / Math.tan(vfov / 2);
    const pts = fitPoints(k);
    const measure = (dist) => {
      const cam = camera(az, el, dist, target);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        const s = project(cam, p, focal, [0, 0]);
        if (!s) return null;
        x0 = Math.min(x0, s[0]);
        x1 = Math.max(x1, s[0]);
        y0 = Math.min(y0, s[1]);
        y1 = Math.max(y1, s[1]);
      }
      return { cam, x0, x1, y0, y1 };
    };
    let lo = 120;
    let hi = 4000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      if (m && m.x1 - m.x0 <= sw && m.y1 - m.y0 <= sh) hi = mid;
      else lo = mid;
    }
    const m = measure(hi);
    view.cam = m.cam;
    view.focal = focal;
    view.center = [(safe.l + safe.r) / 2 - (m.x0 + m.x1) / 2, (safe.t + safe.b) / 2 - (m.y0 + m.y1) / 2];
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(3200000 / Math.max(1, view.width * view.height));
    view.dpr = Math.max(0.75, Math.min(Math.max(dprCap, 1.5), budget, 2));
    layout();
    applyQuality(view.quality);
    wake();
  }

  function applyQuality(q) {
    view.quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function rayFrom(e) {
    const rect = box.getBoundingClientRect();
    const x = e.clientX - rect.left - view.center[0];
    const y = e.clientY - rect.top - view.center[1];
    const c = view.cam;
    const d = norm3(add3(add3(mul3(c.fwd, view.focal), mul3(c.right, x)), mul3(c.up, -y)));
    return { o: c.pos, d };
  }

  function hitBoxRay(ray, c, h) {
    let tn = -Infinity;
    let tf = Infinity;
    for (let a = 0; a < 3; a++) {
      const d = ray.d[a];
      const o = ray.o[a];
      if (Math.abs(d) < 1e-9) {
        if (o < c[a] - h[a] || o > c[a] + h[a]) return -1;
        continue;
      }
      let t0 = (c[a] - h[a] - o) / d;
      let t1 = (c[a] + h[a] - o) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tn = Math.max(tn, t0);
      tf = Math.min(tf, t1);
    }
    return tn <= tf && tn > 0 ? tn : -1;
  }

  function hitCylRay(ray, r, y0, y1) {
    const { o, d } = ray;
    const a = d[0] * d[0] + d[2] * d[2];
    if (a < 1e-9) return -1;
    const b = o[0] * d[0] + o[2] * d[2];
    const cc = o[0] * o[0] + o[2] * o[2] - r * r;
    const h = b * b - a * cc;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = o[1] + d[1] * t;
    return t > 0 && y >= y0 && y <= y1 ? t : -1;
  }

  function planeT(ray, y) {
    if (Math.abs(ray.d[1]) < 1e-6) return -1;
    const t = (y - ray.o[1]) / ray.d[1];
    return t > 0 ? t : -1;
  }

  function capCenter() {
    return [XF, 2 + CAP[1], ZF0 + fader.u * HT];
  }

  function hitFader(ray, touch) {
    const s = touch ? 9 : 4;
    return hitBoxRay(ray, capCenter(), [CAP[0] + s, CAP[1] + s * 0.6, CAP[2] + s]);
  }

  function hitPlatter(ray, touch) {
    const s = touch ? 10 : 3;
    const tc = hitCylRay(ray, R_PLAT + s, 0, Y_REC + 2);
    if (tc > 0) return tc;
    const tp = planeT(ray, Y_REC);
    if (tp > 0) {
      const p = add3(ray.o, mul3(ray.d, tp));
      if (Math.hypot(p[0], p[2]) < R_PLAT + s) return tp;
    }
    return -1;
  }

  function angleOf(ray) {
    let t = hitCylRay(ray, R_PLAT, -40, 60);
    if (t < 0) t = planeT(ray, Y_REC);
    if (t < 0) t = planeT(ray, 0);
    if (t < 0) return null;
    const p = add3(ray.o, mul3(ray.d, t));
    return Math.atan2(p[2], p[0]);
  }

  function capZFrom(ray) {
    const t = planeT(ray, 2 + CAP[1] * 2);
    if (t < 0) return null;
    return ray.o[2] + ray.d[2] * t;
  }

  const pointers = new Map();

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!view.cam) return;
    const ray = rayFrom(e);
    const touch = e.pointerType !== "mouse";
    const tf = fader.id === null ? hitFader(ray, touch) : -1;
    const tp = hand.id === null ? hitPlatter(ray, touch) : -1;
    let role = null;
    if (tf > 0 && (tp < 0 || tf <= tp + 30)) role = "fader";
    else if (tp > 0) role = "platter";
    if (!role) return;
    e.preventDefault();
    stage.focus({ preventScroll: true });
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, role);
    startAudio();
    if (role === "fader") {
      const z = capZFrom(ray);
      fader.id = e.pointerId;
      fader.held = true;
      fader.grab = z === null ? 0 : z - (ZF0 + fader.u * HT);
      fader.target = fader.u;
    } else {
      const th = angleOf(ray);
      hand.id = e.pointerId;
      hand.active = true;
      hand.theta = th ?? 0;
      hand.phiT = plat.phi;
      hand.phiPrev = plat.phi;
      hand.w = plat.w;
    }
    setCursor("grabbing");
    wake();
  }

  function onMove(e) {
    if (!view.cam) return;
    const role = pointers.get(e.pointerId);
    const ray = rayFrom(e);
    if (!role) {
      if (e.pointerType !== "mouse") return;
      const over = hitFader(ray, false) > 0 || hitPlatter(ray, false) > 0;
      setCursor(over ? "grab" : "");
      const glow = hitFader(ray, false) > 0;
      if (glow !== fader.hover) {
        fader.hover = glow;
        wake();
      }
      return;
    }
    if (role === "fader") {
      const z = capZFrom(ray);
      if (z !== null) fader.target = clamp((z - fader.grab - ZF0) / HT, -1.08, 1.08);
    } else {
      const th = angleOf(ray);
      if (th !== null) {
        const d = th - hand.theta;
        hand.theta = th;
        hand.phiT += d - TAU * Math.round(d / TAU);
      }
    }
    wake();
  }

  function onUp(e) {
    const role = pointers.get(e.pointerId);
    if (!role) return;
    pointers.delete(e.pointerId);
    if (role === "fader") {
      fader.id = null;
      fader.held = false;
      tagHold = 0.9;
    } else {
      hand.id = null;
      hand.active = false;
    }
    setCursor("grab");
    wake();
  }

  function setCursor(next) {
    if (next === cursor) return;
    cursor = next;
    stage.style.cursor = next;
  }

  function setPitchKeyboard(u) {
    fader.u = clamp(u, -1, 1);
    fader.v = 0;
    fader.target = fader.u;
    tagHold = 1.2;
    if (Math.abs(fader.u) < 1e-6) {
      fader.u = 0;
      engageLock(true);
    }
    wake();
  }

  function onKey(e) {
    if (e.target !== stage) return;
    const step = e.shiftKey || e.key === "PageUp" || e.key === "PageDown" ? 0.125 : 0.0125;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!e.repeat) pressKey(0);
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      e.preventDefault();
      startAudio();
      setPitchKeyboard(Math.round((fader.u - step) / 0.0125) * 0.0125);
    } else if (e.key === "ArrowDown" || e.key === "PageDown") {
      e.preventDefault();
      startAudio();
      setPitchKeyboard(Math.round((fader.u + step) / 0.0125) * 0.0125);
    } else if (e.key === "Home" || e.key === "0") {
      e.preventDefault();
      startAudio();
      setPitchKeyboard(0);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      startAudio();
      hand.jog = e.key === "ArrowLeft" ? 1 : -1;
    } else if (e.key === "3") {
      pressKey(1);
    } else if (e.key === "4") {
      pressKey(2);
    } else if (e.key === "m" || e.key === "M") {
      toggleSound();
    } else return;
    wake();
  }

  function onKeyUp(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      hand.jog = 0;
      wake();
    }
  }

  function pressKey(i) {
    startAudio();
    if (i === 0) {
      plat.motor = !plat.motor;
      onAnnounce(plat.motor ? `Motor on, spinning up to ${plat.speed === 45 ? "45" : "33⅓"}.` : "Motor off, braking.");
    } else {
      const next = i === 1 ? 33 : 45;
      if (plat.speed !== next) {
        plat.speed = next;
        onAnnounce(`Speed ${next === 45 ? "45" : "33⅓"}.`);
      }
      if (!plat.motor) plat.motor = true;
    }
    audio.click(0.25);
    emitState();
    wake();
  }

  function emitState() {
    onState({ motor: plat.motor, speed: plat.speed });
  }

  function engageLock(fromKeys) {
    if (fader.locked) return;
    fader.locked = true;
    fader.v = 0;
    if (fromKeys) fader.u = 0;
    audio.click(0.5);
    if (fader.held && typeof navigator.vibrate === "function") navigator.vibrate(6);
  }

  function stepFader(h) {
    const u = fader.u;
    let a = 0;
    if (fader.held) a += KF * (fader.target - u) - CF * fader.v;
    if (Math.abs(u) < DETENT) a += -DETENT_F * Math.sin((Math.PI * u) / DETENT);
    const fr = F_FRIC * (fader.held ? 0.5 : 1);
    const vNext = fader.v + a * h;
    if (Math.abs(vNext) <= fr * h && !fader.held) fader.v = 0;
    else fader.v = vNext - Math.sign(vNext) * Math.min(Math.abs(vNext), fr * h);
    if (!fader.held) fader.v *= Math.exp(-h * 6);
    fader.u += fader.v * h;
    if (fader.u > 1) {
      fader.u = 1;
      fader.v = Math.min(0, fader.v);
    } else if (fader.u < -1) {
      fader.u = -1;
      fader.v = Math.max(0, fader.v);
    }
    const inside = Math.abs(fader.u) < DETENT * 0.32 && Math.abs(fader.v) < 0.5;
    if (fader.locked) {
      if (Math.abs(fader.u) > DETENT * 0.55) {
        fader.locked = false;
        audio.click(0.18);
      } else if (!fader.held) {
        fader.u *= Math.exp(-h * 40);
      }
    } else if (inside) engageLock(false);
  }

  function stepPlatter(h, frac) {
    let tq;
    if (plat.motor) {
      const target = targetOmega();
      const err = target - plat.w;
      tq = T_MAX * Math.tanh((K_MOTOR * err) / T_MAX) + 0.015 * target;
    } else tq = -BRAKE * Math.tanh(plat.w / 0.06);
    tq -= 0.015 * plat.w;
    if (hand.active) {
      const phiH = hand.phiPrev + (hand.phiT - hand.phiPrev) * frac;
      const th = clamp(KS * (phiH - plat.phi) + CS * (hand.w - plat.w), -HAND_MAX, HAND_MAX);
      tq += th;
    }
    if (hand.jog) tq += hand.jog * 9;
    plat.w += tq * h;
    if (!plat.motor && !hand.active && !hand.jog && Math.abs(plat.w) < 0.004) plat.w = 0;
    plat.phi += plat.w * h;
  }

  function integrate(span, t0, frameStart, frameDt) {
    if (span <= 0) return;
    const steps = Math.max(1, Math.ceil(span / SUB));
    const h = span / steps;
    for (let i = 0; i < steps; i++) {
      const tNow = t0 + (i + 0.5) * h;
      const frac = clamp((tNow - frameStart) / Math.max(frameDt, 1e-4), 0, 1);
      stepPlatter(h, frac);
      stepFader(h);
    }
  }

  function flash() {
    const dPhi = plat.phi - rows.lastPhi;
    rows.lastPhi = plat.phi;
    for (let i = 0; i < ROWS.length; i++) {
      const inc = wrapHalf((ROWS[i] * dPhi) / TAU);
      rows.a[i] = fract(rows.a[i] + inc);
      rows.d[i] = inc;
    }
  }

  function simulate(dt) {
    const frameStart = simT;
    const end = simT + dt;
    if (hand.active) {
      const inst = (hand.phiT - hand.phiPrev) / dt;
      hand.w += (inst - hand.w) * (1 - Math.exp(-dt / 0.03));
    }
    while (nextFlash <= end) {
      integrate(nextFlash - simT, simT, frameStart, dt);
      simT = nextFlash;
      flash();
      lastFlashT = simT;
      nextFlash += 1 / FLASH;
    }
    integrate(end - simT, simT, frameStart, dt);
    simT = end;
    hand.phiPrev = hand.phiT;
    if (simT > 1e4) {
      simT -= 1e4;
      nextFlash -= 1e4;
      lastFlashT -= 1e4;
    }
    if (Math.abs(plat.phi) > 1e5) {
      const k = TAU * Math.floor(plat.phi / TAU);
      plat.phi -= k;
      rows.lastPhi -= k;
      hand.phiT -= k;
      hand.phiPrev -= k;
    }
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;
    clock += dt;
    simulate(dt);

    const tgt = targetOmega();
    const lockOn = plat.motor && fader.locked && !hand.active && Math.abs(plat.w - tgt) / tgt < 2.5e-4 ? 1 : 0;
    lock += (lockOn - lock) * (1 - Math.exp(-dt / (lockOn ? 0.09 : 0.05)));
    if (Math.abs(lock - lockOn) < 0.003) lock = lockOn;
    if (lockOn && !lockedAnnounced) {
      lockedAnnounced = true;
      onAnnounce(`Locked at ${plat.speed === 45 ? "45" : "33⅓"}. The ${plat.speed === 45 ? "45" : "33"} row stands still.`);
    } else if (!lockOn && lockedAnnounced && lock < 0.01) lockedAnnounced = false;
    fader.glow += ((fader.held ? 1 : fader.hover ? 0.5 : 0) - fader.glow) * (1 - Math.exp(-dt / 0.08));
    if (Math.abs(fader.glow - (fader.held ? 1 : fader.hover ? 0.5 : 0)) < 0.004) fader.glow = fader.held ? 1 : fader.hover ? 0.5 : 0;
    tagHold = Math.max(0, tagHold - dt);

    audio.setRate(plat.w / OMEGA33);
    render(dt);
    updateTag();
    updateMeter(dt);

    const spinning = plat.motor || Math.abs(plat.w) > 1e-4 || hand.active || hand.jog;
    const faderBusy = fader.held || Math.abs(fader.v) > 1e-4 || (fader.locked && Math.abs(fader.u) > 1e-6);
    const busy = spinning || faderBusy || (lock > 0 && lock < 1) || Math.abs(fader.glow - (fader.held ? 1 : fader.hover ? 0.5 : 0)) > 0 || tagHold > 0 || meterLevels.some((l) => l > 0.01);
    if (raw > 0 && busy) {
      interval = interval * 0.85 + raw * 0.15;
      if (interval > 30) slowFrames += 1;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 40 && view.quality > 0.55) {
        applyQuality(Math.max(0.55, view.quality * 0.85));
        slowFrames = 0;
      }
    }
    if (busy) raf = requestAnimationFrame(frame);
    else audio.sleep();
  }

  function render(dt) {
    if (!view.cam) return;
    const frac = clamp((simT - lastFlashT) * FLASH, 0, 1);
    const rowA = new Float32Array(4);
    const rowD = new Float32Array(4);
    for (let i = 0; i < 4; i++) {
      rowA[i] = fract(rows.a[i] + rows.d[i] * frac);
      rowD[i] = rows.d[i];
    }
    const s = view.dpr * view.quality;
    gl.draw({
      center: [view.center[0] * s, view.center[1] * s],
      focal: view.focal * s,
      cam: { pos: new Float32Array(view.cam.pos), fwd: new Float32Array(view.cam.fwd), right: new Float32Array(view.cam.right), up: new Float32Array(view.cam.up) },
      phi: fract(plat.phi / TAU) * TAU,
      omega: plat.w,
      labelBlur: reduced ? 0 : Math.min(Math.abs(plat.w) * Math.min(dt, 1 / 50) * 0.6, 0.5),
      lamp: 1,
      rowA,
      rowD,
      capZ: ZF0 + fader.u * HT,
      capGlow: fader.glow,
      lock,
      shutter: 1 / 120,
      time: clock % 1000,
      motor: plat.motor ? 1 : 0,
    });
    if (!readySent && gl.flags.print) {
      readySent = true;
      onReady();
    }
  }

  function updateTag() {
    if (!tag) return;
    const show = fader.held || tagHold > 0;
    let text = tagText;
    if (show) {
      const rpm = (Math.abs(plat.w) * 60) / TAU;
      text = `${formatPitch(pitch())}  ·  ${rpm.toFixed(2)} rpm`;
    }
    if (text !== tagText) {
      tag.textContent = text;
      tagText = text;
    }
    if (show !== tagShown) {
      tag.dataset.show = show ? "true" : "false";
      tagShown = show;
    }
    if (show && view.cam) {
      const c = capCenter();
      const s = project(view.cam, [c[0] - CAP[0] - 6, c[1] + CAP[1], c[2]], view.focal, view.center);
      if (s) {
        const x = clamp(s[0], 8, view.width - 8);
        const y = clamp(s[1] - 22, 8, view.height - 8);
        tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-100%, -50%)`;
      }
    }
  }

  function updateMeter(dt) {
    if (!meter) return;
    const lvl = audio.level();
    const target = soundState === "on" ? clamp(lvl * 4.2, 0, 1) : 0;
    const k = 1 - Math.exp(-dt / 0.06);
    meterLevels = meterLevels.map((l, i) => {
      const jitter = 0.55 + 0.45 * Math.abs(Math.sin(plat.phi * (i + 2) * 3.1 + i));
      return l + (target * jitter - l) * k;
    });
    const shown = meterLevels.map((l) => l.toFixed(2)).join(",");
    if (shown === meterShown) return;
    meterShown = shown;
    [...meter.children].forEach((bar, i) => {
      bar.style.transform = `scaleY(${(0.25 + 0.75 * meterLevels[i]).toFixed(3)})`;
    });
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    audio.wake();
    raf = requestAnimationFrame(frame);
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createStrobeGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    resize();
    const style = getComputedStyle(box);
    const fonts = {
      sans: style.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
      mono: style.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
      serif: style.getPropertyValue("--strobe-serif").trim() || "Georgia, serif",
    };
    drawLabel(fonts)
      .then((c) => {
        if (destroyed || !gl) return;
        gl.setLabel(c);
        if (!raf) render(1 / 60);
      })
      .catch(() => {});
    drawPrint(fonts)
      .then((c) => {
        if (destroyed || !gl) return;
        gl.setPrint(c);
        wake();
        if (!raf) render(1 / 60);
      })
      .catch(() => {
        if (!destroyed) onReady();
      });
    wake();
    if (!raf) render(1 / 60);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        audio.sleep();
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    resize();
    if (gl && !raf) render(1 / 60);
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) audio.sleep();
    else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("keyup", onKeyUp);
  const onBlur = () => {
    hand.jog = 0;
  };
  stage.addEventListener("blur", onBlur);
  emitState();

  return {
    toggleSound,
    pressKey,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("keyup", onKeyUp);
      stage.removeEventListener("blur", onBlur);
      audio.destroy();
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
