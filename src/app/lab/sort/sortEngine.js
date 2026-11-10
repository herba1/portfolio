import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { GW, GH, CELL, MW, MH, DW, DH, BANDS, PARTS, F_LIFT, F_GLINT, demoMask, bake, liftPlan, liftMask, links, restSort, geometry } from "./sortCore";

// Sort: a real pixel sort, after Kim Asendorf's ASDF Pixel Sort (2010), run
// on the GPU over a summer photograph of a Japanese level crossing.
//
// Bands. The picture is cut into horizontal bands 4-7 px tall, each height
// from a hash. A band is sorted once, along its centre row, and that one
// sorted row is written down the band's full height, so every sorted run is
// a solid rectangle with hard ends, never a comb of independent 1 px lines.
//
// Spans (ASDF). A span may only start at grass (a few green pixels in a row):
// a position on a band belongs to a span when it lies within reach of the
// last grass before it, the brush mask m there is on, and its luminance lies
// inside [lo(m), hi]. The reach is short: a span ends once it has run 30% of
// its band's reach through anything that is not vegetation, so it bridges a
// gap but never trails a long tail of sky. Reach and lo both follow m, so
// brushing longer or harder lets a span run further and lets darker pixels
// join. A span breaks only at a true silhouette: the outline of a pole, a sign
// or a cabinet in the photo's depth map (Depth Anything V2), or a depth step.
//
// The sort. Odd-even transposition sort in WebGL2 fragment passes over a
// R16UI permutation texture, one row per band: each texel holds the home
// index of the pixel now sitting there. Every pass compares disjoint
// neighbour pairs (odd pairs, then even pairs). Across an open link (both
// texels in one span) the pair is ordered by the home pixel's sort key,
// luminance pulled down by greenness, smallest first (ties by home index):
// greens stay rooted where the span starts and the sky and wall highlights
// are pushed out to the run's end. Everywhere else the pair is ordered by home
// index, which is the identity, so any pixel outside a span flows back home
// one position per pass. Erasing the mask (a long press) therefore un-sorts
// by the same network.
//
// The wave is geometry, not sort direction, and it is never bent: after
// herb's reference 2 the curl is a staircase of straight strips. The verge's
// bands are sorted in place and are the root; every band row above them is a
// layer of the stack, and each shows one verge band's sorted run lifted to
// it, a hard-edged horizontal rectangle stepped right by a smooth function of
// its height (sortCore's stackLeft). The stack leans over as it climbs, the
// crest runs on to the right and a lip of shorter strips hangs from its end,
// so the hook's silhouette is only the staircase of the strips' ends. Strips
// are as long as their runs (hundreds of px, stretched at most 3x), so the
// stack's right side is combed by the run lengths, and poles and signs stand
// in front of it (a holdout from the depth map and the photo).
//
// Each strip is its run's luminance ramp, root to tail, lit by the sort
// order: its facing (low under the lean, high at the crest) picks the
// stretch of the run it reads. Low strips read only the dark green heads; the
// crest reads out to the run's tail, whose brightest pixels go white-gold,
// and glint tiles break off the crest's strip ends. A run's few grey, beige
// or blue pixels (road, wall, sky) are graded onto the green ramp by their
// luminance, so the sheet stays one green. The stack climbs as the mask over
// the verge rises: amount 0.5 lifts it half way, with no crest.
//
// The resting wave is the same sort run to completion on the CPU at load
// (identical keys and tie-break, so it is a fixed point of the GPU network).
//
// Query: ?mask=demo|none &amount=0..1 holds the resting wave at that amount:
// how high the stack climbs and how long its runs are.

const ASSET = "/lab/sort/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const PASSES = 24; // odd-even passes per frame
const REGEO = 90; // ms between rebuilds of the links and the wave while brushing
const BUDGET = 4000; // passes to keep running after the last mask change
const SG = GW / 1200; // grid px per layout unit

