import { createStage, clamp } from "../_kit/stage";

// One photograph, relit by a sun you can move. The plate is Jakob Owens'
// worm's-eye frame of Tokyo Tower between two building faces, full bleed.
// The passes a renderer keeps never show: they live only in the shader.
// Everything but the light is baked offline (tools/depth/bakes/passes.py):
// the photo; an albedo with the daylight shading divided out; the Depth
// Anything V2 map as 16 bits across R and G, with depth minus a wide blur in
// B; MoGe-2 normals; and mattes for the sky (R) and the tower (G).
//
// The drag is the sun: across is its azimuth around the camera (straight
// ahead, behind the tower, in the middle; behind your shoulder at either
// edge), up and down its elevation. The concrete faces and the tower's
// lattice take a warm key from it, shaded by the MoGe normals and kept out of
// the creases the depth map finds, and a cyan fill from the open sky. The sky
// stays the photograph's, with a warm aureole where the sun stands in it.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPhoto, uAlbedo, uDepth, uNormal, uMatte, uHalo;
uniform vec2 uRes;        // canvas px
uniform vec4 uMap;        // image uv = frag * uMap.xy + uMap.zw (cover fit)
uniform vec3 uSun;        // unit direction to the sun, camera space (x right, y up, z to the viewer)
uniform vec3 uSunCol;     // key colour times intensity, linear
uniform vec3 uUp;         // world up, camera space
uniform float uDay;       // 0 at the horizon, 1 with the sun high
out vec4 o;

const vec2 TEX = vec2(2048.0, 1536.0);
const float ASPECT = 2048.0 / 1536.0;
// Tone curve: a shoulder that rolls off before white.
const float EXPO = 1.35;

