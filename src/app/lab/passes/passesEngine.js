import { createStage, clamp } from "../_kit/stage";

// One photograph, relit by a sun you can move. The plate is Jakob Owens'
// worm's-eye frame of Tokyo Tower between two building faces, full bleed.
// The passes a renderer keeps never show: they live only in the shader.
// Everything but the light is baked offline (tools/depth/bakes/passes.py):
// the photo; an albedo with the daylight shading divided out; the Depth
// Anything V2 map as 16 bits across R and G, with depth minus a wide blur in
// B; MoGe-2 normals; and mattes for the sky (R) and the tower (G). B is the
// whole sky: R with the holes in the tower's lattice added, keyed and unmixed
// at the source's full 4000 px (tools/depth/bakes/passes-gaps.py), and the
// albedo there holds the steel alone, the plate's haze taken out of it.
//
// The drag is the sun: across is its azimuth around the camera (straight
// ahead, behind the tower, in the middle; behind your shoulder at either
// edge), up and down its elevation. The concrete faces and the tower's
// lattice take a warm key from it, shaded by the MoGe normals and kept out of
// the creases the depth map finds, and a cyan fill from the open sky.
//
// The plate's own sky was flat haze, so inside the sky matte it is replaced by
// a photographed summer cumulus dome (Poly Haven, Rural Asphalt Road, Alexander Scholten, CC0;
// tools/depth/bakes/passes-sky.py): piled cumulus with hard sunlit tops and
// blue-shadowed bases, standing low, with clear deep blue over them. Each
// pixel looks it up along its true camera ray, the plate's pitch and lens, so
// the clouds converge on the same vanishing point as the buildings. The dome
// turns with the dragged sun so its tallest bank stands low on the sun's
// side of the canyon, over the wall tops and behind the tower, and the open
// canyon above stays cobalt. The sun itself is drawn where the light stands.
//
// Plate and dome are then developed as one exposure: a single film pass over
// the matted frame spreads its highlights (a warm Pro-Mist diffusion), throws
// a thin red halation ring onto the dark side of every bright edge, and lays
// one grain field, stepping at 24 fps, over sky and concrete alike.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAlbedo, uDepth, uNormal, uMatte, uSky, uSkyBlue;
uniform vec2 uRes;        // canvas px
uniform vec4 uMap;        // image uv = frag * uMap.xy + uMap.zw (cover fit)
uniform vec3 uSun;        // unit direction to the sun, camera space (x right, y up, z to the viewer)
uniform vec3 uSunCol;     // key colour times intensity, linear
uniform vec3 uUp;         // world up, camera space
uniform float uDay;       // 0 at the horizon, 1 with the sun high
uniform mat3 uDome;       // camera ray -> (toward the dome's cumulus bank, to its right, up), as columns
out vec4 o;

const vec2 TEX = vec2(2048.0, 1536.0);
const float ASPECT = 2048.0 / 1536.0;
// The plate's lens, 2 tan(fov_x / 2): 55 degrees across. Its verticals meet
// 0.9 frame heights above the centre; with the camera pitched 55 degrees up
// (PITCH) that is where the zenith stands for this lens, so sky rays through
// it converge with the walls.
const float LENS = 1.034;
// The sky dome: where its tallest cumulus bank stands across the equirect,
// and its open blue sky's chroma (luma 1).
const float SKY_U = 0.24;
const vec3 SKY_BLUE = vec3(0.72, 1.0, 1.79);
// The clouds' exposure against the graded blue: a sunlit top lands near
// paper white, the way a polariser holds a cobalt sky under bright cumulus,
// and the body of the cloud stays under the shoulder, where its shading
// still reads.
const float CLOUD = 1.3;
// Tone curve: a shoulder that rolls off before white.
const float EXPO = 1.35;

vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 tone(vec3 x){ return pow(x * EXPO / (1.0 + x * EXPO), vec3(1.0 / 2.2)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The dome's layers as stored: x = K s / (1 - s), s = y ^ 2.2.
vec3 skyDecode(vec3 y, float k){ vec3 s = min(pow(y, vec3(2.2)), vec3(0.9975)); return k * s / (1.0 - s); }

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag * uMap.xy + uMap.zw;

  // The whole sky, the lattice's holes in it, a pixel's edge wide; the
  // tower's paint.
  vec3 mt = texture(uMatte, uv).rgb;
  float sky = clamp((mt.b - 0.02) / 0.98, 0.0, 1.0);
  float tower = mt.g;

  // The camera ray through this pixel, from the plate's lens.
  vec3 V = normalize(vec3((uv.x - 0.5) * LENS, -(uv.y - 0.5) * LENS / ASPECT, -1.0));

  // Sky: the cumulus dome along that ray. Azimuth wraps, so where the
  // equirect's seam passes, the derivative comes from a copy shifted half a
  // turn; otherwise the seam would pick the smallest mip as a hairline.
  vec3 D = V * uDome;
  vec2 st = vec2(SKY_U + atan(D.y, D.x) / 6.2831853, 1.0 - asin(clamp(D.z, -1.0, 1.0)) / 1.5707963);
  vec2 sx = dFdx(st), sy = dFdy(st);
  float wx = dFdx(fract(st.x + 0.5)), wy = dFdy(fract(st.x + 0.5));
  if (abs(wx) < abs(sx.x)) sx.x = wx;
  if (abs(wy) < abs(sy.x)) sy.x = wy;
  // It comes in two layers, split offline: the open sky's blue (an amount
  // of SKY_BLUE) and what the clouds and the haze round the sun add over it.
  // They are graded apart, the way a polariser does it: the blue deepens to
  // cobalt toward the zenith and pales to cyan lower down, while the
  // clouds keep their light, warmed toward the key. The clouds are read
  // half a mip soft: a kilometre of air sits between them and the walls,
  // and at the dome's full resolution their edges were crisper than the
  // plate's own.
  vec3 cloud = skyDecode(textureGrad(uSky, st, sx * 1.6, sy * 1.6).rgb, 4.0);
  float beta = skyDecode(textureGrad(uSkyBlue, st, sx, sy).rrr, 1.0).r;
  // Paler only with the ray's own elevation: the sky does not know where the
  // walls stand, and paling it toward them drew a lit band along every edge
  // and filled the gap under the balcony with haze.
  float elev = asin(clamp(dot(V, uUp), -1.0, 1.0));
  // Cobalt over most of the canyon; it pales only in the last stretch above
  // the wall tops, and to a deeper cyan than haze.
  float pale = 1.0 - smoothstep(0.35, 1.05, elev);
  vec3 blue = mix(vec3(0.014, 0.16, 0.66), vec3(0.24, 0.9, 1.85), pale * pale);
  // The clouds' shoulder: a roll-off on their luminance ahead of the tone
  // curve, so the tops near the sun come down to a warm paper white instead
  // of clipping, and the sun's disc itself only just reaches it.
  vec3 warm = mix(vec3(1.0), uSunCol / luma(uSunCol), mix(0.6, 0.3, uDay));
  // What is left over the blue is mostly neutral; at thin edges where the
  // dome's sky leans off SKY_BLUE the remainder turns violet, and the
  // clouds' exposure would show it as a fringe. So it is held near grey.
  cloud = mix(vec3(luma(cloud)), cloud, 0.3) * CLOUD;
  // Cumulus is lit like a solid: the sunlit domes stand well clear of the
  // body under them. The photograph's range is opened round its middle so
  // the tops come forward and the bases fall back toward the blue.
  cloud *= pow(max(luma(cloud), 1e-4) / 4.0, 0.45);
  // A cloud's shadow side is not grey: the sun does not reach it, the open
  // sky does, so it takes the sky's own blue (this ray's, cobalt high and
  // cyan low) at the same luminance, and sits a little deeper. Only the
  // sunlit tops keep the key's warm white.
  float sunlit = smoothstep(2.0, 14.0, luma(cloud));
  vec3 skyTint = mix(vec3(1.0), blue / luma(blue), 0.42);
  cloud *= mix(skyTint * 0.5, warm, sunlit);
  cloud /= 1.0 + luma(cloud) / 12.0;
  vec3 skyL = (beta * blue + cloud) * mix(0.72, 1.0, uDay);
  // The sun: the dome's own was taken out with its haze offline, so it is
  // drawn here where the key light stands, a half-degree disc and a tight
  // glow, warm, peaking under paper white. It sits in the sky layer, so the
  // tower's matte cuts it and the lattice stands in silhouette against it.
  float th = acos(clamp(dot(V, uSun), -1.0, 1.0));
  vec3 sunHue = mix(vec3(1.0, 0.86, 0.6), uSunCol / max(uSunCol.r, 1e-3), 0.3);
  sunHue /= luma(sunHue);
  skyL += sunHue * (5.0 * smoothstep(0.0058, 0.0042, th) + 1.6 * exp(-th / 0.018) + 0.25 * exp(-th / 0.08)) * mix(0.6, 1.0, uDay);

  // Surfaces. Albedo in linear light; the plate's grade left the concrete
  // olive, so most of the chroma comes off the walls (not the tower's paint),
  // and both are brought up from the shade they were photographed in.
  // On the walls a half-step softer mip: brought up from shade, the plate's
  // compression noise would otherwise come up with it. The lattice keeps the
  // full mip, its members are a pixel or two wide.
  vec3 alb = toLin(texture(uAlbedo, uv, mix(0.6, 0.0, tower)).rgb);
  alb = mix(vec3(luma(alb)), alb, mix(0.18, 1.0, tower)) * mix(vec3(1.0, 0.97, 0.93), vec3(1.0), tower);
  // The walls clip at a pale concrete. The tower's paint rolls off into it
  // instead: brought up four times, its white members and the half-lit steel
  // behind them would all clip to the same flat cream, and the lattice would
  // go to a milky mush with no members in it.
  vec3 wallAlb = min(alb * 8.0, vec3(0.82));
  vec3 towerAlb = 0.86 * (1.0 - exp(-alb * 3.4 / 0.86));
  alb = mix(wallAlb, towerAlb, tower);

  // The lattice has no surface at the scale MoGe sees it: its normals there
  // are soft blobs, and a sun shaded by them laid lit veils across the truss
  // like cobwebs. Over the tower they come from a coarse mip, so the light
  // turns with its faces, and each member, round, wraps the light further.
  vec3 n = texture(uNormal, uv).rgb * 2.0 - 1.0;
  n = normalize(mix(n, textureLod(uNormal, uv, 4.5).rgb * 2.0 - 1.0, tower * 0.9));
  float wrap = mix(0.08, 0.4, tower);
  float bend = (texture(uDepth, uv).b - 0.5) * 2.0;

  // No cast shadows: the depth map only holds what the camera saw, so a
  // march through it finds noise, not the walls above the frame. What it can
  // give is the creases: where a surface sits behind its surroundings (a
  // recessed window, the wall behind the pole) the sun reaches it less.
  vec3 L = uSun;
  float ndl = dot(n, L);
  float vis = 1.0 - 0.55 * smoothstep(0.04, 0.3, -bend) * (1.0 - 0.7 * tower);
  // Key: the sun, with a touch of wrap so the terminator rolls off. Fill: the
  // open sky, cyan, strongest on faces that look up into it, weaker in the
  // creases behind a silhouette. Bounce: a little of the sun off the walls.
  float key = max((ndl + wrap) / (1.0 + wrap), 0.0) * vis;
  float skyVis = clamp(0.55 + 0.45 * dot(n, uUp), 0.0, 1.0) * (1.0 - 0.35 * smoothstep(0.0, 0.3, -bend));
  vec3 fill = vec3(0.11, 0.27, 0.45) * mix(0.6, 1.0, uDay) * skyVis;
  vec3 bounce = uSunCol * 0.035 * (0.5 - 0.5 * dot(n, uUp));
  // Only on faces the sun reaches: with the sun behind the tower the half
  // vector turns round and would light the lattice from the front.
  vec3 h = normalize(L - V + vec3(0.0, 0.0, 1e-4));
  float spec = pow(max(dot(n, h), 0.0), 40.0) * vis * mix(0.03, 0.12, tower) * smoothstep(0.0, 0.2, ndl);
  vec3 lit = alb * (uSunCol * key + fill + bounce) + uSunCol * spec;

  // The sky goes over the plate after the tone curve, as a print would be
  // matted: the dome runs to a thousand times paper white at the sun, and
  // in linear light even the matte's last 1% inside the tower would carry
  // it through as white blotches. Diffusion, halation and grain come after,
  // in FILM, over the matted frame as one.
  o = vec4(mix(tone(lit), tone(skyL), sky), 1.0);
}`;

// The film the whole frame shares, plate and dome alike, so they read as one
// exposure. First the light that scatters, at half size: what is brighter
// than 0.8 in rgb, for the diffusion, and the near-white that halates in a.
// Four bilinear taps cover the 4x4 block, so a bright hairline does not
// shimmer in and out of it.
const PREP = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;      // the scene's texel
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 src(vec2 uv){
  vec3 c = texture(uScene, uv).rgb;
  float l = luma(c);
  vec3 lin = pow(c, vec3(2.2));
  return vec4(lin * smoothstep(0.7, 0.95, l), smoothstep(0.84, 0.97, l));
}
void main(){
  vec2 uv = gl_FragCoord.xy * 2.0 * uTexel;
  vec2 t = uTexel;
  o = 0.25 * (src(uv + vec2(-t.x, -t.y)) + src(uv + vec2(t.x, -t.y)) + src(uv + vec2(-t.x, t.y)) + src(uv + t));
}`;

// Then the frame itself: a Pro-Mist diffusion from those highlights (a few
// px at DPR 2, warm, since the filter's scatter is warmer than the light it
// takes), a thin red-orange halation on the dark side of every bright edge
// (the tower and the walls against the cloud), a breath of vignette, a lifted
// toe, and one grain field for the whole frame, stepping at 24 fps.
const FILM = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBright;
uniform vec2 uRes;        // canvas px
uniform vec2 uHalf;       // uBright's texel
uniform float uSeed;
uniform float uDay;
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// The bright layer spread at a mip: four taps a texel of that level apart,
// turned off the pixel grid, so the mips' boxes do not show.
vec4 spread(vec2 uv, float lod){
  vec2 r = uHalf * exp2(lod) * 0.75;
  return 0.25 * (textureLod(uBright, uv + r * vec2(0.92, 0.38), lod) + textureLod(uBright, uv + r * vec2(-0.38, 0.92), lod)
               + textureLod(uBright, uv + r * vec2(-0.92, -0.38), lod) + textureLod(uBright, uv + r * vec2(0.38, -0.92), lod));
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 lin = pow(c, vec3(2.2));
  float l = luma(c);

  vec4 b0 = textureLod(uBright, uv, 0.0);
  vec4 b1 = spread(uv, 0.5);
  vec4 b2 = spread(uv, 1.5);
  vec4 b3 = spread(uv, 2.6);

  // Diffusion: a share of the highlight leaves its pixel and lands spread
  // round it, so the cloud's white veils softly over the steel and the wall
  // edges in front of it, and the tops lose their paper-cut edge. It only
  // moves light, so a wide cloud keeps its level; what lands outside the
  // highlight is warmer than what left.
  vec3 d = b1.rgb * 0.4 + b2.rgb * 0.35 + b3.rgb * 0.25 - b0.rgb;
  lin += 0.4 * (max(d, 0.0) * vec3(1.0, 0.93, 0.82) + min(d, 0.0));

  // Halation: light through the emulsion off the base and back through the
  // red layer. A ring, not a glow: the spread source minus what is already
  // white here, only where the pixel is darker than the source.
  float ring = max(b2.a * 0.4 + b3.a * 0.6 - b0.a * 0.85, 0.0) * (1.0 - smoothstep(0.45, 0.9, l));
  lin += vec3(1.0, 0.3, 0.08) * ring * 0.32 * mix(0.75, 1.0, uDay);

  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  c = mix(vec3(0.018, 0.016, 0.02), vec3(1.0), c);
  vec2 cv = uv - 0.5;
  c *= 1.0 - 0.16 * dot(cv, cv);

  // Grain: clumps about 1.5 px across at DPR 2 with a finer hash through
  // them, triangular, strongest in the midtones but never gone, the same law
  // on the sky as on the concrete. A touch of colour between the layers.
  vec2 p = gl_FragCoord.xy + uSeed * vec2(37.1, 91.7);
  float g = (vnoise(p / 1.5) - 0.5) * 1.5 + (hash(p) + hash(p + 17.3) - 1.0) * 0.55;
  vec3 gc = vec3(g) + (vec3(hash(p + 3.1), hash(p + 5.7), hash(p + 9.3)) - 0.5) * 0.35;
  float lc = luma(c);
  c += gc * (0.06 * lc * (1.0 - lc) + 0.009);
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
// space, its colour and intensity (warmer and weaker near the horizon), how
// high it is, and its azimuth and elevation.
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
  return { dir, col, day, az, el };
}

// The dome's cumulus bank follows the sun round, a share of its azimuth
// (DOME_TURN) and never more than DOME_REACH off the camera's heading: so it
// stands on the sun's side, between the sun and the tower, and at either
// edge of the drag it waits at the wall tops instead of swinging out of
// frame or across the canyon.
const DOME_TURN = 0.35;
const DOME_REACH = (35 * Math.PI) / 180;
// And it is sunk this far, tilted down on its own side, so its tallest tops
// (60 degrees up in the photograph) rise just over the wall tops and behind
// the tower, and the open canyon above them stays deep blue. The tilt no
// longer follows the sun's height: lifting the dome to meet a low sun swung
// its clouds up across the whole canyon, an overcast sheet.
const DOME_SINK = (14 * Math.PI) / 180;

// The dome's orientation for a sun: turned about the zenith to put its bank
// on the sun's side, then tilted down toward the bank. Returned as the three
// columns of uDome: unit vectors, in camera space, toward the bank along the
// ground, to its right, and up.
function domeFor(az) {
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const turn = clamp(az * DOME_TURN, -DOME_REACH, DOME_REACH);
  const sa = Math.sin(turn);
  const ca = Math.cos(turn);
  // Heading (0, -sp, -cp) and right (1, 0, 0) span the ground; up is (0, cp, -sp).
  const toward = [sa, -sp * ca, -cp * ca];
  const right = [ca, sp * sa, cp * sa];
  const up = [0, cp, -sp];
  const c = Math.cos(DOME_SINK);
  const s = Math.sin(DOME_SINK);
  const p = toward.map((t, i) => c * t - s * up[i]);
  const z = toward.map((t, i) => s * t + c * up[i]);
  return [...p, ...right, ...z];
}

export async function createPasses(host) {
  const [albedo, depth, normal, matte, skyCloud, skyBlue] = await Promise.all(
    ["albedo.webp", "depth.png", "normal.webp", "matte.png", "sky-cloud.avif", "sky-blue.avif"].map(
      (f) => loadImage(SRC + f),
    ),
  );

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const num = (k) => (params.has(k) ? clamp(parseFloat(params.get(k)) || 0, 0, 1) : null);
  const holdX = num("x");
  const holdY = num("y");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const prepProg = program(PREP);
  const filmProg = program(FILM);
  const prog = program(FS);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { res: U("uRes"), map: U("uMap"), sun: U("uSun"), sunCol: U("uSunCol"), up: U("uUp"), day: U("uDay"), dome: U("uDome") };
  const up = { texel: gl.getUniformLocation(prepProg, "uTexel") };
  const uf = {
    res: gl.getUniformLocation(filmProg, "uRes"),
    half: gl.getUniformLocation(filmProg, "uHalf"),
    seed: gl.getUniformLocation(filmProg, "uSeed"),
    day: gl.getUniformLocation(filmProg, "uDay"),
  };

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
  tex(depth, 1, "uDepth", false);
  tex(normal, 2, "uNormal", true);
  tex(albedo, 3, "uAlbedo", true);
  tex(matte, 4, "uMatte", true);

  // The sky dome's two layers: azimuth repeats, and anisotropic filtering
  // where the GPU has it, since the equirect stretches across toward the
  // zenith. A GPU that cannot hold 8192 texels across gets them at half size.
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const dome = (im, unit, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    let src = im;
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < im.width) {
      src = document.createElement("canvas");
      src.width = im.width / 2;
      src.height = im.height / 2;
      src.getContext("2d").drawImage(im, 0, 0, src.width, src.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    params2d(true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.uniform1i(U(name), unit);
  };
  dome(skyCloud, 6, "uSky");
  dome(skyBlue, 8, "uSkyBlue");

  // The film's targets: the matted frame at full size (unit 10), and the
  // light that scatters from it at half size, with mips to spread it (11).
  // Allocated whenever the canvas changes size.
  const scene = { tex: gl.createTexture(), fbo: gl.createFramebuffer() };
  const bright = { tex: gl.createTexture(), fbo: gl.createFramebuffer() };
  let fw = 0;
  let fh = 0;
  const alloc = (t, unit, w, h, mips) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    params2d(mips);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };
  const targets = (W, Hc) => {
    if (W === fw && Hc === fh) return;
    fw = W;
    fh = Hc;
    alloc(scene, 10, W, Hc, false);
    alloc(bright, 11, Math.ceil(W / 2), Math.ceil(Hc / 2), true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  gl.useProgram(prepProg);
  gl.uniform1i(gl.getUniformLocation(prepProg, "uScene"), 10);
  gl.useProgram(filmProg);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uScene"), 10);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uBright"), 11);

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

  // The grain steps at 24 fps whether or not the light moves; between steps
  // and while the sun is still, nothing is drawn. A sun held by the query is
  // a still frame, and its grain holds too.
  const still = held || reduce;
  let seed = 0;
  let grainClock = 0;
  let tick = false;

  stage.onFrame((dt) => {
    if (!still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const k = 1 - Math.exp(-dt * rate);
    const dx = target.x - sun.x;
    const dy = target.y - sun.y;
    if (Math.abs(dx) + Math.abs(dy) > 2e-4) {
      sun.x += dx * k;
      sun.y += dy * k;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      draw();
      develop();
    } else if (tick) develop();
    tick = false;
  });

  // The light, into the scene target.
  let day = 1;
  function draw() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    targets(W, Hc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.useProgram(prog);
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
    day = S.day;
    gl.uniformMatrix3fv(u.dome, false, domeFor(S.az));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // What scatters, at half size, spread through its mips.
    gl.bindFramebuffer(gl.FRAMEBUFFER, bright.fbo);
    gl.useProgram(prepProg);
    gl.viewport(0, 0, Math.ceil(W / 2), Math.ceil(Hc / 2));
    gl.uniform2f(up.texel, 1 / W, 1 / Hc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE11);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // The film, to the canvas: cheap, so it alone runs for each grain step.
  function develop() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    if (W !== fw || Hc !== fh) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(filmProg);
    gl.viewport(0, 0, W, Hc);
    gl.uniform2f(uf.res, W, Hc);
    gl.uniform2f(uf.half, 1 / Math.ceil(W / 2), 1 / Math.ceil(Hc / 2));
    gl.uniform1f(uf.seed, seed);
    gl.uniform1f(uf.day, day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      [scene, bright].forEach((t) => {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      });
      stage.destroy();
    },
  };
}
