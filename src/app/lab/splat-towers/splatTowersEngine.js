import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Splat Towers: one worm's-eye photograph lifted into real 3D Gaussians.
//
// Offline (tools/depth/bakes/splat-towers/bake.py) the photo is cut by a
// quadtree that splits where the picture or the geometry asks for it, and each
// cell becomes one anisotropic Gaussian: its shape from the structure tensor
// (an edge gives a thin splat laid along it, open sky a big round one), its
// position unprojected through the depth map, its tilt from a plane fitted to
// the cell's inverse depth. Sky and cloud sit on a dome far behind the towers.
//
// Here every splat is projected the 3DGS way (EWA: Sigma' = J W Sigma W^T J^T),
// sorted back to front on a worker and alpha-blended. Each splat also carries
// the photograph through its own plane: a fragment's ray meets the splat's
// plane, and that point, seen from the original camera, is where the colour
// comes from. From the original camera every splat agrees, so the photograph
// comes back exactly, at full resolution. Move the camera and the splats move
// as the surfaces they are. A tower's lookup is depth-tested: a depth map
// ships with the photo, texel for texel, and a tower splat only takes the
// photo's colour where the photo shows its own surface. Where the photo shows
// something further off (the splat hanging past its tower's edge into sky) it
// lets the fragment go; where something nearer stood in front (a tower that
// has since moved aside) it shows its own colour. The bake never lets one
// splat bridge a depth step, so no colour is smeared across a silhouette. The
// dome is not depth-tested: it takes the photo where the photo shows sky and
// a sky plate (plate.webp, the sky the bake painted in behind every tower)
// everywhere else, so a tower that swings aside uncovers cloud and blue, never
// a hole or a flat patch. The bake outpaints
// the texture and the splats ~12% past the frame, so the lookup runs right to
// the edge of the view at any pose of the orbit. The edges go soft the way a
// lens does: one round blur over the finished frame, growing with the square
// of the distance from the centre (BLUR_FS).
//
// Query: ?yaw=&pitch= (degrees of orbit) hold a still; ?reveal=0..1 holds the
// opening.

const ASSET = "/lab/splat-towers/";
const DATA_W = 2048; // texels per row of the splat texture (2 per splat)
// depth.png: 0..253 is log Z from DEPTH_LO to DEPTH_HI metres, 255 is sky, 254
// is sky in the ring round a tower where the photo carries the lens's halo and
// the dome takes the sky plate instead (bake.py)
const DEPTH_LO = 20;
const DEPTH_HI = 400;
// How far (in log depth) a photo texel may sit off a splat's own plane and
// still be its surface: same below the first value, gone past the second.
// The bake finds steps at 0.05 over 5 px; a facade drifts ~1% across a splat.
const DEPTH_TOL = [0.035, 0.07];

// Orbit range before the rubber band. The bake puts every step between two
// structures (and between a tower and the sky) on the photograph's own edge,
// one pixel wide, and paints the sky in behind every tower, so the towers part
// from each other and from the dome without tearing. Held at six degrees:
// past that the near towers uncover sky deep behind them, where the painted
// plate is furthest from any real cloud (?yaw=&pitch= stills go further).
const MAX_DEG = 6;
// the swing over which the lens softens the edges (it stops softening there)
const SOFT_DEG = 5;
const PIVOT = 70; // metres up the optical axis: the camera swings round this point
const DEG_PER_PX = 0.016;
const OVERZOOM = 1.07; // a little more than cover, so the orbit has room

const FILM = {
  ...FILM_PRESETS.summer,
  input: "linear",
  headroom: 0,
  exposure: 0.1,
  whitePoint: 1.62,
  contrast: 1.16,
  shoulder: 0.95,
  halation: 0.42,
  halationThreshold: 0.75,
  bloom: 0.3,
  softness: 0.4,
  saturation: 1.08,
  blueDepth: 0.55,
  highlightTint: [1.02, 1, 0.96],
  grain: 0.38,
  vignette: 0.24,
};
const HEADROOM = 0.9; // near-white photo values pushed past 1.0 so cloud carries energy

const SPLAT_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in uint aIdx;
uniform usampler2D uData;
uniform mat3 uRot;      // world -> view
uniform vec3 uCam;
uniform float uF;
uniform vec2 uC;
uniform vec4 uM2;       // device offset = M2 * image offset (row major)
uniform vec2 uRes;
uniform vec2 uSoft;     // reveal radius, extra
uniform int uCut;       // level-of-detail cut for the crisp field
out vec2 vOff;
flat out vec3 vConic;
flat out vec4 vCol;
flat out float vTex;
flat out vec4 vPlane;
flat out float vTower;

vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

