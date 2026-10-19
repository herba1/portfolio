import { createBurnAudio } from "./burnAudio";
import { createBurnGL } from "./burnGL";

const TAU = Math.PI * 2;
const SUB = 1 / 240;
const CAPACITY = 74 * 60;
const R0 = 25;
const R1 = 58;
const LEAD_IN = 0.7;
const WRITE = 5.6;
const LEAD_OUT = 0.5;
const SPIN = 40;
const INK = 1024;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function spring(s, key, velKey, target, omega, zeta, h) {
  const a = omega * omega * (target - s[key]) - 2 * zeta * omega * s[velKey];
  s[velKey] += a * h;
  s[key] += s[velKey] * h;
}

function matrix(pitch, roll, flip) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll + flip);
  const sr = Math.sin(roll + flip);
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const ry = [cr, 0, -sr, 0, 1, 0, sr, 0, cr];
  const o = new Float32Array(9);
  for (let col = 0; col < 3; col += 1) {
    for (let r = 0; r < 3; r += 1) o[col * 3 + r] = rx[r] * ry[col * 3] + rx[3 + r] * ry[col * 3 + 1] + rx[6 + r] * ry[col * 3 + 2];
  }
  return o;
}

export function radiusAt(seconds) {
  const k = (R1 * R1 - R0 * R0) / CAPACITY;
  return Math.sqrt(R0 * R0 + k * Math.max(0, seconds)) / 60;
}

