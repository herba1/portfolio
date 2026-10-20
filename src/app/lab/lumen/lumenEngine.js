import { FIXED_STOPS, LIVE_STOPS, OBJECTS, buildLut, hitMask, paintObject } from "./lumenArt";
import { fragment, vertex } from "./lumenShader";

const FW = 288;
const FH = 360;
const RATE = 0.24;
const K = 5;
const FLOOR = 0.1;
const PRE = 16;
const TABLE = [0.925, 0.912, 0.886];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
  return sh;
}

function createFoley() {
  let ctx = null;
  let noise = null;
  return {
    unlock() {
      if (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    },
    drop(kind) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = kind === "key" ? 2400 : 1400;
      f.Q.value = kind === "key" ? 3 : 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === "key" ? 0.09 : 0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "key" ? 0.07 : 0.12));
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t, Math.random() * 0.2, 0.2);
      if (kind === "key") {
        for (const [freq, gain, dur] of [
          [3900, 0.03, 0.16],
          [5600, 0.018, 0.1],
        ]) {
          const o = ctx.createOscillator();
          o.frequency.value = freq;
          const og = ctx.createGain();
          og.gain.setValueAtTime(0, t);
          og.gain.linearRampToValueAtTime(gain, t + 0.002);
          og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(og).connect(ctx.destination);
          o.start(t);
          o.stop(t + dur + 0.02);
        }
      }
    },
    close() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}

