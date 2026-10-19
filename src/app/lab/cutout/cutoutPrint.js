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

function wire(ctx, w, h, y0, y1, sag, width, alpha) {
  ctx.beginPath();
  ctx.moveTo(-0.05 * w, y0 * h);
  ctx.quadraticCurveTo(0.5 * w, ((y0 + y1) / 2 + sag) * h, 1.05 * w, y1 * h);
  ctx.lineWidth = width;
  ctx.strokeStyle = `rgba(28, 32, 38, ${alpha})`;
  ctx.stroke();
}

function compose(photo, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const iw = photo.naturalWidth;
  const ih = photo.naturalHeight;
  const portrait = h > w * 1.05;
  const zoom = portrait ? 1.12 : 1.22;
  const scale = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const horizon = 0.52 * dh;
  const targetHorizon = h * (portrait ? 0.7 : 0.74);
  const dy = Math.min(0, Math.max(h - dh, targetHorizon - horizon));
  const anchor = portrait ? 0.28 : 0.04;
  const dx = Math.min(0, Math.max(w - dw, -anchor * (dw - w) - 0.02 * dw));
  ctx.filter = "blur(0.6px)";
  ctx.drawImage(photo, dx, dy, dw, dh);
  ctx.filter = "none";
  const base = Math.max(1.2, Math.min(w, h) / 520);
  ctx.lineCap = "round";
  wire(ctx, w, h, 0.035, 0.012, 0.03, base * 1.1, 0.78);
  wire(ctx, w, h, 0.07, 0.05, 0.035, base, 0.74);
  wire(ctx, w, h, 0.115, 0.1, 0.04, base * 1.05, 0.8);
  wire(ctx, w, h, 0.15, 0.13, 0.042, base * 0.9, 0.7);
  wire(ctx, w, h, 0.215, 0.2, 0.05, base * 1.1, 0.82);
  ctx.beginPath();
  ctx.moveTo(w * 1.02, h * 0.22);
  ctx.quadraticCurveTo(w * 0.92, h * 0.62, w * 0.82, h * 1.04);
  ctx.lineWidth = base * 1.1;
  ctx.strokeStyle = "rgba(28, 32, 38, 0.8)";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 1.03, h * 0.3);
  ctx.quadraticCurveTo(w * 0.95, h * 0.68, w * 0.885, h * 1.04);
  ctx.lineWidth = base;
  ctx.stroke();
  return canvas;
}

export function createPrint(canvas) {
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
  };
  const vao = gl.createVertexArray();
  const tex = gl.createTexture();

  return {
    render(photo, cssW, cssH, dpr) {
      const w = Math.max(2, Math.round(cssW * dpr));
      const h = Math.max(2, Math.round(cssH * dpr));
      canvas.width = w;
      canvas.height = h;
      const art = compose(photo, w, h);
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
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteTexture(tex);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
