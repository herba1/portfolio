import { WET_FRAGMENT, WET_VERTEX } from "./wetTypeShader";

export const WORD = "monsoon";

const PAPER = [0.965, 0.961, 0.945];
const INK = [0.106, 0.149, 0.69];
const DECAY = 0.984;
const TEETH = 6;
const GAP = 0.34;
const STRENGTH = 4.2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
  return shader;
}

export function createWetType(host, { canvas, blade, onReady, onFail, onTouched, insets }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false });
  const none = { destroy() {}, sweep() {} };
  if (!gl) {
    onFail?.();
    return none;
  }
  let prog;
  try {
    prog = gl.createProgram();
    const v = compile(gl, gl.VERTEX_SHADER, WET_VERTEX);
    const f = compile(gl, gl.FRAGMENT_SHADER, WET_FRAGMENT);
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  } catch {
    onFail?.();
    return none;
  }
  const U = {};
  for (const name of ["uMask", "uField", "uFieldTexel", "uRes", "uWarp", "uPx", "uPaper", "uInk"]) U[name] = gl.getUniformLocation(prog, name);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPosition");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const maskTex = gl.createTexture();
  const fieldTex = gl.createTexture();
  const maskCanvas = document.createElement("canvas");
  const mctx = maskCanvas.getContext("2d");
  const family = getComputedStyle(host).fontFamily || "sans-serif";

  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    gw: 1,
    gh: 1,
    cell: 1,
    data: new Float32Array(4),
    radius: 80,
    pointer: null,
    last: 0,
    raf: 0,
    visible: true,
    destroyed: false,
    active: false,
    energy: 0,
    sweep: null,
    touched: false,
    nextSweep: 0,
    bladeAngle: 0,
    bladeX: -999,
    bladeY: -999,
    bladeOn: 0,
    bladeShown: false,
    ready: false,
    laidOut: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  function drawMask() {
    const { width, height, dpr } = state;
    maskCanvas.width = Math.round(width * dpr);
    maskCanvas.height = Math.round(height * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.fillStyle = "#000";
    mctx.fillRect(0, 0, width, height);
    const inset = insets?.() || { top: 120, bottom: 64 };
    const tall = width / height < 0.8;
    const lines = tall ? ["mon", "soon"] : [WORD];
    const side = width < 640 ? 16 : Math.max(40, width * 0.06);
    const boxW = width - side * 2;
    const boxH = (height - inset.top - inset.bottom) * (tall ? 0.8 : 0.7);
    const probe = 200;
    mctx.font = `700 ${probe}px ${family}`;
    if ("letterSpacing" in mctx) mctx.letterSpacing = `${(-0.043 * (probe - 12)) / probe}em`;
    const widest = Math.max(...lines.map((l) => mctx.measureText(l).width));
    const leading = 0.86;
    let fs = Math.min((boxW / widest) * probe, boxH / (lines.length * leading));
    fs = Math.floor(fs);
    mctx.font = `700 ${fs}px ${family}`;
    if ("letterSpacing" in mctx) mctx.letterSpacing = `${-0.043 * (fs - 12)}px`;
    mctx.fillStyle = "#fff";
    mctx.textBaseline = "alphabetic";
    const m = mctx.measureText("monsh");
    const capTop = m.actualBoundingBoxAscent;
    const blockH = capTop + (lines.length - 1) * fs * leading;
    const room = height - inset.top - inset.bottom;
    let y = inset.top + (room - blockH) / 2 + capTop;
    for (const line of lines) {
      const w = mctx.measureText(line).width;
      mctx.fillText(line, (width - w) / 2 + (-0.043 * (fs - 12)) / 2, y);
      y += fs * leading;
    }
    state.fs = fs;
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, maskCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function buildField() {
    const { width, height } = state;
    const long = Math.max(width, height);
    const gw = Math.round((200 * width) / long);
    const gh = Math.round((200 * height) / long);
    state.gw = Math.max(8, gw);
    state.gh = Math.max(8, gh);
    state.cell = width / state.gw;
    state.data = new Float32Array(state.gw * state.gh * 4);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, state.gw, state.gh, 0, gl.RGBA, gl.FLOAT, state.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    state.radius = clamp(Math.min(width, height) * 0.1, 44, 104);
  }

  function stamp(px, py, dx, dy, amount, dry) {
    const { gw, gh, cell, data, width, height } = state;
    const R = state.radius;
    const rc = R / cell;
    const cx = px / cell;
    const cy = py / cell;
    const x0 = Math.max(0, Math.floor(cx - rc));
    const x1 = Math.min(gw - 1, Math.ceil(cx + rc));
    const y0 = Math.max(0, Math.floor(cy - rc));
    const y1 = Math.min(gh - 1, Math.ceil(cy + rc));
    const maxFlow = 0.2;
    for (let j = y0; j <= y1; j += 1) {
      for (let i = x0; i <= x1; i += 1) {
        const ox = (i + 0.5 - cx) * cell;
        const oy = (j + 0.5 - cy) * cell;
        const d = Math.hypot(ox, oy) / R;
        if (d >= 1) continue;
        const across = (-ox * dy + oy * dx) / R;
        const env = (1 - d) ** 1.2;
        const stripe = ((((across + 1) * 0.5 * TEETH) % 1) + 1) % 1;
        const tooth = stripe < GAP ? 0.3 : 1;
        const force = env * tooth;
        const k = 4 * ((gh - 1 - j) * gw + i);
        let fx = data[k] + (dx * amount * force) / width;
        let fy = data[k + 1] - (dy * amount * force) / height;
        const len = Math.hypot(fx, fy);
        if (len > maxFlow) {
          fx *= maxFlow / len;
          fy *= maxFlow / len;
        }
        data[k] = fx;
        data[k + 1] = fy;
        data[k + 2] = Math.min(1, data[k + 2] + force * dry * 0.035);
      }
    }
    state.active = true;
  }

  function brush(ax, ay, bx, by, dt, gain = 1) {
    const dist = Math.hypot(bx - ax, by - ay);
    if (dist < 0.5) return;
    const dx = (bx - ax) / dist;
    const dy = (by - ay) / dist;
    const speed = dist / Math.max(dt, 1 / 240);
    const fast = Math.min(1, speed / 1500);
    const steps = Math.max(1, Math.ceil(dist / (state.cell * 0.75)));
    const amount = (dist / steps) * STRENGTH * gain * (0.8 + 0.6 * fast);
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      stamp(ax + (bx - ax) * t, ay + (by - ay) * t, dx, dy, amount, fast);
    }
  }

  function decay(dt) {
    const k = DECAY ** (dt * 60);
    const { data } = state;
    let energy = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i] * k;
      const b = data[i + 1] * k;
      const c = data[i + 2] * k;
      data[i] = a;
      data[i + 1] = b;
      data[i + 2] = c;
      energy = Math.max(energy, Math.abs(a) + Math.abs(b) + c);
    }
    state.energy = energy;
    if (energy < 2e-4) {
      data.fill(0);
      state.active = false;
    }
  }

  function render() {
    const { gw, gh } = state;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(U.uMask, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.FLOAT, state.data);
    gl.uniform1i(U.uField, 1);
    gl.uniform2f(U.uFieldTexel, 1 / gw, 1 / gh);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uWarp, 1);
    gl.uniform1f(U.uPx, Math.max(1, Math.round(state.dpr * 1.5)));
    gl.uniform3fv(U.uPaper, PAPER);
    gl.uniform3fv(U.uInk, INK);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  function sweepPath(t) {
    const { width, height } = state;
    const inset = insets?.() || { top: 120, bottom: 64 };
    const mid = inset.top + (height - inset.top - inset.bottom) / 2;
    const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const tall = width / height < 0.8;
    const x0 = width * (tall ? 0.12 : 0.16);
    const x1 = width * (tall ? 0.86 : 0.66);
    const x = x0 + (x1 - x0) * k;
    const y = mid + state.fs * (tall ? 0.5 : 0.3) - state.fs * (tall ? 1.0 : 0.62) * k + Math.sin(k * Math.PI) * state.fs * 0.12;
    return [x, y];
  }

  function step(now) {
    state.raf = 0;
    if (state.destroyed) return;
    const t = now / 1000;
    const dt = Math.min(0.05, Math.max(0.001, t - (state.last || t)));
    state.last = t;

    if (!state.touched && !state.reduced && !state.sweep && t > state.nextSweep) state.sweep = { t0: t, T: 1.3, prev: null };
    const sw = state.sweep;
    let bladeTarget = null;
    if (sw) {
      const k = (t - sw.t0) / sw.T;
      if (k >= 1 || state.pointer) {
        state.sweep = null;
        state.nextSweep = t + 7;
      } else {
        const p = sweepPath(clamp(k, 0, 1));
        if (sw.prev) brush(sw.prev[0], sw.prev[1], p[0], p[1], dt, 0.55);
        sw.prev = p;
        const ahead = sweepPath(clamp(k + 0.02, 0, 1));
        bladeTarget = { x: p[0], y: p[1], vx: ahead[0] - p[0], vy: ahead[1] - p[1] };
      }
    }

    const pt = state.pointer;
    if (pt) {
      if (pt.moved) {
        brush(pt.px, pt.py, pt.x, pt.y, Math.max(dt, (pt.t - pt.pt) / 1000 || dt));
        bladeTarget = { x: pt.x, y: pt.y, vx: pt.x - pt.px, vy: pt.y - pt.py };
        pt.px = pt.x;
        pt.py = pt.y;
        pt.pt = pt.t;
        pt.moved = false;
      } else bladeTarget = { x: pt.x, y: pt.y, vx: 0, vy: 0 };
    }

    if (state.active) decay(dt);
    updateBlade(bladeTarget, dt);
    render();
    if (!state.ready) {
      state.ready = true;
      onReady?.();
    }
    const busy = state.active || state.sweep || state.pointer || Math.abs(state.bladeOn - (bladeTarget ? 1 : 0)) > 0.01 || (!state.touched && !state.reduced);
    if (busy && state.visible) state.raf = requestAnimationFrame(step);
    else state.last = 0;
  }

  function updateBlade(target, dt) {
    if (!blade) return;
    const on = target ? 1 : 0;
    state.bladeOn = damp(state.bladeOn, on, on ? 18 : 8, dt);
    if (target) {
      if (state.bladeX < -900) {
        state.bladeX = target.x;
        state.bladeY = target.y;
      }
      state.bladeX = target.x;
      state.bladeY = target.y;
      const sp = Math.hypot(target.vx, target.vy);
      if (sp > 1.5 && state.bladeOn < 0.08) state.bladeAngle = Math.atan2(target.vy, target.vx) + Math.PI / 2;
      else if (sp > 1.5) {
        const want = Math.atan2(target.vy, target.vx) + Math.PI / 2;
        let diff = want - state.bladeAngle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > Math.PI / 2) diff -= Math.sign(diff) * Math.PI;
        state.bladeAngle += diff * (1 - Math.exp(-14 * dt));
      }
    }
    blade.style.transform = `translate3d(${state.bladeX}px, ${state.bladeY}px, 0) rotate(${state.bladeAngle}rad) scale(${0.85 + 0.15 * state.bladeOn})`;
    blade.style.opacity = String(state.bladeOn);
    blade.style.setProperty("--wet-type-blade", `${state.radius * 1.9}px`);
  }

  function frame() {
    if (state.destroyed || state.raf || !state.visible) return;
    state.raf = requestAnimationFrame(step);
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function touch() {
    if (state.touched) return;
    state.touched = true;
    state.sweep = null;
    onTouched?.();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (e.pointerType !== "mouse" && !state.pointer) return;
    if (!state.pointer) state.pointer = { x, y, px: x, py: y, t: e.timeStamp, pt: e.timeStamp, moved: false, id: e.pointerId };
    const pt = state.pointer;
    pt.x = x;
    pt.y = y;
    pt.t = e.timeStamp;
    pt.moved = true;
    touch();
    frame();
  }

  function onDown(e) {
    const [x, y] = local(e);
    if (e.pointerType !== "mouse") {
      canvas.setPointerCapture?.(e.pointerId);
      state.pointer = { x, y, px: x, py: y, t: e.timeStamp, pt: e.timeStamp, moved: false, id: e.pointerId };
      touch();
      frame();
    }
  }

  function onLeave(e) {
    if (state.pointer && (e.pointerType === "mouse" || e.type !== "pointerleave")) state.pointer = null;
    frame();
  }

  function resize() {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (state.laidOut && Math.abs(r.width - state.width) < 0.5 && Math.abs(r.height - state.height) < 0.5 && dpr === state.dpr) return;
    state.laidOut = true;
    state.width = Math.max(1, r.width);
    state.height = Math.max(1, r.height);
    state.dpr = dpr;
    canvas.width = Math.round(state.width * dpr);
    canvas.height = Math.round(state.height * dpr);
    drawMask();
    buildField();
    frame();
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onLeave);
  canvas.addEventListener("pointercancel", onLeave);
  canvas.addEventListener("pointerleave", onLeave);
  const ro = new ResizeObserver(() => resize());
  const io = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting && document.visibilityState === "visible";
    frame();
  });
  const onVisibility = () => {
    state.visible = document.visibilityState === "visible";
    frame();
  };
  const onLost = (e) => {
    e.preventDefault();
    onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  document.fonts
    .load(`700 200px ${family}`, WORD)
    .catch(() => null)
    .then(() => {
      if (state.destroyed) return;
      ro.observe(host);
      io.observe(host);
      document.addEventListener("visibilitychange", onVisibility);
      resize();
      state.nextSweep = performance.now() / 1000 + 0.9;
      frame();
    });

  return {
    sweep() {
      state.sweep = { t0: performance.now() / 1000, T: 1.3, prev: null };
      frame();
    },
    destroy() {
      state.destroyed = true;
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onLeave);
      canvas.removeEventListener("pointercancel", onLeave);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteTexture(maskTex);
      gl.deleteTexture(fieldTex);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