export function createBurn(root, { onPhase, onTrack, onReady, onFail } = {}) {
  const q = (name) => root.querySelector(`[data-burn="${name}"]`);
  const stage = q("stage");
  const canvas = q("canvas");
  const discbox = q("discbox");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const view = { w: 1, h: 1, dpr: 1 };
  const lay = { R: 140, x: 0, y: 0 };
  const disc = {
    x: 0, y: 0, vx: 0, vy: 0, z: 0, vz: 0, tx: 0, ty: 0, tz: 0,
    pitch: 0, vpitch: 0, roll: 0, vroll: 0, flip: Math.PI, vflip: 0, flipTarget: Math.PI,
    spin: 0.6, omega: 0, tp: 0, tr: 0,
  };
  const pointer = { id: null, hover: false, hx: 0, hy: 0, drawing: false, last: null, speed: 0, lastT: 0 };
  const marks = new Float32Array(24);
  let markCount = 0;
  let plan = [];
  let planR = radiusAt(0);
  let burnR = 0;
  let phase = "plan";
  let phaseT = 0;
  let trackIndex = -1;
  let laser = 0;
  let laserAngle = -0.5;
  let eject = null;
  let gl = null;
  let audio = null;
  let soundOn = false;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let alpha = 0;
  let inkDirty = false;
  let markerLevel = 0;
  let statusKey = "";

  const ink = document.createElement("canvas");
  ink.width = INK;
  ink.height = INK;
  const inkCtx = ink.getContext("2d");

  try {
    gl = createBurnGL(canvas);
  } catch {
    gl = null;
  }
  if (!gl) {
    onFail?.();
    return { destroy() {}, setSound: async () => false, setPlan() {}, burn() {}, eject() {}, flip() {} };
  }
  gl.setInk(ink, true);

  function panOf(x) {
    return clamp((x / view.w) * 2 - 1, -1, 1) * 0.6;
  }

  function measure() {
    const rect = stage.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(3200000 / Math.max(1, view.w * view.h));
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    gl.resize(Math.round(view.w * view.dpr), Math.round(view.h * view.dpr));
    const box = discbox.getBoundingClientRect();
    lay.R = Math.max(60, Math.min(230, Math.min(box.width, box.height) / 2 - 8));
    lay.x = box.left - rect.left + box.width / 2;
    lay.y = box.top - rect.top + box.height / 2;
    if (!eject) {
      disc.x = lay.x;
      disc.y = lay.y;
      disc.tx = lay.x;
      disc.ty = lay.y;
    }
    wake();
  }

  function eyeZ() {
    return Math.max(view.w, view.h) * 1.7 + 600;
  }

  function setStatus(text) {
    const el = q("status");
    if (!el || (text === statusKey && el.textContent === text)) return;
    statusKey = text;
    if (text) el.textContent = text;
  }

  function setPhase(next) {
    phase = next;
    phaseT = 0;
    root.setAttribute("data-phase", next);
    onPhase?.(next);
    wake();
  }

  function setPlan(seconds) {
    plan = seconds.slice(0, 24);
    let t = 0;
    markCount = 0;
    plan.forEach((s, i) => {
      t += s;
      if (i < plan.length - 1) {
        marks[markCount] = radiusAt(t);
        markCount += 1;
      }
    });
    planR = plan.length ? radiusAt(t) : radiusAt(0);
    wake();
  }

  function burn() {
    if (phase !== "plan" || !plan.length) return;
    trackIndex = -1;
    burnR = radiusAt(0) - 0.01;
    laserAngle = -0.5;
    audio?.seek(5);
    audio?.motorStart(1);
    setPhase("burning");
    root.style.setProperty("--burn-progress", "0");
  }

  function flip() {
    if (phase === "burning" || eject) return;
    disc.flipTarget = disc.flipTarget > Math.PI / 2 ? 0 : Math.PI;
    disc.vflip += disc.flipTarget > Math.PI / 2 ? 2 : -2;
    audio?.whoosh(panOf(disc.x));
    root.setAttribute("data-side", disc.flipTarget > Math.PI / 2 ? "data" : "label");
    wake();
  }

  function startEject() {
    if (phase === "burning" || eject) return;
    audio?.lidOpen(panOf(disc.x));
    audio?.whoosh(panOf(disc.x));
    eject = { stage: "out", t: 0 };
    disc.tx = view.w + lay.R * 1.4;
    disc.tz = lay.R * 0.3;
    setPhase("ejecting");
  }

  function resetDisc() {
    inkCtx.clearRect(0, 0, INK, INK);
    gl.setInk(ink, true);
    burnR = 0;
    trackIndex = -1;
    disc.flip = Math.PI;
    disc.flipTarget = Math.PI;
    disc.vflip = 0;
    disc.spin = 0.6;
    disc.omega = 0;
    root.setAttribute("data-side", "data");
    disc.x = -lay.R * 1.4;
    disc.vx = 0;
    disc.tx = lay.x;
    disc.ty = lay.y;
    disc.tz = lay.R * 0.3;
    disc.z = lay.R * 0.3;
  }

  function toLocal(px, py) {
    const D = eyeZ();
    const eye = [view.w / 2, view.h / 2, D];
    const rot = matrix(disc.pitch, disc.roll, disc.flip);
    const U = [rot[0], rot[1], rot[2]];
    const V = [rot[3], rot[4], rot[5]];
    const N = [rot[6], rot[7], rot[8]];
    const dir = [px - eye[0], py - eye[1], -eye[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    dir[0] /= len;
    dir[1] /= len;
    dir[2] /= len;
    const C = [disc.x, disc.y, disc.z + 1.5];
    const den = dir[0] * N[0] + dir[1] * N[1] + dir[2] * N[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((C[0] - eye[0]) * N[0] + (C[1] - eye[1]) * N[1] + (C[2] - eye[2]) * N[2]) / den;
    const H = [eye[0] + dir[0] * t - C[0], eye[1] + dir[1] * t - C[1], eye[2] + dir[2] * t - C[2]];
    const lx = (H[0] * U[0] + H[1] * U[1] + H[2] * U[2]) / lay.R;
    const ly = (H[0] * V[0] + H[1] * V[1] + H[2] * V[2]) / lay.R;
    const a = -disc.spin;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: c * lx - s * ly, y: s * lx + c * ly, r: Math.hypot(lx, ly) };
  }

  function inkPoint(p) {
    return { x: (p.x * 0.5 + 0.5) * INK, y: (p.y * 0.5 + 0.5) * INK, r: p.r };
  }

  const MM = INK / 120;

  function dab(a, b, speed) {
    const width = MM * (1.45 - 0.35 * clamp(speed / 900, 0, 1));
    inkCtx.save();
    inkCtx.beginPath();
    inkCtx.arc(INK / 2, INK / 2, 59 * MM, 0, TAU);
    inkCtx.arc(INK / 2, INK / 2, 17.8 * MM, 0, TAU, true);
    inkCtx.clip();
    inkCtx.strokeStyle = "rgba(10,10,14,0.96)";
    inkCtx.fillStyle = "rgba(10,10,14,0.96)";
    inkCtx.lineCap = "round";
    inkCtx.lineJoin = "round";
    inkCtx.lineWidth = width;
    if (!b) {
      inkCtx.beginPath();
      inkCtx.arc(a.x, a.y, width * 0.62, 0, TAU);
      inkCtx.fill();
    } else {
      inkCtx.beginPath();
      inkCtx.moveTo(a.x, a.y);
      inkCtx.lineTo(b.x, b.y);
      inkCtx.stroke();
    }
    inkCtx.restore();
    inkDirty = true;
  }

  function local(e) {
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function canWrite() {
    return phase === "burned" && disc.flipTarget < Math.PI / 2 && Math.abs(disc.flip) < 0.15 && !eject;
  }

  function onDown(e) {
    if (pointer.id !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button, a, input, [data-burn-panel]")) return;
    ensureAudio();
    const p = local(e);
    const d = Math.hypot(p.x - disc.x, p.y - disc.y);
    if (d > lay.R) return;
    if (canWrite()) {
      const lp = toLocal(p.x, p.y);
      if (!lp) return;
      e.preventDefault();
      pointer.id = e.pointerId;
      stage.setPointerCapture?.(e.pointerId);
      pointer.drawing = true;
      pointer.last = inkPoint(lp);
      pointer.lastT = performance.now();
      pointer.speed = 0;
      dab(pointer.last, null, 0);
      root.setAttribute("data-writing", "");
      wake();
    } else if (phase === "plan" || phase === "burned") {
      e.preventDefault();
      pointer.id = e.pointerId;
      stage.setPointerCapture?.(e.pointerId);
      pointer.drawing = false;
      pointer.lastT = performance.now();
      pointer.spinAngle = Math.atan2(p.y - disc.y, p.x - disc.x);
      pointer.ema = 0;
      wake();
    }
  }

  function onMove(e) {
    const p = local(e);
    if (e.pointerType === "mouse" || pointer.id === e.pointerId) {
      pointer.hover = true;
      pointer.hx = p.x;
      pointer.hy = p.y;
      root.toggleAttribute("data-over-disc", Math.hypot(p.x - disc.x, p.y - disc.y) < lay.R);
    }
    if (pointer.id !== e.pointerId) {
      if (e.pointerType === "mouse") wake();
      return;
    }
    const now = performance.now();
    const dt = Math.max(1, now - pointer.lastT) / 1000;
    pointer.lastT = now;
    if (pointer.drawing) {
      const lp = toLocal(p.x, p.y);
      if (!lp) return;
      const ip = inkPoint(lp);
      const dist = Math.hypot(ip.x - pointer.last.x, ip.y - pointer.last.y);
      const speed = (dist / dt) * (lay.R / (INK / 2));
      pointer.speed = pointer.speed * 0.7 + speed * 0.3;
      if (dist > 0.6) {
        dab(pointer.last, ip, pointer.speed);
        pointer.last = ip;
      }
    } else {
      const a = Math.atan2(p.y - disc.y, p.x - disc.x);
      let da = a - pointer.spinAngle;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      pointer.spinAngle = a;
      disc.spin += da;
      pointer.ema = pointer.ema * 0.7 + clamp(da / dt, -24, 24) * 0.3;
    }
    wake();
  }

  function onUp(e) {
    if (pointer.id !== e.pointerId) return;
    pointer.id = null;
    if (pointer.drawing) {
      pointer.drawing = false;
      pointer.speed = 0;
      root.removeAttribute("data-writing");
    } else {
      const stale = performance.now() - pointer.lastT > 90;
      disc.omega = stale ? 0 : clamp(pointer.ema, -24, 24);
    }
    if (e.pointerType !== "mouse") pointer.hover = false;
    wake();
  }

  function ensureAudio() {
    if (!soundOn || audio) return;
    audio = createBurnAudio();
  }

  function stepPhase(dt) {
    phaseT += dt;
    if (phase === "burning") {
      const total = plan.reduce((a, b) => a + b, 0);
      const startR = radiusAt(0);
      let audioPos = 0;
      if (phaseT < LEAD_IN) {
        burnR = startR - 0.012 + 0.012 * (phaseT / LEAD_IN);
        laser = Math.min(1, phaseT / 0.3);
        setStatus("Writing lead-in");
      } else if (phaseT < LEAD_IN + WRITE) {
        const k = (phaseT - LEAD_IN) / WRITE;
        audioPos = total * k;
        burnR = radiusAt(audioPos);
        let t = 0;
        let idx = 0;
        for (let i = 0; i < plan.length; i += 1) {
          if (audioPos >= t) idx = i;
          t += plan[i];
        }
        if (idx !== trackIndex) {
          trackIndex = idx;
          onTrack?.(idx);
          if (idx > 0) audio?.sled();
        }
        laser = 1;
        setStatus(`Writing track ${idx + 1} of ${plan.length}`);
      } else if (phaseT < LEAD_IN + WRITE + LEAD_OUT) {
        burnR = planR + 0.01 * ((phaseT - LEAD_IN - WRITE) / LEAD_OUT);
        laser = 1;
        if (trackIndex !== plan.length) {
          trackIndex = plan.length;
          onTrack?.(plan.length);
        }
        setStatus("Closing the session");
      } else {
        burnR = planR + 0.01;
        laser = 0;
        audio?.motorStop();
        setStatus("");
        setPhase("cooling");
      }
      const progress = clamp((phaseT - LEAD_IN * 0.4) / (WRITE + LEAD_IN * 0.6 + LEAD_OUT), 0, 1);
      root.style.setProperty("--burn-progress", progress.toFixed(4));
    } else if (phase === "cooling") {
      laser = Math.max(0, laser - dt * 4);
      if (phaseT > 0.7) {
        setPhase("burned");
        disc.flipTarget = 0;
        disc.vflip -= 2;
        root.setAttribute("data-side", "label");
        audio?.whoosh(panOf(disc.x));
        setTimeout(() => audio?.cap(panOf(disc.x)), 700);
      }
    }
    if (eject) {
      eject.t += dt;
      if (eject.stage === "out" && disc.x > view.w + lay.R * 0.9) {
        eject.stage = "in";
        resetDisc();
        audio?.whoosh(panOf(lay.x));
      } else if (eject.stage === "in" && Math.abs(disc.x - lay.x) < 1.5) {
        eject = null;
        disc.tz = 0;
        audio?.tap(panOf(lay.x), 0.8);
        setPhase("plan");
      }
    }
  }

  function step(h) {
    const R = lay.R;
    const slide = eject ? (eject.stage === "out" ? 7 : 9) : 12;
    spring(disc, "x", "vx", disc.tx, slide, 0.92, h);
    spring(disc, "y", "vy", disc.ty, slide, 0.92, h);
    const flipLift = Math.abs(Math.sin(disc.flip)) * R * 0.3;
    const tz = (eject && eject.stage === "in" && Math.abs(disc.x - lay.x) < R * 0.2 ? 0 : disc.tz) + flipLift;
    spring(disc, "z", "vz", eject ? tz : flipLift, 14, 0.9, h);
    if (disc.z < 0) {
      disc.z = 0;
      disc.vz = Math.max(0, disc.vz);
    }
    let tp = 0;
    let tr = 0;
    const writing = phase === "burned" && disc.flipTarget < Math.PI / 2;
    if (pointer.hover && !pointer.drawing && !writing && phase !== "burning") {
      const nx = clamp((pointer.hx - disc.x) / (R * 2.6), -1, 1);
      const ny = clamp((pointer.hy - disc.y) / (R * 2.6), -1, 1);
      tp = ny * 0.18;
      tr = -nx * 0.22;
    }
    if (eject) tr -= clamp(disc.vx * 0.0004, -0.25, 0.25);
    disc.tp = tp;
    disc.tr = tr;
    spring(disc, "pitch", "vpitch", tp, 7.5, 0.72, h);
    spring(disc, "roll", "vroll", tr, 7.5, 0.72, h);
    spring(disc, "flip", "vflip", disc.flipTarget, 9.5, 0.8, h);
    const spinning = phase === "burning" || (phase === "cooling" && phaseT < 0.1);
    if (spinning) disc.omega += (SPIN - disc.omega) * Math.min(1, h * 1.6);
    else if (pointer.id === null || pointer.drawing) {
      const drag = phase === "cooling" ? 1.6 : 0.8;
      disc.omega *= Math.exp(-drag * h);
      disc.omega -= Math.sign(disc.omega) * Math.min(Math.abs(disc.omega), 0.25 * h);
    } else disc.omega = 0;
    if (pointer.drawing) disc.omega = 0;
    disc.spin += disc.omega * h;
    if (Math.abs(disc.spin) > TAU * 64) disc.spin %= TAU;
  }

  function moving() {
    if (pointer.id !== null || eject) return true;
    if (phase === "burning" || phase === "cooling") return true;
    if (Math.abs(disc.omega) > 0.02 || laser > 0.001) return true;
    if (Math.abs(disc.vx) + Math.abs(disc.vy) + Math.abs(disc.vz) > 0.5) return true;
    if (Math.abs(disc.x - disc.tx) + Math.abs(disc.y - disc.ty) > 0.3) return true;
    if (Math.abs(disc.vpitch) + Math.abs(disc.vroll) + Math.abs(disc.vflip) > 0.002) return true;
    if (Math.abs(disc.flip - disc.flipTarget) > 0.001) return true;
    if (Math.abs(disc.pitch - disc.tp) + Math.abs(disc.roll - disc.tr) > 0.002) return true;
    if (alpha < 1 || inkDirty) return true;
    return false;
  }

  function render() {
    const R = lay.R;
    const D = eyeZ();
    const blur = clamp(Math.abs(disc.omega) / 60, 0, 0.9);
    const s = D / Math.max(1, D - disc.z - R * 0.2);
    const reach = R * s * 1.12 + 24;
    const shift = disc.z * 0.6 + 12;
    const x0 = clamp(disc.x - reach - shift, 0, view.w);
    const x1 = clamp(disc.x + reach + shift, 0, view.w);
    const y0 = clamp(disc.y - reach - shift, 0, view.h);
    const y1 = clamp(disc.y + reach + shift, 0, view.h);
    gl.draw({
      dpr: view.dpr,
      eye: [view.w / 2, view.h / 2, D],
      center: [disc.x, disc.y, disc.z + 1.5],
      rot: matrix(disc.pitch, disc.roll, disc.flip),
      radius: R,
      spin: disc.spin,
      blur,
      key: [view.w * 0.22, -view.h * 0.02, 1500],
      fill: [view.w * 1.1, view.h * 0.95, 900],
      alpha,
      envShift: [(lay.x - view.w / 2) / D, (lay.y - view.h / 2) / D],
      burn: burnR,
      plan: planR,
      marks,
      markCount,
      laser,
      laserAngle,
      box: [Math.floor(x0 * view.dpr), Math.floor((view.h - y1) * view.dpr), Math.ceil((x1 - x0) * view.dpr), Math.ceil((y1 - y0) * view.dpr)],
    });
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (alpha < 1) alpha = reduced ? 1 : Math.min(1, alpha + dt / 0.5);
    let acc = dt;
    while (acc > 1e-6) {
      const h = Math.min(SUB, acc);
      step(h);
      acc -= h;
    }
    stepPhase(dt);
    if (inkDirty) {
      gl.setInk(ink, false);
      inkDirty = false;
    }
    if (audio && soundOn) {
      const level = pointer.drawing ? clamp(pointer.speed / 700, 0, 1) : 0;
      if (Math.abs(level - markerLevel) > 0.02) {
        markerLevel = level;
        audio.marker(level);
      }
      if (pointer.drawing) pointer.speed *= 0.85;
    }
    render();
    if (moving() && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || !visible || document.hidden) return;
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
    if (active && /INPUT|TEXTAREA|BUTTON/.test(active.tagName)) return;
    if (e.key === "f" || e.key === "F") flip();
  }

  const leave = (e) => {
    if (e.pointerType === "mouse") {
      pointer.hover = false;
      root.removeAttribute("data-over-disc");
      wake();
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(stage);
  const ro = new ResizeObserver(() => measure());
  ro.observe(stage);
  ro.observe(discbox);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", leave);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);

  measure();
  root.setAttribute("data-phase", phase);
  root.setAttribute("data-side", "data");
  render();
  onReady?.();
  wake();

  return {
    setPlan,
    burn,
    flip,
    eject: startEject,
    hitDisc(clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      return Math.hypot(clientX - rect.left - disc.x, clientY - rect.top - disc.y) < lay.R * 1.1;
    },
    async setSound(on) {
      soundOn = on;
      if (on) {
        if (!audio) audio = createBurnAudio();
        if (!audio) return false;
        const ok = await audio.setEnabled(true);
        if (ok && phase === "burning") audio.motorStart(1);
        return ok;
      }
      markerLevel = 0;
      if (audio) await audio.setEnabled(false);
      return false;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", leave);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      audio?.destroy();
      gl.destroy();
    },
  };
}
