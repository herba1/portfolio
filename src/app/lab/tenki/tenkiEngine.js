import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Tenki: lying under a wooden utility pole and looking up it, its wires
// crossing over you, under building summer cumulus. Drag across and the hour
// moves: the sun goes round behind you on its real path for late July at
// 35.7 N, and the pole, the crossarm, the hardware and the cables are lit by
// it, from the east in the morning and the west in the evening: a warm key on
// the sunlit face, blue skylight in the shade, the terminator crossing the
// pole, cable shadows marched through the depth map, the sheath and the
// galvanised steel catching it. Toward evening the sun reddens and weakens
// through the air mass, and the clouds take its colour.
//
//  - The photograph is taken apart offline (tools/depth/bakes/tenki): a sky
//    matte that keeps every wire (thin-structure trimap, then colour-line
//    unmixing between the local sky and the local cable colour, in linear
//    light), the foreground decontaminated of its old sky, MoGe-2 normals and
//    metric depth, and the photo's own light on the pole fitted as a function
//    of the normal so it can be divided out: albedo = (I - glare) / S_orig,
//    S_orig in colour (its sun against its sky) and corrected on the trunk by
//    what the fit missed (oldlight.py), then put in absolute terms (weathered
//    pole wood, ~0.14).
//  - Each recorded sky (five Poly Haven HDRIs, CC0) is rendered through the
//    photo's lens and reduced to light: SH9 irradiance of the sky plus a sunlit
//    ground, and the sun's direction, irradiance and angular spread. At hour h
//    the recorded sun is moved to the sun's position then, held at a clear
//    sky's ~5:1 over the skylight on a face turned to it, and carried through
//    that hour's air mass (Kasten-Young), which reddens and weakens it; the
//    skylight's SH9 is turned about the vertical with it, dims as the sun
//    drops and gains a warm lobe round a low sun, and the clouds take the
//    sun's colour. The foreground is albedo x (SH9(n) x sky view + sun x
//    OrenNayar(n, l) x shadow) + GGX sun specular x shadow.
//  - Between two skies (?sky= fractions, the up / down keys) everything is a
//    crossfade of light, in linear light.
//
// Query: ?sky=0..4 holds the weather at the hour it was recorded (4, building
// cumulus, is the default sky; 0 clear low sun, 1 cirrus, 2 mackerel,
// 3 fair-weather cumulus); ?t=7..18.5 holds the hour; ?still=1 skips the
// reveal; ?grain=0 for static grain; ?raw=1 the light without the film;
// ?dbg=1 grey albedo, 2 sun visibility, 3 sun only, 4 albedo.

const BASE = "/lab/tenki/";
const SKY_FILES = ["clear", "cirrus", "mackerel", "cumulus", "tower"];
const START = 4; // building cumulus
// The day: lying at the pole's foot, facing north, at 35.7 N (Tokyo) in late
// July (solar declination +20.5). The drag is the hour, in local solar time;
// the sun's path never crosses the frame (it stays behind and to the sides).
const LAT = (35.7 * Math.PI) / 180;
const DEC = (20.5 * Math.PI) / 180;
const DAY = [7, 18.5];
// Optical depth at the film's R, G, B: Rayleigh (as 1 / lambda^4) plus a humid
// July's haze (Angstrom ~1.3): the sun's colour and strength through the air
// mass at its height.
const TAU = [0.14, 0.22, 0.44];
// The bake balanced every sky's sun alone to the film's white. Daylight film
// is balanced for sun and sky together, which is bluer than the sun, and a July
// afternoon sun through humid air is warmer again (~4800 K against 5500 K): it
// is that warm offset against the blue skylight that tells sun from shade on a
// grey pole.
const KEY = [1.12, 1.0, 0.8];
// Direct to diffuse on a face turned to a clear sun at air mass 1.
const CLEAR_RATIO = 5;
// The warm sky round a low sun, as a share of the sky's light on a face
// turned to the sun.
const AUREOLE = 0.6;
// How hard the clouds take the sun's colour (1 = as the beam has it), the
// share of their light that is the sky's, and that skylight's colour.
const CLOUD_WARM = 2;
const CLOUD_FILL = 0.25;
const CLOUD_SKY = [0.78, 0.97, 1.32];
// The HDRIs are open-field skies. Lying in a residential street, the pole
// sees the sun but not the whole sky: houses, wires and trees take the lower
// band of it (a sky-view factor of ~0.6 for a vertical face in a street of
// two-storey houses), so the skylight that fills the shadows is that much less.
const SKY_VIEW = 0.6;
// Exposure: each sky is first exposed for its own sky (median at the photo's
// sky value); then the camera meets the pole half way, the way a negative is
// exposed for the whole frame. 0 = expose for the sky, 1 = for the pole.
const METER = 0;
const RHO_POLE = 0.14;
const VEIL = 0.025;
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
// Print: 4:3, cropped a little into the photo so the frame can breathe.
const PRINT_ASPECT = 4 / 3;
const CROP = 0.965;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Sun visibility, once per change of light, in photo space (half res): from
// each foreground point a ray toward the sun, marched in screen space through
// the depth map with perspective-correct depth, steps growing with distance
// (a far occluder's shadow is as wide as the sun's penumbra there anyway). A
// cable, a bolt or the crossarm is in the way when the depth map there is
// nearer than the ray by more than the noise and less than its thickness. A
// veiled sun's shadow melts: an occluder of ~6 cm blocks only thickness /
// penumbra of the sun once the penumbra is wider than it.
const SUNVIS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFg;
uniform sampler2D uNd;
uniform sampler2D uTrunk; // the trunk, which does not shade itself
uniform vec2 uSize;
uniform float uFx;
uniform vec2 uZ;
uniform vec3 uSunDir[2];
uniform float uSpread[2]; // sun's angular radius, rad
uniform vec2 uOn;
uniform float uRays;      // 1 while the sun is moving, 2 at rest

