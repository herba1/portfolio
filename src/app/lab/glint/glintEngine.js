import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import META from "./meta.json";

// Glint: the pointer is the sun, over a worm's-eye photograph of glass towers.
//
// The bake (tools/depth/bakes/glint) reads Davi Rezende's photograph as what it
// is made of:
//  - the camera: the vertical vanishing point and a 14 mm-equivalent focal
//    length, both measured from the towers' own straight lines;
//  - every visible face as a plane: its normal from the face's horizontal
//    lines, squared up until its floors come out level when the face is
//    rectified onto its own plane;
//  - the curtain-wall grid of each face, measured in that rectified frame:
//    glass vs frame, and every pane a slightly different mirror (a random
//    tilt and an air-pillowed bow);
//  - diffuse albedo for frames and walls (the photo divided by its own sky
//    and sun light), roughness, a sky matte and cloud density;
//  - the sky dome: the photograph unprojected onto a stereographic disc
//    round the zenith, so a wall reflects the real clouds and towers on the
//    other side of the street.
//
// Live, per pixel: the wall's diffuse light turns with the sun (Lambert sun +
// skylight, the same law the albedo was divided by); glass reflects the sun
// through its own pane's normal with Fresnel, as a sharp mirror image plus two
// lobes over the pane normals: a pillow lobe (a pane's bow sweeps it across
// the pane) and a run, longer up the tower than across, so a curtain wall
// facing the sun lights a streak of neighbouring panes, each a moment apart.
// That light is HDR and goes to the film unclipped: only light above an HDR
// threshold is diffused (and haloed), so the glint blooms while mullions,
// roof edges and cloud margins keep the scan's sharpness. The sky round the sun (the aureole) and
// the sunward edges of the cumulus brighten with it, in the sky itself and in
// every reflection of it. The cumulus seen directly is relit from the
// photograph's own reading of it (density and thickness, from how white and
// how grey it is inside the sky matte): forward scattering (Henyey-Greenstein,
// g = 0.7) gives the thin margins near the sun a warm silver lining and turns
// the thick cores in front of it dark, and the edges facing the sun are the
// lit ones, so the whole cumulus reorganises round wherever the sun is put.
// Where the sun is in open sky it has a small blown
// core and veiling glare, and each wall's mirror image of it veils the glass
// round it, a tenth as bright; behind a tower the sun is hidden by the tower.
// Everything but the sun and its glints is held inside the film's shoulder by
// a gain judged on the light's smooth level, so the cumulus round an open sun
// keeps its modelling, and inside the cloud a local contrast and a split tone
// (skylight-blue shadows, warm-white tops) develop it as a volume. At the
// photographer's sun the frame hands back to the
// photograph's own pixels. Developed through the shared film kit (summer).
//
// Query (also ?debug=4/5 show the cloud field and its gain): ?sun=x,y holds the sun at that point of the print (0..1, y down);
// ?sun=photo holds it at the photographer's sun; ?still=1 skips the reveal
// and the idle drift; ?film=0 shows the frame before the film.

const BASE = "/lab/glint/";
const [PW, PH] = META.plate;
const F = META.f;
const [CX, CY] = META.c;
const UP = META.up;
const SUN0 = META.sun0;
const NF = META.faces.length;
const LUMA = [0.2126, 0.7152, 0.0722];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// plate pixel -> camera-space direction (x right, y down, z forward)
const dirOf = (px, py) => norm([(px - CX) / F, (py - CY) / F, 1]);
const pxOf = (d) => [CX + (F * d[0]) / d[2], CY + (F * d[1]) / d[2]];
const SUN0_PX = pxOf(SUN0);

// Face table: normals and how glassy each kind of wall is at normal incidence.
const F0 = { glass: 0.07, punched: 0.05, stone: 0.04 };
const FACE_N = new Float32Array(NF * 3);
const FACE_K = new Float32Array(NF * 2);
META.faces.forEach((fc, i) => {
  FACE_N.set(fc.normal, i * 3);
  // dark bronze glass of the 1960s tower reflects more than clear glass
  const f0 = fc.name.startsWith("dark") ? 0.1 : F0[fc.kind] ?? 0.05;
  FACE_K.set([f0, fc.cyl ? 1 : 0], i * 2);
});
// Mean diffuse light over the walls, for the photographer-style exposure.
const AREA_W = META.faces.map((fc) => (fc.kind === "glass" ? 0.4 : 1));
// The most light any big wall gets: a photographer exposes so the brightest
// sunlit stone still holds.
const BIG = META.faces.map((fc) => !["octagon-a", "octagon-c", "round", "dark-side", "brown-side", "tower-a"].includes(fc.name));
const peakLight = (s) => {
  let m = 1;
  META.faces.forEach((fc, i) => {
    if (BIG[i]) m = Math.max(m, 0.9 + 5 * Math.max(0, dot3(fc.normal, s)));
  });
  return m;
};
const meanLight = (s) => {
  let a = 0;
  let w = 0;
  META.faces.forEach((fc, i) => {
    a += AREA_W[i] * (1 + 5 * Math.max(0, dot3(fc.normal, s)));
    w += AREA_W[i];
  });
  return a / w;
};

