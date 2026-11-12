import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";

// Yuudachi: the sudden summer evening shower, on a real Osaka street.
//
// Hold the pointer down and the clouds roll in from the far end of the street,
// the sun goes, and it pours. Let go and the rain stops, the cloud edge runs
// back down the street toward you, and everything dries unevenly.
//
// Everything is baked from the one photograph (tools/depth/bakes/yuudachi):
//  - geo:   MoGe-2 metric depth and normals, so every pixel is a point in
//           metres with gravity;
//  - mat:   what each surface is made of (asphalt, lane paint, concrete,
//           brick, metal, glass, foliage, painted signs, cloth), as porosity,
//           wet gloss, beading and foliage;
//  - water: when each patch of road goes under (Priority-Flood on the road's
//           height field: hollows fill in order of stored volume over
//           catchment), the hollow's depth, how much rain reaches the surface
//           (overhangs cast a rain shadow), and where the sun was in the photo.
//
// Each material wets by its own physics. Porous surfaces (asphalt, concrete,
// brick) darken and deepen in colour as water replaces the air in their
// pores, evenly across a face, with only a slow unevenness over metres; walls
// take only wind-driven rain. Asphalt's film turns its micro-roughness to a
// sheen, a rough mirror of the street weighted by Fresnel, so the road goes to
// glass toward its grazing far end. The scene is lit by the storm deck alone:
// lower, cooler, but keeping the colour of what is really coloured (signs,
// flowers, leaves). Metal, paint and glass hardly
// darken but bead. Leaves go darker and glisten. Puddles are level water:
// mirrors whose reflection is found by marching the reflected ray through the
// point map (screen-space reflection), rippled by every drop while it rains.
// The rain itself is ~16000 streaks in metres, each 1/40 s of fall long, depth
// tested against the street and defocused by distance; far rain is a veil.
//
// Query: ?rain=0..1 holds the shower that far in; ?dry=0..1 holds the drying
// after it (sun out); ?sun=0..1 holds the cloud edge part-way up the street;
// ?t=seconds freezes the clock; ?still=1 skips the reveal.