void main() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  uint i2 = aIdx * 2u;
  ivec2 tc = ivec2(int(i2 & 2047u), int(i2 >> 11));
  uvec4 t0 = texelFetch(uData, tc, 0);
  uvec4 t1 = texelFetch(uData, tc + ivec2(1, 0), 0);
  vec3 X = uintBitsToFloat(t0.xyz);
  vec3 col = s2l(vec3(float(t0.w & 255u), float((t0.w >> 8) & 255u), float((t0.w >> 16) & 255u)) / 255.0);
  uint flags = t0.w >> 24;
  vec2 h0 = unpackHalf2x16(t1.x);
  vec2 h1 = unpackHalf2x16(t1.y);
  vec2 h2 = unpackHalf2x16(t1.z);
  vec3 a1 = vec3(h0, h1.x);
  vec3 a2 = vec3(h1.y, h2);

  vec3 p = uRot * (X - uCam);
  if (p.z < 0.5) return;
  mat2 M2 = mat2(uM2.x, uM2.z, uM2.y, uM2.w);
  vec2 img = uF * p.xy / p.z;
  vec2 dev = M2 * img + 0.5 * uRes;

  // How much this splat lets go of the photograph: only outside the opening's
  // radius, while the picture first comes up. Everywhere else, edges included,
  // every splat keeps its shape and the photo lookup; the softness toward the
  // frame edge is a lens blur over the finished frame (BLUR_FS), not wider
  // splats.
  float rr = length(dev - 0.5 * uRes) / (0.5 * length(uRes));
  float soft = smoothstep(uSoft.x - 0.3, uSoft.x, rr);
  soft = clamp(soft + uSoft.y, 0.0, 1.0);
  float grow = 1.0 + 1.4 * soft * soft;

  // Crisp field from the fine cut; soft field from the coarse one (16 px
  // cells and up), cross-faded, so the splats at the edge are big enough to
  // read as splats.
  int level = int((flags >> 2) & 7u);
  bool leaf = ((flags >> 1) & 1u) == 1u;
  bool inCut = leaf ? level <= uCut : level == uCut;
  bool inCoarse = leaf ? level <= 4 : level == 4;
  float k = smoothstep(0.3, 0.62, soft);
  float wsel = (inCut ? 1.0 - k : 0.0) + (inCoarse ? k : 0.0);
  if (wsel < 0.004) return;

  // EWA: the Jacobian of the projection at p, applied to the splat's axes.
  vec3 nn = normalize(cross(a1, a2));
  vec3 b1 = uRot * a1;
  vec3 b2 = uRot * a2;
  vec3 b3 = uRot * nn * (0.06 * min(length(a1), length(a2)));
  float iz = 1.0 / p.z;
  vec2 j1 = M2 * (uF * iz * (b1.xy - p.xy * iz * b1.z)) * grow;
  vec2 j2 = M2 * (uF * iz * (b2.xy - p.xy * iz * b2.z)) * grow;
  vec2 j3 = M2 * (uF * iz * (b3.xy - p.xy * iz * b3.z)) * grow;
  mat2 S = outerProduct(j1, j1) + outerProduct(j2, j2) + outerProduct(j3, j3) + mat2(0.3);
  float a = S[0][0];
  float b = S[0][1];
  float c = S[1][1];
  float mid = 0.5 * (a + c);
  float rad = length(vec2(0.5 * (a - c), b));
  float l1 = mid + rad;
  float l2 = max(mid - rad, 0.1);
  vec2 v1 = abs(b) > 1e-6 ? normalize(vec2(b, l1 - a)) : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 v2 = vec2(-v1.y, v1.x);
  float ext = mix(1.9, 3.2, soft); // opaque cores overlap their neighbours long before 1.9 sigma
  float r1 = min(ext * sqrt(l1), 3000.0);
  float r2 = min(ext * sqrt(l2), 3000.0);
  vec2 off = aCorner.x * r1 * v1 + aCorner.y * r2 * v2;
  vOff = off;
  vConic = vec3(c, -b, a) / (a * c - b * b);
  vec2 pos = dev + off;
  gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0);
  // Let go, a splat is its own soft light: brighter, translucent.
  vCol = vec4(col * (1.0 + 0.3 * soft * soft), mix(2.6, 0.5, soft) * wsel);
  vTex = (flags & 1u) == 1u ? 1.0 - smoothstep(0.0, 0.6, soft) : 0.0;
  vPlane = vec4(nn, dot(nn, X));
  vTower = float((flags >> 5) & 1u);
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
in vec2 vOff;
flat in vec3 vConic;
flat in vec4 vCol;
flat in float vTex;
flat in vec4 vPlane;
flat in float vTower;
uniform sampler2D uPhoto;
uniform sampler2D uPlate; // the sky with no towers in it, same canvas (bake.py)
uniform sampler2D uDepth; // R8, nearest: log Z per photo texel, 254 and 255 = sky
uniform vec2 uDr;       // log(DEPTH_LO), log(DEPTH_HI / DEPTH_LO) / 254
uniform vec2 uTol;
uniform mat3 uRotT;     // view -> world
uniform vec3 uCam;
uniform float uF;
uniform vec2 uC;
uniform vec2 uSrc;       // the photograph's own frame, px
uniform vec2 uPad;       // the outpainted margin round it in the texture, px
uniform vec4 uM2inv;
uniform vec2 uRes;
uniform float uHeadroom;
out vec4 outColor;

