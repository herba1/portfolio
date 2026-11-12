import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";

// Film test: one photograph, raw on the left of the split, developed through
// the shared film kit on the right. Drag to move the split.
//
// Query: ?x=0.5 split, ?preset=summer|dusk|night, ?motion=1 moving grain, and
// any numeric film param to override the preset (?halation=0.6&bloom=0.3).

const SRC = "/lab/film-test/street.jpg";

// Summer, re-tuned for this photograph's backlit cumulus. The kit's summer
// spreads all the light (threshold 0), cools the highlights and puts paper
// white above the cloud, so the cloud developed into a flat grey veil. Here
// only light past the knee scatters, so the cloud keeps its own lobes; the
// highlights roll off warm-neutral, and the brightest cloud lands near paper
// white instead of a stop under it. This cloud is bright but not clipped in
// the photo, so less headroom: at the kit's 1.4 the scattered light pushed a
// fifth of the cloud's red and green into 255 and flattened its tops.
const SUMMER = {
  ...FILM_PRESETS.summer,
  headroom: 0.8,
  bloomThreshold: 0.6,
  highlightTint: [1.03, 1, 0.95],
  whitePoint: 1.1,
};
const PRESETS = { ...FILM_PRESETS, summer: SUMMER };

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Draws a texture through a uv scale/offset (cover fit, or 1:1).
const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec4 uXform;
void main() {
  outColor = vec4(texture(uTex, vUv * uXform.xy + uXform.zw).rgb, 1.0);
}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return { p, uTex: gl.getUniformLocation(p, "uTex"), uXform: gl.getUniformLocation(p, "uXform") };
}

function readParams(search) {
  const q = new URLSearchParams(search);
  const preset = PRESETS[q.get("preset")] || PRESETS.summer;
  const params = { ...preset };
  for (const key of Object.keys(FILM_DEFAULTS)) {
    if (typeof FILM_DEFAULTS[key] !== "number") continue;
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) params[key] = +v;
  }
  const x = q.get("x");
  return { params, split: x != null && Number.isFinite(+x) ? clamp(+x, 0, 1) : 0.5, motion: q.get("motion") === "1" };
}

export async function createFilmTest(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const img = await loadImage(SRC);
  const photo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photo);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const blit = compile(gl, VERT, BLIT);
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });

  // The scene the film develops: the photograph cover-fitted at canvas size,
  // still sRGB-encoded, as any RGBA8 render would be.
  let scene = null;
  const makeScene = (w, h) => {
    if (scene) {
      gl.deleteTexture(scene.tex);
      gl.deleteFramebuffer(scene.fbo);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    scene = { tex, fbo, w, h };
  };

  const { params, split: split0, motion } = readParams(window.location.search);
  let split = split0;
  let dirty = true;
  let sceneDirty = true;
  let frame = 0;
  let sinceGrain = 0;

  stage.onResize(() => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    film.resize(w, h);
    makeScene(w, h);
    sceneDirty = true;
    dirty = true;
  });

  const setSplit = (p) => {
    split = clamp(p.x / Math.max(1, stage.width), 0, 1);
    dirty = true;
  };
  stage.on("down", setSplit);
  stage.on("move", (p) => {
    if (p.down) setSplit(p);
  });

  const drawScene = () => {
    const ca = scene.w / scene.h;
    const ia = img.naturalWidth / img.naturalHeight;
    // Cover fit about the centre.
    const sx = ca > ia ? 1 : ca / ia;
    const sy = ca > ia ? ia / ca : 1;
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photo);
    gl.uniform1i(blit.uTex, 0);
    gl.uniform4f(blit.uXform, sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const draw = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    if (sceneDirty) {
      drawScene();
      sceneDirty = false;
    }

    // Film over the whole frame...
    film.render(scene.tex, { ...params, grainSeed: motion ? frame : 0 }, null);

    // ...then the raw frame back over the left of the split.
    const sx = Math.round(split * w);
    gl.bindVertexArray(vao);
    gl.enable(gl.SCISSOR_TEST);
    if (sx > 0) {
      gl.scissor(0, 0, sx, h);
      gl.useProgram(blit.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.uniform1i(blit.uTex, 0);
      gl.uniform4f(blit.uXform, 1, 1, 0, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // A hairline at the split.
    const lw = Math.max(1, Math.round(stage.dpr));
    gl.scissor(clamp(sx - (lw >> 1), 0, w - lw), 0, lw, h);
    gl.clearColor(0.96, 0.95, 0.92, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  };

  stage.onFrame((dt) => {
    if (motion) {
      sinceGrain += dt;
      // Grain moves at 24 frames a second, like the film it pretends to be.
      if (sinceGrain >= 1 / 24) {
        sinceGrain = 0;
        frame++;
        dirty = true;
      }
    }
    if (!dirty || !scene) return;
    dirty = false;
    draw();
  });

  return {
    destroy() {
      film.destroy();
      if (scene) {
        gl.deleteTexture(scene.tex);
        gl.deleteFramebuffer(scene.fbo);
      }
      gl.deleteTexture(photo);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