float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 tone(vec3 x){ return pow(x * EXPO / (1.0 + x * EXPO), vec3(1.0 / 2.2)); }
// The linear value the tone curve maps to display value y.
vec3 untone(vec3 y){ y = pow(clamp(y, 0.0, 0.985), vec3(2.2)); return y / (EXPO * (1.0 - y)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag * uMap.xy + uMap.zw;

  vec3 photo = texture(uPhoto, uv).rgb;
  vec2 mt = texture(uMatte, uv).rg;
  // Sky shows through the tower's lattice inside its matte: pale, blue, and
  // facing straight at the camera.
  float gap = mt.g * smoothstep(0.08, 0.2, photo.b - photo.r);
  float sky = clamp(mt.r + gap, 0.0, 1.0);
  float tower = mt.g * (1.0 - gap);

  // The view ray through this pixel, for the aureole: a 74 degree lens.
  vec3 V = normalize(vec3((uv.x - 0.5) * 1.5, -(uv.y - 0.5) * 1.5 / ASPECT, -1.0));
  float cs = dot(V, uSun);

  // Sky: the photograph's, taken from a softer mip so the plate's sensor
  // noise goes, a little deeper toward the zenith (the top of the frame),
  // and warmed around the sun when it stands in front of the camera.
  // Right at a silhouette the soft mip would smear the tower or a wall into
  // the sky as a pale rim, so there the sky drops back to the sharp plate.
  float open = smoothstep(0.985, 1.0, textureLod(uMatte, uv, 4.0).r);
  vec3 skyP = mix(photo, textureLod(uPhoto, uv, 1.6).rgb, open);
  skyP = pow(skyP, vec3(1.08)) * mix(vec3(0.9, 0.95, 1.02), vec3(1.0), smoothstep(0.0, 0.8, uv.y));
  vec3 skyL = untone(skyP) * mix(0.78, 1.0, uDay);
  float aur = exp((cs - 1.0) * 70.0) * 0.8 + exp((cs - 1.0) * 9.0) * 0.12;
  skyL += uSunCol * vec3(1.0, 0.92, 0.8) * aur * 0.16;

  // Surfaces. Albedo in linear light; the plate's grade left the concrete
  // olive, so most of the chroma comes off the walls (not the tower's paint),
  // and both are brought up from the shade they were photographed in.
  // A half-step softer mip: brought up from shade, the plate's compression
  // noise would otherwise come up with it.
  vec3 alb = toLin(texture(uAlbedo, uv, 0.6).rgb);
  alb = mix(vec3(luma(alb)), alb, mix(0.18, 1.0, tower)) * mix(vec3(1.0, 0.97, 0.93), vec3(1.0), tower);
  alb = min(alb * mix(8.0, 4.2, tower), vec3(0.82));

  vec3 n = normalize(texture(uNormal, uv).rgb * 2.0 - 1.0);
  float bend = (texture(uDepth, uv).b - 0.5) * 2.0;

  // No cast shadows: the depth map only holds what the camera saw, so a
  // march through it finds noise, not the walls above the frame. What it can
  // give is the creases: where a surface sits behind its surroundings (a
  // recessed window, the wall behind the pole) the sun reaches it less.
  vec3 L = uSun;
  float ndl = dot(n, L);
  float vis = 1.0 - 0.55 * smoothstep(0.04, 0.3, -bend);
  // Key: the sun, with a touch of wrap so the terminator rolls off. Fill: the
  // open sky, cyan, strongest on faces that look up into it, weaker in the
  // creases behind a silhouette. Bounce: a little of the sun off the walls.
  float key = max((ndl + 0.08) / 1.08, 0.0) * vis;
  float skyVis = clamp(0.55 + 0.45 * dot(n, uUp), 0.0, 1.0) * (1.0 - 0.35 * smoothstep(0.0, 0.3, -bend));
  vec3 fill = vec3(0.11, 0.27, 0.45) * mix(0.6, 1.0, uDay) * skyVis;
  vec3 bounce = uSunCol * 0.035 * (0.5 - 0.5 * dot(n, uUp));
  vec3 h = normalize(L - V);
  float spec = pow(max(dot(n, h), 0.0), 40.0) * vis * mix(0.03, 0.12, tower);
  vec3 lit = alb * (uSunCol * key + fill + bounce) + uSunCol * spec;

  // Halation: the tower's sunlit white paint bleeds red into what is around
  // it, the way a film's base throws light back through the emulsion.
  vec2 hp = 1.0 / vec2(256.0, 192.0);
  float hal = 0.0;
  hal += textureLod(uHalo, uv + vec2(hp.x, hp.y) * 0.5, 2.4).r;
  hal += textureLod(uHalo, uv + vec2(-hp.x, hp.y) * 0.5, 2.4).r;
  hal += textureLod(uHalo, uv + vec2(hp.x, -hp.y) * 0.5, 2.4).r;
  hal += textureLod(uHalo, uv - vec2(hp.x, hp.y) * 0.5, 2.4).r;
  hal = hal * 0.25 * 0.7 + textureLod(uHalo, uv, 4.2).r * 0.5;
  float towerSun = 0.35 + 0.65 * clamp(dot(vec3(0.0, 0.22, 0.85), L) * 0.5 + 0.5, 0.0, 1.0);
  vec3 halo = vec3(1.0, 0.24, 0.07) * hal * towerSun * luma(uSunCol) * 0.22;

  vec3 c = mix(lit, skyL, sky) + halo;
  c = tone(c);

  // A light film grade: a lifted toe, a breath of vignette, and fine
  // monochrome grain from two hashes, so it is triangular, strongest in the
  // midtones.
  c = mix(vec3(0.018, 0.016, 0.02), vec3(1.0), c);
  vec2 cv = (frag / uRes - 0.5);
  c *= 1.0 - 0.16 * dot(cv, cv);
  float g = hash(frag) + hash(frag + 17.3) - 1.0;
  float lc = luma(c);
  c += g * (0.044 * lc * (1.0 - lc) + 0.004);
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 2048 / 1536;
// The camera looks up this far above the horizon.
const PITCH = (55 * Math.PI) / 180;
// Where the sun rests, in drag coordinates (0..1 across and down the frame):
// low in the west behind your left shoulder, so it rakes the right wall
// gold, leaves the left one in the sky's cyan, and catches the tower's left
// legs.
const REST = { x: 0.15, y: 0.55 };

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

// The sun for a point of the drag. Across: azimuth relative to where the
// camera faces, from 165 degrees left through straight ahead to 165 right.
// Down: elevation, from 78 degrees to 3. Returns its direction in camera
// space, its colour and intensity (warmer and weaker near the horizon), and
// how high it is.
function sunFor(x, y) {
  const az = (x - 0.5) * 2 * ((165 * Math.PI) / 180);
  const el = ((78 - (78 - 3) * clamp(y, 0, 1)) * Math.PI) / 180;
  const sx = Math.cos(el) * Math.sin(az);
  const sh = Math.cos(el) * Math.cos(az);
  const sy = Math.sin(el);
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const dir = [sx, -sp * sh + cp * sy, -(cp * sh + sp * sy)];
  const day = clamp(Math.sin(el) / 0.7, 0, 1);
  const w = Math.sqrt(day);
  const I = 3.1 * (0.55 + 0.45 * w);
  const col = [1.0, 0.52 + 0.26 * w, 0.24 + 0.36 * w].map((c) => c * I);
  return { dir, col, day };
}

// Where the tower's paint is white: the halation source, at a quarter size
// so its mips blur it cheaply in the shader.
function haloMask(photo, matte) {
  const w = 512;
  const h = 384;
  const read = (im) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const p = read(photo);
  const m = read(matte);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = p[4 * i];
    const g = p[4 * i + 1];
    const b = p[4 * i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const white = clamp((lum - 150) / 60, 0, 1) * clamp(1 - (chroma - 30) / 50, 0, 1);
    out[i] = Math.round(255 * white * (m[4 * i + 1] / 255));
  }
  return { w, h, data: out };
}

export async function createPasses(host) {
  const [photo, albedo, depth, normal, matte] = await Promise.all(
    ["photo.webp", "albedo.webp", "depth.png", "normal.webp", "matte.png"].map((f) => loadImage(SRC + f)),
  );

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const num = (k) => (params.has(k) ? clamp(parseFloat(params.get(k)) || 0, 0, 1) : null);
  const holdX = num("x");
  const holdY = num("y");

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { res: U("uRes"), map: U("uMap"), sun: U("uSun"), sunCol: U("uSunCol"), up: U("uUp"), day: U("uDay") };

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const params2d = (mips) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const tex = (im, unit, name, mips) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    params2d(mips);
    gl.uniform1i(U(name), unit);
  };
  tex(photo, 0, "uPhoto", true);
  tex(depth, 1, "uDepth", false);
  tex(normal, 2, "uNormal", true);
  tex(albedo, 3, "uAlbedo", true);
  tex(matte, 4, "uMatte", true);

  const halo = haloMask(photo, matte);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, halo.w, halo.h, 0, gl.RED, gl.UNSIGNED_BYTE, halo.data);
  gl.generateMipmap(gl.TEXTURE_2D);
  params2d(true);
  gl.uniform1i(U("uHalo"), 5);

  let dirty = true;
  stage.onResize(() => {
    dirty = true;
  });

  // The sun eases toward the hand. With no hand yet it rises from low in the
  // west to its rest, once, a moment after the plate appears.
  const held = holdX != null || holdY != null;
  const rest = { x: holdX ?? REST.x, y: holdY ?? REST.y };
  const sun = held ? { ...rest } : { x: REST.x - 0.04, y: 0.9 };
  const target = { ...rest };
  let rate = held ? 12 : 1.6;

  const toU = (p) => ({ x: clamp(p.x / stage.width, 0, 1), y: clamp(p.y / stage.height, 0, 1) });
  const aim = (p) => {
    const q = toU(p);
    target.x = q.x;
    target.y = q.y;
    rate = 9;
  };
  stage.on("down", aim);
  stage.on("move", (p) => {
    if (p.down) aim(p);
  });

  stage.onFrame((dt) => {
    const k = 1 - Math.exp(-dt * rate);
    const dx = target.x - sun.x;
    const dy = target.y - sun.y;
    if (Math.abs(dx) + Math.abs(dy) > 2e-4) {
      sun.x += dx * k;
      sun.y += dy * k;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    draw();
  });

  function draw() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    gl.viewport(0, 0, W, Hc);
    gl.uniform2f(u.res, W, Hc);
    // Cover fit: the photo fills the frame, cropped evenly on the long side.
    const s = Math.max(W / IMG_ASPECT, Hc);
    const sw = s * IMG_ASPECT;
    gl.uniform4f(u.map, 1 / sw, 1 / s, (sw - W) / 2 / sw, (s - Hc) / 2 / s);
    const S = sunFor(sun.x, sun.y);
    gl.uniform3f(u.sun, S.dir[0], S.dir[1], S.dir[2]);
    gl.uniform3f(u.sunCol, S.col[0], S.col[1], S.col[2]);
    gl.uniform3f(u.up, 0, Math.cos(PITCH), -Math.sin(PITCH));
    gl.uniform1f(u.day, S.day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      stage.destroy();
    },
  };
}
