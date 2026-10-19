import { PINS_FRAGMENT, PINS_VERTEX } from "./pinsShader";

const ROW = Math.sqrt(3) / 2;
const PAD = 1.4;
const FINGER = 4.2;
const OMEGA = 15;
const ZETA = 0.66;
const WAVE_SPEED = 46;
const LIFT = 0.42;
const LIFT_WIDTH = 0.2;
const HOLD = 0.32;
const RELAX = 1.15;
const IDLE_MS = 4600;
const ORIGINS = [
  [0.08, 0.1],
  [0.95, 0.5],
  [0.5, 0.96],
  [0.04, 0.6],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
  return sh;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = r * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += src[y * w + clamp(x + k, 0, w - 1)];
      tmp[y * w + x] = s / span;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += tmp[clamp(y + k, 0, h - 1) * w + x];
      out[y * w + x] = s / span;
    }
  }
  return out;
}

async function relief(subject, cols, rows) {
  const img = await loadImage(subject.src);
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const W = img.naturalWidth;
  const [cx, cy, cs] = subject.crop;
  ctx.drawImage(img, cx * W, cy * W, cs * W, cs * W, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i += 1) lum[i] = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255;
  const sorted = Float32Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.985)];
  for (let i = 0; i < lum.length; i += 1) lum[i] = clamp((lum[i] - lo) / Math.max(hi - lo, 0.05), 0, 1);
  const wide = blur(blur(lum, S, S, 6), S, S, 4);
  const fine = blur(lum, S, S, 1);
  const out = new Float32Array(cols * rows);
  const width = cols + 0.5;
  const height = rows * ROW;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = (i + 0.5 + (j % 2) * 0.5) / width;
      const y = ((j + 0.5) * ROW) / height;
      const sx = clamp(Math.round(x * (S - 1)), 0, S - 1);
      const sy = clamp(Math.round(y * (S - 1)), 0, S - 1);
      const k = sy * S + sx;
      const base = 0.15 * wide[k] + 0.85 * fine[k];
      out[j * cols + i] = clamp((base - 0.05) / 0.85, 0, 1);
    }
  }
  return out;
}

function createSound() {
  let ctx = null;
  let budget = 0;
  return {
    wake() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      }
      if (ctx.state === "suspended") ctx.resume();
    },
    clatter(amount, dt) {
      if (!ctx || ctx.state !== "running") return;
      budget += Math.min(amount, 60) * dt;
      const t = ctx.currentTime;
      while (budget >= 1) {
        budget -= 1;
        const when = t + Math.random() * 0.03;
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = 3800 + Math.random() * 3600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.018 + Math.random() * 0.02, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03 + Math.random() * 0.03);
        o.connect(g).connect(ctx.destination);
        o.start(when);
        o.stop(when + 0.08);
      }
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}

