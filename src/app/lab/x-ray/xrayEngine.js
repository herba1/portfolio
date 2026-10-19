import { COMPOSITE_FRAGMENT, FLOOD_FRAGMENT, XRAY_VERTEX } from "./xrayShader";
import { stageSvg } from "./xrayArt";

const STEP = 1 / 60;
const MASK_SCALE = 3;
const HEAL = 0.015;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader failed");
  return shader;
}

function link(gl, fragment) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, XRAY_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
  return p;
}

function texture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

function target(gl, width, height) {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}

async function rasterSvg(svg, width, height, dpr) {
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function createXray({ canvas, box, onReady, onFail }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) {
    onFail?.();
    return null;
  }
  let flood;
  let composite;
  try {
    flood = link(gl, FLOOD_FRAGMENT);
    composite = link(gl, COMPOSITE_FRAGMENT);
  } catch (error) {
    console.error(error);
    onFail?.();
    return null;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const u = (p, name) => gl.getUniformLocation(p, name);
  const floodLoc = { prev: u(flood, "uPrev"), input: u(flood, "uInput"), res: u(flood, "uRes"), aspect: u(flood, "uAspect"), heal: u(flood, "uHeal") };
  const compLoc = { mask: u(composite, "uMask"), ext: u(composite, "uExterior"), xray: u(composite, "uXray"), res: u(composite, "uRes"), dpr: u(composite, "uDpr") };

  const stroke = document.createElement("canvas");
  const strokeCtx = stroke.getContext("2d");
  const strokeTex = texture(gl);
  const extTex = texture(gl);
  const xrayTex = texture(gl);

  let width = 0;
  let height = 0;
  let dpr = 1;
  let maskW = 1;
  let maskH = 1;
  let targets = [];
  let read = 0;
  let art = 0;
  let artReady = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let quiet = 0;
  let visible = true;
  let inView = true;
  let announced = false;

  const pen = { x: null, y: null, lastX: null, lastY: null, tx: 0, ty: 0, active: false, still: false, opacity: 0, dwell: 0, lens: false };

  const disposeTargets = () => {
    for (const t of targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    targets = [];
  };

  const paintArt = async () => {
    const ticket = ++art;
    const w = width;
    const h = height;
    try {
      const [outside, inside] = await Promise.all([rasterSvg(stageSvg("ext", w, h), w, h, dpr), rasterSvg(stageSvg("xray", w, h), w, h, dpr)]);
      if (destroyed || ticket !== art) return;
      gl.bindTexture(gl.TEXTURE_2D, extTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, outside);
      gl.bindTexture(gl.TEXTURE_2D, xrayTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inside);
      artReady = true;
      draw();
      if (!announced) {
        announced = true;
        onReady?.();
      }
    } catch (error) {
      console.error(error);
      onFail?.();
    }
  };

  const resize = () => {
    const rect = box.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width));
    const h = Math.max(2, Math.round(rect.height));
    if (w === width && h === height) return;
    width = w;
    height = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    maskW = Math.max(2, Math.round(w / MASK_SCALE));
    maskH = Math.max(2, Math.round(h / MASK_SCALE));
    stroke.width = maskW;
    stroke.height = maskH;
    disposeTargets();
    targets = [target(gl, maskW, maskH), target(gl, maskW, maskH)];
    read = 0;
    paintArt();
    draw();
  };

  const brush = () => Math.max(maskW * 0.1, 30);

  const drawStroke = () => {
    const ctx = strokeCtx;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, maskW, maskH);
    if (pen.x == null) return;
    ctx.lineCap = "round";
    if (pen.opacity > 0.01 && pen.lastX != null) {
      ctx.beginPath();
      ctx.moveTo(pen.lastX, pen.lastY);
      ctx.lineTo(pen.x, pen.y);
      ctx.lineWidth = brush();
      ctx.strokeStyle = `rgba(0, 0, 0, ${pen.opacity})`;
      ctx.stroke();
    }
    if (pen.dwell > 0.01) {
      ctx.beginPath();
      ctx.arc(pen.x, pen.y, brush() * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 0, 0, ${pen.dwell})`;
      ctx.fill();
    }
  };

  const stepPen = () => {
    if (pen.x == null) {
      pen.x = pen.tx;
      pen.y = pen.ty;
      pen.lastX = pen.x;
      pen.lastY = pen.y;
      return;
    }
    pen.lastX = pen.x;
    pen.lastY = pen.y;
    pen.x += (pen.tx - pen.x) * 0.09;
    pen.y += (pen.ty - pen.y) * 0.09;
    const moved = Math.hypot(pen.x - pen.lastX, pen.y - pen.lastY);
    if (pen.active && moved > 0.5 / MASK_SCALE) pen.opacity = Math.min(1, pen.opacity + 0.1);
    else pen.opacity = Math.max(0, pen.opacity - 0.1);
    pen.dwell = pen.active && pen.lens ? Math.min(1, pen.dwell + 0.08) : Math.max(0, pen.dwell - 0.06);
  };

  const simulate = () => {
    stepPen();
    drawStroke();
    gl.bindTexture(gl.TEXTURE_2D, strokeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stroke);
    const src = targets[read];
    const dst = targets[1 - read];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, maskW, maskH);
    gl.useProgram(flood);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(floodLoc.prev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, strokeTex);
    gl.uniform1i(floodLoc.input, 1);
    gl.uniform2f(floodLoc.res, maskW, maskH);
    const aspect = maskW < maskH ? [1, maskW / maskH] : [maskH / maskW, 1];
    gl.uniform2f(floodLoc.aspect, aspect[0], aspect[1]);
    gl.uniform1f(floodLoc.heal, HEAL);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    read = 1 - read;
  };

  function draw() {
    if (!artReady || !targets.length) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
    gl.uniform1i(compLoc.mask, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, extTex);
    gl.uniform1i(compLoc.ext, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, xrayTex);
    gl.uniform1i(compLoc.xray, 2);
    gl.uniform2f(compLoc.res, canvas.width, canvas.height);
    gl.uniform1f(compLoc.dpr, dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      simulate();
      acc -= STEP;
      steps += 1;
    }
    if (steps === 4) acc = 0;
    draw();
    const busy = pen.active || pen.opacity > 0.01 || pen.dwell > 0.01;
    quiet = busy ? 0 : quiet + dt;
    if (quiet < 1.4 && visible && inView) raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !visible || !inView) return;
    last = performance.now();
    quiet = 0;
    raf = requestAnimationFrame(frame);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(box);
  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) wake();
  });
  io.observe(box);
  const onVisibility = () => {
    visible = document.visibilityState !== "hidden";
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onLost = (event) => {
    event.preventDefault();
    onFail?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  resize();

  return {
    move(x, y, lens = true) {
      if (!pen.active && pen.opacity < 0.01 && pen.dwell < 0.01) pen.x = null;
      pen.tx = x / MASK_SCALE;
      pen.ty = y / MASK_SCALE;
      pen.active = true;
      pen.lens = lens;
      wake();
    },
    jump(x, y) {
      pen.tx = x / MASK_SCALE;
      pen.ty = y / MASK_SCALE;
      pen.x = pen.tx;
      pen.y = pen.ty;
      pen.lastX = pen.x;
      pen.lastY = pen.y;
      pen.active = true;
      pen.lens = true;
      wake();
    },
    release() {
      pen.active = false;
      wake();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      disposeTargets();
      for (const t of [strokeTex, extTex, xrayTex]) gl.deleteTexture(t);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(flood);
      gl.deleteProgram(composite);
    },
  };
}
