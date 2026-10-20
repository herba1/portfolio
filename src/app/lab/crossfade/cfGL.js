import { CF_FRAGMENT, CF_VERTEX } from "./cfShader";

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
  return shader;
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

export function createBlend(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, CF_VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, CF_FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  for (const name of ["uA0", "uA1", "uB0", "uB1", "uFadeA", "uFadeB", "uMix", "uCells", "uTime"]) u[name] = gl.getUniformLocation(program, name);
  ["uA0", "uA1", "uB0", "uB1"].forEach((name, i) => gl.uniform1i(u[name], i));

  const blank = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([24, 24, 24, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const textures = [blank(), blank(), blank(), blank()];
  const decks = { A: { from: 0, to: 0, fade: 1, src: "", loaded: false }, B: { from: 0, to: 0, fade: 1, src: "", loaded: false } };
  const cache = new Map();

  const upload = (tex, img) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  let mix = 0;
  let lost = false;
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    async setCover(which, src) {
      const d = decks[which];
      if (d.src === src) return;
      d.src = src;
      let img = cache.get(src);
      if (!img) {
        img = await loadImage(src).catch(() => null);
        if (!img) return;
        cache.set(src, img);
      }
      if (d.src !== src || lost) return;
      const base = which === "A" ? 0 : 2;
      if (!d.loaded) {
        d.loaded = true;
        upload(textures[base + d.to], img);
        d.fade = 1;
        return;
      }
      if (d.fade >= 0.5) {
        d.from = d.to;
        d.to = 1 - d.to;
        d.fade = 0;
      }
      upload(textures[base + d.to], img);
    },
    advance(dt) {
      for (const d of Object.values(decks)) d.fade = Math.min(1, d.fade + dt / 0.5);
      return decks.A.fade < 1 || decks.B.fade < 1;
    },
    setMix(value) {
      mix = value;
    },
    render(time) {
      if (lost) return;
      const w = canvas.width;
      gl.viewport(0, 0, w, canvas.height);
      textures.forEach((tex, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      });
      gl.uniform1i(u.uA0, decks.A.from);
      gl.uniform1i(u.uA1, decks.A.to);
      gl.uniform1i(u.uB0, 2 + decks.B.from);
      gl.uniform1i(u.uB1, 2 + decks.B.to);
      gl.uniform1f(u.uFadeA, decks.A.fade);
      gl.uniform1f(u.uFadeB, decks.B.fade);
      gl.uniform1f(u.uMix, mix);
      gl.uniform1f(u.uCells, Math.max(18, Math.min(44, w / 14)));
      gl.uniform1f(u.uTime, time);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      textures.forEach((t) => gl.deleteTexture(t));
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
