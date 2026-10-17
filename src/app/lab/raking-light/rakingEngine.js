import { drawBack } from "./rakingBack";
import { CARDS, LAMP_MAX, LAMP_MIN, LAMP_REST } from "./rakingCards";
import { createRakingGL } from "./rakingGL";

const LOG_MIN = Math.log(LAMP_MIN);
const LOG_MAX = Math.log(LAMP_MAX);
const SUB = 1 / 240;
const THICK = 0.32;
const OUT_S = 0.36;
const IN_S = 0.78;
const INTRO_S = 1.8;
const TAP_PX = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function spring(state, key, velKey, target, omega, h) {
  const x = state[key];
  const v = state[velKey];
  const a = omega * omega * (target - x) - 2 * omega * v;
  state[velKey] = v + a * h;
  state[key] = x + state[velKey] * h;
}

function dims(card, aspect) {
  const hw = card.widthMm / 2;
  return { hw, hh: hw / aspect };
}

export function createRakingEngine({ box, stage, canvas, tag, slider, insets, embedded, onSelect, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, pxPerMm: 8, cx: 0, cy: 0 };
  const lamp = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, lz: Math.log(LAMP_REST), vlz: 0, tlz: Math.log(LAMP_REST), power: 0, placed: false };
  const flip = { th: 0, vth: 0, tth: 0 };
  const pointers = new Map();
  const loaded = new Map();
  let slide = null;
  let idx = 0;
  let pinch = null;
  let armed = !embedded;
  let moved = false;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let introT = reduced ? INTRO_S : 0;
  let quality = 1;
  let motionQuality = 1;
  let interval = 16;
  let shownHeight = "";
  let tagOn = false;

  function cardDims(i) {
    const card = CARDS[i];
    return dims(card, loaded.get(card.key)?.aspect || card.aspect);
  }

  function layout() {
    const pad = insets();
    const availW = view.width - 32;
    const availH = Math.max(160, view.height - pad.top - pad.bottom);
    const { hw, hh } = cardDims(0);
    const hhPx = Math.min(availH * 0.45, (availW * 0.39) / (hw / hh));
    view.pxPerMm = hhPx / hh;
    view.cx = view.width / 2;
    view.cy = pad.top + availH / 2;
  }

  function restLamp() {
    const { hw, hh } = cardDims(idx);
    return [-hw - 7, hh + 3];
  }

  function placeLamp() {
    const [rx, ry] = restLamp();
    lamp.tx = rx;
    lamp.ty = ry;
    lamp.tlz = Math.log(LAMP_REST);
    if (reduced) {
      lamp.x = rx;
      lamp.y = ry;
      lamp.lz = lamp.tlz;
      lamp.power = 1;
    } else {
      lamp.x = rx - 16;
      lamp.y = ry + 10;
      lamp.lz = Math.log(LAMP_REST * 1.8);
    }
    lamp.placed = true;
    syncSlider();
  }

  function load(i) {
    const card = CARDS[i];
    if (loaded.has(card.key)) return;
    loaded.set(card.key, { pending: true });
    const img = new Image();
    img.decoding = "async";
    img.src = card.src;
    img
      .decode()
      .then(() => {
        if (destroyed || !gl) return;
        const aspect = img.naturalWidth / img.naturalHeight;
        const { hw, hh } = dims(card, aspect);
        const back = drawBack(card, img.naturalWidth, img.naturalHeight);
        gl.upload(card.key, img, back, { hw, hh, seed: card.seed, print: card.print, print2: card.print2 });
        loaded.set(card.key, { aspect });
        if (i === idx && !lamp.placed) {
          layout();
          placeLamp();
        }
        wake();
      })
      .catch(() => loaded.delete(card.key));
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createRakingGL(canvas);
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
    CARDS.forEach((_, i) => load(i));
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2400000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(quality);
    wake();
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function syncSlider() {
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(((lamp.tlz - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000));
  }

  function toWorld(px, py) {
    return [(px - view.cx) / view.pxPerMm, (py - view.cy) / view.pxPerMm];
  }

  function setLamp(wx, wy) {
    const hx = view.width / 2 / view.pxPerMm;
    const top = -view.cy / view.pxPerMm;
    const bottom = (view.height - view.cy) / view.pxPerMm;
    lamp.tx = clamp(wx, -hx, hx);
    lamp.ty = clamp(wy, top, bottom);
    introT = INTRO_S;
    if (reduced) {
      lamp.x = lamp.tx;
      lamp.y = lamp.ty;
    }
    wake();
  }

  function setHeight(lz) {
    lamp.tlz = clamp(lz, LOG_MIN, LOG_MAX);
    if (reduced) lamp.lz = lamp.tlz;
    introT = INTRO_S;
    syncSlider();
    wake();
  }

  function cardPose() {
    const card = CARDS[idx];
    const { hw, hh } = cardDims(idx);
    let x = 0;
    let y = 0;
    let rot = card.tilt;
    let lift = 0;
    if (slide) {
      const reach = view.width / 2 / view.pxPerMm + hw * 1.8;
      if (slide.phase === "out") {
        const e = easeIn(clamp(slide.t / OUT_S, 0, 1));
        x = -reach * e;
        y = 6 * e;
        rot = card.tilt - 0.16 * e;
        lift = Math.sin(e * Math.PI * 0.5) * 1.6;
      } else {
        const e = easeOut(clamp(slide.t / IN_S, 0, 1));
        x = reach * (1 - e);
        y = -5 * (1 - e);
        rot = card.tilt + 0.2 * (1 - e);
        lift = (1 - e) * 1.4;
      }
    }
    const c = Math.cos(flip.th);
    const s = Math.abs(Math.sin(flip.th));
    const base = (card.cup + THICK) * (1 - c) * 0.5 + (hw + 2.5) * s + lift;
    return {
      key: card.key,
      x,
      y,
      rot,
      theta: flip.th,
      hw,
      hh,
      thick: THICK,
      cup: card.cup,
      twist: card.twist,
      lift: base,
      seed: card.seed,
      crease: card.crease,
      fold: card.fold,
      corners: card.corners,
      material: card.material,
      ink: card.ink,
      top: base + hw * s + card.cup + 1.4,
      reach: Math.hypot(hw, hh) + 1.5,
    };
  }

  function hitCard(px, py) {
    const [wx, wy] = toWorld(px, py);
    const pose = cardPose();
    const qx = wx - pose.x;
    const qy = wy - pose.y;
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    const u = c * qx + s * qy;
    const v = -s * qx + c * qy;
    return Math.abs(u) < pose.hw * Math.max(0.2, Math.abs(Math.cos(flip.th))) + 2 && Math.abs(v) < pose.hh + 2;
  }

  function turn() {
    if (slide) return;
    flip.tth = flip.tth > 1.5 ? 0 : Math.PI;
    if (reduced) {
      flip.th = flip.tth;
      flip.vth = 0;
    }
    wake();
  }

  function select(i) {
    if (i === idx && !slide) return;
    if (slide && slide.phase === "out") {
      slide.next = i;
    } else if (slide && slide.phase === "in") {
      if (i === idx) return;
      slide = { phase: "out", t: OUT_S * (1 - clamp(slide.t / IN_S, 0, 1)) * 0.5, next: i };
    } else {
      slide = { phase: "out", t: 0, next: i };
    }
    if (reduced) {
      idx = i;
      slide = null;
      flip.th = flip.tth = flip.vth = 0;
    }
    load(i);
    onSelect(i);
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function touchLift(type) {
    return type === "touch" ? -Math.min(72, view.height * 0.08) : 0;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    armed = true;
    stage.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y, sx: x, sy: y, type: e.pointerType });
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, lz: lamp.tlz };
      moved = true;
    } else if (pointers.size === 1 && e.pointerType === "mouse") {
      setLamp(...toWorld(x, y));
    }
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "touch" || pointers.size) return;
      setLamp(...toWorld(x, y));
      return;
    }
    p.x = x;
    p.y = y;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setHeight(pinch.lz + Math.log(dist / pinch.dist) * 1.4);
      return;
    }
    if (!moved && Math.hypot(x - p.sx, y - p.sy) > TAP_PX) moved = true;
    if (moved) setLamp(...toWorld(x, y + touchLift(p.type)));
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (e.type === "pointerup" && !moved && !pointers.size) {
      if (hitCard(p.x, p.y)) turn();
      else if (p.type !== "mouse") setLamp(...toWorld(p.x, p.y + touchLift(p.type)));
    }
    if (pointers.size === 1) moved = true;
    wake();
  }

  function onWheel(e) {
    if (!armed) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1;
    const dy = clamp(e.deltaY * unit, -240, 240);
    setHeight(lamp.tlz - dy * (e.ctrlKey ? 0.012 : 0.0028));
  }

  function onKey(e) {
    const step = e.shiftKey ? 8 : 2;
    let handled = true;
    if (e.key === "ArrowLeft") setLamp(lamp.tx - step, lamp.ty);
    else if (e.key === "ArrowRight") setLamp(lamp.tx + step, lamp.ty);
    else if (e.key === "ArrowUp") setLamp(lamp.tx, lamp.ty - step);
    else if (e.key === "ArrowDown") setLamp(lamp.tx, lamp.ty + step);
    else if (e.key === "+" || e.key === "=") setHeight(lamp.tlz + Math.log(1.25));
    else if (e.key === "-" || e.key === "_") setHeight(lamp.tlz - Math.log(1.25));
    else if (e.key === "Enter" || e.key === " " || e.key === "f" || e.key === "F") turn();
    else if (e.key === "]") select((idx + 1) % CARDS.length);
    else if (e.key === "[") select((idx + CARDS.length - 1) % CARDS.length);
    else if (/^[1-3]$/.test(e.key)) select(Number(e.key) - 1);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function onSlider() {
    lamp.tlz = mix(LOG_MIN, LOG_MAX, Number(slider.value) / 1000);
    if (reduced) lamp.lz = lamp.tlz;
    armed = true;
    introT = INTRO_S;
    wake();
  }

  function render() {
    const has = gl.has(CARDS[idx].key);
    const z = Math.exp(lamp.lz);
    const moving = quality < 1;
    gl.draw({
      cx: view.cx,
      cy: view.cy,
      pxPerMm: view.pxPerMm,
      scale: view.dpr * quality,
      lamp: { x: lamp.x, y: lamp.y, z: z + Math.sin(flip.th) * cardDims(idx).hw * 0.85, power: lamp.power },
      bulb: 2.2 + z * 0.04,
      falloff: 12,
      intensity: 5000,
      steps: moving ? 26 : 40,
      micro: 0.045,
      ambient: 0.01,
      exposure: 1,
      card: has ? cardPose() : null,
    });
    if (tag) {
      const label = `${z < 9.95 ? z.toFixed(1) : Math.round(z)} mm`;
      if (label !== shownHeight) {
        tag.textContent = label;
        shownHeight = label;
      }
      const px = view.cx + lamp.x * view.pxPerMm;
      const py = view.cy + lamp.y * view.pxPerMm;
      const tx = clamp(px + 18, 8, view.width - 64);
      const ty = clamp(py + 18, 8, view.height - 32);
      tag.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
    }
    if (has) onReady();
  }

  function setTag(on) {
    if (!tag || on === tagOn) return;
    tagOn = on;
    tag.dataset.on = on ? "true" : "false";
  }

  function step(dt) {
    let moving = false;
    if (introT < INTRO_S) {
      introT = Math.min(INTRO_S, introT + dt);
      lamp.power = easeOut(introT / INTRO_S);
      moving = true;
    } else {
      lamp.power = 1;
    }
    if (slide) {
      slide.t += dt;
      if (slide.phase === "out" && slide.t >= OUT_S && gl.has(CARDS[slide.next].key)) {
        idx = slide.next;
        flip.th = flip.tth = flip.vth = 0;
        slide = { phase: "in", t: 0 };
        layout();
      } else if (slide.phase === "in" && slide.t >= IN_S) {
        slide = null;
      }
      moving = true;
    }
    if (!reduced) {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      const glide = introT < INTRO_S ? 3.6 : 15;
      for (let i = 0; i < steps; i += 1) {
        spring(lamp, "x", "vx", lamp.tx, glide, h);
        spring(lamp, "y", "vy", lamp.ty, glide, h);
        spring(lamp, "lz", "vlz", lamp.tlz, introT < INTRO_S ? 3 : 11, h);
        spring(flip, "th", "vth", flip.tth, 8.5, h);
      }
      if (flip.th < 0) {
        flip.th = 0;
        flip.vth = Math.max(0, flip.vth);
      } else if (flip.th > Math.PI) {
        flip.th = Math.PI;
        flip.vth = Math.min(0, flip.vth);
      }
      const far = Math.abs(lamp.x - lamp.tx) + Math.abs(lamp.y - lamp.ty) > 0.004 || Math.abs(lamp.vx) + Math.abs(lamp.vy) > 0.02;
      const rising = Math.abs(lamp.lz - lamp.tlz) > 0.0006 || Math.abs(lamp.vlz) > 0.003;
      const turning = Math.abs(flip.th - flip.tth) > 0.0008 || Math.abs(flip.vth) > 0.004;
      setTag(rising && introT >= INTRO_S);
      if (far || rising || turning) moving = true;
      else {
        lamp.x = lamp.tx;
        lamp.y = lamp.ty;
        lamp.lz = lamp.tlz;
        flip.th = flip.tth;
        lamp.vx = lamp.vy = lamp.vlz = flip.vth = 0;
      }
    }
    return moving;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden) return;
    const raw = last ? now - last : 16;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    const moving = lamp.placed ? step(dt) : false;
    if (moving) {
      interval = interval * 0.75 + raw * 0.25;
      if (interval > 34 && motionQuality > 0.5) {
        motionQuality = Math.max(0.5, motionQuality * 0.85);
        interval = 20;
      }
      if (quality !== motionQuality) applyQuality(motionQuality);
    } else if (quality !== 1) {
      applyQuality(1);
    }
    render();
    if (moving) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      setTag(false);
    }
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      }
    },
    { rootMargin: "120px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  const onVisibility = () => {
    if (!document.hidden) {
      last = 0;
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKey);
  slider?.addEventListener("input", onSlider);

  return {
    select: (i) => (gl ? select(i) : onSelect(i)),
    turn,
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
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKey);
      slider?.removeEventListener("input", onSlider);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