export function createLumen(stage, canvas, layer, { reducedMotion = false, onChange = () => {} } = {}) {
  const host = stage.closest(".piece-box") || stage;
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: false });
  if (!gl) throw new Error("webgl2");

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  gl.useProgram(program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const name of ["uField", "uLut", "uLutFixed", "uRes", "uPaper", "uFieldSize", "uFix", "uDiffusion", "uHalation", "uWashout", "uRagged", "uGrain", "uSeed", "uScale", "uTable"]) {
    u[name] = gl.getUniformLocation(program, name);
  }

  const texture = (unit, w, h, format, internal, data) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const tone = new Uint8Array(FW * FH);
  const fieldTex = texture(0, FW, FH, gl.RED, gl.R8, tone);
  const lutTex = texture(1, 256, 1, gl.RGBA, gl.RGBA8, buildLut(LIVE_STOPS));
  const lutFixedTex = texture(2, 256, 1, gl.RGBA, gl.RGBA8, buildLut(FIXED_STOPS));
  gl.uniform1i(u.uField, 0);
  gl.uniform1i(u.uLut, 1);
  gl.uniform1i(u.uLutFixed, 2);
  gl.uniform2f(u.uFieldSize, FW, FH);
  gl.uniform1f(u.uDiffusion, 0.55);
  gl.uniform1f(u.uHalation, 0.12);
  gl.uniform1f(u.uWashout, 0.16);
  gl.uniform1f(u.uRagged, 0.7);
  gl.uniform1f(u.uGrain, 0.07);
  gl.uniform1f(u.uSeed, 3.0);
  gl.uniform3f(u.uTable, ...TABLE);

  const cover = document.createElement("canvas");
  cover.width = FW;
  cover.height = FH;
  const coverCtx = cover.getContext("2d", { willReadFrequently: true });
  const exposure = new Float32Array(FW * FH);
  const floor = new Float32Array(FW * FH);
  const speed = new Float32Array(FW * FH);
  {
    const lattice = (cells, seed) => {
      let a = seed >>> 0;
      const grid = Array.from({ length: (cells + 2) * (cells + 2) }, () => {
        a = (a * 1664525 + 1013904223) >>> 0;
        return a / 4294967296;
      });
      return (x, y) => {
        const gx = x * cells;
        const gy = y * cells;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (i, j) => grid[j * (cells + 2) + i];
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        return top + (bottom - top) * sy;
      };
    };
    const coarse = lattice(5, 11);
    const fine = lattice(17, 29);
    for (let y = 0; y < FH; y += 1) {
      for (let x = 0; x < FW; x += 1) {
        const u = x / FW;
        const v = y / FH;
        const n = coarse(u, v) * 0.7 + fine(u, v) * 0.3;
        floor[y * FW + x] = FLOOR * (0.55 + 0.9 * n);
        speed[y * FW + x] = 0.85 + 0.3 * coarse(1 - v, u);
      }
    }
  }
  const previous = new Uint8Array(FW * FH);
  const blurSupported = "filter" in coverCtx;

  const view = { w: 1, h: 1, dpr: 1, unit: 400, px: 0, py: 0, pw: 320, ph: 400, compact: false };
  const foley = createFoley();
  const objects = OBJECTS.map((spec, i) => {
    const el = document.createElement("canvas");
    el.className = "lumen-object";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${spec.name}. Arrow keys move it, Shift with Left or Right turns it.`);
    layer.appendChild(el);
    return { ...spec, el, mask: document.createElement("canvas"), hit: null, x: 0, y: 0, angle: 0, lift: 0, liftTarget: 0, z: i, paintedAt: 0 };
  });

  const state = { fixed: false, fix: 0, fixFrom: 0, fixTo: 0, fixT: 1, fresh: 1, sleeping: 0 };
  let drag = null;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let visible = true;
  let calm = 0;

  function homes(compact) {
    if (compact) {
      return {
        fern: { x: -0.07, y: -0.03, angle: 0.2 },
        key: { x: 0.17, y: 0.36, angle: -0.42 },
        grass: { x: 0.02, y: 0.66, angle: Math.PI / 2 - 0.12 },
      };
    }
    return {
      fern: { x: -0.07, y: -0.02, angle: 0.2 },
      key: { x: 0.18, y: 0.36, angle: -0.42 },
      grass: { x: 0.72, y: 0.02, angle: 0.1 },
    };
  }

  function paint() {
    for (const o of objects) {
      const unit = Math.round(view.unit * view.dpr);
      if (o.paintedAt !== unit) {
        paintObject(o.el, o, unit, "art");
        o.el.style.width = `${o.w * view.unit}px`;
        o.el.style.height = `${o.h * view.unit}px`;
        o.paintedAt = unit;
      }
      if (!o.hit) {
        paintObject(o.mask, o, FH, "mask");
        o.hit = hitMask(o, 300);
      }
    }
  }

  function layout() {
    const rect = host.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.compact = view.w < 900;
    if (view.compact) {
      const pw = Math.max(160, Math.min(view.w * 0.78, (view.h - 368) * 0.8));
      view.pw = pw;
      view.ph = pw / 0.8;
      view.px = (view.w - view.pw) / 2;
      view.py = 244;
    } else {
      const ph = Math.min(view.h * 0.74, (view.w * 0.42) / 0.8);
      view.ph = ph;
      view.pw = ph * 0.8;
      view.px = view.w * 0.47 - view.pw / 2;
      view.py = (view.h - ph) / 2 + view.h * 0.03;
    }
    view.unit = view.ph;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform4f(u.uPaper, view.px * view.dpr, view.py * view.dpr, view.pw * view.dpr, view.ph * view.dpr);
    gl.uniform1f(u.uScale, view.dpr);
    paint();
  }

  function toScreen(o) {
    return [view.px + view.pw / 2 + o.x * view.unit, view.py + view.ph / 2 + o.y * view.unit];
  }

  function drawCover() {
    coverCtx.setTransform(1, 0, 0, 1, 0, 0);
    coverCtx.clearRect(0, 0, FW, FH);
    const order = [...objects].sort((a, b) => a.z - b.z);
    for (const o of order) {
      const reach = Math.max(o.w, o.h) / 2 + 0.1;
      if (Math.abs(o.x) > 0.4 + reach || Math.abs(o.y) > 0.5 + reach) continue;
      const blur = (0.6 + 2.6 * o.thick + 9 * o.lift) * (FH / 360);
      coverCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (blurSupported) coverCtx.filter = `blur(${blur.toFixed(2)}px)`;
      coverCtx.globalAlpha = 1 - 0.5 * o.lift;
      coverCtx.translate(FW / 2 + o.x * FH, FH / 2 + o.y * FH);
      coverCtx.rotate(o.angle);
      coverCtx.drawImage(o.mask, -o.mask.width / 2, -o.mask.height / 2);
    }
    coverCtx.filter = "none";
    coverCtx.globalAlpha = 1;
    return coverCtx.getImageData(0, 0, FW, FH).data;
  }

  function expose(dt) {
    const data = drawCover();
    let delta = 0;
    const live = !state.fixed;
    const fresh = state.fresh < 1 ? ease(state.fresh) : 1;
    for (let i = 0; i < exposure.length; i += 1) {
      if (live) exposure[i] += dt * RATE * speed[i] * (1 - data[i * 4 + 3] / 255);
      const f = floor[i];
      let t = 255 * (f + (1 - f) * Math.exp(-exposure[i] / K));
      if (fresh < 1) t = previous[i] + (t - previous[i]) * fresh;
      const v = Math.round(t);
      const dv = Math.abs(v - tone[i]);
      if (dv > delta) delta = dv;
      tone[i] = v;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FW, FH, gl.RED, gl.UNSIGNED_BYTE, tone);
    return delta;
  }

  function placeObjects() {
    for (const o of objects) {
      const [sx, sy] = toScreen(o);
      const lift = o.lift;
      o.el.style.transform = `translate(${sx - (o.w * view.unit) / 2}px, ${sy - (o.h * view.unit) / 2}px) rotate(${o.angle}rad) scale(${1 + 0.035 * lift})`;
      o.el.style.zIndex = String(10 + o.z);
      const oy = (1.5 + 14 * lift) * (o.thick * 0.6 + 0.4);
      const blur = (2 + 18 * lift) * (o.thick * 0.5 + 0.5);
      o.el.style.filter = `drop-shadow(${oy * 0.4}px ${oy}px ${blur}px rgba(52, 24, 40, ${0.3 - 0.12 * lift}))`;
    }
  }

  function render() {
    gl.uniform1f(u.uFix, state.fix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !visible) return;
    let dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (state.sleeping) {
      dt = Math.min(60, (now - state.sleeping) / 1000);
      state.sleeping = 0;
    } else dt = Math.min(dt, 0.05);
    const frame = Math.min(dt, 0.05);
    let moving = false;
    for (const o of objects) {
      const prevLift = o.lift;
      o.lift = damp(o.lift, o.liftTarget, reducedMotion ? 40 : 14, frame);
      if (Math.abs(o.lift - o.liftTarget) < 0.002) o.lift = o.liftTarget;
      if (o.lift !== prevLift) moving = true;
    }
    if (drag) {
      const o = drag.object;
      const pace = Math.hypot(drag.vx, drag.vy);
      if (pace > 60 && !reducedMotion) {
        const r = Math.hypot(drag.lx, drag.ly);
        if (r > 0.04) {
          const want = Math.atan2(drag.vy, drag.vx) + Math.PI - Math.atan2(drag.ly, drag.lx);
          let diff = Math.atan2(Math.sin(want - o.angle), Math.cos(want - o.angle));
          diff = clamp(diff, -1.2, 1.2);
          o.angle += diff * (1 - Math.exp(-clamp(pace / 2400, 0, 1) * 2.2 * frame));
        }
      }
      const c = Math.cos(o.angle);
      const s = Math.sin(o.angle);
      const tx = drag.gx - (c * drag.lx - s * drag.ly);
      const ty = drag.gy - (s * drag.lx + c * drag.ly);
      o.x = damp(o.x, tx, 30, frame);
      o.y = damp(o.y, ty, 30, frame);
      drag.vx = damp(drag.vx, 0, 8, frame);
      drag.vy = damp(drag.vy, 0, 8, frame);
      moving = true;
    }
    if (state.fixT < 1) {
      state.fixT = Math.min(1, state.fixT + frame / 1.8);
      state.fix = state.fixFrom + (state.fixTo - state.fixFrom) * ease(state.fixT);
      moving = true;
    }
    if (state.fresh < 1) {
      state.fresh = Math.min(1, state.fresh + frame / 0.7);
      moving = true;
    }
    const delta = expose(dt);
    placeObjects();
    render();
    if (delta > 0 && !state.fixed) moving = true;
    calm = moving ? 0 : calm + 1;
    if (calm > 30) {
      state.sleeping = state.fixed ? 0 : now;
      last = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function wake() {
    calm = 0;
    if (!raf && visible && !destroyed) raf = requestAnimationFrame(tick);
  }

  function local(event) {
    const rect = stage.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return [(sx - view.px - view.pw / 2) / view.unit, (sy - view.py - view.ph / 2) / view.unit];
  }

  function pick(x, y) {
    const order = [...objects].sort((a, b) => b.z - a.z);
    for (const o of order) {
      const dx = x - o.x;
      const dy = y - o.y;
      const c = Math.cos(-o.angle);
      const s = Math.sin(-o.angle);
      const lx = c * dx - s * dy;
      const ly = s * dx + c * dy;
      const { alpha, w, h } = o.hit;
      const ix = Math.floor((lx / o.w + 0.5) * w);
      const iy = Math.floor((ly / o.h + 0.5) * h);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      if (alpha[iy * w + ix] > 10) return { o, lx, ly };
    }
    return null;
  }

  function raise(o) {
    const top = Math.max(...objects.map((p) => p.z));
    if (o.z !== top) o.z = top + 1;
    objects
      .slice()
      .sort((a, b) => a.z - b.z)
      .forEach((p, i) => {
        p.z = i;
      });
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const [x, y] = local(event);
    const found = pick(x, y);
    if (!found) return;
    event.preventDefault();
    foley.unlock();
    raise(found.o);
    found.o.liftTarget = 1;
    stage.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, object: found.o, lx: found.lx, ly: found.ly, gx: x, gy: y, vx: 0, vy: 0, t: performance.now() };
    stage.dataset.dragging = "";
    onChange({ held: found.o.name });
    wake();
  }

  function onPointerMove(event) {
    const [x, y] = local(event);
    if (drag && event.pointerId === drag.id) {
      const now = performance.now();
      const dt = Math.max(0.008, (now - drag.t) / 1000);
      const nx = clamp(x, -(view.px + view.pw / 2) / view.unit + 0.02, (view.w - view.px - view.pw / 2) / view.unit - 0.02);
      const ny = clamp(y, -(view.py + view.ph / 2) / view.unit + 0.02, (view.h - view.py - view.ph / 2) / view.unit - 0.02);
      drag.vx = damp(drag.vx, ((nx - drag.gx) * view.unit) / dt, 18, dt);
      drag.vy = damp(drag.vy, ((ny - drag.gy) * view.unit) / dt, 18, dt);
      drag.gx = nx;
      drag.gy = ny;
      drag.t = now;
      wake();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const over = Boolean(pick(x, y));
    if (over !== (stage.dataset.hover === "")) {
      if (over) stage.dataset.hover = "";
      else delete stage.dataset.hover;
    }
  }

  function drop(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    try {
      stage.releasePointerCapture(drag.id);
    } catch {}
    const o = drag.object;
    o.liftTarget = 0;
    foley.drop(o.id);
    drag = null;
    delete stage.dataset.dragging;
    onChange({ dropped: o.name, onPaper: Math.abs(o.x) < 0.4 && Math.abs(o.y) < 0.5 });
    wake();
  }

  function onKeyDown(event) {
    const o = objects.find((p) => p.el === event.target);
    if (!o) return;
    const step = event.altKey ? 0.005 : 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) o.angle += event.key === "ArrowLeft" ? -0.08 : 0.08;
    else {
      o.x = clamp(o.x + move[0], -1.4, 1.4);
      o.y = clamp(o.y + move[1], -0.9, 0.9);
    }
    raise(o);
    wake();
  }

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointermove", onPointerMove);
  stage.addEventListener("pointerup", drop);
  stage.addEventListener("pointercancel", drop);
  stage.addEventListener("lostpointercapture", drop);
  layer.addEventListener("keydown", onKeyDown);

  const ro = new ResizeObserver(() => {
    const before = view.compact;
    layout();
    if (before !== view.compact && !drag) {
      const h = homes(view.compact);
      for (const o of objects) {
        if (o.id === "grass" && (Math.abs(o.x) > 0.45 || Math.abs(o.y) > 0.55)) Object.assign(o, h.grass);
      }
    }
    placeObjects();
    render();
    wake();
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) wake();
  });
  io.observe(stage);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  layout();
  const start = homes(view.compact);
  for (const o of objects) Object.assign(o, start[o.id]);
  objects.find((o) => o.id === "grass").z = 0;
  objects.find((o) => o.id === "fern").z = 1;
  objects.find((o) => o.id === "key").z = 2;
  const pre = drawCover();
  for (let i = 0; i < exposure.length; i += 1) exposure[i] = PRE * (1 - pre[i * 4 + 3] / 255);
  expose(0);
  placeObjects();
  render();
  wake();

  return {
    fix() {
      if (state.fixed) return;
      state.fixed = true;
      state.fixFrom = state.fix;
      state.fixTo = 1;
      state.fixT = 0;
      onChange({ fixed: true });
      wake();
    },
    fresh() {
      previous.set(tone);
      exposure.fill(0);
      state.fixed = false;
      state.fresh = 0;
      state.fixFrom = state.fix;
      state.fixTo = 0;
      state.fixT = 0;
      onChange({ fixed: false });
      wake();
    },
    get fixed() {
      return state.fixed;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", drop);
      stage.removeEventListener("pointercancel", drop);
      stage.removeEventListener("lostpointercapture", drop);
      layer.removeEventListener("keydown", onKeyDown);
      objects.forEach((o) => o.el.remove());
      foley.close();
      gl.deleteTexture(fieldTex);
      gl.deleteTexture(lutTex);
      gl.deleteTexture(lutFixedTex);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
