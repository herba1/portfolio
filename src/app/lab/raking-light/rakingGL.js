import { CELL } from "./rakingBadges";
import { RAKING_FRAGMENT, RAKING_VERTEX } from "./rakingShader";

const UNIFORMS = ["uRes", "uScale", "uRect", "uLift", "uLamp", "uBulb", "uFalloff", "uSteps", "uCell", "uAlbedo", "uHeight", "uMat"];

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

function texture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function createRakingGL(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, RAKING_VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, RAKING_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
  const loc = {};
  for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
  const vao = gl.createVertexArray();
  const albedoTex = texture(gl);
  const heightTex = texture(gl);
  const matTex = texture(gl);
  gl.bindTexture(gl.TEXTURE_2D, matTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  let ready = false;

  function upload(badges) {
    const W = CELL * badges.length;
    const atlas = document.createElement("canvas");
    atlas.width = W;
    atlas.height = CELL;
    const actx = atlas.getContext("2d");
    const height = new Float32Array(W * CELL);
    const mat = new Uint8Array(W * CELL * 4);
    badges.forEach((b, i) => {
      actx.drawImage(b.albedo, i * CELL, 0);
      for (let y = 0; y < CELL; y += 1) {
        height.set(b.height.subarray(y * CELL, (y + 1) * CELL), y * W + i * CELL);
        mat.set(b.mat.subarray(y * CELL * 4, (y + 1) * CELL * 4), (y * W + i * CELL) * 4);
      }
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, albedoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, heightTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    let level = 0;
    let lw = W;
    let lh = CELL;
    let data = height;
    for (;;) {
      gl.texImage2D(gl.TEXTURE_2D, level, gl.R16F, lw, lh, 0, gl.RED, gl.FLOAT, data);
      if (lw === 1 && lh === 1) break;
      const nw = Math.max(1, lw >> 1);
      const nh = Math.max(1, lh >> 1);
      const next = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y += 1) {
        const y0 = Math.min(lh - 1, y * 2);
        const y1 = Math.min(lh - 1, y * 2 + 1);
        for (let x = 0; x < nw; x += 1) {
          const x0 = Math.min(lw - 1, x * 2);
          const x1 = Math.min(lw - 1, x * 2 + 1);
          next[y * nw + x] = (data[y0 * lw + x0] + data[y0 * lw + x1] + data[y1 * lw + x0] + data[y1 * lw + x1]) * 0.25;
        }
      }
      data = next;
      lw = nw;
      lh = nh;
      level += 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, matTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, CELL, 0, gl.RGBA, gl.UNSIGNED_BYTE, mat);
    ready = true;
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function draw(f) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    [albedoTex, heightTex, matTex].forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    });
    gl.uniform1i(loc.uAlbedo, 0);
    gl.uniform1i(loc.uHeight, 1);
    gl.uniform1i(loc.uMat, 2);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    gl.uniform1f(loc.uScale, f.scale);
    gl.uniform4fv(loc.uRect, f.rects);
    gl.uniform1fv(loc.uLift, f.lift);
    gl.uniform4f(loc.uLamp, f.lamp[0], f.lamp[1], f.lamp[2], f.lamp[3]);
    gl.uniform1f(loc.uBulb, f.bulb);
    gl.uniform1f(loc.uFalloff, f.falloff);
    gl.uniform1f(loc.uSteps, f.steps);
    gl.uniform1f(loc.uCell, CELL);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function destroy() {
    gl.deleteTexture(albedoTex);
    gl.deleteTexture(heightTex);
    gl.deleteTexture(matTex);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  return { upload, resize, draw, destroy, has: () => ready };
}
