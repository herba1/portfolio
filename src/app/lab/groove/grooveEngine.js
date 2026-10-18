import { createGrooveGL } from "./grooveGL";
import { buildLabels } from "./grooveLabel";
import { PRESETS } from "./groovePresets";

const TILT = 0.36;
const DIST = 6;
const THICK = 0.014;
const LIGHT_Z = 2.3;
const IDLE = 0.16;
const MAX_SPIN = 9;
const VISCOUS = 0.55;
const COULOMB = 0.35;
const HOME = [-0.25, 0.45];
const GROUND = [0.852, 0.842, 0.81];
const CELL = 512;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function buildPhotos(images) {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * images.length;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const crop = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - crop) / 2;
    const sy = (img.naturalHeight - crop) / 2;
    ctx.drawImage(img, sx, sy, crop, crop, i * CELL, 0, CELL, CELL);
  });
  return canvas;
}

export function createGroove({ box, canvas, header, picker, embedded, preset = 0, onReady }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createGrooveGL(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");

  const eye = [0, -DIST * Math.sin(TILT), DIST * Math.cos(TILT)];
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, radius: 200, focal: 1200 };
  const sim = { theta: -0.2, omega: reduced ? 0 : IDLE, vel: 0, dragging: false, releasing: false, pointerId: null, grabAngle: 0, pointerAngle: 0, lastAngle: 0, thetaPrev: -0.2 };
  const light = { x: 0, y: 0, tx: 0, ty: 0, tau: 0.6 };
  const fade = { from: preset, to: preset, t: 1 };
  let hover = false;
  let quality = 1;
  let interval = 16.7;
  let slowFrames = 0;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let photosReady = false;
  let labelsReady = false;
  let reveal = 0;
  let readySent = false;

  function homeLight() {
    const l = lightFor(HOME[0], HOME[1]);
    light.tx = l[0];
    light.ty = l[1];
  }

  function lightFor(qx, qy) {
    const ez = eye[2];
    let lx = (qx * (LIGHT_Z + ez) - eye[0] * LIGHT_Z) / ez;
    let ly = (qy * (LIGHT_Z + ez) - eye[1] * LIGHT_Z) / ez;
    const m = Math.hypot(lx, ly);
    if (m > 2.4) {
      lx *= 2.4 / m;
      ly *= 2.4 / m;
    }
    return [lx, ly];
  }

  homeLight();
  light.x = light.tx;
  light.y = light.ty;

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.width = w;
    view.height = h;
    let radius;
    if (embedded) {
      radius = Math.min(w * 0.44, h * 0.45);
      view.cx = w / 2;
      view.cy = h / 2;
    } else if (w >= 900) {
      radius = Math.min(w * 0.27, (h - 72 - 72) / 2);
      view.cx = w * 0.58;
      view.cy = 72 + (h - 72) / 2;
    } else {
      const headBottom = header ? header.getBoundingClientRect().bottom - rect.top : 120;
      const pickH = picker ? picker.getBoundingClientRect().height + 40 : 64;
      const room = h - headBottom - pickH - 16;
      radius = Math.min((w - 28) / 2, room / 2);
      view.cx = w / 2;
      view.cy = headBottom + 8 + room / 2;
    }
    view.radius = clamp(radius, 60, 520);
    view.focal = view.radius * DIST;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(3200000 / (w * h));
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    applyQuality(quality);
  }

  function applyQuality(q) {
    quality = q;
    gl?.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function toPlane(x, y) {
    const sx = (x - view.cx) / view.focal;
    const sy = -(y - view.cy) / view.focal;
    const s = Math.sin(TILT);
    const c = Math.cos(TILT);
    let dx = sx;
    let dy = s + c * sy;
    let dz = -c + s * sy;
    const l = Math.hypot(dx, dy, dz);
    dx /= l;
    dy /= l;
    dz /= l;
    const t = (THICK - eye[2]) / Math.min(dz, -1e-4);
    return [eye[0] + dx * t, eye[1] + dy * t];
  }

  function simulate(dt) {
    const idle = reduced ? 0 : IDLE;
    sim.thetaPrev = sim.theta;
    if (sim.dragging) {
      const target = sim.grabTheta + sim.pointerAngle - sim.grabAngle;
      if (dt > 0.002) {
        const inst = (target - sim.theta) / dt;
        const k = 1 - Math.exp(-dt / 0.045);
        sim.vel += (inst - sim.vel) * k;
      }
      sim.theta = target;
      sim.omega = sim.vel;
      if (sim.releasing) {
        sim.dragging = false;
        sim.releasing = false;
        sim.omega = clamp(sim.vel, -MAX_SPIN, MAX_SPIN);
      }
    } else {
      const diff = sim.omega - idle;
      const decel = (VISCOUS * Math.abs(diff) + COULOMB * (reduced ? 4 : 1)) * dt;
      sim.omega = Math.abs(diff) <= decel ? idle : sim.omega - Math.sign(diff) * decel;
      sim.theta += sim.omega * dt;
    }
    if (!sim.dragging && Math.abs(sim.theta) > 1000) sim.theta = wrapPi(sim.theta);
    const k = reduced ? 1 : 1 - Math.exp(-dt / light.tau);
    light.x += (light.tx - light.x) * k;
    light.y += (light.ty - light.y) * k;
    const lightMoving = Math.hypot(light.tx - light.x, light.ty - light.y) > 0.0008;
    if (!lightMoving) {
      light.x = light.tx;
      light.y = light.ty;
    }
    let fading = false;
    if (fade.t < 1) {
      fade.t = reduced ? 1 : Math.min(1, fade.t + dt / 0.75);
      fading = true;
      if (fade.t >= 1) fade.from = fade.to;
    }
    if (photosReady && reveal < 1) {
      reveal = reduced ? 1 : Math.min(1, reveal + dt / 1.1);
      fading = true;
    }
    return lightMoving || fading;
  }

  function render(dt) {
    const step = sim.theta - sim.thetaPrev;
    const span = clamp(Math.abs(step) > 1e-5 ? step : sim.omega * Math.max(dt, 1 / 60), -0.16, 0.16);
    const samples = clamp(Math.ceil(Math.abs(span) / 0.018), 1, 6);
    const e = fade.t < 1 ? 1 - Math.pow(1 - fade.t, 3) : 0;
    gl.draw({
      width: view.width,
      height: view.height,
      cx: view.cx,
      cy: view.cy,
      focal: view.focal,
      tilt: TILT,
      dist: DIST,
      thick: THICK,
      theta: sim.theta,
      sweep: samples > 1 ? span : 0,
      samples,
      light: [light.x, light.y, LIGHT_Z],
      slotA: fade.from,
      slotB: fade.to,
      mix: fade.from === fade.to ? 0 : e,
      toneA: PRESETS[fade.from].tone,
      toneB: PRESETS[fade.to].tone,
      slots: PRESETS.length,
      ground: GROUND,
      photoOn: 1 - Math.pow(1 - reveal, 3),
      kappa: 0.15,
      lobe: [0.06, 0.15],
      gain: 14,
    });
    if (photosReady && labelsReady && !readySent) {
      readySent = true;
      onReady?.();
    }
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = last ? clamp(raw / 1000, 0, 0.05) : 0;
    last = now;
    const busy = simulate(dt);
    if (!reduced) {
      interval = interval * 0.9 + raw * 0.1;
      slowFrames = interval > 40 ? slowFrames + 1 : 0;
      if (slowFrames > 45 && quality > 0.62) {
        slowFrames = 0;
        interval = 20;
        applyQuality(Math.max(0.6, quality * 0.85));
      }
    }
    render(dt);
    const spinning = Math.abs(sim.omega) > 0.0005;
    if (sim.dragging || spinning || busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function aim(e, tau, reach = 0.8) {
    const [x, y] = local(e);
    const [qx, qy] = toPlane(x, y);
    const l = lightFor(HOME[0] + (qx - HOME[0]) * reach, HOME[1] + (qy - HOME[1]) * reach);
    light.tx = l[0];
    light.ty = l[1];
    light.tau = tau;
  }

  function unwrapAngle(qx, qy) {
    const a = Math.atan2(qy, qx);
    const d = wrapPi(a - sim.lastAngle);
    const r = Math.hypot(qx, qy);
    const weight = clamp((r - 0.06) / 0.2, 0, 1);
    sim.lastAngle = a;
    sim.pointerAngle += d * weight;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (sim.dragging && !sim.releasing) return;
    const [x, y] = local(e);
    const [qx, qy] = toPlane(x, y);
    const onDisc = Math.hypot(qx, qy) < 1.06;
    if (e.pointerType === "mouse") aim(e, 0.4, onDisc ? 0.3 : 0.8);
    if (!onDisc) {
      if (e.pointerType !== "mouse") {
        canvas.setPointerCapture?.(e.pointerId);
        sim.lightPointer = e.pointerId;
        aim(e, 0.08);
      }
      wake();
      return;
    }
    canvas.setPointerCapture?.(e.pointerId);
    sim.dragging = true;
    sim.releasing = false;
    sim.pointerId = e.pointerId;
    sim.lastAngle = Math.atan2(qy, qx);
    sim.pointerAngle = sim.lastAngle;
    sim.grabAngle = sim.lastAngle;
    sim.grabTheta = sim.theta;
    sim.vel = 0;
    sim.omega = 0;
    box.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    if (e.pointerType === "mouse") {
      hover = true;
      if (sim.dragging) aim(e, 0.4, 0.3);
      else aim(e, 0.1);
    }
    if (sim.lightPointer === e.pointerId) aim(e, 0.08);
    if (sim.dragging && !sim.releasing && e.pointerId === sim.pointerId) {
      const [x, y] = local(e);
      const [qx, qy] = toPlane(x, y);
      unwrapAngle(qx, qy);
    }
    wake();
  }

  function onUp(e) {
    if (sim.lightPointer === e.pointerId) sim.lightPointer = null;
    if (!sim.dragging || e.pointerId !== sim.pointerId) return;
    if (e.type === "pointerup") {
      const [x, y] = local(e);
      const [qx, qy] = toPlane(x, y);
      unwrapAngle(qx, qy);
    }
    sim.releasing = true;
    sim.pointerId = null;
    delete box.dataset.grabbing;
    wake();
  }

  function onLeave(e) {
    if (e.pointerType !== "mouse" || sim.dragging) return;
    hover = false;
    homeLight();
    light.tau = 0.7;
    wake();
  }

  function onKey(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? -1 : 1;
      sim.omega = clamp(sim.omega + dir * (e.shiftKey ? 3 : 1.2), -MAX_SPIN, MAX_SPIN);
      wake();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      sim.omega = 0;
      wake();
    }
  }

  layout();

  const covers = Promise.all(PRESETS.map((p) => loadImage(p.src).catch(() => null)));
  covers
    .then((images) => (images.every(Boolean) ? buildPhotos(images) : Promise.reject(new Error("cover missing"))))
    .then((photos) => {
      if (destroyed || !gl) return;
      gl.uploadPhotos(photos);
      photosReady = true;
      wake();
    })
    .catch(() => {
      photosReady = true;
      wake();
    });

  Promise.all([covers, document.fonts.ready]).then(([images]) => {
    if (destroyed || !gl) return;
    gl.uploadLabels(buildLabels(PRESETS, images));
    labelsReady = true;
    wake();
  });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    if (!raf && gl && visible) render(0);
    wake();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("keydown", onKey);

  return {
    setPreset(idx) {
      if (idx === fade.to) return;
      fade.from = fade.t < 1 && fade.t < 0.5 ? fade.from : fade.to;
      fade.to = idx;
      fade.t = 0;
      wake();
    },
    isHovering: () => hover,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("keydown", onKey);
      gl?.destroy();
      gl = null;
    },
  };
}