// ---- the cumulus, read off the photograph for the sun to light
// At a quarter of the plate: where there is cloud (white against the blue:
// red over blue, inside the sky matte) and how thick it is there. Thickness
// is how deep a pixel sits inside its cloud (cloud density blurred over ~80
// plate px) and how grey the photograph has it (a cumulus core is grey
// because little light gets through it; a thin margin is white). Towers are
// not counted as "no cloud" (every blur is normalised by the sky), so a
// tower's silhouette never reads as a cloud edge.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const s2lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// separable box blur of v weighted by w, repeated (3 passes ~ a gaussian)
function blurW(v, w, W, H, r, passes) {
  let a = Float32Array.from(v, (x, i) => x * w[i]);
  let b = Float32Array.from(w);
  const tmp = new Float32Array(W * H);
  const pass = (src) => {
    for (let y = 0; y < H; y++) {
      let s = 0;
      const o = y * W;
      for (let x = -r; x <= r; x++) s += src[o + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = s;
        s += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
    const out = new Float32Array(W * H);
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = s;
        s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
      }
    }
    return out;
  };
  for (let p = 0; p < passes; p++) {
    a = pass(a);
    b = pass(b);
  }
  return a.map((x, i) => (b[i] > 1e-6 ? x / b[i] : 0));
}
function cloudField(photoImg, geoPx, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(photoImg, 0, 0, W, H);
  const px = x.getImageData(0, 0, W, H).data;
  const N = W * H;
  const sky = new Float32Array(N);
  const dens = new Float32Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = s2lin(px[i * 4] / 255);
    const g = s2lin(px[i * 4 + 1] / 255);
    const b = s2lin(px[i * 4 + 2] / 255);
    sky[i] = smooth(0.3, 0.7, geoPx[i * 4 + 2] / 255);
    dens[i] = smooth(0.4, 0.82, r / (b + 1e-4));
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const d1 = blurW(dens, sky, W, H, 1, 2);
  const deep = blurW(dens, sky, W, H, 7, 3);
  const dm = Float32Array.from(dens, (d, i) => d * sky[i]);
  const lc = blurW(lum, dm, W, H, 2, 2);
  const thick0 = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const grey = 1 - smooth(0.36, 0.8, lc[i]);
    thick0[i] = Math.min(1, 0.5 * smooth(0.35, 1, deep[i]) + 0.5 * grey) * smooth(0.15, 0.6, d1[i]);
  }
  const thick = blurW(thick0, sky, W, H, 1, 2);
  const mid = blurW(dens, sky, W, H, 4, 2);
  // the sky's own smooth level (towers left out), to tell a bright puff
  // from its surround without a tower's dark edge reading as one
  const ls = blurW(lum, sky, W, H, 2, 1);
  // the cloud's own level a long way round (~30 plate px, gaussian), for the
  // unsharp mask that gives each puff back its modelling: the towers are
  // left out, so a tower's silhouette never rings into the cloud
  const lw = blurW(lum, sky, W, H, 7, 3);
  const out = new Uint8Array(N * 4);
  const wide = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = Math.round(d1[i] * 255);
    out[i * 4 + 1] = Math.round(thick[i] * 255);
    out[i * 4 + 2] = Math.round(mid[i] * 255);
    out[i * 4 + 3] = Math.round(Math.sqrt(Math.min(1, ls[i])) * 255);
    wide[i * 4] = Math.round(Math.sqrt(Math.min(1, lw[i])) * 255);
    wide[i * 4 + 3] = 255;
  }
  return { out, wide };
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto;
uniform sampler2D uAlb;
uniform sampler2D uGeo;
uniform sampler2D uMat;
uniform sampler2D uEnv;
uniform sampler2D uEnvM;
uniform sampler2D uPatch;
uniform sampler2D uCloud; // quarter plate: density, thickness, density over ~16 px, sqrt sky level
uniform sampler2D uCloudW; // quarter plate: sqrt sky level over ~30 px (r)
uniform vec2 uPlate;
uniform float uF;
uniform vec2 uC;
uniform vec3 uUp;
uniform vec3 uEX;
uniform vec3 uEZ;
uniform vec3 uS;      // sun now
uniform vec3 uS0;     // photographer's sun
uniform float uPhotoW; // 1 at the photographer's sun
uniform vec4 uPatchR; // x, y, w, h (plate px)
uniform vec3 uFaceN[${NF}];
uniform vec2 uFaceK[${NF}];
uniform float uExpo;
uniform float uSunL;
uniform float uDebug;
uniform vec3 uGlintD[2]; // where the sun's mirror image sits in the two brightest walls
uniform float uGlintK[2]; // and how bright it is there, in suns

const vec3 LUMA_C = vec3(0.2126, 0.7152, 0.0722);
const float SUN_R = 0.0047;   // angular radius of the sun, rad
const vec3 SKY_C = vec3(0.80, 0.90, 1.08); // skylight on a wall: blue
const vec3 SUN_C = vec3(1.0, 0.93, 0.82);  // the sun: warm
// the cumulus's split tone, as linear colours of unit luma: the shadows
// skylight blue (sRGB 125/142/155: hue 205, 19% saturated), the tops the
// sun's warm white (sRGB 255/248/236)
const vec3 CLOUD_SH = vec3(0.76, 1.04, 1.32);
const vec3 CLOUD_TOP = vec3(1.07, 0.99, 0.86);
const float SPLIT_SH = 1.0;
const float SPLIT_TOP = 1.0;
const float USM_K = 0.28; // local contrast: +28% in log light
// Radiance of the sky round the sun, in units of the clear sky, against the
// angle from it: the solar aureole (forward scattering by haze and droplets)
// is tens of times the sky a few degrees out and falls off fast.
float aureole(float g) {
  return 26.0 * exp(-g / 0.018) + 5.0 * exp(-g / 0.07) + 0.9 * exp(-g / 0.3);
}

vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// the dome: stereographic round up, on the street grid's two horizontals
vec2 envUv(vec3 d) {
  float y = dot(d, uUp);
  vec2 q = vec2(dot(d, uEX), dot(d, uEZ)) / (1.0 + max(y, 0.0));
  return q * 0.5 + 0.5;
}

// Sky light that follows the sun: the aureole (forward scattering by haze,
// steep near the disc) and the cumulus, whose sunward edges catch the light
// and whose thin margins glow when the sun is behind them.
float skyGain(vec3 d, vec3 s) {
  float g = acos(clamp(dot(d, s), -1.0, 1.0));
  vec2 uv = envUv(d);
  vec4 m = texture(uEnvM, uv);
  float c = m.g;
  // density a little way toward the sun, in the dome's own plane
  vec2 to = envUv(normalize(d + (s - d) * 0.06)) - uv;
  float lt = length(to);
  vec2 dir = lt > 1e-6 ? to / lt : vec2(0.0);
  // compare smoothed density (a few texels), so a contrail or a wisp does
  // not turn into a drawn line
  float cs = textureLod(uEnvM, uv, 2.5).g;
  float c2 = textureLod(uEnvM, uv + dir * 0.008, 2.5).g;
  float edge = clamp(cs - c2, -0.5, 0.5);
  float aure = 1.4 * exp(-g / 0.05) + 0.42 * exp(-g / 0.3);
  float lining = 2.2 * c * (1.0 - c) * exp(-g / 0.18);
  return 1.0 + aure * (1.0 - 0.5 * c) + 0.55 * edge * c + lining;
}