const BASE = "/lab/yuudachi/";
const IMG_W = 1536;
const IMG_H = 2040;
const MAP_W = 768;
const MAP_H = 1020;
const FX = 2564.23;
const CX = 767.5;
const CY = 1019.5;
const UP = [-0.0061, 0.97514, -0.22151];
const RIGHT = [0.99998, 0.00626, 0];
const FWD = [0.00139, -0.2215, -0.97516];
const PLANE = [-0.000439, 0.043731, -1.87755];
// Sun+sky over sky alone: on the asphalt this is measured by the bake
// (meta.sunOverSky, the same asphalt either side of the right-hand block's
// shadow). A wall takes the summer sun at a glancing angle, so less of it.
const SUN_GROUND = 25.5;
const SUN_WALL = 12;
// The overcast's light relative to the clear sky's shade light: a whole sky
// of bright cloud, against the slot of blue a shaded street sees.
const OVERCAST = 2.5;
const ASPECT = IMG_W / IMG_H;
const DROPS = 16000;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
const vec2 IMG = vec2(${IMG_W}.0, ${IMG_H}.0);
const ivec2 MAP = ivec2(${MAP_W}, ${MAP_H});
const float FX = ${FX};
const vec2 C0 = vec2(${CX}, ${CY});
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// depth (m) at an image uv (0,0 top left), nearest texel of the half-res map
float depthAt(sampler2D geo, vec2 iuv) {
  ivec2 p = clamp(ivec2(iuv * vec2(MAP)), ivec2(0), MAP - 1);
  vec4 g = texelFetch(geo, p, 0);
  return exp2((g.r * 65280.0 + g.g * 255.0) / 65535.0 * 9.0);
}
vec3 viewRay(vec2 iuv) {
  vec2 px = iuv * IMG;
  return vec3((px.x - C0.x) / FX, -(px.y - C0.y) / FX, -1.0);
}
vec2 project(vec3 P) {
  float z = max(-P.z, 1e-3);
  return vec2(P.x / z * FX + C0.x, -P.y / z * FX + C0.y) / IMG;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 157.0 + 113.0 * i.z;
  vec4 h = fract(sin(vec4(n, n + 1.0, n + 157.0, n + 158.0)) * 43758.5453);
  vec4 k = fract(sin(vec4(n + 113.0, n + 114.0, n + 270.0, n + 271.0)) * 43758.5453);
  vec4 m = mix(h, k, f.z);
  return mix(mix(m.x, m.y, f.x), mix(m.z, m.w, f.x), f.y);
}
float fbm3(vec3 p) {
  return vnoise3(p) * 0.55 + vnoise3(p * 2.03 + 11.1) * 0.3 + vnoise3(p * 4.1 + 27.3) * 0.15;
}
`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPhoto;
uniform sampler2D uSky;
uniform sampler2D uGeo;
uniform sampler2D uMat;
uniform sampler2D uWater;
uniform sampler2D uClean;
uniform float uTime;
uniform float uRain;     // falling now, 0..1
uniform float uAcc;      // rain that has fallen this shower, 0..1.3
uniform float uEvap;     // drying since it stopped, 0..2.2
uniform float uSun;      // the cloud edge: 0 = overcast everywhere, 1 = sun everywhere
uniform float uExpo;
uniform float uLodBias;
uniform vec3 uUp;
uniform vec3 uRight;
uniform vec3 uFwd;
uniform vec3 uRoadN;
uniform float uDbg;
uniform vec4 uCrop;      // the part of the photo on screen: x0, y0, w, h (image uv)
${COMMON}

const float SUN_GROUND = ${SUN_GROUND.toFixed(2)};
const float SUN_WALL = ${SUN_WALL.toFixed(2)};
const float OVERCAST = ${OVERCAST.toFixed(2)};

// The storm deck without the cumulus: slate cobalt overhead, deepening toward
// the zenith, and under its far edge the bright gap: a band of pale sky low
// over the street's end, where the cell ends and daylight still comes in
// sideways. That gap is what the puddles and the rain catch.
vec3 stormBase(float y) {
  float h = clamp(y / 0.62, 0.0, 1.0);
  vec3 c = mix(vec3(0.055, 0.07, 0.095), vec3(0.2, 0.22, 0.25), pow(h, 1.2));
  float gap = smoothstep(0.5, 0.74, y);
  return mix(c, vec3(0.58, 0.61, 0.64), gap);
}

// The rain sky is the photo's own sky gone over: the clear sky (sky matte
// filled, skyclean) with the blue taken down to the storm deck, and the
// cumulus darkened and cooled into the storm cloud. Its billows keep their
// structure: the sky's luminance against a blur of itself, steepened, rides
// on top, so the cloud stays a tower and the faint cirrus stays as streaks.
vec3 rainSky(vec2 iuv) {
  vec3 cl = srgbToLinear(textureLod(uClean, iuv, 0.0).rgb);
  float Y = luma(cl);
  float Yb = luma(srgbToLinear(textureLod(uClean, iuv, 4.5).rgb));
  float mx = max(cl.r, max(cl.g, cl.b));
  float sat = (mx - min(cl.r, min(cl.g, cl.b))) / max(mx, 1e-4);
  float cloud = smoothstep(0.45, 0.15, sat);
  vec3 body = vec3(0.15, 0.165, 0.19) * (0.5 + 1.0 * smoothstep(0.3, 1.0, Y));
  vec3 c = mix(stormBase(iuv.y), body, cloud);
  c *= clamp(pow(max(Y, 1e-4) / max(Yb, 1e-4), 1.6), 0.3, 3.3);
  // and it moves: slow darker masses in the deck
  float m = fbm3(vec3(iuv * vec2(1.6, 2.4) + vec2(uTime * 0.012, 0.0), uTime * 0.02));
  return c * (0.84 + 0.32 * m);
}

// How far the cloud edge is from covering this point: the sun leaves the far
// end of the street first and comes back to it first.
float sunAt(float z, vec2 iuv) {
  float k = clamp(log2(max(z, 1.0)) / 9.0, 0.0, 1.0);   // 0 near .. 1 sky
  float key = 1.0 - k;                                   // far: low
  // the sky opens at the street's end first, overhead last
  float w = 0.06;
  if (z > 400.0) {
    key = 0.06 + 0.34 * clamp(1.0 - iuv.y / 0.62, 0.0, 1.0);
    w = 0.11;
  }
  // the cloud's edge is ragged, and it drifts
  key += (fbm3(vec3(iuv * vec2(2.6, 3.4) + vec2(uTime * 0.01, 0.0), 4.0)) - 0.5) * 0.22;
  float f = uSun * 1.25 - 0.12;
  return smoothstep(key - w, key + w, f);
}

// The photo's light at any point, re-lit for the weather: sunlit surfaces
// lose the sun (divided down to skylight), the blue clear-sky shade turns to
// the grey of an overcast, and the sky itself becomes the rain sky.
vec3 relit(vec2 iuv, float lod, float sunNow, float sunSky, out float skyA) {
  vec3 c = srgbToLinear(textureLod(uPhoto, iuv, lod).rgb);
  float skyRaw = textureLod(uSky, iuv, lod).r;
  // The sky matte also traces every wire and ledge in front of the buildings
  // with a hairline of "sky". Trust it only where there is sky to speak of:
  // where the depth map (eroded to the nearest surface) sees open sky, or
  // where the matte covers most of the neighbourhood (sky between wires).
  float openSky = max(step(400.0, depthAt(uGeo, iuv)), smoothstep(0.55, 0.8, textureLod(uSky, iuv, 4.0).r));
  skyA = skyRaw * openSky;
  vec4 m = texture(uMat, iuv);
  float glass = (1.0 - smoothstep(0.02, 0.07, m.r)) * smoothstep(0.5, 0.65, m.b) * (1.0 - smoothstep(0.18, 0.3, m.g));
  float lit = clamp(textureLod(uWater, iuv, 0.0).a * 2.0 - 1.0, 0.0, 1.0);
  // The sunlight matte misses the thinnest things: the sunlit wall either
  // side of a wire reads as shade, and comes out of the relight as a white
  // outline. A pixel as bright as its sunlit surround is in that sun.
  float litB = clamp(textureLod(uWater, iuv, 1.5).a * 2.0 - 1.0, 0.0, 1.0);
  float yB = luma(srgbToLinear(textureLod(uPhoto, iuv, lod + 2.5).rgb));
  lit = max(lit, litB * smoothstep(0.55, 0.95, luma(c) / max(yB, 1e-4)));
  vec3 clean = srgbToLinear(textureLod(uClean, iuv, 0.0).rgb);
  // A mixed pixel (a wire against the sky) is skyA of clear sky plus the
  // rest of the wire: take the sky's share out, keep the wire.
  vec3 fg = max(c - skyA * clean, 0.0);
  vec3 surf = fg / max(1.0 - skyA, 0.04);
  // Take the sun out. The bake's sunlight matte is soft at the shadow edges,
  // so divide geometrically (K^lit): half-lit edge pixels come out at the
  // shade's level instead of a dark halo. Ground (and soffits, which the
  // sun reached only by bounce off it) by the measured ratio, walls less.
  vec4 g4 = texelFetch(uGeo, clamp(ivec2(iuv * vec2(MAP)), ivec2(0), MAP - 1), 0);
  vec3 N = vec3(g4.b * 2.0 - 1.0, (g4.a - 0.75) * 4.0, 0.0);
  N.z = sqrt(max(0.0, 1.0 - dot(N.xy, N.xy)));
  float flat_ = smoothstep(0.55, 0.85, abs(dot(N, uUp)));
  float K = exp2(mix(log2(SUN_WALL), log2(SUN_GROUND), flat_));
  float ys = max(luma(surf), 1e-5);
  float yo = ys * pow(K, -lit) * OVERCAST;
  // A balcony's underside glowed with sunlight bounced up off the street;
  // under cloud it sees only the dark wet road below it.
  yo *= mix(1.0, 0.35, smoothstep(0.25, 0.7, -dot(N, uUp)));
  // Wires, pole tops and roof edges against the sky are lit by that sky
  // alone: under the storm they go to silhouette, darker than the cloud.
  vec3 rs = rainSky(iuv);
  float nearSky = textureLod(uSky, iuv, 3.0).r;
  float edgeSky = smoothstep(0.25, 0.6, nearSky);
  yo = mix(yo, min(yo, 0.6 * luma(rs)), edgeSky);
  // Light from the storm deck: lower and cooler, but not grey. The photo's
  // shade is lit by blue sky and graded to cyan, so a weakly coloured pixel
  // gives up most of that cast; what is really coloured (a sign, the
  // flowers, the leaves) keeps its colour and reads richer for the dimmer,
  // softer light. Then all of it goes a touch cool.
  float mxs = max(surf.r, max(surf.g, surf.b));
  float sats = (mxs - min(surf.r, min(surf.g, surf.b))) / max(mxs, 1e-4);
  // (Blue and cyan are the clear sky's, in shade and in every window: those
  // go with the sky.)
  float skyish = smoothstep(0.05, 0.25, (surf.b - surf.r) / max(mxs, 1e-4));
  float keep = mix(0.28 + 0.32 * lit, 1.0, smoothstep(0.4, 0.85, sats) * (1.0 - skyish));
  keep *= 1.0 - 0.5 * skyish;
  vec3 over = yo * max(1.0 + (surf / ys - 1.0) * keep, 0.0) * vec3(0.9, 0.97, 1.07);
  // The wire matte: a hairline against the sky is a mixed pixel, and what is
  // left of it after the clear sky is taken out is still partly that sky (the
  // filled sky never matches the photo's to the last bit). Feather it: where
  // the matte is mostly sky, the wire's own colour is only its darkness.
  float fringe = smoothstep(0.15, 0.7, skyRaw) * edgeSky;
  over = mix(over, vec3(luma(over)) * vec3(0.92, 0.97, 1.04), max(fringe, edgeSky * 0.6));
  // glass mirrors the sky, so it greys with it
  over = mix(over, mix(vec3(yo), over, 0.3) * 0.82, glass);
  // the departing cloud's edge is lit from behind: a silver rim
  float rim = sunSky * (1.0 - sunSky) * 4.0;
  rs = mix(rs, vec3(0.62, 0.64, 0.66), rim * 0.55);
  // Surface and sky each change with their own cloud edge: a wire against
  // the sky goes over with the sky behind it, so the clear sky can never
  // show through its matte while the storm is already overhead.
  float sf = smoothstep(0.0, 1.0, mix(sunNow, sunSky, edgeSky));
  float ss = smoothstep(0.0, 1.0, sunSky);
  vec3 fgDry = mix(surf, over, fringe * (1.0 - ss));
  vec3 fgC = mix(over, fgDry, sf);
  vec3 skyC = mix(rs, clean, ss);
  // all clear: exactly the photo
  vec3 comp = fgC * (1.0 - skyA) + skyC * skyA;
  return mix(comp, c, sf * ss);
}

// Ring ripples on standing water, Lagarde-style: one drop per cell at a
// random time; each ring runs out at ~0.35 m/s and fades.
vec2 ripples(vec2 g, float t) {
  vec2 n = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float cs = layer == 0 ? 0.28 : 0.19;
    vec2 q = g / cs + float(layer) * 7.31;
    vec2 cell = floor(q);
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(i, j);
        vec2 h = hash22(c);
        float rate = 1.1 + h.x * 0.6;
        float ph = t * rate + h.y;
        float age = fract(ph);
        vec2 seed = hash22(c + floor(ph) * 1.37);
        vec2 pos = (c + seed) * cs - float(layer) * 7.31 * cs;
        vec2 d = g - pos;
        float r = length(d);
        float R = age * 0.11;
        float x = (r - R) / 0.012;
        float env = exp(-x * x) * (1.0 - age) * (1.0 - age);
        n += d / max(r, 1e-4) * cos(x * 1.6) * env * (seed.x < uRain ? 1.0 : 0.0);
      }
  }
  return n;
}

// Rain veil: only with distance (along the line of sight, so a reflection
// gets it for the whole of its path). The near street stays clear and dark;
// the far end, seen through a few hundred metres of downpour, goes soft
// toward the light of the bright gap behind it.
const vec3 VEIL = vec3(0.29, 0.31, 0.335);
float veilAt(float d) {
  return (1.0 - exp(-max(d - 25.0, 0.0) / 220.0)) * uRain * (1.0 - smoothstep(250.0, 400.0, d)) * 0.6;
}

// The sky as a reflection sees it, at an image uv: the storm deck (with its
// bright gap low over the street's end) or the clear sky, by the cloud edge.
vec3 skyAt(vec2 su, float lod) {
  vec3 clear = srgbToLinear(textureLod(uClean, su, lod).rgb);
  return mix(rainSky(su), clear, smoothstep(0.0, 1.0, sunAt(1000.0, su)));
}

// Screen-space reflection on the point map: the photo seen in the water,
// upside down about each object's foot (each re-lit for its own weather).
vec3 reflectRay(vec3 P, vec3 R, float lod, out float hit) {
  hit = 0.0;
  // a facet tilted far enough to send its ray down only sees more road: keep
  // the ray just above the horizon instead of letting it read the sky there
  float el = dot(R, uUp);
  if (el < 0.015) R = normalize(R + uUp * (0.015 - el));
  float t = max(0.05, -P.z * 0.02);
  vec3 Q = P;
  vec2 uv = vec2(0.0);
  float prevT = 0.0;
  float tHit = 0.0;
  for (int i = 0; i < 40; i++) {
    t *= 1.22;
    Q = P + R * t;
    uv = project(Q);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || Q.z > -0.2) break;
    float zs = depthAt(uGeo, uv);
    float zr = -Q.z;
    if (zs < zr && zs > 400.0) break;           // into open sky
    vec4 gh = texelFetch(uGeo, clamp(ivec2(uv * vec2(MAP)), ivec2(0), MAP - 1), 0);
    float upness = dot(vec3(gh.b * 2.0 - 1.0, (gh.a - 0.75) * 4.0, 0.0), uUp);
    if (zs < zr * 0.995 && zr - zs < max(0.35, t * 0.25) && upness < 0.7) {
      // refine between the last two steps
      float a = prevT, b = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (a + b);
        vec3 M = P + R * m;
        vec2 mu = project(M);
        if (depthAt(uGeo, mu) < -M.z) b = m; else a = m;
      }
      uv = project(P + R * b);
      tHit = b;
      hit = 1.0;
      break;
    }
    prevT = t;
  }
  float s;
  // Open sky above, or out of frame: the sky in that direction (the filled
  // sky is defined behind everything, so a ray past a roof still finds it).
  vec2 su = clamp(project(P + R * 400.0), vec2(0.02), vec2(0.98));
  vec3 sky = skyAt(su, max(lod, 2.0));
  if (hit > 0.5) {
    float zh = depthAt(uGeo, uv);
    vec3 c = relit(uv, lod, sunAt(zh, uv), sunAt(1000.0, uv), s);
    // seen through the rain, there and back: the far street's end mirrors
    // as the pale sheet it is in the downpour
    c = mix(c, VEIL, veilAt(length(P) + tHit) * (1.0 - s));
    // fade toward the frame edges so the reflection never ends on a line
    vec2 e = smoothstep(vec2(0.0), vec2(0.06), uv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - uv);
    return mix(sky, c, e.x * e.y);
  }
  return sky;
}

void main() {
  vec2 iuv = uCrop.xy + vec2(vUv.x, 1.0 - vUv.y) * uCrop.zw;
  float z = depthAt(uGeo, iuv);
  vec4 g4 = texelFetch(uGeo, clamp(ivec2(iuv * vec2(MAP)), ivec2(0), MAP - 1), 0);
  vec3 N = vec3(g4.b * 2.0 - 1.0, (g4.a - 0.75) * 4.0, 0.0);
  N.z = sqrt(max(0.0, 1.0 - dot(N.xy, N.xy)));
  vec3 Vd = normalize(viewRay(iuv));
  vec3 P = viewRay(iuv) * z;
  vec4 mat = texture(uMat, iuv);
  float por = mat.r, gloss = mat.g, bead = mat.b, fol = mat.a * 2.0 - 1.0;
  vec4 wat = textureLod(uWater, iuv, 0.0);
  float fillT = wat.r / 0.96;
  fillT *= fillT;
  float dep = wat.g;
  float expo = wat.b;
  float lit = clamp(wat.a * 2.0 - 1.0, 0.0, 1.0);
  float sunNow = sunAt(z, iuv);

  float sunSky = sunAt(1000.0, iuv);
  float skyA;
  vec3 col = relit(iuv, uLodBias, sunNow, sunSky, skyA);
  float surf = 1.0 - skyA;

  vec2 gp = vec2(dot(P, uRight), dot(P, uFwd));
  float isGround = step(0.85, dot(N, uUp)) * surf;
  float dist = z;

  // --- how wet this surface is ------------------------------------------
  // Supply: rain that reached it (overhangs shelter, walls take less).
  float vert = 1.0 - abs(dot(N, uUp));
  // A wall takes wind-driven rain over the whole face, a little more toward
  // the open sky above it: take only the bake's broadest trend (its per-
  // patch exposure on walls is blotchy), so a face wets as one surface.
  float expoW = mix(expo, 0.3 + 0.55 * textureLod(uWater, iuv, 6.0).b, smoothstep(0.3, 0.7, vert));
  float supply = uAcc * (0.3 + 0.7 * expoW) * mix(1.0, 1.25, vert);
  // Porosity varies slowly across a surface (a few metres; longer down a
  // wall, where the water runs): a gentle unevenness, never patches.
  float yUp = dot(P, uUp);
  vec3 bp = vec3(dot(P, uRight), yUp * mix(1.0, 0.45, vert), dot(P, uFwd)) * 0.22;
  float blot = vnoise3(bp + 3.7);
  // First drops on dry ground: dark spots, one per ~13 cm cell, appearing
  // one by one until they merge (drawn a little large, ~4-9 cm, to read at print size).
  float spots = 0.0;
  if (isGround > 0.5 && dist < 40.0) {
    vec2 q = gp / 0.13;
    for (int j = 0; j <= 1; j++)
      for (int i = 0; i <= 1; i++) {
        vec2 cc = floor(q - 0.5) + vec2(i, j);
        vec2 h = hash22(cc);
        vec2 o = (cc + 0.25 + 0.5 * hash22(cc + 3.1)) * 0.13;
        float r = (0.018 + 0.026 * h.x);
        float d = length(gp - o);
        float aa = 0.6 * dist / ${FX.toFixed(1)} * 2.0;
        spots = max(spots, smoothstep(r + aa, r - aa, d) * step(h.y * 0.14, supply));
      }
    spots *= 1.0 - smoothstep(18.0, 40.0, dist);
  }
  float onset = 0.06 + 0.12 * blot * por + 0.1 * vert;
  float wetIn = max(smoothstep(onset, onset + 0.3, supply), spots * 0.85);
  // Drying: thin films go first, in the sun first; porous concrete holds on,
  // shade holds on.
  float cap = mix(0.16, 0.5, por * por) * (0.8 + 0.4 * blot) + 0.22 * vert;
  cap += 0.25 * (1.0 - lit);
  float ev = uEvap * (0.55 + 0.45 * lit);
  float wet = wetIn * (1.0 - smoothstep(cap - 0.06, cap + 0.06, ev)) * surf;
  // a surface that was dry stays dry under its rain shadow
  wet *= smoothstep(0.02, 0.2, expoW + 0.05 * isGround);

  // --- standing water ----------------------------------------------------
  float water = 0.0;
  if (fillT < 0.999) {
    float level = smoothstep(fillT, fillT + 0.06, uAcc * 1.05);
    // depth now, minus evaporation: shallow edges surface first
    float d = dep * (0.35 + 0.65 * smoothstep(fillT, fillT + 0.5, uAcc)) + 0.05;
    float left = d - ev * 0.95;
    water = level * smoothstep(0.0, 0.025, left) * isGround;
    // where a puddle has just gone the asphalt stays dark a while longer
    wet = max(wet, level * smoothstep(-0.14, 0.0, left) * isGround);
  }

  // --- material response ---------------------------------------------------
  // Darkening and deepening: water in the pores cuts the scattering at the
  // surface (Lagarde: diffuse x ~0.3-0.5 for porous, saturation up).
  float dark = wet * por;
  vec3 c = col;
  float yl = luma(c);
  c = mix(vec3(yl), c, 1.0 + 0.45 * dark);
  // (the road most: its open texture fills and goes near black under a film)
  c *= 1.0 - (0.62 + 0.22 * isGround) * dark * (0.9 + 0.2 * blot);
  // leaves: darker, greener
  c = mix(c, c * vec3(0.78, 0.86, 0.8), fol * wet * 0.6);

  // Fresnel of a water film / surface.
  float cosv = clamp(dot(-Vd, isGround > 0.5 ? uRoadN : N), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);

  // Wet sheen on the film (asphalt, lane paint): the road becomes a rough
  // mirror of the street, by Fresnel, so it goes to glass toward the far end
  // where you see it at a grazing angle. Puddles: a smooth mirror, rippled by
  // every drop while it rains.
  float sheen = wet * gloss * surf;
  float mirror = water;
  if (isGround > 0.5 && (sheen > 0.02 || mirror > 0.01)) {
    vec3 Nr = uRoadN;
    float hit;
    // A wet film on rough asphalt: the micro-facets tilt mostly toward and
    // away from you, so the reflection smears vertically (the long streaks
    // under every light on a wet road). Four taps along that tilt; the film
    // smooths as it thickens, so the smear tightens as the rain piles up.
    float thick = smoothstep(0.25, 1.0, uAcc) * smoothstep(0.4, 1.0, wet);
    vec3 rough = vec3(0.0);
    if (mirror < 0.99) {
      float spread = mix(0.075, 0.03, thick);
      for (int k = 0; k < 4; k++) {
        float o = (float(k) - 1.5) * spread;
        vec3 Nk = normalize(Nr + uFwd * o);
        rough += reflectRay(P, reflect(Vd, Nk), uLodBias + mix(2.4, 1.2, thick), hit);
      }
      rough *= 0.25;
    }
    // The film is broken where the aggregate stands proud of it: finer and
    // rarer as it thickens.
    float grit = vnoise3(vec3(gp * vec2(9.0, 3.0), 1.7));
    // First drops are dark spots, not mirrors: the sheen needs a film, and
    // the film needs the rain to have run together (or a puddle's margin).
    float film = max(smoothstep(0.12, 0.4, supply), mirror);
    float filmK = sheen * film * mix(0.5, 0.95, thick) * mix(0.7 + 0.3 * grit, 1.0, thick);
    vec3 filmC = c * (1.0 - F * filmK) + rough * F * filmK;
    vec3 poolC = filmC;
    if (mirror > 0.01) {
      if (dist < 45.0) {
        vec2 rp = ripples(gp, uTime) * uRain * (1.0 - smoothstep(20.0, 45.0, dist));
        Nr = normalize(Nr + (uRight * rp.x + uFwd * rp.y) * 0.16);
      }
      float Fm = 0.02 + 0.98 * pow(1.0 - clamp(dot(-Vd, Nr), 0.0, 1.0), 5.0);
      vec3 sharp = reflectRay(P, reflect(Vd, Nr), uLodBias + 0.3, hit);
      // the asphalt under a few mm of water is darker still, and what the
      // water reflects sits on top of it
      float Rw = clamp(Fm * 1.15 + 0.05, 0.0, 0.94);
      poolC = c * 0.3 * (1.0 - Rw) + sharp * Rw;
    }
    c = mix(filmC, poolC, mirror);
  } else if (sheen > 0.02) {
    // walls, leaves, signs: a faint sheen of the grey sky at their Fresnel
    float Fn = 0.02 + 0.98 * pow(1.0 - clamp(dot(-Vd, N), 0.0, 1.0), 5.0);
    vec3 env = mix(rainSky(vec2(iuv.x, 0.15)), srgbToLinear(texture(uClean, vec2(iuv.x, 0.1)).rgb), sunNow);
    c += env * Fn * sheen * 0.35 * (0.5 + 0.5 * max(dot(N, uUp), 0.0));
  }

  // Beads on metal, paint and glass: a scatter of tiny bright drops.
  if (bead > 0.05 && wet > 0.02) {
    vec2 sp = iuv * IMG / 2.2;
    vec2 cell = floor(sp);
    vec2 h = hash22(cell);
    float dd = length(fract(sp) - 0.5 - (h - 0.5) * 0.6);
    float drop = smoothstep(0.3, 0.1, dd) * step(0.88, h.x);
    vec3 skyc = mix(rainSky(vec2(0.5, 0.1)), vec3(1.0, 0.98, 0.94) * 1.4, sunNow);
    c = mix(c, skyc * 0.75, drop * bead * min(wetIn, 1.0) * 0.3 * (1.0 - smoothstep(0.0, 0.5, ev)));
  }

  // Leaves glint where the sun comes back on them while they are still wet.
  if (fol > 0.5 && wet > 0.02) {
    vec2 sp = iuv * IMG / 3.0;
    vec2 cell = floor(sp);
    vec2 h = hash22(cell + 7.7);
    float tw = 0.5 + 0.5 * sin(uTime * (0.6 + h.y * 1.3) + h.x * 40.0);
    float g = smoothstep(0.3, 0.05, length(fract(sp) - 0.5)) * step(0.93, h.x) * tw;
    c += vec3(1.0, 0.97, 0.9) * g * sunNow * lit * wet * 0.9;
    c += vec3(0.7, 0.8, 0.9) * g * (1.0 - sunNow) * wet * 0.12;
  }

  // Impact splashes on wet ground while it rains: a short white crown.
  if (isGround > 0.5 && uRain > 0.01 && dist < 28.0) {
    vec2 q = gp / 0.16;
    vec2 cell = floor(q);
    vec2 h = hash22(cell + 1.3);
    float ph = uTime * (2.2 + h.x) + h.y;
    float age = fract(ph);
    vec2 seed = hash22(cell + floor(ph));
    vec2 o = (cell + 0.2 + 0.6 * seed) * 0.16;
    float r = length(gp - o);
    float flash = smoothstep(0.022, 0.006, r) * smoothstep(0.12, 0.0, age) * step(seed.y, uRain);
    c += vec3(0.5, 0.53, 0.56) * flash * 0.45 * (1.0 - smoothstep(12.0, 28.0, dist));
  }

  // Rain veil (not on wires and edges against the sky itself: they are
  // already sky).
  c = mix(c, VEIL, veilAt(dist) * surf);

  // Steam, sparingly: sun on wet, warm asphalt just after the shower.
  float steam = isGround * wet * sunNow * lit * (1.0 - smoothstep(0.0, 0.6, uEvap)) * smoothstep(0.02, 0.15, uEvap);
  float sn = fbm3(vec3(gp.x * 1.4, gp.y * 0.35, 0.0) + vec3(0.0, 0.0, uTime * 0.25) - vec3(0.0, uTime * 0.0, 0.0));
  c = mix(c, vec3(0.62, 0.6, 0.56), steam * 0.07 * sn);

  outColor = vec4(c * uExpo, 1.0);
  if (uDbg > 0.5) {
    vec4 mm = texture(uMat, iuv);
    float gl = (1.0 - smoothstep(0.02, 0.07, mm.r)) * smoothstep(0.5, 0.65, mm.b) * (1.0 - smoothstep(0.18, 0.3, mm.g));
    float v = uDbg < 1.5 ? gl : uDbg < 2.5 ? lit : uDbg < 3.5 ? wet : uDbg < 4.5 ? water : uDbg < 5.5 ? por : sunNow;
    outColor = vec4(vec3(v * v), 1.0);
  }
}`;

