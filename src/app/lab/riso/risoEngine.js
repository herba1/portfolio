import { FEATURED } from "@/app/lab/_music/catalog";

import { createRisoSound } from "./risoAudio";
import { RISO_FRAGMENT, RISO_VERTEX } from "./risoShader";

export const COVERS = FEATURED;

export const LINES = [
  "we can stay out till the streetlights go soft",
  "nothing good comes easy but it comes",
  "i keep your voice on the walk home",
  "the whole point is not knowing and going anyway",
  "it will take a while to feel like this again",
  "you don't have to be anyone tonight",
];

export const INKS = [
  { id: "yellow", name: "Yellow", hex: "#ffe800", t: [1, 0.9, 0.07], angle: 0.08 },
  { id: "pink", name: "Fluorescent pink", hex: "#ff48b0", t: [1, 0.29, 0.66], angle: 1.31 },
  { id: "blue", name: "Medium blue", hex: "#0078bf", t: [0.07, 0.46, 0.75], angle: 0.26 },
];

const SHEET_MM = 148;
const FONT = "RisoArimo";
const LIMIT = 18;
const IDLE = 9000;

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(info || "compile failed");
  }
  return s;
}

function link(gl) {
  const vs = compile(gl, gl.VERTEX_SHADER, RISO_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, RISO_FRAGMENT);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  const u = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(prog, i);
    u[info.name.replace("[0]", "")] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u };
}

const ease = (t) => 1 - Math.pow(1 - t, 3);
const rand = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