// Veiling glare round a visible sun: a tight core (a few disc radii), then
// a short, faint skirt. Kept compact so the sun reads as a point of fire with
// the cloud round it still modelled, not as a white wash.
float veilOf(float gs) {
  return 7.0 * exp(-gs / 0.007) + 0.3 * exp(-gs / 0.03) + 0.1 * exp(-gs / 0.14) + 0.04 * exp(-gs / 0.5);
}

// Henyey-Greenstein, normalised to 1 straight at the sun.
float hgN(float cosT, float g) {
  float g2 = g * g;
  float p = (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * cosT, 1.5);
  return p * (1.0 - g) * (1.0 - g) / (1.0 + g);
}

// The cumulus seen directly, lit by a sun in direction s. Water droplets
// scatter forward (HG, g = 0.7): looking toward the sun, a thin margin glows
// with the sun's own light (the silver lining) while a thick core, which the
// light cannot get through, goes darker. Off to the side, the edge that faces
// the sun is the lit one. Returns the gain on the photograph's cloud (x), the
// warm light the margins add (y), and the forward lobe (z).
vec3 cloudLight(vec3 v, vec2 px, vec4 cl, vec3 s) {
  float c = cl.r;
  float th = cl.g;
  float cosT = dot(v, s);
  float fwd = hgN(cosT, 0.7);
  float side = hgN(cosT, 0.3);
  // which way the sun is from here, on the print: the great circle toward s,
  // projected through the camera
  vec3 td = s - v * cosT;
  vec2 dp = (td.xy - v.xy * td.z / v.z) / v.z;
  float ld = length(dp);
  vec2 dir = ld > 1e-6 ? dp / ld : vec2(0.0);
  // density here against density a little toward the sun: > 0 on the
  // sunward edge of a cloud, < 0 on the far side of one
  float ahead = textureLod(uCloud, (px + dir * 26.0) / uPlate, 0.0).b;
  float behind = textureLod(uCloud, (px - dir * 26.0) / uPlate, 0.0).b;
  float e = clamp((behind - ahead) * 1.6, -1.0, 1.0);
  float thin = c * (1.0 - th);
  float gain = (1.0 + 0.55 * e * c * (0.35 + 0.65 * side)) * (1.0 - 0.72 * c * smoothstep(0.1, 0.8, th) * pow(fwd, 0.5));
  float lining = fwd * thin * (1.0 - th) * (0.6 + 0.8 * max(e, 0.0));
  return vec3(gain, lining, fwd);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uPlate;
  vec2 t = px / uPlate;
  vec3 v = normalize(vec3((px - uC) / uF, 1.0));

  vec3 photo = texture(uPhoto, t).rgb;
  // the photographer's glare, cut out once the sun moves off
  vec2 pq = (px - uPatchR.xy) / uPatchR.zw;
  if (all(greaterThanEqual(pq, vec2(0.0))) && all(lessThan(pq, vec2(1.0)))) {
    vec2 pt = vec2(pq.x * 0.5, pq.y);
    vec3 fill = texture(uPatch, pt).rgb;
    float pm = texture(uPatch, pt + vec2(0.5, 0.0)).r;
    photo = mix(photo, fill, pm * (1.0 - uPhotoW));
  }
  vec3 base = s2l(photo);

  vec4 geo = texture(uGeo, t);
  int id = int(geo.r * 255.0 + 0.5);
  float rough = geo.g;
  float skyM = geo.b;
  vec4 mt = texture(uMat, t);
  float glass = mt.b;

  // ---- sky: the photograph, relit by where the sun is now
  float gNow = skyGain(v, uS);
  float g0 = skyGain(v, uS0);
  float away = 1.0 - uPhotoW;
  // the cumulus seen directly is relit below, from the photograph's own
  // reading of it; the dome's coarser gain is kept for the clear sky
  vec4 cl = texture(uCloud, t);
  float skyR = mix(clamp(gNow / g0, 0.35, 3.0), 1.0, 0.85 * cl.r);
  vec3 sky = base * skyR;
  // the cumulus, relit: the photograph's own forward scattering (round the
  // photographer's sun) divided out, the sun's now put in
  // (sharpened per pixel: cloud where the photograph is white against the
  // blue, and a puff brighter than its surround is thinner than it, so the
  // lining follows the cloud's own drawing, not the quarter-plate field)
  float Lpx = dot(base, LUMA_C);
  float Ls = cl.a * cl.a;
  float det = clamp((Lpx - Ls) / max(Ls, 0.05), -0.6, 0.6);
  float cPix = mix(cl.r, smoothstep(0.4, 0.82, base.r / (base.b + 1e-4)), 0.7);
  vec4 clp = vec4(cPix, clamp(cl.g - 1.2 * det, 0.0, 1.0), cl.ba);
  vec3 cNow = cloudLight(v, px, clp, uS);
  vec3 cPh = cloudLight(v, px, clp, uS0);
  float cGain = clamp(cNow.x / cPh.x, 0.4, 2.2);
  const vec3 LINING_C = vec3(1.0, 0.9, 0.76);
  vec3 cAdd = LINING_C * 2.0 * cNow.y * away;
  // the core the light cannot get through goes a cool grey (it sees only the
  // sky); the thin cloud the sun lights from close by takes its warmth
  float cShade = clamp(1.0 - cGain, 0.0, 1.0) * cl.r;
  vec3 cTint = mix(vec3(1.0), vec3(0.96, 1.0, 1.05), cShade);
  cTint *= mix(vec3(1.0), vec3(1.05, 1.0, 0.9), cl.r * (1.0 - cl.g) * cNow.z * away);
  sky = sky * cGain * cTint + cAdd;
  // the disc itself, where open sky shows it (behind a tower, the tower wins)
  float gs = acos(clamp(dot(v, uS), -1.0, 1.0));
  float pxa = 1.0 / uF;
  float disc = 1.0 - smoothstep(SUN_R - pxa, SUN_R + pxa, gs);
  float limb = 0.6 + 0.4 * sqrt(max(0.0, 1.0 - (gs * gs) / (SUN_R * SUN_R)));
  // HDR that must reach the film unclipped by the scene's own shoulder: the
  // sun's disc and its mirror images in the glass (halation draws their bloom)
  vec3 hot = vec3(1.0, 0.97, 0.92) * uSunL * 0.12 * disc * limb * away * step(0.5, skyM);
  // round the disc, what the eye and the film make of it: a small blown core
  // and, a few disc radii out, a thin warm ring where light that went through
  // the emulsion came back off the film base (halation)
  float ringR = SUN_R * 6.0;
  float ringW = SUN_R * 1.7;
  vec3 sunHot = vec3(1.0, 0.97, 0.92) * 3.0 * (1.0 - smoothstep(SUN_R * 1.6, SUN_R * 2.6, gs))
              + vec3(1.0, 0.6, 0.3) * 0.65 * exp(-0.5 * pow((gs - ringR) / ringW, 2.0));
  // the aureole: forward scattering by haze brightens the sky round the sun
  // by a factor (so the cumulus keeps its modelling) plus a little light of
  // its own, warm-neutral, not grey-blue
  float au = aureole(gs) - 0.9 * exp(-gs / 0.3);
  // (in cloud the droplets' own forward scattering, above, takes over: the
  // aureole is the clear air's)
  float auK = 1.0 + 0.035 * au * away * (1.0 - 0.8 * cl.r);
  sky *= auK;
  sky += vec3(1.0, 0.95, 0.87) * 0.02 * au * away * (1.0 - 0.8 * cl.r);
  // ---- the cumulus, developed as a volume, not a grey smear. Inside the
  // cloud only: local contrast against the cloud's own level ~30 px round
  // (an unsharp mask, in log light so it is a ratio and keeps the hue), then
  // a split tone. The cloud's shadows see only the blue sky, so they take
  // skylight's colour (hue ~205, a fifth saturated); its sunlit tops roll
  // off to the sun's warm white, never to the scan's grey.
  float cm = smoothstep(0.15, 0.6, cPix);
  float Lw = texture(uCloudW, t).r;
  Lw *= Lw;
  float usm = clamp(pow(max(Lpx, 1e-3) / max(Lw, 0.02), USM_K), 0.72, 1.35);
  sky *= mix(1.0, usm, cm);
  float Ly = dot(sky, LUMA_C);
  float Ld = Ly * uExpo;
  float wSh = cm * smoothstep(0.06, 0.16, Ld) * (1.0 - smoothstep(0.42, 0.68, Ld));
  float wTop = cm * smoothstep(0.5, 0.95, Ld);
  sky = mix(sky, Ly * CLOUD_SH, wSh * SPLIT_SH);
  sky = mix(sky, Ly * CLOUD_TOP, wTop * SPLIT_TOP) * (1.0 + 0.14 * wTop);

  // ---- towers
  vec3 col = sky;
  if (id < 255 && skyM < 0.999) {
    vec3 n0 = uFaceN[id];
    vec2 k = uFaceK[id];
    if (k.y > 0.5) {
      vec3 vh = v - dot(v, uUp) * uUp;
      n0 = -normalize(vh);
    }
    vec3 tH = normalize(cross(n0, uUp));
    vec3 tU = normalize(cross(tH, n0));
    float LIM = radians(2.0);
    vec2 j = (mt.rg * 2.0 - 1.0) * LIM;
    vec3 n = normalize(n0 + j.x * uUp + j.y * tH);

    // diffuse: skylight + sun on the face, the law the albedo was divided by
    vec3 e = SKY_C + 5.0 * max(dot(n0, uS), 0.0) * SUN_C;
    vec3 e0 = SKY_C + 5.0 * max(dot(n0, uS0), 0.0) * SUN_C;
    vec3 alb = s2l(texture(uAlb, t).rgb) * 2.0;
    vec3 wall = alb * e;
    vec3 photoWall = base;
    // a wall pixel is the photo times the change of light (exact at the
    // photographer's sun, and free of the albedo's 8-bit steps there)
    wall = mix(wall, photoWall * (e / e0), 0.6);

    // specular: the photo already holds the reflected sky; add what the sun
    // changes in it, and the sun's own mirror image
    vec3 r = reflect(v, n);
    float cosI = clamp(-dot(v, n), 0.0, 1.0);
    float f0 = mix(0.04, k.x, glass);
    float fr = f0 + (1.0 - f0) * pow(1.0 - cosI, 5.0);
    vec2 envT = envUv(r);
    vec3 envC = s2l(texture(uEnv, envT).rgb);
    float envSky = texture(uEnvM, envT).r;
    float gr = skyGain(r, uS) / skyGain(r, uS0) - 1.0;
    vec3 dE = envC * envSky * clamp(gr, -0.6, 2.5);

    // the sun's image: a disc, widened by roughness and by how far the
    // reflected ray turns across this pixel (pane edges, distance)
    float sr = rough * rough * 0.6;
    float fp = length(fwidth(r)) * 0.6;
    float sig2 = SUN_R * SUN_R * 0.5 + sr * sr + fp * fp;
    float th = acos(clamp(dot(r, uS), -1.0, 1.0));
    float lobe = (SUN_R * SUN_R * 0.5 / sig2) * exp(-th * th / (2.0 * sig2));
    // the sun must be in front of the face to be seen in it
    float front = smoothstep(-0.02, 0.05, dot(n0, uS));
    vec3 glint = vec3(1.0, 0.96, 0.9) * uSunL * lobe * front;
    // and the bright sky round it, through the same pane: this is what
    // spreads one glint into a patchwork of lit panes
    float ga = th;
    float gg = sqrt(ga * ga + sr * sr);
    vec3 aur = vec3(0.62, 0.7, 0.78) * 0.12 * (12.0 * exp(-gg / 0.08) + 1.5 * exp(-gg / 0.3)) * front;

    // The glint proper. A curtain wall is a field of slightly different
    // mirrors, so the sun is not seen in one pane but in a run of them: every
    // pane whose normal lies near the half vector between the eye and the
    // sun catches it. Two lobes over the pane normals (tilt and pillow
    // included), in the face's own frame: a pillow lobe, narrow enough that a
    // pane's bow sweeps it bright from one side to the other, and the run
    // itself, longer up the tower than across it (insulated units pillow
    // and sit off plumb more than they twist), so the lit panes line up
    // into a streak that slides pane by pane as the sun moves.
    // (the run reads each pane's tilt and bow at twice the bake's, which is
    // what sets one lit pane apart from the next inside it)
    vec3 hv = normalize(uS - v);
    vec3 dh = hv - n;
    float du = dot(dh, tU);
    float dv = dot(dh, tH);
    float pil = exp(-(du * du + dv * dv) / (2.0 * 0.008 * 0.008));
    vec3 dr = hv - normalize(n0 + 2.0 * (j.x * uUp + j.y * tH));
    float ru = dot(dr, tU) / 0.05;
    float rv = dot(dr, tH) / 0.024;
    float run = exp(-0.5 * (ru * ru + rv * rv));
    float gfr = fr * front * glass * away;
    // radiance in units of the scene, through Fresnel: a mirror of the sun is
    // far brighter than anything else in the frame
    float hdr = gfr * (10.0 * pil + 26.0 * run);
    hot += vec3(1.0, 0.95, 0.86) * hdr * (1.0 - skyM);
    hot += fr * glint * glass * (1.0 - skyM);

    vec3 spec = fr * (dE + aur);
    vec3 glassC = base + spec;
    vec3 frameC = wall + spec * 0.6 + fr * glint * 0.6;
    vec3 tower = mix(frameC, glassC, glass);
    col = mix(tower, sky, skyM);
    if (uDebug > 0.5 && uDebug < 1.5) col = vec3(lobe, run * glass, pil * glass);
    if (uDebug > 2.5 && uDebug < 3.5) col = vec3(mt.r, mt.g, glass * 0.3);
  }
  // veiling glare: a sun in open sky is too bright to look at. Its light
  // scatters in the air, the lens and the emulsion into a broad warm bloom
  // that washes the sky round it, lifts the cloud beside it and veils the
  // towers in front, all from where the disc is. A tower over the disc takes
  // it away (the sky matte at the sun, over a few disc radii, says how much
  // of the sun shows).
  float sunVis = 0.0;
  if (uS.z > 0.05) {
    vec2 sp = uC + uF * uS.xy / uS.z;
    float vis = 0.0;
    for (int i = 0; i < 9; i++) {
      float a = float(i) * 2.39996;
      float rr = (i == 0 ? 0.0 : sqrt(float(i) / 8.0)) * SUN_R * uF * 2.5;
      vec2 q = (sp + rr * vec2(cos(a), sin(a))) / uPlate;
      float inP = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
      vis += inP * texture(uGeo, q).b;
    }
    vis = smoothstep(0.1, 0.9, vis / 9.0) * away;
    float veil = veilOf(gs);
    col += vec3(1.0, 0.95, 0.86) * veil * vis;
    sunVis = vis;
    // a thick cumulus in front of the disc takes most of it (its glow
    // through the cloud, the veil, stays)
    vec4 cs = texture(uCloud, sp / uPlate);
    hot += sunHot * vis * mix(1.0, 0.3, cs.r * smoothstep(0.35, 0.9, cs.g));
  }
  // and the sun's mirror image in a curtain wall is a second sun, a tenth as
  // bright: it veils the panes and the sky round it the same way, so the
  // glint blooms instead of sitting in the glass as a pattern
  for (int k = 0; k < 2; k++) {
    float gk = acos(clamp(dot(v, uGlintD[k]), -1.0, 1.0));
    float gv = 0.7 * exp(-gk / 0.012) + 0.18 * exp(-gk / 0.05);
    col += vec3(1.0, 0.93, 0.82) * gv * uGlintK[k] * away;
  }
  if (uDebug > 3.5) col = vec3(cl.r, cl.g, cGain * 0.5) * skyM;
  if (uDebug > 1.5 && uDebug < 2.5) col = vec3(gNow / g0 * 0.5, texture(uEnvM, envUv(v)).g, texture(uEnvM, envUv(v)).r);
  // The film's shoulder. Everything but the sun and its mirror images is
  // held inside it, so the sky round an open sun rolls off to a warm white
  // instead of clipping into a flat disc. The roll-off is judged on the
  // light's smooth level (the photograph a few texels wide, relit the same
  // way), and applied as a gain, so the cumulus keeps its modelling inside
  // it; then a gentle per-pixel shoulder takes what detail pokes out. Within
  // a few disc radii of a visible sun the core is let through to blow out.
  col *= uExpo;
  vec3 lb = s2l(textureLod(uPhoto, t, 4.5).rgb);
  float Lsm = dot(lb, LUMA_C) * (skyM > 0.5 ? skyR * auK * cGain : 1.0);
  Lsm += (0.02 * au * away * (1.0 - 0.8 * cl.r) + dot(cAdd, LUMA_C)) * skyM;
  Lsm += veilOf(gs) * sunVis;
  Lsm *= uExpo;
  // (a ceiling that falls off with the angle from the sun, not a disc with
  // an edge: the blown core is a few disc radii and fades into the glow)
  float core = 6.0 * exp(-gs / 0.009) * sunVis;
  float K = 0.72;
  // (the silver lining is let a little way past the shoulder: thin cloud
  // toward the sun is the brightest thing in the sky after the sun)
  float M = 0.92 + core + 0.3 * dot(cAdd, LUMA_C) * skyM;
  float Ls2 = Lsm > K ? K + (M - K) * (1.0 - exp(-(Lsm - K) / (M - K))) : Lsm;
  // (at the photographer's sun the frame is the photograph, untouched)
  Ls2 = mix(Ls2, Lsm, uPhotoW);
  col *= Ls2 / max(Lsm, 1e-4);
  float Lp = max(dot(col, LUMA_C), max(col.r, max(col.g, col.b)) * 0.85);
  float K2 = 0.95;
  float M2 = 1.1 + core;
  float Lp2 = Lp > K2 ? K2 + (M2 - K2) * (1.0 - exp(-(Lp - K2) / (M2 - K2))) : Lp;
  Lp2 = mix(Lp2, Lp, uPhotoW);
  col *= Lp2 / max(Lp, 1e-4);
  // the glints: HDR straight to the film, with a soft ceiling so a run of
  // panes blooms through the halation without a hard white slab
  vec3 hx = hot * uExpo;
  float hl = dot(hx, LUMA_C);
  float HM = 2.2;
  hx *= hl > 0.0 ? HM * (1.0 - exp(-hl / HM)) / hl : 0.0;
  hx += hot * uExpo * disc * away; // the disc itself stays a sun
  outColor = vec4(col + hx, 1.0);
  if (uDebug > 4.5) outColor = vec4(cGain * 0.5, dot(cAdd, LUMA_C), cl.g, 1.0) * skyM;
}`;

// ---- diffusion, on the highlights only. The film's own Pro-Mist spreads a
// share of all the light, which takes the bite out of every mullion, roof
// edge and cloud margin at once. Here only the light above an HDR threshold
// (the sun, its mirror images in the glass, the brightest cloud tops) leaves
// the image and lands spread out, energy conserving, over two scales (~12 and
// ~48 px); everything below it keeps the scan's own sharpness.
const HI_T = 0.85; // scene-linear luma where diffusion starts
const HI_K = 0.32; // share of the highlight's light that is spread
const HI_FN = `
const vec3 LUMA_H = vec3(0.2126, 0.7152, 0.0722);
uniform float uThr;
vec3 hiOf(vec3 c) {
  c = max(c, 0.0);
  float l = dot(c, LUMA_H);
  float k = uThr * 0.25;
  float x = clamp(l - uThr + k, 0.0, 2.0 * k);
  float h = max(x * x / (4.0 * k + 1e-5), l - uThr);
  // (a soft ceiling: the sun's disc is thousands of times the sky, and its
  // own glare is drawn in the scene; spread whole it would blow a slab)
  h = 16.0 * (1.0 - exp(-h / 16.0));
  return c * (h / max(l, 1e-4));
}`;
// full -> quarter (the highlight part), or quarter -> sixteenth (as is):
// four bilinear taps cover the 4x4 block
const HI_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uCut;
${HI_FN}
vec3 tap(vec2 o) {
  vec3 c = texture(uSrc, vUv + o * uTexel).rgb;
  return uCut > 0.5 ? hiOf(c) : c;
}
void main() {
  outColor = vec4(0.25 * (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))), 1.0);
}`;
// separable gaussian, 9 taps in 5 bilinear fetches, spaced by uDir
const HI_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.227027;
  c += (texture(uSrc, vUv + uDir * 1.384615).rgb + texture(uSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
  c += (texture(uSrc, vUv + uDir * 3.230769).rgb + texture(uSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
  outColor = vec4(c, 1.0);
}`;
const HI_COMP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uNear;
uniform sampler2D uWide;
uniform vec2 uNearTexel;
uniform vec2 uWideTexel;
uniform float uK;
${HI_FN}
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  // tent upsampling (four bilinear taps): a bilinear one draws the bright
  // core of a spread highlight as a square
  vec2 n = uNearTexel * 0.5;
  vec3 near = 0.25 * (texture(uNear, vUv + vec2(-n.x, -n.y)).rgb + texture(uNear, vUv + vec2(n.x, -n.y)).rgb
            + texture(uNear, vUv + vec2(-n.x, n.y)).rgb + texture(uNear, vUv + vec2(n.x, n.y)).rgb);
  vec2 o = uWideTexel * 0.5;
  vec3 wide = 0.25 * (texture(uWide, vUv + vec2(-o.x, -o.y)).rgb + texture(uWide, vUv + vec2(o.x, -o.y)).rgb
            + texture(uWide, vUv + vec2(-o.x, o.y)).rgb + texture(uWide, vUv + vec2(o.x, o.y)).rgb);
  outColor = vec4(max(c + uK * (0.5 * near + 0.5 * wide - hiOf(c)), 0.0), 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
uniform float uRaw;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  if (uRaw > 0.5) c = mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
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

function program(gl, vs, fs) {
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
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, { mips = false, nearest = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, ok };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createGlint(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const sunQ = q.get("sun");
  let heldPx = null;
  if (sunQ === "photo") heldPx = SUN0_PX.slice();
  else if (sunQ) {
    const [a, b] = sunQ.split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) heldPx = [a * PW, b * PH];
  }
  const held = heldPx != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const debug = q.get("debug") ? +q.get("debug") : 0;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");

  const files = ["photo.webp", "albedo.webp", "geo.webp", "mat.webp", "env.webp", "envmask.webp", "patch.webp"];
  const imgs = await Promise.all(files.map((f) => loadImage(BASE + f)));
  // face ids and glass at a quarter of the plate, to find on the CPU where
  // the sun's mirror image lands in each wall
  const GQ = 4;
  const GW = Math.round(PW / GQ);
  const GH = Math.round(PH / GQ);
  const readSmall = (img) => {
    const c = document.createElement("canvas");
    c.width = GW;
    c.height = GH;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, GW, GH);
    return x.getImageData(0, 0, GW, GH).data;
  };
  const geoPx = readSmall(imgs[2]);
  const matPx = readSmall(imgs[3]);
  const T0 = {
    photo: imageTexture(gl, imgs[0], { mips: true }),
    alb: imageTexture(gl, imgs[1], { mips: true }),
    geo: imageTexture(gl, imgs[2], { nearest: true }),
    mat: imageTexture(gl, imgs[3], { nearest: true }),
    env: imageTexture(gl, imgs[4], { mips: true }),
    envm: imageTexture(gl, imgs[5], { mips: true }),
    patch: imageTexture(gl, imgs[6]),
    cloud: gl.createTexture(),
    cloudW: gl.createTexture(),
  };
  const cf = cloudField(imgs[0], geoPx, GW, GH);
  [
    [T0.cloud, cf.out],
    [T0.cloudW, cf.wide],
  ].forEach(([tex, data]) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  });

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    scene: program(gl, VERT, SCENE),
    blit: program(gl, VERT, BLIT),
    hiDown: program(gl, VERT, HI_DOWN),
    hiBlur: program(gl, VERT, HI_BLUR),
    hiComp: program(gl, VERT, HI_COMP),
  };
  const film = createFilm(gl, { width: 2, height: 2 });

  // The print: the whole 3:4 plate, as tall as the box allows.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  const T = { scene: null, film: null, comp: null, q1: null, q2: null, s1: null, s2: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      const w = Math.min(W, H * ar);
      Object.assign(L, { w, h: w / ar });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = Math.min(W - side * 2, (H - 96) * ar);
      Object.assign(L, { w, h: w / ar });
    } else {
      const h = Math.min(H * 0.84, (W - 48) / ar);
      Object.assign(L, { w: h * ar, h });
    }
    L.x = Math.round(((W - L.w) / 2) * dpr) / dpr;
    L.y = Math.round(((H - L.h) / 2) * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph, floatOk);
    if (!T.scene.ok) {
      freeTarget(gl, T.scene);
      T.scene = target(gl, L.pw, L.ph, false);
    }
    T.film = target(gl, L.pw, L.ph, false);
    if (T.scene.ok && floatOk) {
      const qw = Math.max(2, Math.round(L.pw / 4));
      const qh = Math.max(2, Math.round(L.ph / 4));
      const sw = Math.max(2, Math.round(qw / 4));
      const sh = Math.max(2, Math.round(qh / 4));
      T.comp = target(gl, L.pw, L.ph, true);
      T.q1 = target(gl, qw, qh, true);
      T.q2 = target(gl, qw, qh, true);
      T.s1 = target(gl, sw, sh, true);
      T.s2 = target(gl, sw, sh, true);
    } else Object.assign(T, { comp: null, q1: null, q2: null, s1: null, s2: null });
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // ---- the sun: a goal in plate pixels, followed on a critically damped-ish
  // spring; idle, it drifts slowly along the arc a summer sun would take
  const toPlate = (p) => [((p.x - L.x) / L.w) * PW, ((p.y - L.y) / L.h) * PH];
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  // opening walk: from the photographer's sun round toward the lattice's
  // crown, where the street's walls catch it
  // (behind the lattice, where the bronze tower across the street catches it)
  const OPEN = [0.2 * PW, 0.3 * PH];
  let goal = held ? heldPx.slice() : SUN0_PX.slice();
  let sun = goal.slice();
  let vel = [0, 0];
  let touched = held;
  let rest = OPEN.slice();
  let lastHand = -1e9;

  stage.on("move", (p) => {
    if (held || !inPrint(p)) return;
    touched = true;
    goal = toPlate(p);
    lastHand = performance.now();
  });
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    touched = true;
    goal = toPlate(p);
    lastHand = performance.now();
  });

  let seed = 0;
  let grainClock = 0;
  let t0 = -1;
  let lastSunKey = "";

  // The two brightest mirror images of the sun: for each flat wall lit from
  // the front, the direction the sun is seen in it, and how much lit glass of
  // that wall is round that point (Fresnel x glass share).
  const glintD = new Float32Array(6);
  const glintK = new Float32Array(2);
  const findGlints = (s) => {
    const best = [];
    META.faces.forEach((fc, i) => {
      if (fc.cyl) return;
      const n = fc.normal;
      const c = dot3(n, s);
      if (c < 0.03) return;
      const d = [s[0] - 2 * c * n[0], s[1] - 2 * c * n[1], s[2] - 2 * c * n[2]];
      if (d[2] < 0.05) return;
      const [px, py] = pxOf(d);
      const gx = Math.round(px / GQ);
      const gy = Math.round(py / GQ);
      let sum = 0;
      let cnt = 0;
      for (let y = gy - 4; y <= gy + 4; y++) {
        for (let x = gx - 4; x <= gx + 4; x++) {
          cnt++;
          if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
          const o = (y * GW + x) * 4;
          if (geoPx[o] === i && geoPx[o + 2] < 128) sum += matPx[o + 2] / 255;
        }
      }
      if (!sum) return;
      const f0 = FACE_K[i * 2];
      const fr = f0 + (1 - f0) * Math.pow(1 - c, 5);
      best.push({ d, k: 4 * fr * (sum / cnt) });
    });
    best.sort((a, b) => b.k - a.k);
    for (let k = 0; k < 2; k++) {
      const g = best[k];
      glintD.set(g ? g.d : [0, 0, -1], k * 3);
      glintK[k] = g ? g.k : 0;
    }
  };

  // how much open sky is round a point of the plate (the sun's), 0..1
  const openSky = (p) => {
    const gx = Math.round(p[0] / GQ);
    const gy = Math.round(p[1] / GQ);
    let a = 0;
    for (let y = gy - 3; y <= gy + 3; y++) {
      for (let x = gx - 3; x <= gx + 3; x++) {
        if (x >= 0 && y >= 0 && x < GW && y < GH) a += geoPx[(y * GW + x) * 4 + 2] / 255;
      }
    }
    return a / 49;
  };

  const draw = (expoStops, fade) => {
    const s = dirOf(sun[0], sun[1]);
    const ang = Math.acos(clamp(dot3(s, SUN0), -1, 1));
    const photoW = Math.exp(-((ang / 0.012) ** 2));
    // exposure follows the light half way, as a photographer would
    const pk = peakLight(SUN0) / peakLight(s);
    // and with the sun itself in open sky, the meter sees it and holds the
    // exposure down: the sky keeps its depth and the sun its fire
    const sunOpen = openSky(sun) * (1 - photoW);
    const expo = Math.pow(meanLight(SUN0) / meanLight(s), 0.5) * Math.pow(Math.min(1, pk), 0.7) * (1 - 0.22 * sunOpen) * 2 ** expoStops;

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    const u = P.scene.u;
    gl.useProgram(P.scene.p);
    bindTex(0, T0.photo, u.uPhoto);
    bindTex(1, T0.alb, u.uAlb);
    bindTex(2, T0.geo, u.uGeo);
    bindTex(3, T0.mat, u.uMat);
    bindTex(4, T0.env, u.uEnv);
    bindTex(5, T0.envm, u.uEnvM);
    bindTex(6, T0.patch, u.uPatch);
    bindTex(7, T0.cloud, u.uCloud);
    bindTex(8, T0.cloudW, u.uCloudW);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1f(u.uF, F);
    gl.uniform2f(u.uC, CX, CY);
    gl.uniform3fv(u.uUp, UP);
    gl.uniform3fv(u.uEX, META.ex);
    gl.uniform3fv(u.uEZ, META.ez);
    gl.uniform3fv(u.uS, s);
    gl.uniform3fv(u.uS0, SUN0);
    gl.uniform1f(u.uPhotoW, photoW);
    gl.uniform4fv(u.uPatchR, META.patch);
    gl.uniform3fv(u.uFaceN, FACE_N);
    gl.uniform2fv(u.uFaceK, FACE_K);
    gl.uniform1f(u.uExpo, expo);
    gl.uniform1f(u.uSunL, 1200);
    gl.uniform1f(u.uDebug, debug);
    findGlints(s);
    gl.uniform3fv(u.uGlintD, glintD);
    gl.uniform1fv(u.uGlintK, glintK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const linear = floatOk && T.scene.ok;
    // the highlights' diffusion (linear HDR only; an 8-bit frame has no
    // highlights above white, and keeps the film's own Pro-Mist instead)
    const split = linear && T.comp && T.comp.ok;
    if (split && !raw && !debug) {
      const pass = (prog, dst, setup) => {
        gl.useProgram(prog.p);
        setup(prog.u);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const down = (src, dst, cut) =>
        pass(P.hiDown, dst, (u2) => {
          bindTex(0, src.tex, u2.uSrc);
          gl.uniform2f(u2.uTexel, 1 / src.w, 1 / src.h);
          gl.uniform1f(u2.uCut, cut);
          gl.uniform1f(u2.uThr, HI_T);
        });
      const blur = (a, b) => {
        // spaced 1.5 texels apart: a gaussian of ~3 texels
        pass(P.hiBlur, b, (u2) => {
          bindTex(0, a.tex, u2.uSrc);
          gl.uniform2f(u2.uDir, 1.5 / a.w, 0);
        });
        pass(P.hiBlur, a, (u2) => {
          bindTex(0, b.tex, u2.uSrc);
          gl.uniform2f(u2.uDir, 0, 1.5 / b.h);
        });
      };
      down(T.scene, T.q1, 1);
      blur(T.q1, T.q2);
      down(T.q1, T.s1, 0);
      blur(T.s1, T.s2);
      pass(P.hiComp, T.comp, (u2) => {
        bindTex(0, T.scene.tex, u2.uScene);
        bindTex(1, T.q1.tex, u2.uNear);
        bindTex(2, T.s1.tex, u2.uWide);
        gl.uniform2f(u2.uNearTexel, 1 / T.q1.w, 1 / T.q1.h);
        gl.uniform2f(u2.uWideTexel, 1 / T.s1.w, 1 / T.s1.h);
        gl.uniform1f(u2.uK, HI_K);
        gl.uniform1f(u2.uThr, HI_T);
      });
    }
    if (!raw && !debug) {
      film.render(
        split ? T.comp.tex : T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          // The scan already carries its grade; the film adds the optics.
          headroom: linear ? 0 : 1.2,
          contrast: 1.06,
          toe: 0.012,
          saturation: 1.04,
          blueDepth: 0.45,
          shadowTint: [0.97, 1, 1.03],
          highlightTint: [0.99, 1, 1.01],
          whitePoint: 1.18,
          shoulder: 0.92,
          halation: 0.7,
          halationThreshold: 1.1,
          // amber, not red: a red fringe on a glint reads as a lens fault
          halationColor: [1, 0.46, 0.2],
          // no veil over the whole frame: the highlights have had theirs
          // above, and below them the drawing keeps the scan's sharpness
          bloom: split ? 0 : 0.24,
          softness: split ? 0.12 : 0.45,
          vignette: 0.18,
          grain: 0.3,
          input: linear ? "linear" : "srgb",
          grainSeed: seed,
        },
        T.film.fbo,
      );
      gl.bindVertexArray(vao);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(P.blit.p);
    bindTex(0, raw || debug ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform1f(P.blit.u.uRaw, (raw || debug) && linear ? 1 : 0);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up two stops over, an airy white-blue, and
  // settles; then the sun walks off the photographer's spot to show it can.
  const REVEAL = 2.0;
  const WALK_AT = 0.8;
  const WALK = 2.2;
  let lastNow = 0;
  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now();
    lastNow = now;
    if (t0 < 0) t0 = now / 1000;
    const age = still ? 99 : now / 1000 - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.0 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held) {
      if (!touched) {
        const k = reduce ? 0 : expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
        goal = [SUN0_PX[0] + (OPEN[0] - SUN0_PX[0]) * k, SUN0_PX[1] + (OPEN[1] - SUN0_PX[1]) * k];
        if (k >= 1) rest = OPEN.slice();
      } else if (!stage.pointer.inside && !stage.pointer.down && now - lastHand > 2500) {
        rest = goal.slice();
      }
      // idle: a slow drift along the sun's arc, ~1% of the frame per second
      const idle = (!touched && age > WALK_AT + WALK) || (touched && !stage.pointer.inside && now - lastHand > 2500);
      if (idle && !reduce && !still) {
        const tt = now / 1000;
        goal = [rest[0] + 70 * Math.sin(tt / 6.5), rest[1] + 40 * Math.sin(tt / 9.1 + 0.7)];
      }
    }
    let moving = false;
    if (held) sun = goal.slice();
    else {
      // spring: damping ratio 0.85, ~0.35 s to settle
      const w = 14;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        for (let a = 0; a < 2; a++) {
          const acc = w * w * (goal[a] - sun[a]) - 2 * z * w * vel[a];
          vel[a] += acc * h;
          sun[a] += vel[a] * h;
        }
      }
      moving = Math.hypot(goal[0] - sun[0], goal[1] - sun[1]) > 0.05 || Math.hypot(vel[0], vel[1]) > 0.05;
    }

    let tick = false;
    if (!still && !reduce) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    const key = `${sun[0].toFixed(2)},${sun[1].toFixed(2)}`;
    if (!dirty && !moving && !tick && !revealing && key === lastSunKey) return;
    lastSunKey = key;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      Object.values(T0).forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