// One photo texel against a tower fragment's own surface, at log depth lp.
// x: the texel is this surface (take the photo); y: something nearer stood in
// front of it in the photo (take the splat's own colour). Neither: the texel
// is further off, beyond this surface's edge, and the fragment lets go.
vec2 tapClass(ivec2 ij, ivec2 size, float lp) {
  if (any(lessThan(ij, ivec2(0))) || any(greaterThanEqual(ij, size))) return vec2(0.0, 1.0);
  float d = texelFetch(uDepth, ij, 0).r * 255.0;
  if (d > 253.5) return vec2(0.0); // sky, beyond this tower's edge
  float dz = uDr.x + d * uDr.y - lp;
  float same = 1.0 - smoothstep(uTol.x, uTol.y, abs(dz));
  return vec2(same, dz < 0.0 ? 1.0 - same : 0.0);
}

float isSky(ivec2 ij, ivec2 size) {
  if (any(lessThan(ij, ivec2(0))) || any(greaterThanEqual(ij, size))) return 0.0;
  return texelFetch(uDepth, ij, 0).r * 255.0 > 254.5 ? 1.0 : 0.0;
}

void main() {
  float pw = -0.5 * (vConic.x * vOff.x * vOff.x + 2.0 * vConic.y * vOff.x * vOff.y + vConic.z * vOff.y * vOff.y);
  float alpha = min(0.995, vCol.a * exp(pw));
  if (alpha < 1.0 / 255.0) discard;
  // The pixel's ray meets the splat's plane; the original camera says where
  // that point was in the photograph.
  vec2 dev = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5 * uRes;
  vec2 img = mat2(uM2inv.x, uM2inv.z, uM2inv.y, uM2inv.w) * dev;
  vec3 dir = uRotT * vec3(img / uF, 1.0);
  float den = dot(vPlane.xyz, dir);
  float t = (vPlane.w - dot(vPlane.xyz, uCam)) / (abs(den) > 1e-6 ? den : 1e-6);
  vec3 P = uCam + t * dir;
  vec3 c = vCol.rgb;
  if (vTex > 0.0) {
    // The texture runs uPad past the frame on every side (outpainted in the
    // bake), so a lookup the orbit carries past the frame still finds texels.
    vec2 uv = (uF * P.xy / max(P.z, 1e-3) + uC + uPad) / (uSrc + 2.0 * uPad);
    float keep = 0.0;
    vec3 look = vec3(0.0);
    if (vTower < 0.5 && t > 0.0 && P.z > 0.1) {
      // The dome never lets go and is never depth tested: where the photo
      // shows sky it takes the photo, and wherever a tower stood in front it
      // takes the sky plate, the sky the bake painted in behind the towers.
      ivec2 size = textureSize(uDepth, 0);
      vec2 tp = uv * vec2(size) - 0.5;
      ivec2 i0 = ivec2(floor(tp));
      vec2 f = tp - floor(tp);
      vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      vec4 sm = w * vec4(isSky(i0, size), isSky(i0 + ivec2(1, 0), size), isSky(i0 + ivec2(0, 1), size), isSky(i0 + ivec2(1, 1), size));
      float sky = sm.x + sm.y + sm.z + sm.w;
      vec3 pl = texture(uPlate, uv).rgb;
      vec3 ph = pl;
      if (sky > 0.999) {
        ph = texture(uPhoto, uv).rgb;
      } else if (sky > 0.0) {
        ivec2 cl = size - 1;
        ph = (sm.x * texelFetch(uPhoto, clamp(i0, ivec2(0), cl), 0).rgb
            + sm.y * texelFetch(uPhoto, clamp(i0 + ivec2(1, 0), ivec2(0), cl), 0).rgb
            + sm.z * texelFetch(uPhoto, clamp(i0 + ivec2(0, 1), ivec2(0), cl), 0).rgb
            + sm.w * texelFetch(uPhoto, clamp(i0 + ivec2(1, 1), ivec2(0), cl), 0).rgb) / sky;
      }
      look = mix(pl, ph, sky);
      keep = 1.0;
    } else if (t > 0.0 && P.z > 0.1) {
      // Depth test the lookup on the four texels around it, unfiltered, and
      // weigh them bilinearly so the cut is antialiased, not texel-stepped.
      ivec2 size = textureSize(uDepth, 0);
      vec2 tp = uv * vec2(size) - 0.5;
      ivec2 i0 = ivec2(floor(tp));
      vec2 f = tp - floor(tp);
      float lp = log(P.z);
      vec2 k00 = tapClass(i0, size, lp);
      vec2 k10 = tapClass(i0 + ivec2(1, 0), size, lp);
      vec2 k01 = tapClass(i0 + ivec2(0, 1), size, lp);
      vec2 k11 = tapClass(i0 + ivec2(1, 1), size, lp);
      vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      vec4 sm = w * vec4(k00.x, k10.x, k01.x, k11.x);
      float same = sm.x + sm.y + sm.z + sm.w;
      float own = dot(w, vec4(k00.y, k10.y, k01.y, k11.y));
      vec3 ph;
      if (same > 0.999) {
        ph = texture(uPhoto, uv).rgb; // all its own surface: filtered, mipmapped
      } else {
        // on a silhouette: only the texels that are this surface
        ivec2 cl = size - 1;
        ph = sm.x * texelFetch(uPhoto, clamp(i0, ivec2(0), cl), 0).rgb
           + sm.y * texelFetch(uPhoto, clamp(i0 + ivec2(1, 0), ivec2(0), cl), 0).rgb
           + sm.z * texelFetch(uPhoto, clamp(i0 + ivec2(0, 1), ivec2(0), cl), 0).rgb
           + sm.w * texelFetch(uPhoto, clamp(i0 + ivec2(1, 1), ivec2(0), cl), 0).rgb;
        ph /= max(same, 1e-4);
      }
      keep = same + own;
      look = (ph * same + vCol.rgb * own) / max(keep, 1e-4);
    }
    alpha *= mix(1.0, keep, vTex);
    if (alpha < 1.0 / 255.0) discard;
    c = mix(vCol.rgb, look, vTex);
  }
  float m = max(c.r, max(c.g, c.b));
  float e = smoothstep(0.55, 1.0, m);
  c *= 1.0 + uHeadroom * e * e;
  outColor = vec4(c * alpha, alpha);
}`;

// The lens: one isotropic Gaussian over the finished frame whose sigma grows
// with the square of the distance from the centre (field curvature, and the
// diffusion a fast lens shows wide open), so the edges go soft the same way
// in every direction and the middle is untouched. Gaussians are the one
// isotropic kernel that separates, so it runs as two passes, horizontal then
// vertical, each with the sigma of its own pixel; sigma changes slowly enough
// across the frame that the two compose to a round blur, with no seam.
const BLUR_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uIn;
uniform vec2 uRes;
uniform vec2 uDir;      // (1, 0) or (0, 1)
uniform float uK;       // sigma in the corners, device px
out vec4 outColor;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 d = fc - 0.5 * uRes;
  vec2 hd = 0.5 * uRes;
  float sigma = uK * dot(d, d) / dot(hd, hd);
  ivec2 ij = ivec2(fc);
  vec4 acc = texelFetch(uIn, ij, 0);
  if (sigma < 0.3) {
    outColor = acc;
    return;
  }
  // 2.5 sigma each side in at most 16 taps; past 6.4 px of sigma the taps
  // spread out and the bilinear fetch prefilters between them
  float st = max(1.0, sigma * 2.5 / 16.0);
  int n = int(ceil(sigma * 2.5 / st));
  float k = -0.5 / (sigma * sigma);
  float wsum = 1.0;
  for (int i = 1; i <= 16; i++) {
    if (i > n) break;
    float x = float(i) * st;
    float w = exp(k * x * x);
    acc += w * (texture(uIn, (fc + uDir * x) / uRes) + texture(uIn, (fc - uDir * x) / uRes));
    wsum += 2.0 * w;
  }
  outColor = acc / wsum;
}`;
// sigma in the corners as a share of the frame's height, at rest, and how much
// more a full swing of the camera opens it
const BLUR_CORNER = 0.004;
const BLUR_SWING = 0.0028;

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

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
    gl.deleteShader(s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// float32 -> float16 bits
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >> (1 - e);
    return sign | ((m + 0x1000) >> 13);
  }
  if (e >= 31) return sign | 0x7bff;
  const h = sign | (e << 10) | ((m + 0x1000) >> 13);
  return h;
}
const half2 = (a, b) => (toHalf(a) | (toHalf(b) << 16)) >>> 0;