export async function createPins({ root, stage, canvas, subjects, onAlbum }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) throw new Error("WebGL2 unavailable");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createSound();
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, PINS_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, PINS_FRAGMENT);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  const loc = {};
  for (const n of ["uRes", "uScale", "uField", "uGrid", "uPlate", "uHeight"]) loc[n] = gl.getUniformLocation(program, n);
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const plateColor = (() => {
    const m = getComputedStyle(stage).backgroundColor.match(/\d+(\.\d+)?/g) || [18, 19, 21];
    return m.slice(0, 3).map((v) => Number(v) / 255);
  })();

  const view = { w: 1, h: 1, dpr: 1, x: 0, y: 0, pitch: 4 };
  let cols = 0;
  let rows = 0;
  let heights = new Float32Array(1);
  let vel = new Float32Array(1);
  let base = new Float32Array(1);
  let next = new Float32Array(1);
  let delay = new Float32Array(1);
  let imp = new Float32Array(1);
  let hold = new Float32Array(1);
  let zeros = new Float32Array(1);
  let wave = null;
  let current = 0;
  let wanted = 0;
  let ticket = 0;
  let loopIndex = 0;
  let lastInput = 0;
  let idleTimer = 0;
  const reliefs = new Map();
  const pointer = { id: null, x: 0, y: 0, px: 0, py: 0 };
  let raf = 0;
  let last = 0;
  let active = true;
  let destroyed = false;
  let dirty = true;

  function allocate(c) {
    cols = c;
    rows = Math.round((cols + 0.5) / ROW);
    const n = cols * rows;
    heights = new Float32Array(n);
    vel = new Float32Array(n);
    base = new Float32Array(n);
    next = new Float32Array(n);
    delay = new Float32Array(n);
    imp = new Float32Array(n);
    hold = new Float32Array(n);
    zeros = new Float32Array(n);
    wave = null;
    reliefs.clear();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, cols, rows, 0, gl.RED, gl.FLOAT, heights);
  }

  function layout() {
    const rect = stage.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const side = Math.min(view.w, view.h);
    const c = side < 480 ? 56 : 80;
    const changed = c !== cols;
    if (changed) allocate(c);
    view.pitch = Math.min(view.w / (cols + 0.5 + PAD * 2), view.h / (rows * ROW + PAD * 2));
    view.x = (view.w - (cols + 0.5) * view.pitch) / 2;
    view.y = (view.h - rows * ROW * view.pitch) / 2;
    dirty = true;
    return changed;
  }

  function reliefFor(idx) {
    if (!reliefs.has(idx)) reliefs.set(idx, relief(subjects[idx], cols, rows));
    return reliefs.get(idx);
  }

  function rollTo(target, origin, lift = LIFT) {
    if (wave) {
      const t = (performance.now() - wave.start) / 1000;
      for (let k = 0; k < base.length; k += 1) if (t >= delay[k]) base[k] = next[k];
    }
    next = target;
    const ox = origin[0] * (cols + 0.5);
    const oy = origin[1] * rows * ROW;
    let far = 0;
    for (let j = 0; j < rows; j += 1) {
      const y = (j + 0.5) * ROW;
      const shift = (j % 2) * 0.5;
      for (let i = 0; i < cols; i += 1) {
        const d = Math.hypot(i + 0.5 + shift - ox, y - oy) / WAVE_SPEED;
        delay[j * cols + i] = d;
        if (d > far) far = d;
      }
    }
    wave = { start: performance.now(), far, target, lift };
    if (reduced) {
      base.set(target);
      heights.set(target);
      vel.fill(0);
      wave = null;
      dirty = true;
    }
    wake();
  }

  async function press(idx, origin) {
    const mine = ++ticket;
    wanted = idx;
    const r = await reliefFor(idx);
    if (destroyed || mine !== ticket) return;
    current = idx;
    rollTo(r, origin);
  }

  function flatten() {
    ticket += 1;
    rollTo(zeros, [0.5, 0.04], 0.12);
  }

  function nudge() {
    lastInput = performance.now();
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
  }

  function scheduleIdle() {
    if (idleTimer || reduced || destroyed || !active || pointer.id !== null) return;
    const now = performance.now();
    lastInput = Math.max(lastInput, now - IDLE_MS + 3400);
    const wait = Math.max(120, IDLE_MS - (now - lastInput));
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (destroyed || !active || pointer.id !== null || wave) return;
      if (performance.now() - lastInput < IDLE_MS - 60) {
        scheduleIdle();
        return;
      }
      loopIndex += 1;
      const idx = (current + 1) % subjects.length;
      onAlbum?.(idx);
      press(idx, ORIGINS[loopIndex % ORIGINS.length]);
    }, wait);
  }

  function step(dt) {
    let clicks = 0;
    let busy = false;
    const n = cols * rows;
    const t = wave ? (performance.now() - wave.start) / 1000 : 0;
    if (wave && t > wave.far + 0.9) {
      base.set(wave.target);
      wave = null;
    }
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    const k2 = OMEGA * OMEGA;
    const c = 2 * ZETA * OMEGA;
    for (let k = 0; k < n; k += 1) {
      let target = base[k];
      if (wave) {
        const tk = t - delay[k];
        if (tk >= 0) target = next[k];
        const lift = wave.lift * Math.exp(-((tk / LIFT_WIDTH) ** 2));
        if (lift > 0.002) target = Math.max(target, Math.min(1, Math.max(base[k], next[k]) + lift));
      }
      if (hold[k] > 0) hold[k] = Math.max(0, hold[k] - dt);
      else if (imp[k] > 0) imp[k] = Math.max(0, imp[k] - dt * RELAX);
      if (imp[k] > target) target = imp[k];
      let x = heights[k];
      let v = vel[k];
      for (let s = 0; s < sub; s += 1) {
        v += (k2 * (target - x) - c * v) * h;
        x += v * h;
      }
      if (x < 0) {
        if (v < -1.4) clicks += 1;
        x = 0;
        v = 0;
      } else if (x > 1.08) {
        x = 1.08;
        v = Math.min(v, 0);
      }
      if (Math.abs(v) > 0.003 || Math.abs(target - x) > 0.002) busy = true;
      else {
        x = target;
        v = 0;
      }
      if (x !== heights[k]) dirty = true;
      heights[k] = x;
      vel[k] = v;
    }
    if (pointer.id !== null) {
      const steps = Math.max(1, Math.ceil(Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py) / (view.pitch * 1.2)));
      for (let s = 1; s <= steps; s += 1) {
        const x = pointer.px + ((pointer.x - pointer.px) * s) / steps;
        const y = pointer.py + ((pointer.y - pointer.py) * s) / steps;
        clicks += pushAt(x, y) * 0.25;
      }
      pointer.px = pointer.x;
      pointer.py = pointer.y;
      busy = true;
    }
    if (clicks) sound.clatter(clicks, dt);
    return busy || Boolean(wave);
  }

  function pushAt(x, y) {
    const fx = (x - view.x) / view.pitch;
    const fy = (y - view.y) / view.pitch;
    const R = FINGER;
    const j0 = clamp(Math.floor((fy - R) / ROW), 0, rows - 1);
    const j1 = clamp(Math.ceil((fy + R) / ROW), 0, rows - 1);
    let moved = 0;
    for (let j = j0; j <= j1; j += 1) {
      const shift = (j % 2) * 0.5;
      const i0 = clamp(Math.floor(fx - R - shift), 0, cols - 1);
      const i1 = clamp(Math.ceil(fx + R - shift), 0, cols - 1);
      for (let i = i0; i <= i1; i += 1) {
        const d = Math.hypot(i + 0.5 + shift - fx, (j + 0.5) * ROW - fy) / R;
        if (d >= 1) continue;
        const want = Math.sqrt(1 - d * d);
        const k = j * cols + i;
        if (want > imp[k] + 0.01) {
          if (want > heights[k] + 0.08) moved += 1;
          imp[k] = want;
        }
        if (want > 0.05) hold[k] = HOLD;
      }
    }
    return moved;
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED, gl.FLOAT, heights);
    gl.uniform1i(loc.uHeight, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uScale, view.dpr);
    gl.uniform3f(loc.uField, view.x, view.y, view.pitch);
    gl.uniform2f(loc.uGrid, cols, rows);
    gl.uniform3f(loc.uPlate, plateColor[0], plateColor[1], plateColor[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    const moving = step(dt);
    if (dirty) {
      render();
      dirty = false;
    }
    if (moving) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      scheduleIdle();
    }
  }

  function wake() {
    if (raf || destroyed || !active) return;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = stage.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointer.id !== null) return;
    const [x, y] = local(e);
    e.preventDefault();
    sound.wake();
    stage.setPointerCapture?.(e.pointerId);
    pointer.id = e.pointerId;
    pointer.x = pointer.px = x;
    pointer.y = pointer.py = y;
    root.dataset.pressing = "";
    nudge();
    pushAt(x, y);
    wake();
  }

  function onMove(e) {
    if (e.pointerId !== pointer.id) return;
    [pointer.x, pointer.y] = local(e);
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.id = null;
    delete root.dataset.pressing;
    nudge();
    wake();
  }

  function choose(idx) {
    sound.wake();
    nudge();
    onAlbum?.(idx);
    press(idx, [0.5, 0.98]);
  }

  function onKey(e) {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      sound.wake();
      nudge();
      flatten();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(wanted);
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= subjects.length) {
      choose(Number(e.key) - 1);
    }
  }

  layout();
  render();
  nudge();
  await press(0, [0.5, 0.98]);

  const ro = new ResizeObserver(() => {
    const changed = layout();
    if (changed) {
      press(current, [0.5, 0.98]);
    } else {
      render();
      dirty = false;
    }
  });
  ro.observe(stage);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("lostpointercapture", onUp);
  stage.addEventListener("keydown", onKey);

  return {
    setActive(on) {
      active = on;
      if (on) {
        last = 0;
        dirty = true;
        wake();
      } else {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = 0;
      }
    },
    choose,
    flatten() {
      sound.wake();
      nudge();
      flatten();
    },
    destroy() {
      destroyed = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("lostpointercapture", onUp);
      stage.removeEventListener("keydown", onKey);
      sound.destroy();
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