float depthAt(vec2 uv) {
  float l = texture(uNd, uv).a;
  return uZ.x * pow(uZ.y / uZ.x, l);
}

vec2 projectPx(vec3 P) {
  return vec2(0.5 * uSize.x + uFx * P.x / -P.z, 0.5 * uSize.y - uFx * P.y / -P.z);
}

float march(vec3 P, vec3 L, float spread, float jit) {
  float T = 7.0;
  if (L.z > 1e-4) T = min(T, (-0.2 - P.z) / L.z);
  if (T <= 0.02) return 1.0;
  vec3 E = P + L * T;
  vec2 a = projectPx(P);
  vec2 b = projectPx(E);
  vec2 ab = b - a;
  float len = length(ab);
  if (len < 1.0) return 1.0;
  float iz0 = 1.0 / -P.z;
  float iz1 = 1.0 / -E.z;
  float occ = 0.0;
  float s = 1.0;
  for (int i = 0; i < 120; i++) {
    float st = 1.5 + 0.032 * s;
    float sj = s + st * jit; // each ray samples at its own fraction of every step
    s += st;
    if (sj >= len) break;
    float f = sj / len;
    vec2 q = a + ab * f;
    if (q.x < 0.0 || q.y < 0.0 || q.x > uSize.x || q.y > uSize.y) break;
    vec2 uv = q / uSize;
    float iz = mix(iz0, iz1, f);
    float zr = 1.0 / iz;
    float t = T * f * iz1 / iz; // distance along the ray (m)
    float cov = texture(uFg, uv).a * (1.0 - texture(uTrunk, uv).r);
    float dz = zr - depthAt(uv);
    float eps = 0.035 + 0.03 * t;
    // a cable, bolt or the crossarm is ~3 to 12 cm through; a ray that passes
    // further behind it than that went behind it, not through it
    float hit = cov * smoothstep(eps, eps * 1.6, dz) * (1.0 - smoothstep(eps + 0.1, eps + 0.16, dz));
    float pen = 2.0 * spread * t;
    occ = max(occ, hit * min(1.0, 0.06 / max(pen, 1e-4)));
    if (occ > 0.99) break;
  }
  return 1.0 - occ;
}