const FILM = {
  ...FILM_PRESETS.summer,
  headroom: 0.8,
  halation: 0.2,
  bloom: 0.14,
  softness: 0.32,
  contrast: 1.14,
  saturation: 1.08,
  blueDepth: 0.7,
  grain: 0.24,
  vignette: 0.08,
  flipY: true,
};

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const PASS_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uState;
uniform usampler2D uLink;   // R8UI: 1 where texels x and x + 1 lie in one span
uniform usampler2D uKey;    // R16UI sort key of the pixel at home on each texel: greenest and darkest first
uniform int uPhase;
out uvec4 o;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int W = textureSize(uState, 0).x;
  int left = ((q.x + uPhase) & 1) == 0 ? q.x : q.x - 1;
  int right = left + 1;
  uint self = texelFetch(uState, q, 0).r;
  if (left < 0 || right >= W) { o = uvec4(self, 0u, 0u, 0u); return; }
  uint a = texelFetch(uState, ivec2(left, q.y), 0).r;
  uint b = texelFetch(uState, ivec2(right, q.y), 0).r;
  bool sw;
  if (texelFetch(uLink, ivec2(left, q.y), 0).r > 0u) {
    uint ka = texelFetch(uKey, ivec2(int(a), q.y), 0).r;
    uint kb = texelFetch(uKey, ivec2(int(b), q.y), 0).r;
    sw = ka > kb || (ka == kb && a > b);
  } else {
    sw = a > b;
  }
  uint v = q.x == left ? (sw ? b : a) : (sw ? a : b);
  o = uvec4(v, 0u, 0u, 0u);
}`;

const SHOW_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uState;
uniform usampler2D uGeo;    // in place, per (x, band): source x + 1 (0 = not sorted here), source band
uniform usampler2D uStripe; // per band, per strip: (x0, x1, source band + 1, q0 | q1 << 4 | flags << 8) and (run x0, run x1, facing, vegetation share)
uniform usampler2D uBand;   // row 0: band of each grid row; row 1: centre row of each band; row 2: top row of each band
uniform usampler2D uHold;   // 255 where a pole or a sign stands in front of the stack
uniform sampler2D uFilm;    // the developed print, print-sized, GL orientation
uniform sampler2D uClean;   // the photo developed at grid size without grain, for the strips
uniform vec4 uPrint;        // x, y, w, h in device px, top-left origin
uniform float uCanvasH;
uniform vec3 uPaper;
uniform vec2 uGrid;
out vec4 o;
vec3 film(int gx, int gy) {
  return texelFetch(uClean, ivec2(gx, int(uGrid.y) - 1 - gy), 0).rgb;
}
void main() {
  vec2 d = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 l = (d - uPrint.xy) / uPrint.zw;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThanEqual(l, vec2(1.0)))) { o = vec4(uPaper, 1.0); return; }
  ivec2 fs = textureSize(uFilm, 0);
  ivec2 fp = ivec2(d - uPrint.xy);
  vec3 col = texelFetch(uFilm, ivec2(fp.x, fs.y - 1 - fp.y), 0).rgb;
  ivec2 g = ivec2(floor(l * uGrid));
  ivec2 src = ivec2(-1);
  bool lifted = false;
  bool glint = false;
  float f = 0.0;
  float pr = 0.0;
  int band = int(texelFetch(uBand, ivec2(g.y, 0), 0).r);
  int q = g.y - int(texelFetch(uBand, ivec2(band, 2), 0).r);
  bool held = texelFetch(uHold, g, 0).r > 0u;
  for (int k = 0; k < ${PARTS}; k++) {
    uvec4 a = texelFetch(uStripe, ivec2(band, 2 * k), 0);
    if (a.b == 0u) break;
    int q0 = int(a.a & 15u);
    int q1 = int((a.a >> 4u) & 15u);
    uint fl = a.a >> 8u;
    if (q < q0 || q >= q1 || g.x < int(a.r) || g.x >= int(a.g)) continue;
    // A pole or a sign stands in front of the stack.
    if ((fl & ${F_LIFT}u) != 0u && held) continue;
    uvec4 b = texelFetch(uStripe, ivec2(band, 2 * k + 1), 0);
    f = float(b.b) / 65535.0;
    float vf = clamp(float(b.a) / 65535.0, 0.35, 1.0);
    glint = (fl & ${F_GLINT}u) != 0u;
    // The strip is its run's ramp, head to tail, stretched over its length.
    // Its facing picks the stretch it reads: low and tucked, the dark green
    // head; at the crest, on out past the grass into the brightest tail.
    float sf = (float(g.x - int(a.r)) + 0.5) / float(a.g - a.r);
    float lo = 0.42 * pow(f, 1.6) * vf;
    float hi = mix(0.62 * vf, vf, smoothstep(0.0, 0.6, f)) + (1.0 - vf) * smoothstep(0.62, 1.0, f);
    pr = glint ? 0.985 + 0.015 * sf : mix(lo, hi, sf);
    float len = float(b.g - b.r);
    src = ivec2(int(b.r) + int(clamp(pr, 0.0, 1.0) * (len - 1.0)), int(a.b) - 1);
    lifted = true;
    break;
  }
  if (!lifted) {
    uvec2 geo = texelFetch(uGeo, ivec2(g.x, band), 0).rg;
    if (geo.r > 0u) src = ivec2(int(geo.r) - 1, int(geo.g));
  }
  if (src.x >= 0) {
    // Every strip pixel is one sorted pixel, read where it now sits: no
    // blend along the strip, so strips keep hard ends.
    uint h = texelFetch(uState, src, 0).r;
    col = film(int(h), int(texelFetch(uBand, ivec2(src.y, 1), 0).r));
    if (lifted) {
      // The sheet stays one green: a pixel that is not grass (the road, a
      // wall, the sky caught in a run) is graded onto the green ramp by its
      // luminance, so the strip still reads dark to bright.
      float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float gr = clamp((col.g - max(col.r, col.b)) * 9.0, 0.0, 1.0);
      vec3 ramp = mix(vec3(0.05, 0.13, 0.04), vec3(0.33, 0.52, 0.11), smoothstep(0.02, 0.42, y));
      ramp = mix(ramp, vec3(0.80, 0.84, 0.40), smoothstep(0.42, 0.85, y));
      col = mix(col, ramp, (1.0 - gr) * 0.85);
      // Turned to the sky at the crest, the run's brightest tail blooms
      // white-gold; a glint is that pixel broken off.
      vec3 gold = mix(vec3(0.98, 0.80, 0.36), vec3(1.0, 0.96, 0.80), smoothstep(0.3, 0.75, y));
      // The last stretch of a lit run goes over whole, a hard block at the
      // strip's end, not a fade.
      float crest = smoothstep(0.78, 1.0, f);
      float push = mix(pow(f, 1.5) * 0.5, 1.0, crest) * smoothstep(0.6 - 0.12 * crest, 0.88, pr);
      push = max(push, pow(f, 1.5) * step(0.93, pr));
      col = mix(col, gold, push);
      if (glint) col = mix(vec3(1.0, 0.8, 0.32), vec3(1.0, 0.97, 0.86), 0.25 + 0.35 * smoothstep(0.3, 0.8, y));
    }
  }
  o = vec4(col, 1.0);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function pixels(bm, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export async function createSort(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qMask = q.get("mask");
  const amount = clamp(num("amount") ?? 1, 0, 1);
  const passes = clamp(Math.round(num("passes") ?? PASSES), 2, 64) & ~1;
  const held = qMask != null || num("amount") != null;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "crosshair";

  const [photoBm, depthBm] = await Promise.all([loadBitmap(`${ASSET}photo.webp`), loadBitmap(`${ASSET}depth.png`)]);
  // ---- mask
  const mask = qMask === "none" ? new Float32Array(MW * MH) : demoMask(amount);
  const mask8 = new Uint8Array(MW * MH);
  const syncMask8 = () => {
    for (let i = 0; i < mask.length; i++) mask8[i] = Math.round(clamp(mask[i], 0, 1) * 255);
  };
  syncMask8();

  const base = bake(pixels(photoBm, GW, GH), pixels(depthBm, GW, GH));
  depthBm.close?.();
  // The spans the mask opens, and the wave's slabs, rebuilt as the mask moves.
  const bm = new Uint8Array(DW * DH);
  const link = new Uint8Array(DW * DH);
  const wave = { geo: new Uint16Array(DW * DH * 2), table: new Uint16Array(DH * 2 * PARTS * 4) };
  const rebuildCpu = () => {
    const plan = liftPlan(mask8);
    liftMask(mask8, plan, bm);
    links(base, bm, link);
    geometry(mask8, base, link, plan, wave);
  };
  rebuildCpu();
  const state = qMask === "none" ? restSort(base, new Uint8Array(DW * DH)) : restSort(base, link);
  const bandRows = new Uint16Array(GH * 3);
  bandRows.set(BANDS.of, 0);
  bandRows.set(BANDS.c, GH);
  bandRows.set(BANDS.y0, GH * 2);

  // ---- GL resources
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const tex = (internal, format, type, w, h, data, filter = gl.NEAREST) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const keyTex = tex(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, DW, DH, base.key);
  const linkTex = tex(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, DW, DH, link);
  const geoTex = tex(gl.RG16UI, gl.RG_INTEGER, gl.UNSIGNED_SHORT, DW, DH, wave.geo);
  const stripeTex = tex(gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, DH, 2 * PARTS, wave.table);
  const bandTex = tex(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, GH, 3, bandRows);
  const holdTex = tex(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, GW, GH, base.hold);
  const uploadCpu = () => {
    gl.bindTexture(gl.TEXTURE_2D, linkTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DW, DH, gl.RED_INTEGER, gl.UNSIGNED_BYTE, link);
    gl.bindTexture(gl.TEXTURE_2D, geoTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DW, DH, gl.RG_INTEGER, gl.UNSIGNED_SHORT, wave.geo);
    gl.bindTexture(gl.TEXTURE_2D, stripeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DH, 2 * PARTS, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, wave.table);
  };
  const stateTex = [0, 1].map(() => tex(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, DW, DH, state));
  const stateFbo = stateTex.map((t) => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let cur = 0;

  const photoTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photoTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, photoBm);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  photoBm.close?.();

  const pass = compile(gl, QUAD_VS, PASS_FS);
  const show = compile(gl, QUAD_VS, SHOW_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---- layout and the developed print
  let L = null;
  let filmT = null;
  let film = null;
  let dirty = true;
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    const narrow = W < 700;
    const margin = Math.max(20, Math.min(W, H) * (narrow ? 0.05 : 0.09));
    const printW = Math.min(W - margin * 2, (H - margin * 2) * (GW / GH));
    const pw = Math.round(printW * dpr);
    const ph = Math.round((printW * GH * dpr) / GW);
    const px = Math.round((W * dpr - pw) / 2);
    const py = Math.round((H * dpr - ph) / 2);
    return { W, H, dpr, pw, ph, px, py };
  };
  const dropFilm = () => {
    for (const f of filmT || []) {
      gl.deleteTexture(f.tex);
      gl.deleteFramebuffer(f.fbo);
    }
    filmT = null;
  };
  const build = () => {
    L = layout();
    dropFilm();
    // Two developments of the photo: the print, shown where the photo is
    // untouched, and one at the grid's own resolution without grain that the
    // slabs take their colour from, texel for texel. A slab pixel must be
    // the very pixel its key was read from: a print-sized texel blends its
    // neighbours, which would break every sorted stretch into flicker, and
    // grain repeated down a band would streak.
    filmT = [
      [L.pw, L.ph, FILM],
      [GW, GH, { ...FILM, grain: 0 }],
    ].map(([w, h, look]) => {
      const t = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, w, h, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!film) film = createFilm(gl, { width: w, height: h });
      film.resize(w, h);
      film.render(photoTex, look, fbo);
      return { tex: t, fbo };
    });
    dirty = true;
  };
  stage.onResize(build);

  // ---- the sort network
  let budget = 0;
  let phase = 0;
  let load = passes; // odd-even passes this frame, adapted to frame time
  const runPasses = (n) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.useProgram(pass.p);
    const u = pass.u;
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uLink, 1);
    gl.uniform1i(u.uKey, 2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, keyTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, linkTex);
    gl.viewport(0, 0, DW, DH);
    for (let k = 0; k < n; k++) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo[1 - cur]);
      gl.uniform1i(u.uPhase, phase);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      cur = 1 - cur;
      phase = 1 - phase;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  const present = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.useProgram(show.p);
    const u = show.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTex[cur]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, filmT[0].tex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, filmT[1].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, geoTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, bandTex);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, stripeTex);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, holdTex);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uFilm, 1);
    gl.uniform1i(u.uClean, 4);
    gl.uniform1i(u.uGeo, 2);
    gl.uniform1i(u.uBand, 3);
    gl.uniform1i(u.uStripe, 5);
    gl.uniform1i(u.uHold, 6);
    gl.uniform4f(u.uPrint, L.px, L.py, L.pw, L.ph);
    gl.uniform1f(u.uCanvasH, stage.canvas.height);
    gl.uniform3f(u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform2f(u.uGrid, GW, GH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  // ---- input: brush to sort, long press to let everything flow home
  const toGrid = (x, y) => [((x * L.dpr - L.px) / L.pw) * GW, ((y * L.dpr - L.py) / L.ph) * GH];
  let press = null; // { x, y, t, moved, pressure }
  let unsort = null; // { gx, gy, t0 }
  let maskDirty = false;
  let cpuDirty = false;
  let lastCpu = 0;
  stage.on("down", (p, e) => {
    press = { x: p.x, y: p.y, t: performance.now(), moved: false, pressure: e.pressure > 0 ? e.pressure : 0.5 };
    unsort = null;
  });
  stage.on("move", (p, e) => {
    if (!press) return;
    if (e.pressure > 0) press.pressure = e.pressure;
    if (Math.hypot(p.x - press.x, p.y - press.y) > 6) press.moved = true;
  });
  stage.on("up", () => {
    press = null;
    unsort = null;
  });

  // The brush: a comet laid along the rows through the pointer, a short head
  // to the left and a long tail to the right, so the span it opens runs on
  // from the grass under the hand the way the strips run.
  const brush = (gx, gy, radius, tail, fn) => {
    for (let i = 0; i < mask.length; i++) {
      const a = (((Math.floor(i / MW) + 0.5) * CELL - gy) / radius) * 1.6;
      if (a <= -1 || a >= 1) continue;
      const du = ((i % MW) + 0.5) * CELL - gx;
      const b = du < 0 ? -du / radius : du / tail;
      const d = Math.hypot(a, b);
      if (d >= 1) continue;
      const w = 1 - d * d;
      const v = fn(mask[i], w * w);
      if (v !== mask[i]) {
        mask[i] = v;
        maskDirty = true;
      }
    }
  };

  const frame = (dt) => {
    if (!L) return;
    const now = performance.now();
    if (press && L) {
      const [gx, gy] = toGrid(stage.pointer.x, stage.pointer.y);
      const age = (now - press.t) / 1000;
      if (!press.moved && age > 0.42) {
        if (!unsort) unsort = { gx, gy, t0: now };
        const ua = (now - unsort.t0) / 1000;
        // The erased disc grows from the press point; inside it the mask
        // drains, so the darkest pixels leave their spans first.
        const R = (40 + 1500 * (1 - Math.exp(-ua * 0.8))) * SG;
        for (let i = 0; i < mask.length; i++) {
          const cx = ((i % MW) + 0.5) * CELL;
          const cy = (Math.floor(i / MW) + 0.5) * CELL;
          if (mask[i] > 0 && Math.hypot(cx - unsort.gx, cy - unsort.gy) < R) {
            mask[i] = Math.max(0, mask[i] - dt * 1.6);
            maskDirty = true;
          }
        }
      } else if (press.moved || age < 0.42) {
        // Dwell and pressure both feed the mask: reach grows, lo(m) falls,
        // spans lengthen and the stack climbs; a held press lets the tail
        // run on along the row.
        const rate = (1.6 + 4 * press.pressure) * (press.moved ? 1 : 0.35);
        const tail = (260 + 520 * Math.min(1, age / 2.5)) * SG;
        brush(gx, gy, 90 * SG, tail, (m, w) => Math.min(1, m + dt * rate * w));
      }
    }
    if (maskDirty) {
      maskDirty = false;
      cpuDirty = true;
      budget = BUDGET;
    }
    // The links and the slabs follow the mask, at most every REGEO ms while
    // it moves (a rebuild is a few tens of ms of CPU).
    if (cpuDirty && now - lastCpu >= REGEO) {
      syncMask8();
      rebuildCpu();
      uploadCpu();
      cpuDirty = false;
      lastCpu = now;
      dirty = true;
    }
    if (budget > 0) {
      // The grid is the full print, so a slow GPU sheds passes rather than
      // frames: the sort runs slower but the brush stays under the hand.
      load = dt > 0.04 ? Math.max(2, load - 2) : dt < 0.022 ? Math.min(passes, load + 2) : load;
      // Un-sorting runs at half rate so the flow home stays legible.
      const n = unsort ? Math.max(2, (load >> 2) << 1) : load;
      runPasses(n);
      budget -= n;
      dirty = true;
    }
    if (dirty) {
      present();
      dirty = false;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1 && !L) build();
  if (L) present();
  void embedded;
  void held;

  return {
    destroy() {
      film?.destroy();
      dropFilm();
      for (const t of [...stateTex, keyTex, linkTex, geoTex, stripeTex, bandTex, holdTex, photoTex]) gl.deleteTexture(t);
      for (const f of stateFbo) gl.deleteFramebuffer(f);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(pass.p);
      gl.deleteProgram(show.p);
      stage.destroy();
    },
  };
}