function wrap(ctx, text, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function createRiso({ sheet, under, onState = () => {}, onFail = () => {} }) {
  const canvas = document.createElement("canvas");
  canvas.className = "riso-canvas";
  sheet.append(canvas);
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: true });
  let program = null;
  try {
    program = gl ? link(gl) : null;
  } catch {
    program = null;
  }
  if (!program) {
    canvas.remove();
    onFail();
    return { destroy() {}, pull() {}, setActive() {}, nudge() {}, setSound: async () => false };
  }
  const { prog, u } = program;
  const vao = gl.createVertexArray();

  const makeTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    return t;
  };
  const coverTex = makeTex();
  const plateTex = makeTex();
  const plate = document.createElement("canvas");
  const px = plate.getContext("2d");
  const underCtx = under.getContext("2d");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const images = new Map();
  let sound = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let job = null;
  let content = null;
  let edition = 7;
  let seed = 3;
  let offsets = [
    [1.2, -0.8],
    [-2.1, 1.4],
    [0.9, 2.2],
  ];
  let rots = [0.0008, -0.0012, 0.0006];
  let prog3 = [0, 0, 0];
  let active = 1;
  let drag = null;
  let raf = 0;
  let dirty = true;
  let destroyed = false;
  let visible = !document.hidden;
  let onscreen = true;
  let idleTimer = 0;
  let lastInput = 0;
  let hasCover = 0;
  let printed = false;

  const mm = (v) => (v / Math.max(1, W)) * SHEET_MM;
  const emit = () => onState({ offsets: offsets.map(([x, y]) => [mm(x), mm(y)]), printing: Boolean(job), content: content ? { cover: content.cover, line: content.line } : null, active });

  const loadImage = (src) => {
    if (images.has(src)) return images.get(src);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
    return p;
  };

  const layoutBox = () => {
    const m = W * 0.08;
    return { m, img: [m, m * 1.3, W - m * 2, W - m * 2] };
  };

  const buildPlate = () => {
    if (!content || !W) return;
    plate.width = Math.round(W * dpr);
    plate.height = Math.round(H * dpr);
    px.setTransform(dpr, 0, 0, dpr, 0, 0);
    px.globalCompositeOperation = "source-over";
    px.fillStyle = "#000";
    px.fillRect(0, 0, W, H);
    px.globalCompositeOperation = "lighter";
    const { m, img } = layoutBox();
    const album = COVERS[content.cover];

    const reg = (x, y, r) => {
      px.strokeStyle = "#fff";
      px.lineWidth = Math.max(0.75, W / 600);
      px.beginPath();
      px.arc(x, y, r, 0, Math.PI * 2);
      px.stroke();
      px.beginPath();
      px.moveTo(x - r * 1.7, y);
      px.lineTo(x + r * 1.7, y);
      px.moveTo(x, y - r * 1.7);
      px.lineTo(x, y + r * 1.7);
      px.stroke();
    };
    const r = Math.max(4, W * 0.011);
    reg(m * 0.55, m * 0.62, r);
    reg(W - m * 0.55, m * 0.62, r);

    const small = Math.max(9, W * 0.025);
    px.font = `400 ${small}px ${FONT}`;
    px.textBaseline = "alphabetic";
    px.fillStyle = "rgb(0,255,0)";
    px.fillText(`no. ${String(edition).padStart(2, "0")}`, m, m * 0.62 + small * 0.36);
    px.textAlign = "right";
    px.fillText(`${album.title.toLowerCase()}, ${album.year}`, W - m, m * 0.62 + small * 0.36);
    px.textAlign = "left";

    const top = img[1] + img[3] + m * 0.62;
    const room = W - m * 2;
    let size = W * 0.083;
    let lines = [];
    for (let k = 0; k < 8; k += 1) {
      px.font = `700 ${size}px ${FONT}`;
      lines = wrap(px, content.text, room);
      if (lines.length <= 3) break;
      size *= 0.92;
    }
    const lead = size * 0.98;
    px.fillStyle = "rgb(0,0,255)";
    lines.forEach((line, i) => px.fillText(line, m - size * 0.04, top + size * 0.74 + i * lead));

    const foot = H - m * 0.62;
    px.font = `400 ${small}px ${FONT}`;
    px.fillStyle = "rgb(0,255,0)";
    px.fillText(`${album.artist.toLowerCase()} · ${album.tracks[content.cover % album.tracks.length].toLowerCase()}`, m, foot);
    const sw = small * 0.9;
    const sx0 = W - m - sw * 5;
    const sy = foot - sw * 0.82;
    const swatch = (x, color) => {
      px.fillStyle = color;
      px.fillRect(x, sy, sw, sw);
    };
    swatch(sx0, "rgb(255,0,0)");
    swatch(sx0 + sw, "rgb(0,255,0)");
    swatch(sx0 + sw * 2, "rgb(0,0,255)");
    swatch(sx0 + sw * 3, "rgb(255,255,0)");
    swatch(sx0 + sw * 4, "rgb(0,255,255)");
    px.globalCompositeOperation = "source-over";
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plate);
  };

  const uploadCover = (img) => {
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    hasCover = 1;
  };

  const render = () => {
    if (!W) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverTex);
    gl.uniform1i(u.uCover, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(u.uPlate, 1);
    gl.uniform2f(u.uSize, W, H);
    const { img } = layoutBox();
    gl.uniform4f(u.uImg, img[0], img[1], img[2], img[3]);
    gl.uniform2fv(u.uOff, offsets.flat());
    gl.uniform1fv(u.uRot, rots);
    gl.uniform1fv(u.uProg, prog3);
    gl.uniform3fv(u.uInk, INKS.flatMap((i) => i.t));
    gl.uniform1fv(u.uAngle, INKS.map((i) => i.angle));
    gl.uniform1f(u.uPitch, Math.max(2.4, W / 168));
    gl.uniform1f(u.uSeed, seed);
    gl.uniform1f(u.uDevice, dpr);
    gl.uniform1f(u.uHasCover, hasCover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const snapshotUnder = () => {
    if (!printed) return;
    under.width = canvas.width;
    under.height = canvas.height;
    underCtx.drawImage(canvas, 0, 0);
    under.dataset.show = "";
  };

  const PASS = 0.82;
  const GAP = 0.16;
  const FEED = 0.5;

  const tick = (now) => {
    raf = 0;
    if (destroyed) return;
    let busy = false;
    if (job) {
      const t = (now - job.start) / 1000;
      for (let i = 0; i < 3; i += 1) {
        const s = FEED + i * (PASS + GAP);
        const p = Math.min(1, Math.max(0, (t - s) / PASS));
        if (p > 0 && !job.started[i]) {
          job.started[i] = true;
          sound?.drum(PASS, i);
        }
        prog3[i] = p <= 0 ? 0 : ease(p) * 0.15 + p * 0.85;
      }
      dirty = true;
      if (t >= FEED + 3 * PASS + 2 * GAP) {
        prog3 = [1, 1, 1];
        job = null;
        printed = true;
        emit();
        scheduleIdle();
      } else busy = true;
    }
    if (dirty) {
      render();
      dirty = false;
    }
    if (busy) raf = requestAnimationFrame(tick);
  };

  function wake() {
    dirty = true;
    if (destroyed || raf || !visible || !onscreen) return;
    raf = requestAnimationFrame(tick);
  }

  const scheduleIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (destroyed) return;
      const quiet = performance.now() - lastInput;
      if (job || drag || quiet < IDLE || !visible || !onscreen || reduced) {
        scheduleIdle();
        return;
      }
      const next = content ? { cover: (content.cover + 1) % COVERS.length, line: (content.line + 1) % LINES.length } : { cover: 0, line: 0 };
      pull(next.cover, next.line, true);
    }, IDLE);
  };

  const misregister = () => {
    const r = rand(seed * 7919 + 13);
    offsets = offsets.map(() => [(r() - 0.5) * 4.5, (r() - 0.5) * 4.5]);
    rots = rots.map(() => (r() - 0.5) * 0.004);
  };

  async function pull(cover, line, auto = false, instant = false) {
    if (!auto) lastInput = performance.now();
    const album = COVERS[cover];
    const img = await loadImage(album.cover);
    if (destroyed) return;
    snapshotUnder();
    seed = (seed * 1.618 + 0.7) % 97;
    edition += 1;
    content = { cover, line, text: LINES[line] };
    if (img) uploadCover(img);
    buildPlate();
    misregister();
    if (instant || reduced) {
      prog3 = [1, 1, 1];
      job = null;
      printed = true;
      wake();
      emit();
      scheduleIdle();
      return;
    }
    prog3 = [0, 0, 0];
    job = { start: performance.now(), started: [false, false, false] };
    sheet.animate(
      [
        { transform: "translate3d(0, -40px, 0) rotate(-0.6deg)" },
        { transform: "translate3d(0, 0, 0) rotate(0deg)" },
      ],
      { duration: 460, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    sound?.feed();
    emit();
    wake();
  }

  const layout = () => {
    const r = sheet.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nextW = r.width;
    const nextH = r.height;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nextW === W && nextH === H && nextDpr === dpr) return;
    const scaleOffsets = W ? nextW / W : 1;
    W = nextW;
    H = nextH;
    dpr = nextDpr;
    offsets = offsets.map(([x, y]) => [x * scaleOffsets, y * scaleOffsets]);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    buildPlate();
    wake();
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    lastInput = performance.now();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, base: [...offsets[active]], lastTick: [...offsets[active]] };
    canvas.setPointerCapture?.(e.pointerId);
    sheet.dataset.dragging = "";
    e.preventDefault();
  };

  const setOffset = (i, x, y) => {
    const nx = Math.max(-LIMIT, Math.min(LIMIT, x));
    const ny = Math.max(-LIMIT, Math.min(LIMIT, y));
    offsets[i] = [nx, ny];
    wake();
    emit();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    lastInput = performance.now();
    const k = 0.5;
    const nx = drag.base[0] + (e.clientX - drag.x) * k;
    const ny = drag.base[1] + (e.clientY - drag.y) * k;
    setOffset(active, nx, ny);
    const [lx, ly] = drag.lastTick;
    const step = W / SHEET_MM * 0.25;
    if (Math.abs(offsets[active][0] - lx) >= step || Math.abs(offsets[active][1] - ly) >= step) {
      drag.lastTick = [...offsets[active]];
      sound?.tick((active - 1) * 0.4);
    }
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete sheet.dataset.dragging;
    lastInput = performance.now();
    scheduleIdle();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  const ro = new ResizeObserver(() => layout());
  ro.observe(sheet);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(sheet);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  document.addEventListener("visibilitychange", onVisibility);

  const fonts = document.fonts?.load ? Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`400 12px ${FONT}`)]) : Promise.resolve();
  Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]).then(async () => {
    if (destroyed) return;
    layout();
    await pull(0, 0, true, true);
    if (destroyed) return;
    sheet.dataset.ready = "";
    setTimeout(() => {
      if (destroyed || job || performance.now() - lastInput < 1500) return;
      pull(1, 1, true);
    }, 2600);
  });

  return {
    pull: (cover, line) => pull(cover, line),
    setActive(i) {
      active = i;
      lastInput = performance.now();
      emit();
    },
    nudge(i, dx, dy) {
      lastInput = performance.now();
      const step = (W / SHEET_MM) * 0.25;
      setOffset(i, offsets[i][0] + dx * step, offsets[i][1] + dy * step);
      sound?.tick((i - 1) * 0.4);
      scheduleIdle();
    },
    async setSound(on) {
      if (on && !sound) sound = createRisoSound();
      if (!sound) return false;
      lastInput = performance.now();
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (idleTimer) clearTimeout(idleTimer);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.stopAll();
      sound?.destroy();
      gl.deleteTexture(coverTex);
      gl.deleteTexture(plateTex);
      gl.deleteProgram(prog);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