// Rain: instanced streaks in camera space, depth tested against the street.
const RAIN_VS = `#version 300 es
in vec4 aDrop;    // screen x (0..1, with margin), depth (m), phase, size
in vec2 aCorner;  // (0|1 along the streak, -1|1 across)
uniform float uTime;
uniform vec3 uUp;
uniform vec3 uWind;
uniform float uFall;      // m/s
uniform float uShutter;   // s
uniform vec2 uView;       // tan of the half field (x, y)
uniform vec2 uRes;        // render target px
uniform float uFocus;     // m
uniform vec4 uCrop;
out float vAlpha;
out float vAcross;
out float vAlong;
out float vZ;
out vec2 vIuv;
${COMMON}
void main() {
  float d = aDrop.y;
  vec3 g = normalize(-uUp + uWind);
  // the frustum at this depth: the drop's column, wrapped vertically
  float halfH = d * uView.y * 1.35;
  vec3 c0 = vec3((aDrop.x * 2.0 - 1.0) * d * uView.x, 0.0, -d);
  float span = halfH * 2.0;
  float s = mod(uTime * uFall + aDrop.z * span, span) - halfH;
  vec3 head = c0 + g * s - uUp * 0.0;
  // centre the column on the frustum's middle row (the camera looks up 13°)
  head.y += d * ((${CY.toFixed(1)} - ${IMG_H / 2}.0) / FX);
  vec3 tail = head - g * uFall * uShutter;
  vec2 ph = (project(head) - uCrop.xy) / uCrop.zw * uRes;
  vec2 pt = (project(tail) - uCrop.xy) / uCrop.zw * uRes;
  vec2 dir = ph - pt;
  float len = length(dir);
  vec2 t = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-t.y, t.x);
  // width: drop diameter in px, plus defocus (the lens focuses on ~18 m)
  float px = uRes.y / (IMG.y * uCrop.w) * FX;
  float diam = aDrop.w * px / d;
  float coc = 0.0055 * px * abs(1.0 / d - 1.0 / uFocus) * 1.4;
  float w = max(diam + coc, 1.1);
  vec2 p = mix(pt, ph, aCorner.x) + nrm * aCorner.y * w * 0.5 - t * (aCorner.x * 2.0 - 1.0) * -w * 0.5;
  // coverage: a thin drop covers a fraction of its 1px-wide line; a blurred
  // one spreads the same light over a wider one
  vAlpha = clamp(diam / w, 0.0, 1.0) * min(1.0, len / max(w, 1.0) + 0.3);
  vAcross = aCorner.y;
  vAlong = aCorner.x;
  vZ = -mix(tail.z, head.z, aCorner.x);
  vec2 ndc = p / uRes * 2.0 - 1.0;
  vIuv = uCrop.xy + p / uRes * uCrop.zw;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;

const RAIN_FS = `#version 300 es
precision highp float;
in float vAlpha;
in float vAcross;
in float vAlong;
in float vZ;
in vec2 vIuv;
out vec4 outColor;
uniform sampler2D uGeo;
uniform vec3 uDropLight;  // what a drop shows: the sky it refracts
uniform float uGain;
${COMMON}
void main() {
  float zs = depthAt(uGeo, vIuv);
  if (zs < vZ) discard;
  float across = 1.0 - vAcross * vAcross;
  float along = smoothstep(0.0, 0.25, vAlong) * smoothstep(1.0, 0.75, vAlong);
  float a = vAlpha * across * along * uGain;
  outColor = vec4(uDropLight * a, a);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
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

function program(gl, vs, fs, attribs = ["aPos"]) {
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
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
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

function imageTexture(gl, img, { mips = false, nearest = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  const min = nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
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
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// Summer film, and the cooler stock the shower slides it toward: less warm,
// less cobalt (there is no blue left to deepen). Not more veil: a dark wet
// street under a storm has deep blacks and bright reflections, and a lifted,
// blued toe and a wide mist over all of it is what turns it to grey.
const SUMMER = { ...FILM_PRESETS.summer };
const SHOWER = {
  warmth: -0.22,
  blueDepth: 0.35,
  saturation: 1.12,
  contrast: 1.3,
  bloom: 0.14,
  softness: 0.5,
  halation: 0.3,
  shadowTint: [0.92, 1, 1.07],
  highlightTint: [0.97, 1, 1.03],
  toeColor: [0.85, 1, 1.12],
  vignette: 0.36,
};
function filmAt(k) {
  const out = {};
  for (const [key, to] of Object.entries(SHOWER)) {
    const from = key in SUMMER ? SUMMER[key] : FILM_DEFAULTS[key];
    out[key] = Array.isArray(to) ? lerp3(from, to, k) : lerp(from, to, k);
  }
  return out;
}

function makeDrops() {
  // Drops are 1-3.5 mm. The array is shuffled so drawing the first N*rain
  // instances thins the rain evenly.
  const a = new Float32Array(DROPS * 4);
  let seed = 9;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < DROPS; i++) {
    const u = rnd();
    // uniform in the view's volume out to 45 m (about 1.5 visible drops per m³):
    // a couple within arm's reach, thousands far off
    // plus a band at 3-14 m, where a 1/40 s streak is long and sharp enough to
    // read: that band is what a photo of a downpour shows
    const d = i % 5 < 2 ? 3 + 11 * rnd() : Math.cbrt(0.8 ** 3 + u * (45 ** 3 - 0.8 ** 3));
    a[i * 4] = -0.1 + rnd() * 1.2;
    a[i * 4 + 1] = d;
    a[i * 4 + 2] = rnd();
    a[i * 4 + 3] = 0.001 + 0.0025 * rnd() ** 2;
  }
  return a;
}

export async function createYuudachi(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? clamp(+v, 0, 1) : null;
  };
  const rainQ = num("rain");
  const dryQ = num("dry");
  const timeQ = q.get("t");
  const frozen = timeQ != null && timeQ !== "" && Number.isFinite(+timeQ);
  const held = rainQ != null || dryQ != null || q.get("sun") != null || +(q.get("hold") || 0) > 0;
  const still = held || q.get("still") === "1";
  const DBG = +(q.get("dbg") || 0);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [photoImg, skyImg, geoImg, matImg, waterImg, cleanImg] = await Promise.all(
    ["photo.webp", "sky.png", "geo.webp", "mat.webp", "water.webp", "skyclean.jpg"].map((f) => loadImage(BASE + f)),
  );
  const tex = {
    photo: imageTexture(gl, photoImg, { mips: true }),
    sky: imageTexture(gl, skyImg, { mips: true }),
    geo: imageTexture(gl, geoImg, { nearest: true }),
    mat: imageTexture(gl, matImg),
    water: imageTexture(gl, waterImg, { mips: true }),
    clean: imageTexture(gl, cleanImg, { mips: true }),
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Rain streak instances.
  const rainVao = gl.createVertexArray();
  gl.bindVertexArray(rainVao);
  const dropBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dropBuf);
  gl.bufferData(gl.ARRAY_BUFFER, makeDrops(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const scene = program(gl, VERT, SCENE);
  const rain = program(gl, RAIN_VS, RAIN_FS, ["aDrop", "aCorner"]);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // Road normal from the plane fit of the point map: h = a x + b z + c.
  const rn = [UP[0] - PLANE[0], UP[1], UP[2] - PLANE[1]];
  const rl = Math.hypot(...rn);
  const ROADN = rn.map((v) => v / rl);

  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      // fill the tile, cropping the photo's height
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      const side = W < 640 ? 16 : Math.max(24, W * 0.06);
      let h = H * (W < 640 ? 0.78 : 0.82);
      let w = h * ASPECT;
      if (w > W - side * 2) {
        w = W - side * 2;
        h = w / ASPECT;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - (W < 640 ? 8 : 12) });
    }
    // An embedded tile is wider than the photo: show its full width and the
    // band from the cumulus down to the road.
    L.crop = [0, 0, 1, 1];
    const a = L.w / L.h;
    if (a > ASPECT * 1.02) {
      const hh = ASPECT / a;
      L.crop = [0, clamp(0.66 - hh / 2, 0, 1 - hh), 1, hh];
    } else if (a < ASPECT * 0.98) {
      const ww = a / ASPECT;
      L.crop = [(1 - ww) / 2, 0, ww, 1];
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // ---- weather state ----
  // rain: falling now; acc: fallen this shower; evap: drying since; sun: the
  // cloud edge (1 = clear everywhere).
  const S = { rain: 0, acc: 0, evap: 0, sun: 1, since: 0 };
  if (rainQ != null) Object.assign(S, { rain: rainQ > 0 ? 1 : 0, acc: rainQ * 1.15, evap: 0, sun: rainQ > 0 ? 0 : 1 });
  if (dryQ != null) Object.assign(S, { rain: 0, acc: rainQ ?? 1.15, evap: dryQ * 2.2, sun: 1 });
  // ?sun= holds the cloud edge part-way (with ?rain, the moment it breaks)
  const sunQ = num("sun");
  if (sunQ != null) Object.assign(S, { sun: sunQ, rain: dryQ != null ? 0 : clamp(1 - sunQ * 1.6, 0, 1) });
  let holding = false;
  let keyHold = false;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (embedded || inPrint(p)) holding = true;
  });
  stage.on("up", () => {
    holding = false;
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKeyDown = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    keyHold = true;
  };
  const onKeyUp = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    keyHold = false;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  // ---- the weather, one step ----
  // While held: the cloud edge runs up the street toward you (τ 0.9 s), the
  // first big drops, then the downpour (τ 1.1 s); rain piles up (~6 s to
  // fill the hollows to the brim) and rewets anything that had started to dry. Let go:
  // the rain stops (τ 0.45 s), the sun comes back down the street (τ 1.6 s),
  // and evaporation runs, three times faster in the sun than in the shade.
  const EVAP_END = 2.2;
  const step = (dt, wet) => {
    const k = (tau) => 1 - Math.exp(-dt / tau);
    if (wet) {
      S.since += dt;
      S.sun += (0 - S.sun) * k(0.9);
      const goal = S.since > 0.45 ? 1 : 0.06;
      S.rain += (goal - S.rain) * k(S.since > 0.45 ? 1.1 : 0.3);
      S.acc = Math.min(1.3, S.acc + S.rain * dt * 0.2);
      S.evap = Math.max(0, S.evap - S.rain * dt * 1.2);
    } else {
      S.since = 0;
      S.rain += (0 - S.rain) * k(0.45);
      if (S.rain < 0.35) S.sun += (1 - S.sun) * k(1.6);
      if (S.acc > 0) {
        S.evap = Math.min(EVAP_END, S.evap + dt * 0.08 * (0.25 + 0.75 * S.sun) * (1 - S.rain));
        if (S.evap >= EVAP_END) {
          S.acc = 0;
          S.evap = 0;
        }
      }
    }
    return wet || S.rain > 0.002 || S.sun < 0.999 || S.acc > 0;
  };
  // ?hold=s&release=s: replay a gesture offline and hold its last state.
  const holdQ = +(q.get("hold") || 0);
  if (holdQ > 0) {
    for (let t = 0; t < holdQ; t += 1 / 60) step(1 / 60, true);
    const rel = +(q.get("release") || 0);
    for (let t = 0; t < rel; t += 1 / 60) step(1 / 60, false);
  }

  let time = frozen ? +timeQ : 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // Crop: the print shows the whole photo when its aspect matches; an
    // embedded tile crops it around the street.
    const u = scene.u;
    gl.useProgram(scene.p);
    const bindT = (unit, t, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(u[name], unit);
    };
    bindT(0, tex.photo, "uPhoto");
    bindT(1, tex.sky, "uSky");
    bindT(2, tex.geo, "uGeo");
    bindT(3, tex.mat, "uMat");
    bindT(4, tex.water, "uWater");
    bindT(5, tex.clean, "uClean");
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uRain, S.rain);
    gl.uniform1f(u.uAcc, S.acc);
    gl.uniform1f(u.uEvap, S.evap);
    gl.uniform1f(u.uSun, S.sun);
    // Under the storm the street is lit by the deck alone: the camera keeps
    // its exposure a little under, so it reads as dark and wet, not lifted.
    const gloom = 1 - S.sun;
    gl.uniform1f(u.uExpo, 2 ** (expoStops - 0.15 * gloom));
    gl.uniform1f(u.uLodBias, Math.max(0, Math.log2((IMG_H * L.crop[3]) / L.rh)));
    gl.uniform3fv(u.uUp, UP);
    gl.uniform3fv(u.uRight, RIGHT);
    gl.uniform3fv(u.uFwd, FWD);
    gl.uniform3fv(u.uRoadN, ROADN);
    gl.uniform1f(u.uDbg, DBG);
    gl.uniform4fv(u.uCrop, L.crop);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Rain streaks, composited over the street in linear light.
    const n = q.get("drops") === "0" ? 0 : Math.round(DROPS * clamp(S.rain, 0, 1) ** 0.8);
    if (n > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(rain.p);
      gl.bindVertexArray(rainVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.geo);
      gl.uniform1i(rain.u.uGeo, 0);
      gl.uniform1f(rain.u.uTime, time);
      gl.uniform3fv(rain.u.uUp, UP);
      gl.uniform3fv(rain.u.uWind, [0.07, 0, 0.02]);
      gl.uniform1f(rain.u.uFall, 7.5);
      gl.uniform1f(rain.u.uShutter, 1 / 40);
      gl.uniform2f(rain.u.uView, IMG_W / 2 / FX, IMG_H / 2 / FX);
      gl.uniform2f(rain.u.uRes, L.rw, L.rh);
      gl.uniform1f(rain.u.uFocus, 18);
      gl.uniform4fv(rain.u.uCrop, L.crop);
      // a drop is a tiny lens: it shows the bright sky above and behind,
      // much brighter than the dim street it falls in front of
      gl.uniform3fv(rain.u.uDropLight, [0.46, 0.49, 0.53]);
      gl.uniform1f(rain.u.uGain, 0.75);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
    }

    film.render(
      sceneT.tex,
      {
        ...SUMMER,
        ...filmAt(clamp(gloom, 0, 1)),
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        grainSeed,
      },
      filmT.fbo,
    );

    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const REVEAL = 2.0;
  let slow = 0;
  let lastNow = 0;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!frozen) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    if (!frozen) time += dt;
    if (t0 < 0) t0 = time;
    const age = frozen ? 99 : time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let active = false;
    if (!held) active = step(dt, holding || keyHold);

    if (!reduce && !frozen) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    const moving = !frozen && (active || age < REVEAL + 0.2 || held);
    if (!dirty && !moving) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(rain.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(dropBuf);
      gl.deleteBuffer(cornerBuf);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(rainVao);
      stage.destroy();
    },
  };
}
