import { PRINT_FRAGMENT, PRINT_VERTEX } from "./cutoutShader";

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader compile failed");
  }
  return shader;
}

function place(ctx, img, w, h, { zoom = 1, fx = 0.5, fy = 0.5, filter = "none" }) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = Math.min(0, Math.max(w - dw, w * 0.5 - fx * dw));
  const dy = Math.min(0, Math.max(h - dh, h * 0.5 - fy * dh));
  ctx.filter = filter;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = "none";
  return { dx, dy, dw, dh };
}

function band(ctx, w, h, mode, stops, alpha = 1) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function glow(ctx, x, y, r, mode, stops, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

const SEA_HORIZON = 0.515;

function seaFrame(ctx, img, w, h, filter) {
  const zoom = 1.24;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dh = ih * scale;
  const target = h * 0.6;
  const fy = (SEA_HORIZON * dh - target + h * 0.5) / dh;
  const r = place(ctx, img, w, h, { zoom, fx: 0.36, fy, filter });
  return r.dy + SEA_HORIZON * r.dh;
}

function composeDusk(ctx, img, w, h) {
  place(ctx, img, w, h, { zoom: 1.1, fx: 0.46, fy: 0.4, filter: "blur(0.5px) saturate(1.35) contrast(1.06) brightness(1.04)" });
  band(ctx, w, h, "color", [
    [0, "#8b7fb0"],
    [0.22, "#c99aa8"],
    [0.45, "#eba889"],
    [0.66, "#f2a35c"],
    [1, "#5a3a3a"],
  ], 0.45);
  band(ctx, w, h, "soft-light", [
    [0, "rgba(255, 230, 230, 0.2)"],
    [0.5, "rgba(255, 200, 150, 0.25)"],
    [0.7, "rgba(255, 180, 100, 0.35)"],
    [1, "rgba(30, 15, 20, 0.3)"],
  ]);
}

function composeBlueHour(ctx, img, w, h) {
  const horizon = seaFrame(ctx, img, w, h, "blur(0.6px) saturate(0.55) brightness(0.7) contrast(1.12)");
  const t = horizon / h;
  band(ctx, w, h, "color", [
    [0, "#24306e"],
    [t * 0.55, "#4a4f95"],
    [t * 0.9, "#a986b4"],
    [t - 0.005, "#e7a3a6"],
    [t + 0.01, "#2a466e"],
    [1, "#13283f"],
  ]);
  band(ctx, w, h, "soft-light", [
    [0, "rgba(0, 0, 30, 0.5)"],
    [t * 0.8, "rgba(255, 220, 230, 0.15)"],
    [t, "rgba(255, 210, 200, 0.55)"],
    [t + 0.04, "rgba(40, 70, 110, 0.3)"],
    [1, "rgba(0, 10, 30, 0.6)"],
  ]);
  glow(ctx, w * 0.62, horizon, w * 0.7, "screen", [
    [0, "rgba(250, 180, 170, 0.32)"],
    [0.4, "rgba(170, 120, 170, 0.12)"],
    [1, "rgba(0, 0, 0, 0)"],
  ]);
  const lights = [0.06, 0.13, 0.17, 0.29, 0.34, 0.47, 0.52, 0.55, 0.71, 0.78, 0.86, 0.93];
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < lights.length; i += 1) {
    const x = lights[i] * w;
    const r = Math.max(1.4, w * 0.0032) * (i % 3 === 0 ? 1.3 : 1);
    const g = ctx.createRadialGradient(x, horizon - r * 0.4, 0, x, horizon - r * 0.4, r * 3.2);
    g.addColorStop(0, "rgba(255, 214, 150, 0.95)");
    g.addColorStop(0.3, "rgba(255, 190, 120, 0.45)");
    g.addColorStop(1, "rgba(255, 170, 100, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 4, horizon - r * 4, r * 8, r * 8);
  }
  ctx.globalCompositeOperation = "source-over";
}

function composeSunset(ctx, img, w, h) {
  const horizon = seaFrame(ctx, img, w, h, "blur(0.6px) saturate(0.5) brightness(1.02) contrast(1.06)");
  const t = horizon / h;
  band(ctx, w, h, "color", [
    [0, "#6f6aa6"],
    [t * 0.45, "#c98aa0"],
    [t * 0.78, "#f0a07a"],
    [t - 0.004, "#f6c56c"],
    [t + 0.01, "#7a5a78"],
    [t + 0.25, "#4a3f68"],
    [1, "#2d2d4e"],
  ]);
  band(ctx, w, h, "soft-light", [
    [0, "rgba(60, 40, 90, 0.4)"],
    [t * 0.7, "rgba(255, 210, 170, 0.35)"],
    [t, "rgba(255, 220, 150, 0.7)"],
    [t + 0.05, "rgba(120, 80, 90, 0.2)"],
    [1, "rgba(20, 10, 30, 0.5)"],
  ]);
  const sx = w * 0.6;
  glow(ctx, sx, horizon, w * 0.9, "screen", [
    [0, "rgba(255, 220, 160, 0.75)"],
    [0.05, "rgba(255, 196, 130, 0.6)"],
    [0.2, "rgba(250, 150, 110, 0.28)"],
    [0.55, "rgba(200, 110, 120, 0.1)"],
    [1, "rgba(0, 0, 0, 0)"],
  ]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon + 1, w, h - horizon);
  ctx.clip();
  const path = ctx.createLinearGradient(sx - w * 0.2, 0, sx + w * 0.2, 0);
  path.addColorStop(0, "rgba(255, 190, 120, 0)");
  path.addColorStop(0.35, "rgba(255, 200, 130, 0.22)");
  path.addColorStop(0.5, "rgba(255, 214, 150, 0.4)");
  path.addColorStop(0.65, "rgba(255, 200, 130, 0.22)");
  path.addColorStop(1, "rgba(255, 190, 120, 0)");
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = path;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}

function composeAlbum(ctx, img, w, h, meta) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const margin = Math.round(w * 0.1);
  const size = w - margin * 2;
  const top = Math.round(h * 0.09);
  ctx.filter = "blur(0.4px) saturate(1.1)";
  ctx.drawImage(img, margin, top, size, size);
  ctx.filter = "none";
  const base = top + size + Math.round(h * 0.07);
  const title = Math.round(w * 0.058);
  ctx.fillStyle = "#141210";
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic ${title}px CutoutTinos, "Times New Roman", serif`;
  ctx.fillText(meta.title, margin, base);
  ctx.font = `${Math.round(title * 0.5)}px CutoutTinos, "Times New Roman", serif`;
  ctx.fillText(`${meta.artist}, ${meta.year}`, margin, base + Math.round(title * 0.95));
  const folio = String(meta.folio);
  ctx.font = `${Math.round(title * 0.42)}px CutoutTinos, "Times New Roman", serif`;
  ctx.fillText(folio, w - margin - ctx.measureText(folio).width, h - Math.round(h * 0.045));
  ctx.fillRect(margin, base + Math.round(title * 1.45), size * 0.18, Math.max(1, w * 0.002));
}

export const PRINTS = [
  { id: "dusk", label: "Dusk over the wires", compose: composeDusk, paper: [0.93, 0.915, 0.87], line: 0.6, density: 0.76, sat: 1.3, shadow: "64 34 24" },
  { id: "blue-hour", label: "Sea at blue hour", compose: composeBlueHour, paper: [0.92, 0.915, 0.89], line: 0.25, density: 0.8, sat: 1.7, shadow: "10 22 48" },
  { id: "sunset", label: "Sunset on the water", compose: composeSunset, paper: [0.94, 0.92, 0.875], line: 0.25, density: 0.76, sat: 1.6, shadow: "60 30 50" },
  { id: "album", label: "Rubber Soul, printed", compose: composeAlbum, paper: [0.945, 0.93, 0.895], line: 0.5, density: 0.78, sat: 1.05, shadow: "48 40 28" },
];

export function composeThumb(print, img, meta, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  print.compose(ctx, img, w, h, meta);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function createPrint() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, PRINT_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, PRINT_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {
    image: gl.getUniformLocation(program, "uImage"),
    res: gl.getUniformLocation(program, "uRes"),
    cell: gl.getUniformLocation(program, "uCell"),
    seed: gl.getUniformLocation(program, "uSeed"),
    paper: gl.getUniformLocation(program, "uPaper"),
    line: gl.getUniformLocation(program, "uLine"),
    density: gl.getUniformLocation(program, "uDensity"),
    sat: gl.getUniformLocation(program, "uSat"),
  };
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();
  const art = document.createElement("canvas");

  return {
    render(target, print, img, meta, cssW, cssH, dpr) {
      const w = Math.max(2, Math.round(cssW * dpr));
      const h = Math.max(2, Math.round(cssH * dpr));
      canvas.width = w;
      canvas.height = h;
      art.width = w;
      art.height = h;
      const actx = art.getContext("2d");
      actx.clearRect(0, 0, w, h);
      print.compose(actx, img, w, h, meta);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, art);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.image, 0);
      gl.uniform2f(loc.res, w, h);
      gl.uniform1f(loc.cell, 3.2 * dpr);
      gl.uniform1f(loc.seed, 0.37);
      gl.uniform3f(loc.paper, print.paper[0], print.paper[1], print.paper[2]);
      gl.uniform1f(loc.line, print.line);
      gl.uniform1f(loc.density, print.density);
      gl.uniform1f(loc.sat, print.sat);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      target.width = w;
      target.height = h;
      target.getContext("2d").drawImage(canvas, 0, 0);
    },
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
