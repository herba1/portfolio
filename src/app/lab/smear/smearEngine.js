import { SMEAR_FRAGMENT, SMEAR_VERTEX } from "./smearShader";

const PAD = 0.25;
const INK = [0.09, 0.08, 0.07];
const PAPER = [0.953, 0.945, 0.925];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader failed");
  }
  return shader;
}

function program(gl) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, SMEAR_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SMEAR_FRAGMENT);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link failed");
  return p;
}

function upload(gl, texture, source, mips) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mips) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
}

function rasterText(el, dpr, scratch) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const width = Math.max(1, Math.ceil(rect.width * dpr));
  const height = Math.max(1, Math.ceil(rect.height * dpr));
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
  if ("fontKerning" in ctx) ctx.fontKerning = "normal";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent;
    const words = /\S+/g;
    for (let match = words.exec(text); match; match = words.exec(text)) {
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const box = range.getClientRects()[0];
      if (!box) continue;
      const metrics = ctx.measureText(match[0]);
      const ascent = metrics.fontBoundingBoxAscent ?? box.height * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? box.height * 0.2;
      const baseline = box.top - rect.top + (box.height - ascent - descent) / 2 + ascent;
      ctx.fillText(match[0], box.left - rect.left, baseline);
    }
  }
  range.detach?.();
  return scratch;
}

export function createSmear({ scroller, content, canvas, onReady, onFail }) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) {
    onFail?.();
    return { destroy() {} };
  }
  let prog;
  try {
    prog = program(gl);
  } catch (error) {
    console.error(error);
    onFail?.();
    return { destroy() {} };
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const loc = {};
  for (const name of ["uCanvas", "uRect", "uTex", "uRands", "uStrength", "uId", "uKind", "uCover", "uInk", "uPaper", "uReveal"]) loc[name] = gl.getUniformLocation(prog, name);
  gl.useProgram(prog);
  gl.uniform1i(loc.uTex, 0);
  gl.uniform3fv(loc.uInk, INK);
  gl.uniform3fv(loc.uPaper, PAPER);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const scratch = document.createElement("canvas");
  const items = Array.from(content.querySelectorAll("[data-smear]")).map((el, index) => ({
    el,
    kind: el.dataset.smear,
    id: index + 1,
    src: el.dataset.src,
    focus: [Number(el.dataset.fx ?? 0.5), Number(el.dataset.fy ?? 0.5)],
    texture: gl.createTexture(),
    ready: false,
    reveal: 0,
    image: null,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rands: [0, 0, 0, 0],
    cover: [0, 0, 1, 1],
  }));

  let destroyed = false;
  let dpr = 1;
  let viewW = 1;
  let viewH = 1;
  let canvasH = 1;
  let strength = 0;
  let lastScroll = scroller.scrollTop;
  let lastTime = performance.now();
  let raf = 0;
  let visible = true;
  let fontsReady = false;
  let dirtyText = true;
  let announced = false;

  const coverFor = (item) => {
    if (!item.image) return [0, 0, 1, 1];
    const ia = item.image.naturalWidth / item.image.naturalHeight;
    const ea = item.w / item.h;
    if (ia > ea) {
      const sw = ea / ia;
      return [(1 - sw) * item.focus[0], 0, sw, 1];
    }
    const sh = ia / ea;
    return [0, (1 - sh) * item.focus[1], 1, sh];
  };

  const measure = () => {
    const box = content.getBoundingClientRect();
    const frameBox = scroller.getBoundingClientRect();
    for (const item of items) {
      const r = item.el.getBoundingClientRect();
      item.x = r.left - frameBox.left;
      item.y = r.top - box.top;
      item.w = r.width;
      item.h = r.height;
      if (item.kind === "photo") item.cover = coverFor(item);
    }
  };

  const rasterAll = () => {
    if (!fontsReady) return;
    for (const item of items) {
      if (item.kind !== "text") continue;
      upload(gl, item.texture, rasterText(item.el, dpr, scratch), false);
      item.ready = true;
      item.reveal = 1;
    }
    dirtyText = false;
  };

  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = Math.max(1, scroller.clientWidth);
    viewH = Math.max(1, scroller.clientHeight);
    canvasH = Math.round(viewH * (1 + PAD * 2));
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(canvasH * dpr);
    canvas.style.width = `${viewW}px`;
    canvas.style.height = `${canvasH}px`;
    measure();
    dirtyText = true;
    wake();
  };

  for (const item of items) {
    if (item.kind !== "photo") continue;
    const image = new Image();
    image.decoding = "async";
    image.src = item.src;
    image
      .decode()
      .then(() => {
        if (destroyed) return;
        item.image = image;
        upload(gl, item.texture, image, true);
        item.cover = coverFor(item);
        item.ready = true;
        item.reveal = 1;
        wake();
      })
      .catch(() => {});
  }

  document.fonts?.ready.then(() => {
    if (destroyed) return;
    fontsReady = true;
    dirtyText = true;
    measure();
    wake();
  });

  const render = (scrollTop) => {
    const top = scrollTop - viewH * PAD;
    canvas.style.transform = `translate3d(0, ${top}px, 0)`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uCanvas, viewW, canvasH);
    gl.uniform1f(loc.uStrength, Math.min(1, strength));
    gl.activeTexture(gl.TEXTURE0);
    for (const item of items) {
      if (!item.ready) continue;
      const y = item.y - top;
      if (y > canvasH || y + item.h < 0) continue;
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.uniform4f(loc.uRect, item.x, y, item.w, item.h);
      gl.uniform4fv(loc.uRands, item.rands);
      gl.uniform1f(loc.uId, item.id);
      gl.uniform1f(loc.uKind, item.kind === "text" ? 1 : 0);
      gl.uniform4fv(loc.uCover, item.kind === "text" ? [0, 0, 1, 1] : item.cover);
      gl.uniform1f(loc.uReveal, item.reveal);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    if (dirtyText) rasterAll();
    const scrollTop = scroller.scrollTop;
    const delta = scrollTop - lastScroll;
    lastScroll = scrollTop;
    const speed = Math.abs(delta) / dt / viewH;
    const target = Math.min(1.4, Math.max(0, (speed - 0.6) / 2.4));
    strength = Math.max(target, strength * Math.exp(-dt * 10));
    for (const item of items) {
      if (Math.random() > Math.exp(-dt * 25 * (1 + strength))) item.rands = [Math.random(), Math.random(), Math.random(), Math.random()];
    }
    render(scrollTop);
    if (!announced && fontsReady && items.some((item) => item.kind === "text" && item.ready)) {
      announced = true;
      onReady?.();
    }
    const settled = strength < 0.002 && delta === 0 && !dirtyText;
    if (settled) {
      strength = 0;
      render(scrollTop);
      return;
    }
    if (visible) raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible) return;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onScroll = () => wake();
  scroller.addEventListener("scroll", onScroll, { passive: true });
  const ro = new ResizeObserver(resize);
  ro.observe(scroller);
  ro.observe(content);
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
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      ro.disconnect();
      for (const item of items) gl.deleteTexture(item.texture);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    },
  };
}
