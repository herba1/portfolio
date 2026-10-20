import { PINS_FRAGMENT, PINS_VERTEX } from "./pinsShader";

const ROW = Math.sqrt(3) / 2;
const DEPTH = 7;
const PRESS_SPAN = 1.1;
const PIN_TRAVEL = 0.42;
const FINGER = 4.2;

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

async function relief(src, cols, rows) {
  const img = await loadImage(src);
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i += 1) lum[i] = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255;
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
      const base = 0.35 * wide[k] + 0.65 * fine[k];
      const t = clamp((base - 0.06) / 0.8, 0, 1);
      out[j * cols + i] = Math.pow(smooth(t), 0.9) * 0.92 + wide[k] * 0.08;
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

export async function createPins({ root, stage, canvas, albums, onAlbum, onReady }) {
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
  for (const n of ["uRes", "uScale", "uField", "uGrid", "uDepth", "uLight", "uHeight"]) loc[n] = gl.getUniformLocation(program, n);
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const view = { w: 1, h: 1, dpr: 1, x: 0, y: 0, pitch: 4 };
  let cols = 0;
  let rows = 0;
  let heights = new Float32Array(1);
  let from = new Float32Array(1);
  let target = new Float32Array(1);
  let mode = "idle";
  let modeT = 0;
  let pendingAlbum = -1;
  let current = 0;
  const reliefs = new Map();
  const pointer = { id: null, x: 0, y: 0, px: 0, py: 0 };
  let raf = 0;
  let last = 0;
  let active = true;
  let destroyed = false;
  let dirty = true;
  let uploaded = false;

  function gridFor(width) {
    return width < 720 ? 72 : 100;
  }

  function allocate(c) {
    cols = c;
    rows = Math.round((cols + 0.5) / ROW);
    heights = new Float32Array(cols * rows);
    from = new Float32Array(cols * rows);
    target = new Float32Array(cols * rows);
    reliefs.clear();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, cols, rows, 0, gl.RED, gl.FLOAT, heights);
  }

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const narrow = view.w < 720;
    const top = narrow ? 148 : 96;
    const bottom = narrow ? 96 : 96;
    const avail = Math.max(160, Math.min(view.w - (narrow ? 32 : 96), view.h - top - bottom));
    const c = gridFor(view.w);
    const changed = c !== cols;
    if (changed) allocate(c);
    view.pitch = avail / (cols + 0.5 + 2.8);
    const fw = (cols + 0.5) * view.pitch;
    const fh = rows * ROW * view.pitch;
    view.x = (view.w - fw) / 2;
    view.y = top + (view.h - top - bottom - fh) / 2;
    dirty = true;
    return changed;
  }

  async function reliefFor(idx) {
    if (!reliefs.has(idx)) reliefs.set(idx, relief(albums[idx].cover, cols, rows));
    return reliefs.get(idx);
  }

  async function press(idx) {
    const r = await reliefFor(idx);
    if (destroyed) return;
    target = r;
    from.set(heights);
    mode = "press";
    modeT = 0;
    current = idx;
    onAlbum?.(idx);
    wake();
  }

  function flatten(next = -1) {
    from.set(heights);
    mode = "flatten";
    modeT = 0;
    pendingAlbum = next;
    wake();
  }

  function step(dt) {
    let moved = 0;
    if (mode === "press") {
      modeT += dt;
      const n = cols * rows;
      for (let k = 0; k < n; k += 1) {
        const j = Math.floor(k / cols);
        const delay = (1 - j / rows) * PRESS_SPAN;
        const u = reduced ? 1 : clamp((modeT - delay) / PIN_TRAVEL, 0, 1);
        const want = Math.max(from[k], target[k] * smooth(u));
        if (Math.abs(want - heights[k]) > 0.002) moved += 1;
        heights[k] = want;
      }
      if (modeT > PRESS_SPAN + PIN_TRAVEL || reduced) mode = "idle";
      dirty = true;
    } else if (mode === "flatten") {
      modeT += dt;
      const n = cols * rows;
      for (let k = 0; k < n; k += 1) {
        const j = Math.floor(k / cols);
        const delay = (j / rows) * 0.5;
        const u = reduced ? 1 : clamp((modeT - delay) / 0.32, 0, 1);
        const want = from[k] * (1 - u * u);
        if (Math.abs(want - heights[k]) > 0.002) moved += 1;
        heights[k] = want;
      }
      if (modeT > 0.9 || reduced) {
        mode = "idle";
        if (pendingAlbum >= 0) {
          const next = pendingAlbum;
          pendingAlbum = -1;
          press(next);
        }
      }
      dirty = true;
    }
    if (pointer.id !== null) {
      const steps = Math.max(1, Math.ceil(Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py) / (view.pitch * 1.2)));
      for (let s = 1; s <= steps; s += 1) {
        const x = pointer.px + ((pointer.x - pointer.px) * s) / steps;
        const y = pointer.py + ((pointer.y - pointer.py) * s) / steps;
        moved += pushAt(x, y);
      }
      pointer.px = pointer.x;
      pointer.py = pointer.y;
    }
    if (moved) sound.clatter(moved * 0.25, dt);
    return mode !== "idle" || pointer.id !== null;
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
        const want = 0.95 * Math.sqrt(1 - d * d);
        const k = j * cols + i;
        if (want > heights[k] + 0.01) {
          heights[k] = want;
          moved += 1;
        }
      }
    }
    if (moved) dirty = true;
    return moved;
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (!uploaded || dirty) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RED, gl.FLOAT, heights);
      uploaded = true;
    }
    gl.uniform1i(loc.uHeight, 0);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uScale, view.dpr);
    gl.uniform4f(loc.uField, view.x, view.y, view.pitch, 0);
    gl.uniform2f(loc.uGrid, cols, rows);
    gl.uniform1f(loc.uDepth, DEPTH);
    gl.uniform3f(loc.uLight, -0.62, -0.5, 0.6);
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
      onReady?.();
    }
    if (moving) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !active) return;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    const fw = (cols + 0.5) * view.pitch;
    const fh = rows * ROW * view.pitch;
    if (x < view.x || y < view.y || x > view.x + fw || y > view.y + fh) return;
    e.preventDefault();
    sound.wake();
    stage.setPointerCapture?.(e.pointerId);
    pointer.id = e.pointerId;
    pointer.x = pointer.px = x;
    pointer.y = pointer.py = y;
    root.dataset.pressing = "";
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
  }

  function onKey(e) {
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "f") {
      e.preventDefault();
      sound.wake();
      flatten();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      sound.wake();
      flatten(current);
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= albums.length) {
      sound.wake();
      flatten(Number(e.key) - 1);
    }
  }

  layout();
  render();
  await press(0);

  const ro = new ResizeObserver(() => {
    const changed = layout();
    if (changed) press(current);
    else {
      render();
      dirty = false;
    }
  });
  ro.observe(root);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);

  return {
    setActive(on) {
      active = on;
      if (on) {
        last = 0;
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    choose(idx) {
      sound.wake();
      flatten(idx);
    },
    flatten() {
      sound.wake();
      flatten();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      sound.destroy();
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
