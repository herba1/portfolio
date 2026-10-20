import { DISC, NOMINAL, PRESSINGS, STROBE_HZ, buildEtchMask, buildGrooveMask, buildTexture, etchCells } from "./groovePressings";

const LIGHT = -132;
const MAX_SPIN = 1440;
const SLIDE_K = 70;
const DEG = Math.PI / 180;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrap180 = (a) => a - 360 * Math.round(a / 360);

function speedText(omega) {
  const rpm = (Math.abs(omega) * 60) / 360;
  if (Math.abs(rpm - 100 / 3) < 0.25) return "33⅓";
  if (rpm < 0.5) return "0";
  return String(Math.round(rpm));
}

export function createGroove({ box, canvas, header, controls, speedEl, embedded, index = 0, strobe = true, onThumbs }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { w: 1, h: 1, dpr: 1, cx: 0, cy: 0, R: 100, spacing: 800 };
  const st = {
    theta: -8,
    omega: reduced ? 0 : NOMINAL,
    motor: !reduced,
    strobe,
    shown: -8,
    flashN: -1,
    drag: null,
    p: index,
    pv: 0,
    sel: index,
    speed: "",
  };
  const textures = new Array(PRESSINGS.length).fill(null);
  let texSize = 0;
  let mask = null;
  let sheen = null;
  let gloss = null;
  let shadow = null;
  let cells = null;
  let etchMask = null;
  let font = "system-ui, sans-serif";
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let buildTimer = 0;
  let dirty = true;
  const drawn = { shown: NaN, p: NaN };

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.w = w;
    view.h = h;
    let R;
    if (embedded) {
      R = Math.min(w * 0.44, h * 0.44);
      view.cx = w / 2;
      view.cy = h / 2;
    } else if (w >= 900) {
      const top = 88;
      const bottom = 48;
      const room = h - top - bottom;
      const left = 360;
      const right = w - 300;
      R = Math.min((right - left) / 2, room / 2);
      view.cx = (left + right) / 2;
      view.cy = top + room / 2;
    } else {
      const headBottom = header ? header.getBoundingClientRect().bottom - rect.top : 120;
      const pickH = controls ? controls.getBoundingClientRect().height + 24 : 64;
      const room = h - headBottom - pickH - 24;
      R = Math.min((w - 32) / 2, room / 2);
      view.cx = w / 2;
      view.cy = headBottom + 12 + room / 2;
    }
    view.R = Math.max(60, R);
    view.vertical = !embedded && w >= 900;
    view.spacing = view.vertical
      ? Math.max(view.cy, h - view.cy) + view.R + 32
      : Math.max(view.cx, w - view.cx) + view.R + 32;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * view.dpr);
    canvas.height = Math.round(h * view.dpr);
    const want = Math.min(2048, Math.ceil((view.R * 2 * view.dpr) / 64) * 64);
    const maskSize = Math.ceil(view.R * 2 * view.dpr);
    mask = buildGrooveMask(maskSize, 17);
    sheen = document.createElement("canvas");
    sheen.width = maskSize;
    sheen.height = maskSize;
    gloss = buildSheen(maskSize);
    shadow = buildShadow();
    if (!texSize || want > texSize * 1.15 || want < texSize * 0.6) {
      texSize = want;
      textures.fill(null);
      scheduleBuild();
    }
  }

  function buildShadow() {
    const size = Math.ceil(view.R * 2.6 * view.dpr);
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, r * 0.62, r, r, r);
    grad.addColorStop(0, "rgb(40 34 26 / 0.22)");
    grad.addColorStop(0.25, "rgb(40 34 26 / 0.14)");
    grad.addColorStop(0.5, "rgb(40 34 26 / 0.07)");
    grad.addColorStop(0.75, "rgb(40 34 26 / 0.025)");
    grad.addColorStop(1, "rgb(40 34 26 / 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function buildOne(i) {
    textures[i] = buildTexture(PRESSINGS[i], texSize, font);
  }

  function scheduleBuild() {
    clearTimeout(buildTimer);
    const order = [st.sel, ...PRESSINGS.map((_, i) => i).filter((i) => i !== st.sel)];
    const step = () => {
      if (destroyed) return;
      const next = order.find((i) => !textures[i]);
      if (next === undefined) {
        sendThumbs();
        return;
      }
      buildOne(next);
      wake(true);
      buildTimer = setTimeout(step, 16);
    };
    step();
  }

  function sendThumbs() {
    if (!onThumbs) return;
    const urls = textures.map((tex) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(tex, 0, 0, 64, 64);
      return c.toDataURL("image/png");
    });
    onThumbs(urls);
  }

  function buildSheen(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    const r = size / 2;
    const cone = g.createConicGradient((LIGHT - 30) * DEG, r, r);
    const lobe = (a) => `rgb(255 255 255 / ${a.toFixed(3)})`;
    const stops = [
      [0, 0],
      [0.03, 0.12],
      [0.06, 0.55],
      [0.083, 1],
      [0.106, 0.55],
      [0.136, 0.12],
      [0.166, 0],
    ];
    stops.forEach(([o, a]) => cone.addColorStop(o, lobe(a * 0.46)));
    stops.forEach(([o, a]) => cone.addColorStop(0.5 + o, lobe(a * 0.32)));
    cone.addColorStop(1, lobe(0));
    g.fillStyle = cone;
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask, 0, 0, size, size);
    g.globalCompositeOperation = "source-over";
    const gloss = g.createRadialGradient(r * 0.55, r * 0.5, 0, r * 0.55, r * 0.5, r * 1.3);
    gloss.addColorStop(0, "rgb(255 255 255 / 0.14)");
    gloss.addColorStop(0.35, "rgb(255 255 255 / 0.06)");
    gloss.addColorStop(0.7, "rgb(255 255 255 / 0.015)");
    gloss.addColorStop(1, "rgb(255 255 255 / 0)");
    g.fillStyle = gloss;
    g.beginPath();
    g.arc(r, r, r * DISC.rim, 0, Math.PI * 2);
    g.arc(r, r, r * DISC.hole, 0, Math.PI * 2, true);
    g.fill("evenodd");
    return c;
  }

  function drawSheen(x, y) {
    const R = view.R;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(gloss, x - R, y - R, R * 2, R * 2);
    ctx.restore();
  }

  function drawEtchGlints(x, y, angle) {
    if (!cells) cells = etchCells();
    if (!etchMask || etchMask.width !== texSize) etchMask = buildEtchMask(texSize);
    const g = sheen.getContext("2d");
    const s = sheen.width;
    const r = s / 2;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, s, s);
    g.save();
    g.translate(r, r);
    g.rotate(angle * DEG);
    g.save();
    g.scale(r, r);
    for (const cell of cells) {
      const d = (cell.dir + angle - LIGHT) * DEG;
      const b = Math.pow(Math.abs(Math.cos(d)), 60);
      if (b < 0.02) continue;
      g.fillStyle = `rgb(240 236 228 / ${b.toFixed(3)})`;
      g.fill(cell.path);
    }
    g.restore();
    g.globalCompositeOperation = "destination-in";
    g.drawImage(etchMask, -r, -r, s, s);
    g.restore();
    const R = view.R;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(sheen, x - R, y - R, R * 2, R * 2);
    ctx.restore();
  }

  function drawDisc(i, x, y, angle, blur) {
    const tex = textures[i];
    const R = view.R;
    const pressing = PRESSINGS[i];
    ctx.drawImage(shadow, x - R * 1.3, y - R * 1.3 + R * 0.05, R * 2.6, R * 2.6);
    ctx.save();
    ctx.translate(x, y);
    if (!tex) {
      ctx.fillStyle = "#e4e0d6";
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const samples = blur > 1.5 && !pressing.etched ? Math.min(7, Math.ceil(blur / 1.4)) : 1;
    for (let k = 0; k < samples; k += 1) {
      const a = samples > 1 ? angle - (blur * k) / (samples - 1) : angle;
      ctx.save();
      ctx.globalAlpha = 1 / (k + 1);
      ctx.rotate(a * DEG);
      ctx.drawImage(tex, -R, -R, R * 2, R * 2);
      ctx.restore();
    }
    ctx.restore();
    if (pressing.etched) drawEtchGlints(x, y, angle);
    if (pressing.sheen !== "none") drawSheen(x, y);
  }

  function render() {
    const { w, h, dpr, cx, cy, R, spacing } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const blur = st.strobe ? 0 : Math.abs(st.omega) * 0.028;
    for (let i = 0; i < PRESSINGS.length; i += 1) {
      const off = (i - st.p) * spacing;
      const x = view.vertical ? cx : cx + off;
      const y = view.vertical ? cy + off : cy;
      if (x + R * 1.3 < 0 || x - R * 1.3 > w || y + R * 1.3 < 0 || y - R * 1.3 > h) continue;
      drawDisc(i, x, y, st.shown, blur);
    }
  }

  function step(now) {
    raf = 0;
    if (destroyed) return;
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 1 / 60;
    last = t;
    if (st.drag) {
      if (now - st.drag.lastT > 50) st.drag.vel *= Math.exp(-dt * 14);
      st.omega = st.drag.vel;
    } else {
      const target = st.motor ? NOMINAL : 0;
      const k = st.motor ? 2.2 : 1.2;
      st.omega += (target - st.omega) * (1 - Math.exp(-k * dt));
      if (!st.motor && Math.abs(st.omega) < 0.6) st.omega = 0;
      st.theta += st.omega * dt;
    }
    if (st.strobe) {
      const n = Math.floor(t * STROBE_HZ);
      if (n !== st.flashN) {
        st.flashN = n;
        st.shown = st.theta - st.omega * (t - n / STROBE_HZ);
      }
    } else {
      st.shown = st.theta;
      st.flashN = -1;
    }
    const a = -SLIDE_K * (st.p - st.sel) - 2 * Math.sqrt(SLIDE_K) * st.pv;
    st.pv += a * dt;
    st.p += st.pv * dt;
    if (Math.abs(st.p - st.sel) < 0.0005 && Math.abs(st.pv) < 0.001) {
      st.p = st.sel;
      st.pv = 0;
    }
    if (reduced) {
      st.p = st.sel;
      st.pv = 0;
    }
    if (dirty || st.shown !== drawn.shown || st.p !== drawn.p || (!st.strobe && st.omega !== 0)) {
      dirty = false;
      drawn.shown = st.shown;
      drawn.p = st.p;
      render();
    }
    const text = speedText(st.omega);
    if (text !== st.speed) {
      st.speed = text;
      if (speedEl) speedEl.textContent = text;
    }
    const idle = !st.drag && st.omega === 0 && st.p === st.sel && st.shown === st.theta;
    if (visible && !idle) raf = requestAnimationFrame(step);
    else if (visible && idle) last = 0;
  }

  function wake(force) {
    if (force) dirty = true;
    if (raf || !visible || destroyed) return;
    raf = requestAnimationFrame(step);
  }

  function local(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function center() {
    const off = (st.sel - st.p) * view.spacing;
    return view.vertical ? [view.cx, view.cy + off] : [view.cx + off, view.cy];
  }

  function angleAt(x, y) {
    const [ox, oy] = center();
    return Math.atan2(y - oy, x - ox) / DEG;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    const [ox, oy] = center();
    if (Math.hypot(x - ox, y - oy) > view.R) return;
    canvas.setPointerCapture?.(e.pointerId);
    st.drag = { id: e.pointerId, last: angleAt(x, y), lastT: performance.now(), vel: 0 };
    box.setAttribute("data-grabbing", "");
    e.preventDefault();
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!st.drag) {
      const [ox, oy] = center();
      const over = Math.hypot(x - ox, y - oy) <= view.R;
      if (over) box.setAttribute("data-over", "");
      else box.removeAttribute("data-over");
      return;
    }
    if (e.pointerId !== st.drag.id) return;
    const now = performance.now();
    const a = angleAt(x, y);
    const d = wrap180(a - st.drag.last);
    const dtm = Math.max(4, now - st.drag.lastT);
    st.theta += d;
    st.drag.vel = st.drag.vel * 0.55 + ((d / dtm) * 1000) * 0.45;
    st.drag.last = a;
    st.drag.lastT = now;
    wake();
  }

  function onUp(e) {
    if (!st.drag || e.pointerId !== st.drag.id) return;
    const fresh = performance.now() - st.drag.lastT < 90;
    st.omega = fresh ? clamp(st.drag.vel, -MAX_SPIN, MAX_SPIN) : 0;
    st.drag = null;
    box.removeAttribute("data-grabbing");
    wake();
  }

  function onKey(e) {
    if (e.key === "ArrowRight") st.omega = clamp(st.omega + 90, -MAX_SPIN, MAX_SPIN);
    else if (e.key === "ArrowLeft") st.omega = clamp(st.omega - 90, -MAX_SPIN, MAX_SPIN);
    else if (e.key === " ") st.motor = !st.motor;
    else return;
    e.preventDefault();
    wake();
  }

  const ro = new ResizeObserver(() => {
    layout();
    wake(true);
  });
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) {
      last = 0;
      wake(true);
    }
  });
  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    if (visible) {
      last = 0;
      wake();
    }
  };

  font = getComputedStyle(box).fontFamily || font;
  layout();
  ro.observe(box);
  io.observe(box);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("keydown", onKey);
  wake();

  return {
    setPressing(i) {
      st.sel = clamp(i, 0, PRESSINGS.length - 1);
      if (!textures[st.sel]) buildOne(st.sel);
      wake(true);
    },
    setStrobe(on) {
      st.strobe = on;
      wake(true);
    },
    toggleMotor() {
      st.motor = !st.motor;
      wake();
    },
    destroy() {
      destroyed = true;
      clearTimeout(buildTimer);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("keydown", onKey);
      textures.fill(null);
    },
  };
}
