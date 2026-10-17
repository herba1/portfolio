import { PHOTOS, backprintCanvas, fibreCanvas, labelCanvas, loadImage, photoCanvas } from "./shredderArt";
import { mat4, program, imageTexture, roundedBox } from "./shredderGL";
import { BG_FS, BG_VS, DEPTH_FS, DEPTH_VS, PAPER_FS, PAPER_VS, SOLID_FS, SOLID_VS } from "./shredderShader";
import { EXIT_Y, FLOOR_Y, INNER, K, L_BITE, L_MAX, L_REST, N, PITCH, PRINT_H, PRINT_W, V_FEED, createSim, stripX } from "./shredderSim";

const THETA = (16 * Math.PI) / 180;
const D = [0, Math.cos(THETA), -Math.sin(THETA)];
const NT = [0, Math.sin(THETA), Math.cos(THETA)];
const SLOT_X = 0.79;
const BUTTON = [0.8, -0.08];
const MACHINE_Z = 0.2;
const SHADOW = 1024;
const STEP = 1 / 120;
const V_HEAL = 0.36;
const LIGHT = (() => {
  const v = [-0.3, 1, 0.42];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
const EYE = [0, 1.5, 5.7];
const AT = [0, -0.4, 0];
const FLOATS = 10;
const PRINT_ROWS = 14;
const MAX_VERTS = N * (K + 2) * 2 + N * PRINT_ROWS * 6 + 64;
const SEED = 4127;
const METAL = [0.7, 0.702, 0.698];
const WALL = [0.894, 0.89, 0.878];
const GROUND = [0.872, 0.866, 0.852];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hexToRgb(value, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function createShredder({ root, canvas, embedded, reduced, insets, onStatus, onPhoto }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("webgl2");

  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  try {
    await document.fonts.load(`500 15px ${mono || "monospace"}`);
  } catch {}
  const images = await Promise.all(PHOTOS.map((p) => loadImage(p.src)));

  const depthProg = program(gl, DEPTH_VS, DEPTH_FS);
  const bgProg = program(gl, BG_VS, BG_FS);
  const solidProg = program(gl, SOLID_VS, SOLID_FS);
  const paperProg = program(gl, PAPER_VS, PAPER_FS);

  const photoTex = images.map((img, i) => imageTexture(gl, photoCanvas(img, PHOTOS[i])));
  const fibreTex = imageTexture(gl, fibreCanvas(), { repeat: true });
  const labelTex = imageTexture(gl, labelCanvas());
  const backTex = imageTexture(gl, backprintCanvas(), { repeat: true });

  const fuseTex = gl.createTexture();
  const fuseBytes = new Uint8Array(N * K);
  gl.bindTexture(gl.TEXTURE_2D, fuseTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, K, N, 0, gl.RED, gl.UNSIGNED_BYTE, fuseBytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const solid = { verts: [], idx: [] };
  const X = [1, 0, 0];
  const Y = [0, 1, 0];
  const Z = [0, 0, 1];
  roundedBox(solid, { hx: 0.98, ha: 0.08, hb: MACHINE_Z, r: 0.04, re: 0.035, center: [0, -0.08, 0], X, A: Y, B: Z, part: 0 });
  const postH = (-0.16 - FLOOR_Y) / 2;
  for (const sx of [-1, 1]) {
    roundedBox(solid, { hx: 0.026, ha: postH, hb: 0.03, r: 0.012, re: 0.012, center: [sx * 0.9, FLOOR_Y + postH, 0], X, A: Y, B: Z, part: 2 });
    roundedBox(solid, { hx: 0.09, ha: 0.011, hb: 0.15, r: 0.009, re: 0.02, center: [sx * 0.9, FLOOR_Y + 0.011, 0], X, A: Y, B: Z, part: 2 });
  }
  const solidVao = gl.createVertexArray();
  gl.bindVertexArray(solidVao);
  const solidVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, solidVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(solid.verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  const solidIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, solidIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(solid.idx), gl.STATIC_DRAW);
  const solidCount = solid.idx.length;
  gl.bindVertexArray(null);

  const bgVao = gl.createVertexArray();
  gl.bindVertexArray(bgVao);
  const bgVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bgVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const paperData = new Float32Array(MAX_VERTS * FLOATS);
  const paperVao = gl.createVertexArray();
  gl.bindVertexArray(paperVao);
  const paperVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, paperVbo);
  gl.bufferData(gl.ARRAY_BUFFER, paperData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, FLOATS * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, FLOATS * 4, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 24);
  gl.bindVertexArray(null);

  const accent = hexToRgb(getComputedStyle(document.documentElement).getPropertyValue("--brand-500") || "", [0.231, 0.51, 0.965]);
  const lightView = mat4.lookAt([LIGHT[0] * 6, -0.45 + LIGHT[1] * 6, LIGHT[2] * 6], [0, -0.45, 0], [0, 1, 0]);
  const lightVP = (() => {
    const box = [];
    for (const x of [-1.3, 1.3]) for (const y of [FLOOR_Y, 1]) for (const z of [-0.9, 0.9]) box.push([x, y, z]);
    const v = [0, 0, 0, 0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of box) {
      mat4.apply(lightView, p[0], p[1], p[2], v);
      minX = Math.min(minX, v[0]);
      maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]);
      maxZ = Math.max(maxZ, v[2]);
    }
    return mat4.mul(mat4.ortho(minX, maxX, minY, maxY, -maxZ - 0.5, -minZ + 0.5), lightView);
  })();

  const sim = createSim(SEED);
  sim.state.reduced = reduced;

  let photo = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let view = null;
  let proj = null;
  let vp = null;
  let invVP = null;
  let raf = 0;
  let active = false;
  let destroyed = false;
  let lastTs = 0;
  let acc = 0;
  let calm = 0;
  let motorV = 0;
  let led = 0;
  let press = 0;
  let lifted = 0;
  let feedTarget = 0;
  let hoverPrint = false;
  let healWait = 0;
  let healing = false;
  let hold = false;
  let keyHold = false;
  let pointer = null;
  let combScript = null;
  let fuseDirty = true;
  let lastStatus = "";
  const shake = [0, 0, 0];
  const v4 = [0, 0, 0, 0];

  const project = (x, y, z, out) => {
    mat4.apply(vp, x, y, z, v4);
    const w = Math.abs(v4[3]) > 1e-6 ? v4[3] : 1e-6;
    out[0] = (v4[0] / w * 0.5 + 0.5) * width;
    out[1] = (1 - (v4[1] / w * 0.5 + 0.5)) * height;
    return out;
  };

  let frameTop = 0.42;
  let cachedInsets = null;

  const frameGoal = () => clamp(PRINT_H - sim.state.L + 0.1, 0.42, 0.94);

  function fit() {
    const rect = root.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    view = mat4.lookAt(EYE, AT, [0, 1, 0]);
    cachedInsets = insets();
    frameProject();
  }

  function frameProject() {
    const base = mat4.mul(mat4.perspective((22 * Math.PI) / 180, width / height, 0.5, 40), view);
    const pts = [];
    const reach = width < 600 ? 0.86 : 1;
    for (const sx of [-1, 1]) {
      pts.push([sx * reach, 0.02, -MACHINE_Z], [sx * reach, -0.16, MACHINE_Z], [sx * reach, 0.0, MACHINE_Z]);
      pts.push([sx * reach, FLOOR_Y, 0.3], [sx * reach, FLOOR_Y, -0.16]);
      pts.push([sx * PRINT_W * 0.5, D[1] * frameTop, D[2] * frameTop]);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      mat4.apply(base, p[0], p[1], p[2], v4);
      const x = v4[0] / v4[3];
      const y = v4[1] / v4[3];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const ins = cachedInsets;
    const l = -1 + (2 * ins.left) / width;
    const r = 1 - (2 * ins.right) / width;
    const b = -1 + (2 * ins.bottom) / height;
    const t = 1 - (2 * ins.top) / height;
    const s = Math.min((r - l) / (maxX - minX), (t - b) / (maxY - minY));
    const ox = (l + r) / 2 - ((minX + maxX) / 2) * s;
    const oy = (b + t) / 2 - ((minY + maxY) / 2) * s;
    const adjust = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1, 0, ox, oy, 0, 1]);
    proj = mat4.mul(adjust, mat4.perspective((22 * Math.PI) / 180, width / height, 0.5, 40));
    vp = mat4.mul(proj, view);
    invVP = mat4.invert(vp);
  }

  function warm(L) {
    sim.reset(INNER + 0.002);
    let m = 0;
    while (sim.state.L < L - 1e-4) {
      sim.step(STEP, Math.min(V_FEED, (L - sim.state.L) / STEP));
    }
    for (let i = 0; i < 480; i += 1) m = sim.step(STEP, 0);
    fuseDirty = true;
    return m;
  }

  function writeVert(o, x, y, z, nx, ny, nz, u, t, ul, col) {
    paperData[o] = x;
    paperData[o + 1] = y;
    paperData[o + 2] = z;
    paperData[o + 3] = nx;
    paperData[o + 4] = ny;
    paperData[o + 5] = nz;
    paperData[o + 6] = u;
    paperData[o + 7] = t;
    paperData[o + 8] = ul;
    paperData[o + 9] = col;
  }

  const ranges = [];
  const order = [];
  let printRange = null;

  function buildPaper() {
    let v = 0;
    ranges.length = 0;
    const { pos, nrm, tan, fuse, state, comb } = sim;
    const E = state.E;
    if (E > 0) {
      for (let i = 0; i < N; i += 1) {
        const first = v;
        const px = sim.pins[i * 3];
        const py = sim.pins[i * 3 + 1];
        const pz = sim.pins[i * 3 + 2];
        const topN = (i * K + E - 1) * 3;
        const fusedTop = fuse[i * K + E - 1];
        const hwTop = (PITCH / 2) * (fusedTop > 0.5 ? 1.004 : 0.995);
        for (const [yy, tt] of [[py + 0.05, state.tExit + 0.05], [py, state.tExit]]) {
          let nx = nrm[topN];
          let nz = nrm[topN + 2];
          const l = Math.hypot(nx, nz) || 1;
          nx /= l;
          nz /= l;
          const ny = 0;
          const bx = nz;
          const bz = -nx;
          writeVert(v * FLOATS, px - bx * hwTop, yy, pz - bz * hwTop, nx, ny, nz, i / N, tt, 0, i);
          v += 1;
          writeVert(v * FLOATS, px + bx * hwTop, yy, pz + bz * hwTop, nx, ny, nz, (i + 1) / N, tt, 1, i);
          v += 1;
        }
        let sumZ = 0;
        for (let k = E - 1; k >= 0; k -= 1) {
          const o = (i * K + k) * 3;
          const lo = k > 0 ? (i * K + k - 1) * 3 : o;
          let tx = tan[o] + tan[lo];
          let ty = tan[o + 1] + tan[lo + 1];
          let tz = tan[o + 2] + tan[lo + 2];
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          const nx = nrm[o];
          const ny = nrm[o + 1];
          const nz = nrm[o + 2];
          let bx = ny * tz - nz * ty;
          let by = nz * tx - nx * tz;
          let bz = nx * ty - ny * tx;
          const bl = Math.hypot(bx, by, bz) || 1;
          bx /= bl;
          by /= bl;
          bz /= bl;
          const f = fuse[i * K + k];
          const hw = (PITCH / 2) * (f > 0.5 ? 1.004 : 0.995);
          const t = k / (K - 1);
          writeVert(v * FLOATS, pos[o] - bx * hw, pos[o + 1] - by * hw, pos[o + 2] - bz * hw, nx, ny, nz, i / N, t, 0, i);
          v += 1;
          writeVert(v * FLOATS, pos[o] + bx * hw, pos[o + 1] + by * hw, pos[o + 2] + bz * hw, nx, ny, nz, (i + 1) / N, t, 1, i);
          v += 1;
          mat4.apply(view, pos[o], pos[o + 1], pos[o + 2], v4);
          sumZ += v4[2];
        }
        ranges.push({ first, count: v - first, z: sumZ / E });
      }
    }
    order.length = 0;
    for (let i = 0; i < ranges.length; i += 1) order.push(i);
    order.sort((a, b) => ranges[a].z - ranges[b].z);
    const L = state.L;
    const t0 = Math.max(0, (L - 0.05) / PRINT_H);
    printRange = null;
    if (t0 < 0.999) {
      const first = v;
      const lift = lifted * 0.01;
      const row = (r) => t0 + ((1 - t0) * r) / PRINT_ROWS;
      const point = (u, t, out) => {
        const along = t * PRINT_H - L;
        const flat = clamp(along / 0.18, 0, 1);
        const xc = (u - 0.5) * 2;
        const bow = (0.012 * (1 - xc * xc) + lift) * flat * flat;
        const dbow = -0.012 * 2 * xc * 2 * flat * flat / PRINT_W;
        const off = 0.004 + bow;
        const rattle = 1 + Math.max(0, along) * 2.5;
        out[0] = (u - 0.5) * PRINT_W + shake[0] * rattle;
        out[1] = D[1] * along + NT[1] * off + shake[1];
        out[2] = D[2] * along + NT[2] * off + shake[2] * rattle;
        let nx = -dbow;
        let ny = NT[1];
        let nz = NT[2];
        const l = Math.hypot(nx, ny, nz);
        out[3] = nx / l;
        out[4] = ny / l;
        out[5] = nz / l;
        return out;
      };
      const a = [0, 0, 0, 0, 0, 0];
      const quad = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]];
      for (let r = 0; r < PRINT_ROWS; r += 1) {
        for (let c = 0; c < N; c += 1) {
          for (const [dc, dr] of quad) {
            const u = (c + dc) / N;
            const t = row(r + dr);
            point(u, t, a);
            writeVert(v * FLOATS, a[0], a[1], a[2], a[3], a[4], a[5], u, t, -1, c);
            v += 1;
          }
        }
      }
      printRange = { first, count: v - first };
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, paperVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, paperData, 0, v * FLOATS);
  }

  function uploadFuse() {
    const { fuse } = sim;
    for (let i = 0; i < N * K; i += 1) fuseBytes[i] = Math.round(clamp(fuse[i], 0, 1) * 255);
    gl.bindTexture(gl.TEXTURE_2D, fuseTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, K, N, gl.RED, gl.UNSIGNED_BYTE, fuseBytes);
    fuseDirty = false;
  }

  function bindShadowUniforms(u, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(u.uShadow, unit);
    gl.uniformMatrix4fv(u.uLightVP, false, lightVP);
    gl.uniform2f(u.uShadowTexel, 1 / SHADOW, 1 / SHADOW);
  }

  function drawPaper(prog) {
    gl.bindVertexArray(paperVao);
    if (printRange) gl.drawArrays(gl.TRIANGLES, printRange.first, printRange.count);
    for (const idx of order) gl.drawArrays(gl.TRIANGLE_STRIP, ranges[idx].first, ranges[idx].count);
    gl.bindVertexArray(null);
    return prog;
  }

  function render() {
    if (!vp) return;
    buildPaper();
    if (fuseDirty) uploadFuse();

    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 2);
    gl.useProgram(depthProg.p);
    gl.uniformMatrix4fv(depthProg.u.uLightVP, false, lightVP);
    gl.uniform3f(depthProg.u.uOffset, shake[0], shake[1], shake[2]);
    gl.bindVertexArray(solidVao);
    gl.drawElements(gl.TRIANGLES, solidCount, gl.UNSIGNED_SHORT, 0);
    gl.uniform3f(depthProg.u.uOffset, 0, 0, 0);
    drawPaper(depthProg);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.9, 0.9, 0.89, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(bgProg.p);
    gl.uniformMatrix4fv(bgProg.u.uInvVP, false, invVP);
    gl.uniform3fv(bgProg.u.uEye, EYE);
    gl.uniform1f(bgProg.u.uFloor, FLOOR_Y);
    gl.uniform3fv(bgProg.u.uWall, WALL);
    gl.uniform3fv(bgProg.u.uGround, GROUND);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fibreTex);
    gl.uniform1i(bgProg.u.uFibre, 1);
    bindShadowUniforms(bgProg.u, 0);
    gl.bindVertexArray(bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(solidProg.p);
    const su = solidProg.u;
    gl.uniformMatrix4fv(su.uVP, false, vp);
    gl.uniform3f(su.uOffset, shake[0], shake[1], shake[2]);
    gl.uniform3fv(su.uEye, EYE);
    gl.uniform3fv(su.uLight, LIGHT);
    gl.uniform3fv(su.uMetal, METAL);
    gl.uniform3fv(su.uAccent, accent);
    gl.uniform1f(su.uLed, led);
    gl.uniform1f(su.uPress, press);
    gl.uniform1f(su.uSlotZ, 0.0);
    gl.uniform1f(su.uSlotX, SLOT_X);
    gl.uniform2f(su.uButton, BUTTON[0], BUTTON[1]);
    gl.uniform1f(su.uPitch, PITCH);
    bindShadowUniforms(su, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fibreTex);
    gl.uniform1i(su.uFibre, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, labelTex);
    gl.uniform1i(su.uLabel, 2);
    gl.bindVertexArray(solidVao);
    gl.drawElements(gl.TRIANGLES, solidCount, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(paperProg.p);
    const pu = paperProg.u;
    gl.uniformMatrix4fv(pu.uVP, false, vp);
    gl.uniform3fv(pu.uEye, EYE);
    gl.uniform3fv(pu.uLight, LIGHT);
    gl.uniform1f(pu.uN, N);
    gl.uniform1f(pu.uK, K);
    gl.uniform1f(pu.uExitY, EXIT_Y);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, backTex);
    gl.uniform1i(pu.uBack, 5);
    bindShadowUniforms(pu, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fibreTex);
    gl.uniform1i(pu.uFibre, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, photoTex[photo]);
    gl.uniform1i(pu.uPhotoA, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, photoTex[(photo + 1) % PHOTOS.length]);
    gl.uniform1i(pu.uPhotoB, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, fuseTex);
    gl.uniform1i(pu.uFuse, 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawPaper(paperProg);
    gl.disable(gl.BLEND);
  }

  function status() {
    const s = sim.state;
    const fed = Math.round(clamp((s.L - L_BITE) / (PRINT_H - L_BITE), 0, 1) * 100);
    const through = s.L >= L_MAX - 1e-3;
    const key = `${healing ? 1 : 0}|${s.fusedCount}|${fed}|${through ? 1 : 0}`;
    if (key === lastStatus) return;
    lastStatus = key;
    onStatus?.({ fused: s.fusedCount, total: N, fed, healing, through, photo });
  }

  function printHit(x, y) {
    const L = sim.state.L;
    const t0 = Math.max(0, L / PRINT_H);
    if (t0 >= 0.995) return false;
    const corners = [
      [-PRINT_W / 2, t0],
      [PRINT_W / 2, t0],
      [PRINT_W / 2, 1],
      [-PRINT_W / 2, 1],
    ].map(([px, t]) => {
      const along = t * PRINT_H - L;
      return project(px, D[1] * along, D[2] * along, [0, 0]);
    });
    let area = 0;
    for (let i = 0; i < 4; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const sign = area < 0 ? -1 : 1;
    for (let i = 0; i < 4; i += 1) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const cross = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * sign;
      if (cross < -14 * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
    }
    return true;
  }

  function buttonHit(x, y) {
    const c = project(BUTTON[0], BUTTON[1], MACHINE_Z, [0, 0]);
    const e = project(BUTTON[0] + 0.04, BUTTON[1], MACHINE_Z, [0, 0]);
    const r = Math.max(22, Math.abs(e[0] - c[0]) * 1.4);
    return Math.hypot(x - c[0], y - c[1]) < r;
  }

  function stripsHit(x, y) {
    const a = project(-PRINT_W * 0.6, EXIT_Y, 0, [0, 0]);
    const b = project(PRINT_W * 0.6, FLOOR_Y, 0.3, [0, 0]);
    return x > a[0] - 24 && x < b[0] + 24 && y > a[1] - 8 && y < b[1] + 24;
  }

  const projA = [0, 0];
  function comb(x0, y0, x1, y1) {
    const sx = x1 - x0;
    const sy = y1 - y0;
    const segLen = Math.hypot(sx, sy);
    if (segLen < 0.01) return;
    const a = project(0, -0.5, 0, [0, 0]);
    const b = project(1, -0.5, 0, [0, 0]);
    const ppu = Math.max(1, Math.abs(b[0] - a[0]));
    const pitchPx = PITCH * ppu;
    const R = Math.max(20, pitchPx * 1.6);
    let mx = sx / ppu;
    let my = -sy / ppu;
    const ml = Math.hypot(mx, my);
    if (ml > 0.02) {
      mx *= 0.02 / ml;
      my *= 0.02 / ml;
    }
    const { pos, state } = sim;
    const E = state.E;
    const l2 = segLen * segLen;
    for (let i = 0; i < N; i += 1) {
      let best = 0;
      for (let k = 0; k < E; k += 1) {
        const o = (i * K + k) * 3;
        project(pos[o], pos[o + 1], pos[o + 2], projA);
        const px = projA[0] - x0;
        const py = projA[1] - y0;
        const t = clamp((px * sx + py * sy) / l2, 0, 1);
        const d = Math.hypot(px - sx * t, py - sy * t);
        if (d >= R) continue;
        const q = 1 - clamp((d - R * 0.3) / (R * 0.7), 0, 1);
        const w = q * q * (3 - 2 * q);
        best = Math.max(best, w);
        sim.nudge(i, k, mx * w * 0.22, my * w * 0.22, 0);
      }
      if (best > 0) sim.addComb(i, best * Math.min(0.22, (segLen / (2 * R)) * 0.5));
    }
  }

  function combPass() {
    if (!sim.state.E || healing) return;
    const len = sim.state.tExit * PRINT_H;
    const yMid = EXIT_Y - Math.min(len, -FLOOR_Y + EXIT_Y) * 0.45;
    const left = project(-PRINT_W * 0.62, yMid, 0, [0, 0]);
    const right = project(PRINT_W * 0.62, yMid, 0, [0, 0]);
    const low = project(PRINT_W * 0.62, yMid - len * 0.2, 0, [0, 0]);
    const lowL = project(-PRINT_W * 0.62, yMid - len * 0.2, 0, [0, 0]);
    combScript = { t: 0, legs: [[left, right], [low, lowL]], last: null };
    wake();
  }

  function frame(ts) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    const s = sim.state;
    let want = 0;
    if (healing) want = -V_HEAL;
    else if (hold || keyHold) want = V_FEED;
    else {
      if (pointer && pointer.mode === "feed") feedTarget = Math.max(feedTarget, pointer.L0 + (pointer.y - pointer.y0) / pointer.k);
      if (feedTarget - s.L > 0.003) want = V_FEED * clamp((feedTarget - s.L) / 0.02, 0.35, 1);
    }
    if (!healing && s.L >= L_MAX - 1e-4 && want > 0) want = 0;
    motorV += (want - motorV) * (1 - Math.exp(-dt / 0.09));
    if (Math.abs(motorV) < 1e-4 && want === 0) motorV = 0;
    if (!healing && s.L >= L_MAX - 1e-4 && motorV > 0) motorV = 0;
    led += ((Math.abs(motorV) > 0.01 ? 1 : 0) - led) * (1 - Math.exp(-dt / 0.12));
    press += ((hold ? 1 : 0) - press) * (1 - Math.exp(-dt / 0.05));
    const wantLift = (pointer && pointer.mode === "feed") || (hoverPrint && !pointer) ? 1 : 0;
    lifted += (wantLift - lifted) * (1 - Math.exp(-dt / 0.12));

    if (pointer && pointer.mode === "comb" && !healing) {
      comb(pointer.lx, pointer.ly, pointer.x, pointer.y);
      pointer.lx = pointer.x;
      pointer.ly = pointer.y;
    }
    if (combScript) {
      combScript.t += dt;
      const legDur = 0.8;
      const leg = Math.floor(combScript.t / legDur);
      if (leg >= combScript.legs.length || healing) combScript = null;
      else {
        const f = (combScript.t - leg * legDur) / legDur;
        const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
        const [a, b] = combScript.legs[leg];
        const x = a[0] + (b[0] - a[0]) * e;
        const y = a[1] + (b[1] - a[1]) * e;
        if (combScript.last && combScript.last[2] === leg) comb(combScript.last[0], combScript.last[1], x, y);
        combScript.last = [x, y, leg];
      }
    }

    const amp = reduced ? 0 : 0.002 * clamp(Math.abs(motorV) / V_FEED, 0, 1);
    const tm = s.time;
    shake[0] = amp * (Math.sin(tm * 197) * 0.6 + Math.sin(tm * 311 + 1.3) * 0.4);
    shake[1] = amp * 0.6 * (Math.sin(tm * 263 + 0.7) * 0.5 + Math.sin(tm * 151 + 2.1) * 0.5);
    shake[2] = amp * 0.5 * Math.sin(tm * 229 + 0.4);
    s.shake[0] = shake[0];
    s.shake[1] = shake[1];
    s.shake[2] = shake[2];

    acc += dt;
    let motion = 0;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      motion = Math.max(motion, sim.step(STEP, motorV));
      acc -= STEP;
      steps += 1;
    }
    if (steps === 6) acc = 0;
    fuseDirty = true;

    const goal = frameGoal();
    if (Math.abs(goal - frameTop) > 1e-4) {
      frameTop += (goal - frameTop) * (1 - Math.exp(-dt / (reduced ? 0.05 : 0.7)));
      if (Math.abs(goal - frameTop) < 1e-4) frameTop = goal;
      frameProject();
    }
    if (healing) feedTarget = 0;
    if (healing && s.L <= L_BITE + 1e-4) {
      healing = false;
      motorV = 0;
      photo = (photo + 1) % PHOTOS.length;
      sim.reseed(SEED + photo * 31);
      sim.reset(L_BITE);
      onPhoto?.(photo);
    } else if (!healing && s.allFused && s.L >= L_MAX - 1e-3) {
      healWait += dt;
      if (healWait > 0.7) {
        healing = true;
        healWait = 0;
      }
    } else healWait = 0;

    render();
    status();

    const busy = Math.abs(frameGoal() - frameTop) > 1e-4 || feedTarget - s.L > 0.003 || pointer || hold || keyHold || combScript || healing || Math.abs(motorV) > 0 || s.fusing || s.air > 0.004 || healWait > 0 || Math.abs(led - (Math.abs(motorV) > 0.01 ? 1 : 0)) > 0.01 || Math.abs(press - (hold ? 1 : 0)) > 0.01 || Math.abs(lifted - ((pointer && pointer.mode === "feed") || (hoverPrint && !pointer) ? 1 : 0)) > 0.01;
    if (!busy && motion < 5e-5) calm += 1;
    else calm = 0;
    if (calm < 24) raf = requestAnimationFrame(frame);
    else lastTs = 0;
  }

  function wake() {
    calm = 0;
    if (!raf && active && !destroyed) {
      lastTs = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = local(e);
    if (pointer) return;
    let mode = null;
    if (buttonHit(x, y)) mode = "button";
    else if (!healing && printHit(x, y)) mode = "feed";
    else if (stripsHit(x, y)) mode = "comb";
    if (!mode) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    const a = project(0, 0, 0, [0, 0]);
    const b = project(-D[0] * 0.1, -D[1] * 0.1, -D[2] * 0.1, [0, 0]);
    const k = Math.max(20, (b[1] - a[1]) / 0.1);
    pointer = { id: e.pointerId, mode, x, y, x0: x, y0: y, lx: x, ly: y, L0: sim.state.L, k };
    if (mode === "button") hold = true;
    if (mode === "feed") feedTarget = sim.state.L;
    root.dataset.grabbing = mode;
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (pointer && e.pointerId === pointer.id) {
      pointer.x = x;
      pointer.y = y;
      wake();
      return;
    }
    if (pointer) return;
    const over = buttonHit(x, y) ? "button" : !healing && printHit(x, y) ? "feed" : stripsHit(x, y) ? "comb" : "";
    if (root.dataset.hover !== over) root.dataset.hover = over;
    if ((over === "feed") !== hoverPrint) {
      hoverPrint = over === "feed";
      wake();
    }
  }

  function onUp(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    if (pointer.mode === "button") hold = false;
    pointer = null;
    delete root.dataset.grabbing;
    wake();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  const onLeave = () => {
    if (pointer) return;
    delete root.dataset.hover;
    if (hoverPrint) {
      hoverPrint = false;
      wake();
    }
  };
  canvas.addEventListener("pointerleave", onLeave);

  const ro = new ResizeObserver(() => {
    fit();
    render();
  });
  ro.observe(root);

  warm(L_REST);
  frameTop = frameGoal();
  fit();
  render();
  status();

  return {
    setActive(v) {
      active = v;
      if (v) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        lastTs = 0;
      }
    },
    select(i) {
      if (i === photo && !healing && sim.state.L === L_REST && !sim.state.fusedCount) return;
      photo = i;
      healing = false;
      feedTarget = 0;
      motorV = 0;
      combScript = null;
      sim.reseed(SEED + i * 31);
      warm(L_REST);
      fuseDirty = true;
      frameTop = frameGoal();
      frameProject();
      onPhoto?.(photo);
      render();
      status();
      wake();
    },
    feed(on) {
      keyHold = on;
      wake();
    },
    combPass,
    relayout() {
      fit();
      render();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