// Decode the quantised bake into GPU texels and worker positions.
function decode(buf) {
  const dv = new DataView(buf);
  // SPT2 adds the texture's outpainted margin (x, y) to SPT1's header.
  const magic = dv.getUint32(0, true);
  if (magic !== 0x31545053 && magic !== 0x32545053) throw new Error("splats.bin: bad magic");
  const nh = magic === 0x32545053 ? 10 : 8;
  const N = dv.getUint32(4, true);
  const h = new Float32Array(buf.slice(8, 8 + 4 * nh));
  const [W, H, F, CX, CY, M, ZMIN, ZMAX, PX = 0, PY = 0] = h;
  let o = 8 + 4 * nh;
  const qu = new Uint16Array(buf, o, N);
  o += 2 * N;
  const qv = new Uint16Array(buf, o, N);
  o += 2 * N;
  const qz = new Uint16Array(buf, o, N);
  o += 2 * N;
  const qn = new Int8Array(buf, o, 2 * N);
  o += 2 * N;
  const qs1 = new Uint8Array(buf, o, N);
  o += N;
  const qs2 = new Uint8Array(buf, o, N);
  o += N;
  const qa = new Uint8Array(buf, o, N);
  o += N;
  const rgb = new Uint8Array(buf, o, 3 * N);
  o += 3 * N;
  const flags = new Uint8Array(buf, o, N);

  const rows = Math.ceil((2 * N) / DATA_W);
  const texels = new Uint32Array(DATA_W * rows * 4);
  const tf = new Float32Array(texels.buffer);
  const pos = new Float32Array(3 * N);
  const lz = Math.log(ZMAX / ZMIN);
  const n = [0, 0, 0];
  const plane = (px, py, nd, out) => {
    const rx = (px - CX) / F;
    const ry = (py - CY) / F;
    const den = n[0] * rx + n[1] * ry + n[2];
    const t = nd / den;
    out[0] = t * rx;
    out[1] = t * ry;
    out[2] = t;
    return den;
  };
  const P = [0, 0, 0];
  const Q = [0, 0, 0];
  const axis = (u, v, Z, nd, ex, ey, den0, out) => {
    const d1 = plane(u + ex, v + ey, nd, P);
    const d2 = plane(u - ex, v - ey, nd, Q);
    let ax = (P[0] - Q[0]) / 2;
    let ay = (P[1] - Q[1]) / 2;
    let az = (P[2] - Q[2]) / 2;
    const flat = (Math.hypot(ex, ey) * Z) / F;
    const len = Math.hypot(ax, ay, az);
    // Past grazing (or through the horizon of the plane): lay it flat.
    if (!(d1 * den0 > 0 && d2 * den0 > 0) || !(len < flat * 10)) {
      ax = (ex * Z) / F;
      ay = (ey * Z) / F;
      az = 0;
    }
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
  };
  const a1 = [0, 0, 0];
  const a2 = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const u = qu[i] / 8 - M;
    const v = qv[i] / 8 - M;
    const Z = ZMIN * Math.exp((qz[i] / 65535) * lz);
    const X = ((u - CX) / F) * Z;
    const Y = ((v - CY) / F) * Z;
    // octahedral normal
    let nx = qn[2 * i] / 127;
    let ny = qn[2 * i + 1] / 127;
    let nz = 1 - Math.abs(nx) - Math.abs(ny);
    if (nz < 0) {
      const ox = nx;
      nx = (1 - Math.abs(ny)) * Math.sign(ox || 1);
      ny = (1 - Math.abs(ox)) * Math.sign(ny || 1);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    n[0] = nx / nl;
    n[1] = ny / nl;
    n[2] = nz / nl;
    const nd = n[0] * X + n[1] * Y + n[2] * Z;
    const den0 = n[0] * ((u - CX) / F) + n[1] * ((v - CY) / F) + n[2];
    const s1 = 2 ** (qs1[i] / 20 - 2);
    const s2 = 2 ** (qs2[i] / 20 - 2);
    const ang = (qa[i] / 256) * Math.PI;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    axis(u, v, Z, nd, ca * s1, sa * s1, den0, a1);
    axis(u, v, Z, nd, -sa * s2, ca * s2, den0, a2);
    const t = i * 8;
    tf[t] = X;
    tf[t + 1] = Y;
    tf[t + 2] = Z;
    texels[t + 3] = (rgb[3 * i] | (rgb[3 * i + 1] << 8) | (rgb[3 * i + 2] << 16) | (flags[i] << 24)) >>> 0;
    texels[t + 4] = half2(a1[0], a1[1]);
    texels[t + 5] = half2(a1[2], a2[0]);
    texels[t + 6] = half2(a2[1], a2[2]);
    texels[t + 7] = 0;
    pos[3 * i] = X;
    pos[3 * i + 1] = Y;
    pos[3 * i + 2] = Z;
  }
  return { N, W, H, F, CX, CY, PX, PY, ZMIN, ZMAX, rows, texels, pos, flags: flags.slice() };
}