void main() {
  vec2 pu = vec2(vUv.x, 1.0 - vUv.y);
  vec4 f = texture(uFg, pu);
  if (f.a < 0.002) { outColor = vec4(1.0); return; }
  vec2 px = pu * uSize;
  vec3 d = normalize(vec3((px.x - 0.5 * uSize.x) / uFx, -(px.y - 0.5 * uSize.y) / uFx, -1.0));
  vec4 nd = texture(uNd, pu);
  vec3 n = normalize(nd.rgb * 2.0 - 1.0);
  float z = uZ.x * pow(uZ.y / uZ.x, nd.a);
  // start a hair off the surface, toward the camera, so the pole does not shade itself
  vec3 P = d * (z / -d.z);
  P += n * 0.012;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // two rays a half step apart, so thin cables are not stepped over
  vec2 v = vec2(1.0);
  for (int k = 0; k < 2; k++) {
    if ((k == 0 ? uOn.x : uOn.y) < 0.5 || dot(n, uSunDir[k]) < -0.2) continue;
    float a = march(P, uSunDir[k], uSpread[k], jit);
    if (uRays > 1.5) a = 0.5 * (a + march(P, uSunDir[k], uSpread[k], fract(jit + 0.5)));
    if (k == 0) v.x = a;
    else v.y = a;
  }
  outColor = vec4(v, 1.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFg;    // rgb: foreground (sRGB texture -> linear), a: coverage
uniform sampler2D uNd;    // rgb: camera normal * .5 + .5, a: log depth
uniform sampler2D uVis;   // r, g: sun visibility for sun 0, 1 (photo space)
uniform sampler2D uShade; // what the fitted old light missed on the trunk: log rgb, .5 = none
uniform sampler2D uTrunk; // the trunk (wood: rough, whatever its cracks look like)
uniform sampler2D uSky0;
uniform sampler2D uSky1;
uniform vec4 uCrop;       // photo uv (y down) = (x, 1 - y) * crop.xy + crop.zw
uniform vec2 uSize;       // photo px
uniform float uFx;
uniform float uMargin;
uniform vec2 uZ;          // zNear, zFar (m)
uniform mat3 uR;          // camera -> heading frame (y up)
uniform vec3 uUp;         // world up, camera space
uniform float uDrift;     // sky yaw drift (rad)
uniform vec3 uSH[9];      // combined skylight irradiance (turned with the sun), photo units
uniform vec3 uSunDir[2];  // camera space
uniform vec3 uSunE[2];    // photo units (weights, airmass folded in)
uniform float uSunSoft[2];
uniform vec2 uSkyK;       // sky gains (weights folded in)
uniform float uSHo[9];    // the photo's own light (luminance): sky part
uniform vec3 uSunO;       // and its sun, camera space
uniform float uSunOK;
uniform vec3 uOldSun;     // the photo's own sun and sky colours (luminance 1)
uniform vec3 uOldSky;
uniform vec3 uVeil;       // the lens's veiling glare in the photograph (linear)
uniform vec3 uKeyDir;     // the dominant sun now (camera space), for the clouds
uniform vec3 uCloudTint;  // cloud colour now / under a high sun
uniform float uRim;       // strength of the sun side of each cloud
uniform float uSkyDim;    // the blue sky's light now / at the recorded hour
uniform float uExpo;      // reveal exposure, linear factor
uniform float uLinearOut;
uniform float uDbg;
uniform float uCal;       // albedo 1 -> radiance (the relight's calibration)


vec3 shEval(vec3 d) {
  float x = d.x, y = d.y, z = d.z;
  return uSH[0] * 0.282095
    + uSH[1] * (0.488603 * y) + uSH[2] * (0.488603 * z) + uSH[3] * (0.488603 * x)
    + uSH[4] * (1.092548 * x * y) + uSH[5] * (1.092548 * y * z)
    + uSH[6] * (0.315392 * (3.0 * y * y - 1.0))
    + uSH[7] * (1.092548 * x * z) + uSH[8] * (0.546274 * (x * x - z * z));
}

float shEvalO(vec3 d) {
  float x = d.x, y = d.y, z = d.z;
  return uSHo[0] * 0.282095
    + uSHo[1] * (0.488603 * y) + uSHo[2] * (0.488603 * z) + uSHo[3] * (0.488603 * x)
    + uSHo[4] * (1.092548 * x * y) + uSHo[5] * (1.092548 * y * z)
    + uSHo[6] * (0.315392 * (3.0 * y * y - 1.0))
    + uSHo[7] * (1.092548 * x * z) + uSHo[8] * (0.546274 * (x * x - z * z));
}

vec3 decodeSky(vec3 v) {
  vec3 p = min(pow(v, vec3(2.2)), vec3(0.996));
  return p / (1.0 - p);
}

// rotate v about axis k by angle a (Rodrigues)
vec3 rot(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// Oren-Nayar (rough, sigma ~ .45): weathered wood and cable sheath are not
// Lambertian; the lit side stays flatter and falls off harder at the
// terminator, and a sun behind the camera lights them back toward it.
float orenNayar(vec3 n, vec3 l, vec3 v) {
  float nl = dot(n, l);
  float nv = max(dot(n, v), 1e-3);
  if (nl <= 0.0) return 0.0;
  const float A = 1.0 - 0.5 * 0.2025 / (0.2025 + 0.33);
  const float B = 0.45 * 0.2025 / (0.2025 + 0.09);
  float s = dot(l, v) - nl * nv;
  float t = s > 0.0 ? max(nl, nv) : 1.0;
  return nl * (A + B * s / t);
}

// GGX sun specular (Smith-Schlick, Schlick Fresnel): cable sheath is glossy
// polyethylene, the hardware galvanised steel, the wood rough. Per unit sun
// irradiance, times n.l.
float ggx(vec3 n, vec3 l, vec3 v, float rough, float f0) {
  float nl = dot(n, l);
  float nv = max(dot(n, v), 1e-3);
  if (nl <= 0.0) return 0.0;
  vec3 h = normalize(l + v);
  float nh = max(dot(n, h), 0.0);
  float a = rough * rough;
  float a2 = a * a;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dd * dd);
  float k = a * 0.5;
  float G = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  float F = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  return D * G * F / (4.0 * nl * nv) * nl;
}

vec2 skyUv(vec3 ds) {
  return vec2(0.5) + vec2(ds.x / -ds.z, -ds.y / -ds.z) * uFx / uSize / uMargin;
}

// how much of a sky pixel is cloud: white against the polarised cobalt
float cloudAt(vec2 su, float lod) {
  vec3 v = textureLod(uSky0, su, lod).rgb * uSkyK.x + textureLod(uSky1, su, lod).rgb * uSkyK.y;
  return smoothstep(0.42, 0.86, v.r / max(v.b, 1e-3));
}

void main() {
  vec2 pu = vec2(vUv.x, 1.0 - vUv.y) * uCrop.xy + uCrop.zw;
  vec2 px = pu * uSize;
  vec3 d = normalize(vec3((px.x - 0.5 * uSize.x) / uFx, -(px.y - 0.5 * uSize.y) / uFx, -1.0));

  // sky: the same lens, drifting slowly about the vertical
  vec3 ds = rot(d, uUp, uDrift);
  vec2 su = clamp(skyUv(ds), vec2(0.001), vec2(0.999));
  vec3 sky = decodeSky(texture(uSky0, su).rgb) * uSkyK.x + decodeSky(texture(uSky1, su).rgb) * uSkyK.y;
  // the clouds take the hour's sun: the side of each cloud that faces it
  // lifts in the sun's colour, the side away from it falls to skylight blue
  {
    vec3 Ls = rot(uKeyDir, uUp, uDrift);
    vec2 sb = skyUv(normalize(ds + 0.04 * (Ls - ds * dot(ds, Ls))));
    vec2 toSun = sb - skyUv(ds);
    toSun /= max(length(toSun), 1e-6);
    vec2 o = vec2(5.0) / vec2(textureSize(uSky0, 0));
    float c = cloudAt(su, 0.0);
    vec2 g = vec2(cloudAt(su + vec2(o.x, 0.0), 2.0) - cloudAt(su - vec2(o.x, 0.0), 2.0),
                  cloudAt(su + vec2(0.0, o.y), 2.0) - cloudAt(su - vec2(0.0, o.y), 2.0));
    float face = -dot(g, toSun) * 3.0;
    float lit = clamp(face, 0.0, 1.0);
    float shd = clamp(-face, 0.0, 1.0);
    vec3 cl = sky * uCloudTint;
    cl *= 1.0 + uRim * lit * normalize(uCloudTint) * 1.732;
    cl *= mix(vec3(1.0), vec3(0.78, 0.86, 1.0), uRim * shd);
    // the blue between them is skylight, and dims with it; the clouds are
    // lit by the sun, and go with the key
    sky = mix(sky * uSkyDim, cl, c);
  }

  vec4 f = texture(uFg, pu);
  vec3 col = sky;
  if (f.a > 0.002) {
    vec4 nd = texture(uNd, pu);
    vec3 n = normalize(nd.rgb * 2.0 - 1.0);
    // the photo's own light, divided out (grey; the albedo keeps its colour)
    float oSun = uSunOK * max(dot(n, uSunO), 0.0);
    float So = max(shEvalO(uR * n) + oSun, 1e-4);
    vec3 Sc = So * mix(uOldSky, uOldSun, oSun / So);
    Sc *= exp((texture(uShade, pu).rgb - 0.5) * 2.7725887);
    // (the sRGB texture decodes to linear; the glare that lifted every dark
    // thing against the bright sky comes off first, or black cables relight grey)
    vec3 albedo = max(f.rgb - uVeil, f.rgb * 0.15) / Sc;
    if (abs(uDbg - 1.0) < 0.5) albedo = vec3(1.0);
    vec2 vis = texture(uVis, vec2(pu.x, 1.0 - pu.y)).rg;
    vec3 E = uDbg > 2.5 ? vec3(0.0) : max(shEval(uR * n), vec3(0.0));
    // material from the albedo: dark and grey is cable sheath (glossy), light
    // and grey is galvanised steel, the rest wood (rough, barely specular)
    float al = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    float sat = (max(albedo.r, max(albedo.g, albedo.b)) - min(albedo.r, min(albedo.g, albedo.b))) / max(al, 1e-4);
    float wood = texture(uTrunk, pu).r;
    float cable = (1.0 - smoothstep(0.35, 0.7, al)) * (1.0 - smoothstep(0.3, 0.6, sat)) * (1.0 - wood);
    float steel = smoothstep(1.6, 2.6, al) * (1.0 - smoothstep(0.15, 0.35, sat)) * (1.0 - wood);
    float rough = mix(mix(0.8, 0.38, cable), 0.45, steel);
    float f0 = mix(0.04, 0.35, steel);
    vec3 spec = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float s = uSunSoft[k];
      // a veiled sun wraps a little; a clear one is Oren-Nayar
      float wrap = clamp((dot(n, uSunDir[k]) + s) / (1.0 + s), 0.0, 1.0);
      float ndl = mix(orenNayar(n, uSunDir[k], -d), wrap, clamp(s * 4.0, 0.0, 1.0));
      float vk = k == 0 ? vis.r : vis.g;
      E += uSunE[k] * ndl * vk;
      spec += uSunE[k] * ggx(n, uSunDir[k], -d, rough, f0) * vk;
    }
    vec3 fgc = albedo * E + spec / uCal * mix(vec3(1.0), albedo / max(al, 1e-4), steel);
    if (abs(uDbg - 2.0) < 0.5) fgc = vec3(vis.r * vis.g * 0.6);
    if (abs(uDbg - 4.0) < 0.5) fgc = albedo * 0.1;
    col = mix(sky, fgc, f.a);
  }
  col *= uExpo;
  if (uLinearOut < 0.5) col = pow(col / (1.0 + col), vec3(1.0 / 2.2));
  outColor = vec4(col, 1.0);
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

const RAW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 2.0;
  outColor = vec4(pow(c / (1.0 + c), vec3(1.0 / 2.2)), 1.0);
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

function imageTexture(gl, img, { srgb = false, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

// The sun at hour h: direction in the heading frame (y up, +z north, -x east,
// as the photo's camera sees it), and its elevation (rad).
function solar(h) {
  const H = ((h - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(DEC) + Math.cos(LAT) * Math.cos(DEC) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(H) * Math.cos(DEC), Math.cos(LAT) * Math.sin(DEC) - Math.sin(LAT) * Math.cos(DEC) * Math.cos(H));
  return { el, dir: [-Math.sin(az) * Math.cos(el), sinEl, Math.cos(az) * Math.cos(el)] };
}
// Kasten-Young air mass, and the direct beam's transmittance through it
const airmass = (el) => {
  const deg = Math.max(0.5, (el * 180) / Math.PI);
  return 1 / (Math.sin((deg * Math.PI) / 180) + 0.50572 * Math.pow(deg + 6.07995, -1.6364));
};
const beam = (el) => TAU.map((t) => Math.exp(-t * airmass(el)));
// the beam's luminance transmittance at sun height el
const beamL = (el) => dot3(beam(el), LUM);
// the skylight follows the sun's height: a low sun lights less of the sky
const skyGainAt = (el) => clamp(Math.pow(Math.max(0.02, Math.sin(el)), 0.6), 0.25, 1);
// how far the camera opens for the light at sun height el (1 at air mass 1)
const meterAt = (el) => {
  const k = beamL(el) / BEAM_Z;
  return Math.min(1.6, Math.pow((CLEAR_RATIO + 1) / (CLEAR_RATIO * k + skyGainAt(el)), 0.45));
};
// SH9 irradiance in direction v (heading frame), rgb
const SHY = [
  () => 0.282095,
  (x, y) => 0.488603 * y,
  (x, y, z) => 0.488603 * z,
  (x) => 0.488603 * x,
  (x, y) => 1.092548 * x * y,
  (x, y, z) => 1.092548 * y * z,
  (x, y) => 0.315392 * (3 * y * y - 1),
  (x, y, z) => 1.092548 * x * z,
  (x, y, z) => 0.546274 * (x * x - z * z),
];
// clamped-cosine convolution per band (Ramamoorthi and Hanrahan)
const SHA = [Math.PI, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];
function shAt(sh, v) {
  const out = [0, 0, 0];
  for (let i = 0; i < 9; i++) {
    const b = SHY[i](v[0], v[1], v[2]);
    for (let c = 0; c < 3; c++) out[c] += sh[i][c] * b;
  }
  return out;
}
// the hour on the day's arc whose sun is nearest a recorded one
function hourOf(sun) {
  let best = DAY[0];
  let bd = -2;
  for (let h = DAY[0]; h <= DAY[1] + 1e-6; h += 0.01) {
    const c = dot3(solar(h).dir, sun);
    if (c > bd) {
      bd = c;
      best = h;
    }
  }
  return best;
}
// SH9 irradiance (y the polar axis) turned about the vertical by a, in place
// of rotating the sky: the bright side of the skylight goes round with the sun.
function turnSH(sh, a, out) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const c2 = Math.cos(2 * a);
  const s2 = Math.sin(2 * a);
  for (let ch = 0; ch < 3; ch++) {
    const g = (i) => sh[i][ch];
    out[0][ch] = g(0);
    out[1][ch] = g(1);
    out[6][ch] = g(6);
    // (x, z) and y(x, z) pairs: f(phi - a)
    out[3][ch] = g(3) * c + g(2) * sn;
    out[2][ch] = g(2) * c - g(3) * sn;
    out[4][ch] = g(4) * c + g(5) * sn;
    out[5][ch] = g(5) * c - g(4) * sn;
    // xz and (x^2 - z^2) / 2 go as sin 2phi and -cos 2phi
    const p = g(7);
    const q = -g(8);
    out[7][ch] = p * c2 + q * s2;
    out[8][ch] = -(q * c2 - p * s2);
  }
  return out;
}
const LUM = [0.2126, 0.7152, 0.0722];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// the beam's luminance at air mass 1 (the zenith), and at noon on our day
// against it
const BEAM_Z = dot3(TAU.map((t) => Math.exp(-t)), LUM);
const NOON_TRL = beamL(solar(12).el) / BEAM_Z;
// R maps camera -> heading; its transpose maps heading -> camera.
const tmul = (R, v) => [0, 1, 2].map((i) => R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]);

export async function createTenki(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const skyQ = num("sky");
  const hourQ = num("t");
  const held = skyQ != null || hourQ != null;
  const still = held || q.get("still") === "1";
  const dbg = num("dbg") ?? 0;
  const grainOn = q.get("grain") !== "0";
  const raw = q.get("raw") === "1";
  // ?hal= / ?bloom= / ?expo= tune the print while looking at a still
  const dev = {};
  for (const [k, key] of [["hal", "halation"], ["bloom", "bloom"], ["expo", "exposure"], ["blue", "blueDepth"], ["soft", "softness"], ["sat", "saturation"]]) if (q.get(k) != null) dev[key] = +q.get(k);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  stage.canvas.style.cursor = "grab";

  const [data, fgImg, ndImg, shadeImg, trunkImg, ...skyImgs] = await Promise.all([
    fetch(`${BASE}tenki.json`).then((r) => r.json()),
    loadImage(`${BASE}fg.webp`),
    loadImage(`${BASE}nd.webp`),
    loadImage(`${BASE}shade.webp`),
    loadImage(`${BASE}trunk.webp`),
    ...SKY_FILES.map((n) => loadImage(`${BASE}sky-${n}.webp`)),
  ]);
  const fgTex = imageTexture(gl, fgImg, { srgb: true });
  const ndTex = imageTexture(gl, ndImg, { mips: false });
  const shadeTex = imageTexture(gl, shadeImg, { mips: false });
  const trunkTex = imageTexture(gl, trunkImg, { mips: false });
  const skyTex = skyImgs.map((img) => imageTexture(gl, img));
  const N = skyTex.length;

  // Per-sky light in photo units, and the camera's exposure for each sky.
  const R = data.R;
  const up = tmul(R, [0, 1, 0]);
  const skies = data.skies.map((s) => ({ ...s, ePoleL: dot3(s.ePole, LUM) }));
  const geo = Math.exp(skies.reduce((a, s) => a + Math.log(s.ePoleL), 0) / N);
  for (const s of skies) {
    s.expo = Math.pow(s.ePoleL / geo, -METER);
    s.soft = clamp(Math.sin((s.spread * Math.PI) / 180) * 3, 0, 0.35);
    s.spreadRad = Math.max((0.27 * Math.PI) / 180, (s.spread * Math.PI) / 180);
    // the hour this sky was recorded at, on our day's arc
    s.hour = hourOf(s.sun);
    s.phi = Math.atan2(s.sun[0], s.sun[2]);
    s.el0 = Math.asin(clamp(s.sun[1], 0.05, 1));
    s.beam0 = beam(s.el0);
    s.shT = s.sh.map((c) => c.slice());
    // The key against the skylight. The bake gives each sun's irradiance as
    // the HDRI recorded it, which for a clear sun is anything from 3:1 to 11:1
    // over the sky on a face turned to it, depending on how the HDRI was
    // stitched. A clear summer sky at the zenith is ~5:1 direct to diffuse on a
    // sun-facing face (DNI ~850 W/m2 against ~170 of sky and ground), so a
    // clear sun is put there at air mass 1 and carried through the air from
    // it; a veiled one keeps the ratio it was recorded at.
    const g0 = SKY_VIEW / Math.sqrt(Math.max(0.02, s.sun[1]));
    s.skyRef = dot3(shAt(s.sh, s.sun), LUM) * g0;
    const sunL = dot3(s.sunE, LUM);
    const r1 = (sunL / s.skyRef) * (BEAM_Z / beamL(s.el0));
    const clear = clamp((1.0 - s.spread) / 0.6, 0, 1);
    s.ratio1 = Math.exp((1 - clear) * Math.log(r1) + clear * Math.log(CLEAR_RATIO));
    s.sunChroma = s.sunE.map((v) => v / sunL);
    s.skyGain0 = skyGainAt(s.el0);
  }
  const sunO = tmul(R, data.orig.sun);
  // Albedo in absolute terms: the photo divided by its own light averages 1 on
  // the lower pole, and that pole is creosoted, weathered wood (~0.14). The
  // bake's own calibration matched the relit pole to the photograph's, which
  // was exposed for the sky and left the pole near black (an albedo of ~0.02);
  // at its real albedo a sunlit face stands up against the sky and the shadow
  // side falls away from it, as it does lying under a pole on a summer day.
  // Veiling glare: a small, sky-coloured share of the photo's sky added over
  // everything; taken off before the division, the pole is renormalised.
  const veil = [0.78, 0.97, 1.32].map((c) => c * VEIL * data.skyMed);
  // The photo's own light in colour: its sun taken as the bake's film white
  // (every recorded sun was balanced to it), its sky that over orig.sunTint, as
  // fitted on the trunk by oldlight.py.
  const norm = (v) => v.map((x) => x / dot3(v, LUM));
  const oldSun = norm([1, 0.97, 0.92]);
  const oldSky = norm(oldSun.map((x, c) => x / (data.orig.sunTint?.[c] ?? 1)));
  const cal = RHO_POLE / Math.PI / (1 - (VEIL * data.skyMed) / data.fitMean);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const sunvis = program(gl, VERT, SUNVIS);
  const blit = program(gl, VERT, BLIT);
  const rawP = program(gl, VERT, RAW);
  const film = createFilm(gl, { width: 2, height: 2 });

  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2 };
  let sceneT = null;
  let filmT = null;
  // sun visibility lives in photo space, at the depth map's resolution
  const visT = target(gl, data.size[0] >> 1, data.size[1] >> 1, false);
  let visKey = "";
  let dirty = true;
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      const narrow = W / H < 0.9;
      const side = narrow ? 16 : Math.max(24, W * 0.07);
      let w = W - side * 2;
      let h = w / PRINT_ASPECT;
      const hMax = H * (narrow ? 0.62 : 0.8);
      if (h > hMax) {
        h = hMax;
        w = h * PRINT_ASPECT;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // ---- the weather: a position s in [0, N - 1] (?sky=, or the up / down
  // keys; fractions are mid-crossfade), and the hour h, which the drag moves.
  let s = skyQ != null ? clamp(skyQ, 0, N - 1) : START;
  let h = hourQ != null ? clamp(hourQ, DAY[0], DAY[1]) : skies[Math.round(s)].hour;
  let vel = 0; // hours per second
  let sVel = 0;
  let dragging = false;
  let last = null;
  let goal = null; // an hour the keys asked for
  let sGoal = null; // a sky the keys asked for
  // px of drag per hour: the whole day is a little more than the print's width
  const perHour = () => Math.max(40, (L.w * 1.25) / (DAY[1] - DAY[0]));

  stage.on("down", (p) => {
    dragging = true;
    vel = 0;
    goal = null;
    last = { x: p.x, t: performance.now() };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging || !last) return;
    const now = performance.now();
    // the sun follows the hand: drag right and it goes back toward the east
    let dh = -(p.x - last.x) / perHour();
    // rubber band past dawn and dusk
    if ((h <= DAY[0] && dh < 0) || (h >= DAY[1] && dh > 0)) dh *= 0.3;
    h += dh;
    const dt = Math.max(1, now - last.t) / 1000;
    vel += (dh / dt - vel) * Math.min(1, dt / 0.05);
    last = { x: p.x, t: now };
    dirty = true;
  });
  stage.on("up", () => {
    dragging = false;
    stage.canvas.style.cursor = "grab";
    if (last && performance.now() - last.t > 60) vel = 0;
    last = null;
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      goal = clamp((goal ?? h) + (e.key === "ArrowLeft" ? 1 : -1), DAY[0], DAY[1]);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      sGoal = clamp((sGoal ?? Math.round(s)) + (e.key === "ArrowUp" ? 1 : -1), 0, N - 1);
    } else return;
    dirty = true;
  };
  host.addEventListener("keydown", onKey);

  // uniforms for the light of sky position pos at hour hr
  const SH = new Float32Array(27);
  const sunDir = new Float32Array(6);
  const sunE = new Float32Array(6);
  const sunSoft = new Float32Array(2);
  const spread = new Float32Array(2);
  const keyDir = [0, 1, 0];
  const cloudTint = [1, 1, 1];
  const lightAt = (pos, hr) => {
    const p = clamp(pos, 0, N - 1);
    const i0 = Math.min(N - 2, Math.floor(p));
    const w = p - i0;
    const a = skies[i0];
    const b = skies[i0 + 1];
    // one camera, metered for each sky at its own hour: exposure blends in
    // stops; the light adds in linear units
    const expo0 = Math.exp((1 - w) * Math.log(a.expo) + w * Math.log(b.expo));
    // the rubber band past dawn and dusk is the hand's, not the sun's
    const sun = solar(clamp(hr, DAY[0], DAY[1]));
    const cam = tmul(R, sun.dir);
    const tr = beam(sun.el);
    const tr1 = TAU.map((t) => Math.exp(-t));
    const phi = Math.atan2(sun.dir[0], sun.dir[2]);
    const skyGain = skyGainAt(sun.el);
    // Kasten-Young all the way through: the beam's colour against the zenith
    // sun (air mass 1, which daylight film is balanced near), luminance 1
    const trel = tr.map((v, c) => v / tr1[c]);
    const trl = dot3(trel, LUM);
    const sunCol = trel.map((v, c) => (v / trl) * KEY[c]);
    // how far into the evening (or the early morning) the air has got
    const low = clamp((airmass(sun.el) - 1.15) / 2.6, 0, 1);
    // The camera meets the hour part way (each sky as it was exposed at its
    // own hour): as the sun drops the skylight falls faster than the key, and
    // the exposure opens a little for what is left, so a late afternoon is
    // warmer and richer, not only darker.
    const expo = expo0 * Math.exp(Math.log(meterAt(sun.el)) - ((1 - w) * Math.log(meterAt(a.el0)) + w * Math.log(meterAt(b.el0))));
    SH.fill(0);
    let skyDim = 0;
    for (const [sk, k, j] of [
      [a, (1 - w) * a.scale * expo * cal, 0],
      [b, w * b.scale * expo * cal, 1],
    ]) {
      const g = (SKY_VIEW * skyGain) / Math.sqrt(Math.max(0.02, sk.sun[1]));
      turnSH(sk.sh, phi - sk.phi, sk.shT);
      for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) SH[i * 3 + c] += sk.shT[i][c] * k * g;
      // the sky warms with the sun: the bright, reddened sky round a low sun
      // (aureole and the horizon band under it) as a warm cosine lobe toward
      // it. It lights the sun side; the shade side keeps the blue zenith.
      const aur = AUREOLE * low * sk.skyRef * skyGain * k;
      for (let i = 0; i < 9; i++) {
        const yb = SHA[i] * SHY[i](sun.dir[0], sun.dir[1], sun.dir[2]) * aur;
        for (let c = 0; c < 3; c++) SH[i * 3 + c] += yb * sunCol[c] * sunCol[c];
      }
      // the key: a clear sun at its physical ratio to the sky, carried to this
      // hour's air mass and coloured by it
      const sunL = sk.ratio1 * sk.skyRef * trl;
      for (let c = 0; c < 3; c++) {
        sunDir[j * 3 + c] = cam[c];
        sunE[j * 3 + c] = sunL * sunCol[c] * sk.sunChroma[c] * k;
      }
      sunSoft[j] = sk.soft;
      spread[j] = sk.spreadRad;
      skyDim += (j ? w : 1 - w) * Math.min(1, skyGain / sk.skyGain0);
    }
    keyDir[0] = cam[0];
    keyDir[1] = cam[1];
    keyDir[2] = cam[2];
    // clouds take the sun's colour: white under a high sun (the HDRIs were
    // balanced so), warming and dimming with it through the air as it drops.
    // A cloud is lit by the sun and, a quarter of it, by the blue sky round
    // it, which keeps an evening cloud peach rather than yellow.
    const rl = Math.min(1, trl / NOON_TRL);
    const ct = trel.map((v) => (v / trl) ** CLOUD_WARM);
    const ctl = dot3(ct, LUM);
    for (let c = 0; c < 3; c++) cloudTint[c] = ((1 - CLOUD_FILL) * (ct[c] / ctl) * Math.pow(rl, 0.6) + CLOUD_FILL * CLOUD_SKY[c] * skyDim) / ((1 - CLOUD_FILL) + CLOUD_FILL * CLOUD_SKY[c]);
    // sky: decoded x = L K (median .5); shown at the photo's sky median, times
    // the exposure; the blue of it dims with the skylight
    const gs = (data.skyMed / 0.5) * expo;
    return { i0, w, skyK: [(1 - w) * gs, w * gs], skyDim };
  };

  const renderVis = (lt, moving) => {
    const k = `${s.toFixed(4)}|${h.toFixed(4)}|${moving ? 1 : 2}`;
    if (k === visKey) return;
    visKey = k;
    gl.useProgram(sunvis.p);
    const u = sunvis.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fgTex);
    gl.uniform1i(u.uFg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ndTex);
    gl.uniform1i(u.uNd, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, trunkTex);
    gl.uniform1i(u.uTrunk, 2);
    gl.uniform2f(u.uSize, data.size[0], data.size[1]);
    gl.uniform1f(u.uFx, data.fx);
    gl.uniform2f(u.uZ, data.zNear, data.zFar);
    gl.uniform3fv(u.uSunDir, sunDir);
    gl.uniform1fv(u.uSpread, spread);
    gl.uniform2f(u.uOn, lt.w < 1 ? 1 : 0, lt.w > 0 ? 1 : 0);
    gl.uniform1f(u.uRays, moving ? 1 : 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, visT.fbo);
    gl.viewport(0, 0, visT.w, visT.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let time = 0;
  let t0 = -1;
  let moving = false;
  let grainClock = 0;
  let grainSeed = 0;

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    const [PW, PH] = data.size;
    const photoA = PW / PH;
    const pa = L.pw / L.ph;
    let sx;
    let sy;
    if (pa >= photoA) {
      sx = CROP;
      sy = (CROP * photoA) / pa;
    } else {
      sy = CROP;
      sx = (CROP * pa) / photoA;
    }
    const br = reduce || still ? [0, 0] : [Math.sin(time * ((2 * Math.PI) / 11)) * 0.0022, Math.sin(time * ((2 * Math.PI) / 13.7) + 1.1) * 0.0018];
    const ox = clamp(0.5 - sx / 2 + br[0], 0, 1 - sx);
    const oy = clamp(0.5 - sy / 2 + br[1], 0, 1 - sy);
    const drift = reduce || still ? 0 : (Math.sin((time * 2 * Math.PI) / 150) * 1.4 * Math.PI) / 180;

    const lt = lightAt(s, h);
    renderVis(lt, moving);
    const u = scene.u;
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fgTex);
    gl.uniform1i(u.uFg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ndTex);
    gl.uniform1i(u.uNd, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, skyTex[lt.i0]);
    gl.uniform1i(u.uSky0, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, skyTex[lt.i0 + 1]);
    gl.uniform1i(u.uSky1, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, visT.tex);
    gl.uniform1i(u.uVis, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, shadeTex);
    gl.uniform1i(u.uShade, 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, trunkTex);
    gl.uniform1i(u.uTrunk, 6);
    gl.uniform4f(u.uCrop, sx, sy, ox, oy);
    gl.uniform2f(u.uSize, PW, PH);
    gl.uniform1f(u.uFx, data.fx);
    gl.uniform1f(u.uMargin, data.margin);
    gl.uniform2f(u.uZ, data.zNear, data.zFar);
    // GLSL mat3 is column-major: column j = R^T row j... uR * n must be R n.
    gl.uniformMatrix3fv(u.uR, false, new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]));
    gl.uniform3fv(u.uUp, up);
    gl.uniform1f(u.uDrift, drift);
    gl.uniform3fv(u.uSH, SH);
    gl.uniform3fv(u.uSunDir, sunDir);
    gl.uniform3fv(u.uSunE, sunE);
    gl.uniform1fv(u.uSunSoft, sunSoft);
    gl.uniform2f(u.uSkyK, lt.skyK[0], lt.skyK[1]);
    gl.uniform1fv(u.uSHo, data.orig.sh);
    gl.uniform3fv(u.uSunO, sunO);
    gl.uniform1f(u.uSunOK, data.orig.sunK);
    gl.uniform3fv(u.uVeil, veil);
    gl.uniform3fv(u.uOldSun, oldSun);
    gl.uniform3fv(u.uOldSky, oldSky);
    gl.uniform3fv(u.uKeyDir, keyDir);
    gl.uniform3fv(u.uCloudTint, cloudTint);
    gl.uniform1f(u.uRim, RIM);
    gl.uniform1f(u.uSkyDim, lt.skyDim);
    gl.uniform1f(u.uDbg, dbg);
    gl.uniform1f(u.uCal, cal);
    gl.uniform1f(u.uExpo, 2 ** expoStops);
    gl.uniform1f(u.uLinearOut, floatOk && sceneT.ok ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (raw) {
      // ?raw=1: the scene with a plain x/(1+x) curve, no film (to check the light)
      gl.bindFramebuffer(gl.FRAMEBUFFER, filmT.fbo);
      gl.viewport(0, 0, L.pw, L.ph);
      gl.useProgram(rawP.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
      gl.uniform1i(rawP.u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        ...FILM,
        ...dev,
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
  // Settling: a critically damped-ish spring (zeta ~ .85) to the nearest sky.
  const OMEGA = 7.5;
  const ZETA = 0.85;

  stage.onFrame((dt) => {
    if (!sceneT) return;
    time += dt;
    if (t0 < 0) t0 = time;
    const age = time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
      if (age < REVEAL + 0.1) dirty = true;
    }

    if (!dragging && !held) {
      // the hour: carried by a throw, with friction, or eased to a key's hour
      if (goal != null) {
        const x = h - goal;
        if (Math.abs(x) > 1e-3 || Math.abs(vel) > 1e-3) {
          vel += (-OMEGA * OMEGA * x - 2 * ZETA * OMEGA * vel) * dt;
          h += vel * dt;
          dirty = true;
        } else {
          h = goal;
          vel = 0;
          goal = null;
        }
      } else if (Math.abs(vel) > 0.01 || h < DAY[0] || h > DAY[1]) {
        h += vel * dt;
        vel *= Math.exp(-dt / 0.3);
        // past dawn or dusk, a spring brings the sun back
        const over = h < DAY[0] ? h - DAY[0] : h > DAY[1] ? h - DAY[1] : 0;
        if (over) vel += (-OMEGA * OMEGA * over - 2 * ZETA * OMEGA * vel) * dt;
        if (Math.abs(vel) <= 0.01 && Math.abs(over) < 1e-3) {
          vel = 0;
          h = clamp(h, DAY[0], DAY[1]);
        }
        dirty = true;
      }
      // the weather settles on a whole sky
      const target = sGoal ?? clamp(Math.round(s), 0, N - 1);
      const x = s - target;
      if (Math.abs(x) > 1e-4 || Math.abs(sVel) > 1e-4) {
        sVel += (-OMEGA * OMEGA * x - 2 * ZETA * OMEGA * sVel) * dt;
        s += sVel * dt;
        dirty = true;
      } else {
        s = target;
        sVel = 0;
        sGoal = null;
      }
    }

    if (!reduce && !still) {
      // the sky drifts, the frame breathes and the grain moves: at rest that
      // is a 24 fps film frame, not 60
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        if (grainOn) grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    // while the sun moves its shadows are marched with one ray; once it rests,
    // once more with two
    const was = moving;
    moving = dragging || goal != null || sGoal != null || Math.abs(vel) > 0.01 || Math.abs(sVel) > 1e-3;
    if (was && !moving) dirty = true;
    if (!dirty) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      freeTarget(gl, visT);
      for (const t of [fgTex, ndTex, shadeTex, trunkTex, ...skyTex]) gl.deleteTexture(t);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(sunvis.p);
      gl.deleteProgram(blit.p);
      gl.deleteProgram(rawP.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}

// The sun side of each cloud: how far it lifts toward the sun's colour.
const RIM = 1.0;

// The print: Superia-ish summer, developed from a linear render. The scene
// already sits on the photo's own exposure, so the curve is gentle; the sky's
// depth comes from the bake's polariser and blueDepth here.
const FILM = {
  headroom: 0,
  exposure: 0.35,
  whitePoint: 3.2,
  contrast: 1.12,
  shoulder: 0.94,
  blueDepth: 0.5,
  saturation: 1.12,
  halation: 0.26,
  halationThreshold: 0.85,
  halationLocal: 0,
  bloom: 0.12,
  softness: 0.45,
  toe: 0.05,
  grain: 0.32,
  vignette: 0.18,
  // a warm roll-off, and shadows only a breath cooler: the cool side of the
  // pole is the skylight's to give, and the key's warmth must survive the print
  shadowTint: [0.96, 1, 1.03],
  highlightTint: [1.03, 1, 0.95],
  toeColor: [0.85, 1, 1.1],
};