// A damped spring on one value.
function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

// R = Ry(yaw) Rx(pitch), row major. World: x right, y down, z up the lens.
function rotation(yawDeg, pitchDeg) {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  // Ry * Rx
  return [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
}

export async function createSplatTowers(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qYaw = num("yaw");
  const qPitch = num("pitch");
  const qReveal = num("reveal");
  const held = qYaw != null || qPitch != null || qReveal != null;
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) {
    const v = num(key);
    if (typeof FILM[key] === "number" && v != null) film0[key] = v;
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // The colour field the picture opens from.
  host.style.background = "#dfe8ef";

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  const loadBitmap = (name) =>
    fetch(`${ASSET}${name}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${name} ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }));
  const [buf, bitmap, depthBitmap, plateBitmap] = await Promise.all([
    fetch(`${ASSET}splats.bin`).then((r) => {
      if (!r.ok) throw new Error(`splats.bin ${r.status}`);
      return r.arrayBuffer();
    }),
    loadBitmap("photo.webp"),
    loadBitmap("depth.png"),
    loadBitmap("plate.webp"),
  ]);
  const D = decode(buf);

  // ---- textures
  const dataTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dataTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, DATA_W, D.rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, D.texels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const photo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photo);
  const levels = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, bitmap.width, bitmap.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  bitmap.close?.();
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

  // The sky plate: the dome's sky behind the towers, filtered like the photo.
  const plate = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, plate);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(plateBitmap.width, plateBitmap.height))) + 1, gl.SRGB8_ALPHA8, plateBitmap.width, plateBitmap.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, plateBitmap);
  plateBitmap.close?.();
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // The depth map: read texel by texel, never filtered across a silhouette.
  const depthTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, depthBitmap.width, depthBitmap.height);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RED, gl.UNSIGNED_BYTE, depthBitmap);
  depthBitmap.close?.();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // ---- geometry: one quad, instanced per splat index
  const prog = compile(gl, SPLAT_VS, SPLAT_FS);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const order = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, order);
  gl.bufferData(gl.ARRAY_BUFFER, D.N * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);

  // ---- the sort worker
  const worker = new Worker(new URL("./sortWorker.js", import.meta.url), { type: "module" });
  worker.postMessage({ type: "init", pos: D.pos, meta: D.flags });
  let drawCount = 0;
  let sortBusy = false;
  let sortWanted = null;
  let sortId = 0;
  let resolveFirst;
  const firstSort = new Promise((r) => (resolveFirst = r));
  worker.onmessage = (e) => {
    const { order: ord, count } = e.data;
    gl.bindBuffer(gl.ARRAY_BUFFER, order);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ord, 0, count);
    drawCount = count;
    sortBusy = false;
    dirty = true;
    resolveFirst?.();
    resolveFirst = null;
    if (sortWanted) {
      const w = sortWanted;
      sortWanted = null;
      requestSort(w);
    }
  };
  function requestSort(cam) {
    if (sortBusy) {
      sortWanted = cam;
      return;
    }
    sortBusy = true;
    worker.postMessage({ type: "sort", cam: cam.C, fwd: cam.fwd, cut: cam.cut, id: ++sortId });
  }

  // ---- scene target, the lens's two blur targets, film
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const blurProg = compile(gl, BLUR_VS, BLUR_FS);
  const tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const triVao = gl.createVertexArray();
  gl.bindVertexArray(triVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let tex = null;
  let fbo = null;
  let blurA = null;
  let blurB = null;
  let dirty = true;
  const target = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    }
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fbo: f };
  };
  const drop = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    if (tex) gl.deleteTexture(tex);
    if (fbo) gl.deleteFramebuffer(fbo);
    drop(blurA);
    drop(blurB);
    ({ tex, fbo } = target(w, h));
    blurA = target(w, h);
    blurB = target(w, h);
    film.resize(w, h);
    dirty = true;
  };
  stage.onResize(build);

  // Looking straight up there is no "up": a landscape box turns the
  // photograph a quarter turn so it fills the window.
  const view = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    const turn = w > h * 1.02;
    const sw = turn ? D.H : D.W;
    const sh = turn ? D.W : D.H;
    const s = Math.max(w / sw, h / sh) * OVERZOOM;
    // device = M * image offset; a quarter turn sends the photo's top to the right
    const m = turn ? [0, -s, s, 0] : [s, 0, 0, s];
    const det = m[0] * m[3] - m[1] * m[2];
    const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
    return { m, inv, turn, s };
  };

  const camera = (yawDeg, pitchDeg) => {
    const R = rotation(yawDeg, pitchDeg);
    const fwd = [R[2], R[5], R[8]];
    const C = [-PIVOT * fwd[0], -PIVOT * fwd[1], PIVOT - PIVOT * fwd[2]];
    return { R, fwd, C };
  };

  const uploadMat3 = (loc, R, transpose) => {
    // GL wants column major. R is row major: as-is it is R^T in GL's eyes.
    const a = transpose ? R : [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
    gl.uniformMatrix3fv(loc, false, a);
  };

  const renderSplats = (cam, soft) => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    const V = view();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.16, 0.33, 0.47, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog.p);
    const u = prog.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dataTex);
    gl.uniform1i(u.uData, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, photo);
    gl.uniform1i(u.uPhoto, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.uniform1i(u.uDepth, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(u.uPlate, 3);
    gl.uniform2f(u.uDr, Math.log(DEPTH_LO), Math.log(DEPTH_HI / DEPTH_LO) / 254);
    gl.uniform2f(u.uTol, DEPTH_TOL[0], DEPTH_TOL[1]);
    // world -> view is R^T: R row major read as column major is exactly R^T.
    uploadMat3(u.uRot, cam.R, true);
    uploadMat3(u.uRotT, cam.R, false);
    gl.uniform3fv(u.uCam, cam.C);
    gl.uniform1f(u.uF, D.F);
    gl.uniform2f(u.uC, D.CX, D.CY);
    gl.uniform2f(u.uSrc, D.W, D.H);
    gl.uniform2f(u.uPad, D.PX, D.PY);
    gl.uniform4fv(u.uM2, V.m);
    gl.uniform4fv(u.uM2inv, V.inv);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform2fv(u.uSoft, soft);
    gl.uniform1i(u.uCut, cut);
    gl.uniform1f(u.uHeadroom, HEADROOM);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, drawCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  };

  // The lens over the composited frame: scene -> A (horizontal) -> B (vertical).
  const renderLens = (corner) => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.useProgram(blurProg.p);
    gl.bindVertexArray(triVao);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blurProg.u.uIn, 0);
    gl.uniform2f(blurProg.u.uRes, w, h);
    gl.uniform1f(blurProg.u.uK, corner);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.fbo);
    gl.uniform2f(blurProg.u.uDir, 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, blurA.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.fbo);
    gl.uniform2f(blurProg.u.uDir, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  // ---- state
  const yaw = spring(qYaw ?? 0);
  const pitch = spring(qPitch ?? 0);
  const hover = { x: 0, y: 0 };
  const orient = { b: null, g: null, x: 0, y: 0 };
  let grab = null;
  let born = performance.now();
  let breathe = 0;
  let lastKey = "";
  let lastGrain = -1;
  let cut = coarse ? 5 : 6;
  let slow = 0;
  let lastSortCam = null;

  stage.on("down", (p) => {
    // Take over from the hover lean where it is, so the grab does not jump.
    yaw.x += hover.x;
    pitch.x += hover.y;
    hover.x = 0;
    hover.y = 0;
    grab = { x: p.x, y: p.y, y0: yaw.x, p0: pitch.x };
    yaw.to = yaw.x;
    pitch.to = pitch.x;
    requestOrientation();
  });
  stage.on("up", (p) => {
    if (!grab) return;
    grab = null;
    // Let go: the camera swings home, carrying the hand's speed into the spring.
    const V = view();
    const [ix, iy] = toImage(V, p.vx, p.vy);
    yaw.v = ix * DEG_PER_PX * 0.9;
    pitch.v = -iy * DEG_PER_PX * 0.9;
    yaw.to = 0;
    pitch.to = 0;
  });
  // screen (css px) -> image-space direction
  const toImage = (V, dx, dy) => {
    const r = V.turn ? [dy, -dx] : [dx, dy];
    return r;
  };

  const onOrient = (e) => {
    if (e.beta == null) return;
    if (orient.b == null) {
      orient.b = e.beta;
      orient.g = e.gamma;
    }
    orient.x = clamp((e.gamma - orient.g) * 0.15, -2, 2);
    orient.y = clamp((e.beta - orient.b) * 0.15, -2, 2);
  };
  let orientOn = false;
  function requestOrientation() {
    if (orientOn || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!coarse) return;
    orientOn = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  const band = (lim, x) => (Math.abs(x) <= lim ? x : Math.sign(x) * (lim + (Math.abs(x) - lim) * 0.35));

  const frame = (dt, t) => {
    const now = performance.now();
    const p = stage.pointer;
    const age = (now - born) / 1000;
    const V = view();

    if (grab) {
      const [ix, iy] = toImage(V, p.x - grab.x, p.y - grab.y);
      // The rubber band acts on the swing's radius, so a diagonal drag stops
      // at the same MAX_DEG as a straight one.
      const ty = grab.y0 + ix * DEG_PER_PX;
      const tp = grab.p0 - iy * DEG_PER_PX;
      const r = Math.hypot(ty, tp);
      const k = r > 0 ? band(MAX_DEG, r) / r : 1;
      yaw.to = ty * k;
      pitch.to = tp * k;
      stepSpring(yaw, 40, 1, dt);
      stepSpring(pitch, 40, 1, dt);
    } else if (!held) {
      stepSpring(yaw, 9, 0.85, dt);
      stepSpring(pitch, 9, 0.85, dt);
    }

    // Hover: the field leans a degree toward the pointer.
    let hx = 0;
    let hy = 0;
    if (!grab && p.inside && !reduced && !held) {
      const [ix, iy] = toImage(V, p.x / stage.width - 0.5, p.y / stage.height - 0.5);
      hx = ix * 2.2;
      hy = -iy * 2.2;
    }
    hover.x = damp(hover.x, hx + orient.x, 1 / 0.35, dt);
    hover.y = damp(hover.y, hy - orient.y, 1 / 0.35, dt);

    // Breathing: the camera drifts half a degree once the hand is away.
    const idle = !grab && !held && !reduced && stage.idleFor() > 1500;
    breathe = damp(breathe, idle ? 1 : 0, 0.8, dt);
    const by = breathe * 0.6 * Math.sin((t * 2 * Math.PI) / 11.3);
    const bp = breathe * 0.45 * Math.sin((t * 2 * Math.PI) / 13.7 + 1.2);

    const yd = yaw.x + hover.x + by;
    const pd = pitch.x + hover.y + bp;
    const cam = camera(yd, pd);

    // The lens softens the edges; they breathe, and go softer the further
    // the camera swings.
    const swing = Math.min(1, Math.hypot(yd, pd) / SOFT_DEG);
    const reveal = qReveal != null ? qReveal : held || reduced ? 1 : expoOut(clamp((age - 0.25) / 2.6, 0, 1));
    const lens = stage.canvas.height * (BLUR_CORNER * (1 + 0.12 * breathe * Math.sin((t * 2 * Math.PI) / 9.1)) + BLUR_SWING * swing * swing);
    const soft = [0.3 + reveal * 1.25, 0];

    // Keep the order fresh as the camera moves.
    const sk = `${cam.C.map((v) => v.toFixed(2)).join(",")}|${cut}`;
    if (sk !== lastSortCam) {
      lastSortCam = sk;
      requestSort({ ...cam, cut });
    }

    const key = `${yd.toFixed(4)}|${pd.toFixed(4)}|${soft.map((v) => v.toFixed(4)).join(",")}|${lens.toFixed(2)}`;
    let drew = false;
    if (key !== lastKey || dirty) {
      const t0 = performance.now();
      renderSplats(cam, soft);
      renderLens(lens);
      lastKey = key;
      dirty = false;
      drew = true;
      // Adaptive count: if frames run long while moving, stop a level early.
      slow = damp(slow, dt > 1 / 36 ? 1 : 0, 2, dt);
      if (slow > 0.8 && cut > 4 && !held) {
        cut -= 1;
        slow = 0;
      }
      void t0;
    }
    const exposure = film0.exposure + (held ? 0 : 1.6 * (1 - reveal));
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (drew || tick !== lastGrain) {
      film.render(blurB.tex, { ...film0, exposure, grainSeed: tick * 7.31 });
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  // First order, then one full frame before the reveal.
  await new Promise((r) => requestAnimationFrame(() => r()));
  if (!tex) build();
  const c0 = camera(yaw.x, pitch.x);
  requestSort({ ...c0, cut });
  lastSortCam = `${c0.C.map((v) => v.toFixed(2)).join(",")}|${cut}`;
  await firstSort;
  frame(1 / 60, performance.now() / 1000);
  born = performance.now();
  void embedded;

  return {
    destroy() {
      worker.terminate();
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      drop(blurA);
      drop(blurB);
      gl.deleteBuffer(tri);
      gl.deleteVertexArray(triVao);
      gl.deleteProgram(blurProg.p);
      gl.deleteTexture(dataTex);
      gl.deleteTexture(photo);
      gl.deleteTexture(depthTex);
      gl.deleteTexture(plate);
      gl.deleteBuffer(corners);
      gl.deleteBuffer(order);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog.p);
      stage.destroy();
    },
  };
}
