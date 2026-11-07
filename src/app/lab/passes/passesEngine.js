import { createStage, clamp } from "../_kit/stage";
import { TOWER } from "./towerMatte";

// One photograph and the passes under it, the way a renderer or a
// photogrammetry tool keeps them: depth, surface normals, and the scene relit.
// The plate is Jakob Owens' worm's-eye frame of Tokyo Tower between two
// building faces. Everything but the light is baked offline
// (tools/depth/bakes/passes.py): the photo; an albedo with the daylight
// shading divided out; the Depth Anything V2 map as 16 bits across R and G,
// with depth minus a wide blur in B, which the passes use to calm normals at
// silhouettes; MoGe-2 normals; and mattes for the sky and the tower. The
// sheets are cut around the tower (towerMatte.js: a SAM mask blurred and
// re-thresholded so its contour is smooth, kept as its left and right
// silhouette per photo row). Wherever a sheet's edge would cross it, the cut
// steps out along the tower's silhouette and back, so the stack reads as
// prints scissored around it.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPhoto, uAlbedo, uDepth, uNormal, uMatte;
uniform highp sampler2D uFig;   // 1 x rows, RG = the tower's left, right silhouette in u
uniform vec4 uFigBox;     // the tower's rows (top, bottom) in photo rows, its x range in u
uniform vec2 uRes;        // canvas px
uniform vec4 uRect;       // print rect in canvas px: x, y (top), w, h
uniform vec3 uEdge;       // sheet edges in image u: photo|lit, lit|normal, normal|depth
uniform vec3 uLight;      // light in image u, v (top-down), height
uniform vec3 uGround;
out vec4 o;

float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

const float ROWS = 1536.0;
const vec2 TEX = vec2(2048.0, 1536.0);
float pxU, pxR;   // one canvas pixel in u, and in photo rows

// Depth, 16 bits split over R (high byte) and G (low byte). Linear filtering
// of the two bytes recombines exactly, so the sheet has no 8-bit ledges.
float depthAt(vec2 uv){
  vec2 t = texture(uDepth, uv).rg;
  return t.r * (65280.0 / 65535.0) + t.g * (255.0 / 65535.0);
}

vec2 figRow(float r){
  if (r < uFigBox.x || r > uFigBox.y) return vec2(-1.0);
  return texelFetch(uFig, ivec2(0, int(r - uFigBox.x)), 0).rg;
}
// Where a sheet's edge e is cut on a row that holds the tower from h.x to
// h.y. It moves as one piece, never split across two sheets. The photo
// (side < 0) gives it up as soon as its edge reaches its rightmost point: on
// every row of the tower the cut runs back to its left silhouette. The deeper
// sheets (side > 0) hold on to it until their edge clears its leftmost point:
// the cut runs out to its right one. So the lit sheet keeps the tower, and no
// cut ever runs through it; above it the edge is straight.
float cutAt(float e, vec2 h, float side){
  if (h.x < 0.0) return e;
  if (side < 0.0) return (e > h.x && e < uFigBox.w) ? h.x : e;
  return (e > uFigBox.z && e < h.y) ? h.y : e;
}
// How much of the sheet below edge e shows at p = (u, photo row): 0 left of
// the cut, 1 right of it, a pixel of coverage in between, blended across rows.
float under(float e, float side, vec2 p){
  float r0 = floor(p.y - 0.5);
  float t = p.y - 0.5 - r0;
  float a = clamp((p.x - cutAt(e, figRow(r0), side)) / pxU + 0.5, 0.0, 1.0);
  float b = clamp((p.x - cutAt(e, figRow(r0 + 1.0), side)) / pxU + 0.5, 0.0, 1.0);
  return mix(a, b, t);
}
// One sheet edge as paper: coverage of the sheet below (a), a lighter cut lip
// on the sheet above (y), and the soft shadow it throws on the sheet below
// (z), cast down and to the right as if lit from the upper left.
vec3 sheet(float e, float side, vec2 p){
  float R = 16.0 * pxU;
  bool near = abs(p.x - e) < R ||
    (p.y > uFigBox.x - 16.0 * pxR && p.x > uFigBox.z - R && p.x < uFigBox.w + R);
  if (!near) return vec3(clamp((p.x - e) / pxU + 0.5, 0.0, 1.0), 0.0, 0.0);
  float a = under(e, side, p);
  float l = 1.5;
  float lip = (1.0 - a) * max(under(e, side, p + vec2(l * pxU, 0.0)),
    max(under(e, side, p + vec2(0.0, l * pxR)), under(e, side, p - vec2(0.0, l * pxR))));
  vec2 d = normalize(vec2(1.0, 0.45)) * 1.6;
  float sh = 0.0, wsum = 0.0;
  for (int k = 1; k <= 8; k++) {
    float w = exp(-float(k) / 3.2);
    sh += w * (1.0 - under(e, side, p - vec2(d.x * float(k) * pxU, d.y * float(k) * pxR)));
    wsum += w;
  }
  return vec3(a, lip, a * sh / wsum);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  pxU = 1.0 / uRect.z;
  pxR = ROWS / uRect.w;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    // A soft contact shadow under the print, nothing more.
    vec2 q = max(vec2(0.0), max(-uv, uv - 1.0)) * uRect.zw;
    float sh = exp(-dot(q, q) / (uRect.z * uRect.z * 0.0009)) * 0.10;
    o = vec4(uGround * (1.0 - sh), 1.0);
    return;
  }
  float D = depthAt(uv);
  float bend = (texture(uDepth, uv).b - 0.5) * 2.0;
  vec2 mt = texture(uMatte, uv).rg;
  float sky = mt.r;

  vec3 photo = texture(uPhoto, uv).rgb;

  // Depth, printed rather than dumped. The bake already stretched it to its
  // own 2nd-99.5th percentile; a 0.6 gamma on distance (1 - D) lifts the
  // far end so the tower, the pole and the two faces pull apart in tone.
  // Warm black for the sky, paper white for the nearest wall, and an
  // iso-depth line every twelfth of the range, faded out where the depth
  // jumps (a silhouette, not a slope) so lines only ever run across surfaces.
  float dt = 1.0 - pow(1.0 - D, 0.6);
  vec3 depth = mix(vec3(0.11, 0.1, 0.095), vec3(0.955, 0.945, 0.925), dt);
  float Ds = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 2.39996;
    float r = sqrt((float(k) + 0.5) / 8.0) * 3.0;
    Ds += depthAt(uv + vec2(cos(a), sin(a)) * r / TEX);
  }
  float iso = (1.0 - pow(1.0 - Ds / 8.0, 0.6)) * 12.0;
  float fw = fwidth(iso);
  float line = (1.0 - smoothstep(0.0, 1.0, abs(fract(iso + 0.5) - 0.5) / max(fw * 1.2, 1e-4)))
    * (1.0 - smoothstep(0.06, 0.3, fw)) * (1.0 - sky);
  depth *= 1.0 - 0.2 * line;
  depth += (hash(frag) - 0.5) / 255.0;

  // Normals as a plaster cast: one warm-grey albedo, a fixed raking light
  // from the upper left at 30 degrees, a little sky fill, so the walls, the
  // pole and the tower read as relief, not as the RGB encoding. Where depth
  // jumps a surface's far side sinks a little, the way plaster darkens in
  // the crease behind a figure. The sky has no surface: the cast stands in
  // front of a plain studio ground, darker toward the zenith.
  vec3 n = normalize(texture(uNormal, uv).rgb * 2.0 - 1.0);
  const vec3 RAKE = vec3(-0.6124, 0.6124, 0.5);
  float ndl = clamp((dot(n, RAKE) + 0.1) / 1.1, 0.0, 1.0);
  vec3 clay = vec3(0.6121, 0.5708, 0.508) * (0.9 * ndl + 0.16 + 0.08 * n.y);
  clay *= 1.0 - 0.3 * smoothstep(0.0, 0.3, -bend);
  vec3 ground = mix(vec3(0.5, 0.48, 0.455), vec3(0.64, 0.62, 0.59), uv.y);
  vec3 normal = mix(pow(clay, vec3(1.0 / 2.2)), ground, sky);
  normal += (hash(frag + 7.0) - 0.5) / 255.0;

  // Relit: the canyon's surfaces under one warm lamp that was never there.
  // Albedo is the baked one (the day's shading divided out), in linear
  // light, so the pool lands on the concrete and the tower's paint in their
  // own colours. The day goes down to blue hour: a cool skylight from above
  // is all that is left on the walls, and the sky deepens toward cobalt, so
  // the lamp's warmth is the only warmth in the sheet.
  float aspect = uRect.z / uRect.w;
  vec3 P = vec3(uv.x * aspect, -uv.y, D * 0.55);
  // The lamp hovers in the canyon in front of whatever is under the hand.
  float Dl = depthAt(clamp(uLight.xy, 0.0, 1.0));
  vec3 L = vec3(uLight.x * aspect, -uLight.y, max(Dl, 0.3) * 0.55 + uLight.z);
  vec3 dl = L - P;
  float dist2 = dot(dl, dl);
  vec3 l = dl * inversesqrt(dist2);
  // A touch of wrap so the terminator rolls off instead of cutting to black.
  float lam = max((dot(n, l) + 0.15) / 1.15, 0.0);
  float fall = 1.0 / (1.0 + dist2 * 30.0);
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 24.0);
  // The plate's grade leaves the concrete olive, and olive under a warm lamp
  // goes green; take most of the chroma off the walls (not the tower's paint)
  // so the lamp is what colours them.
  vec3 albedo = pow(texture(uAlbedo, uv).rgb, vec3(2.2));
  albedo = mix(vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), albedo, mix(0.35, 1.0, mt.g));
  vec3 lamp = vec3(1.0, 0.56, 0.26);
  float up = 0.5 + 0.5 * n.y;
  vec3 amb = albedo * mix(vec3(0.035, 0.045, 0.07), vec3(0.09, 0.115, 0.17), up);
  vec3 lit = amb + albedo * lamp * (lam * fall * 7.0) + lamp * spec * fall * 0.05;
  // A shoulder that rolls off before white, so the pool never clips.
  lit = pow(lit * 1.4 / (1.0 + lit * 1.4), vec3(1.0 / 2.2));
  vec3 dusk = pow(photo, vec3(1.35)) * vec3(0.78, 0.86, 1.0);
  lit = mix(lit, dusk, sky);

  // Sheets, crisp to a pixel, cut around the tower. Each lower sheet sits in
  // the shadow of the one above; each upper sheet's cut catches a paper lip.
  vec2 p = vec2(uv.x, uv.y * ROWS);
  vec3 s0 = sheet(uEdge.x, -1.0, p);
  vec3 s1 = sheet(uEdge.y, 1.0, p);
  vec3 s2 = sheet(uEdge.z, 1.0, p);
  vec3 paper = vec3(0.985, 0.975, 0.955);
  vec3 c = mix(photo, paper, 0.2 * s0.y);
  c = mix(c, mix(lit, paper, 0.12 * s1.y) * (1.0 - 0.32 * s0.z), s0.x);
  c = mix(c, mix(normal, paper, 0.4 * s2.y) * (1.0 - 0.26 * s1.z), s1.x);
  c = mix(c, depth * (1.0 - 0.2 * s2.z), s2.x);
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 2048 / 1536;
// The photo|lit seam sits under the hand (LEAD behind it). At rest (hand at
// 0.4) it crosses the tower's deck, so the photo's cut steps back around the
// tower's left side and the lit sheet holds all of it, about u 0.38-0.6.
const LEAD = 0;
// Lamp height above the surface under it, in the shader's scene units
// (the whole depth range spans 0.55).
const LAMP_Z = 0.12;
const REST = 0.4;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

export async function createPasses(host, { embedded = false } = {}) {
  const [photo, albedo, depth, normal, matte] = await Promise.all(
    ["photo.webp", "albedo.webp", "depth.png", "normal.webp", "matte.png"].map((f) => loadImage(SRC + f)),
  );

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const holdX = params.has("x") ? clamp(parseFloat(params.get("x")) || 0, 0, 1) : null;
  const holdLx = params.has("lx") ? parseFloat(params.get("lx")) : null;
  const holdLy = params.has("ly") ? parseFloat(params.get("ly")) : null;

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
  const u = { res: U("uRes"), rect: U("uRect"), edge: U("uEdge"), light: U("uLight"), ground: U("uGround"), figBox: U("uFigBox") };

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = (im, unit, name, mips) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U(name), unit);
  };
  tex(photo, 0, "uPhoto", true);
  tex(depth, 1, "uDepth", false);
  tex(normal, 2, "uNormal", true);
  tex(albedo, 4, "uAlbedo", true);
  tex(matte, 5, "uMatte", true);

  // The tower's matte: per photo row, its left and right silhouette in u.
  const raw = Uint8Array.from(atob(TOWER.data), (ch) => ch.charCodeAt(0));
  const fig = new Float32Array(TOWER.rows * 2);
  let fx0 = 1;
  let fx1 = 0;
  for (let i = 0; i < fig.length; i++) {
    fig[i] = (raw[2 * i] | (raw[2 * i + 1] << 8)) / 16 / TOWER.w;
    if (i % 2) fx1 = Math.max(fx1, fig[i]);
    else fx0 = Math.min(fx0, fig[i]);
  }
  const figTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, figTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, TOWER.rows, 0, gl.RG, gl.FLOAT, fig);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(U("uFig"), 3);
  gl.uniform4f(u.figBox, TOWER.top, TOWER.top + TOWER.rows - 1, fx0, fx1);

  // Ground: the page's warm white, read from the box so it matches.
  const ground = [0.949, 0.941, 0.922];

  let dirty = true;
  // Print rect in CSS px.
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  stage.onResize((w, h) => {
    const m = Math.max(24, Math.round(Math.min(w, h) * (embedded ? 0.07 : 0.09)));
    let ph = h - 2 * m;
    let pw = ph * IMG_ASPECT;
    if (pw > w - 2 * m) {
      pw = w - 2 * m;
      ph = pw / IMG_ASPECT;
    }
    rect = { x: Math.round((w - pw) / 2), y: Math.round((h - ph) / 2), w: Math.round(pw), h: Math.round(ph) };
    dirty = true;
  });

  // Seam and the three sheet edges. Each edge is a spring chasing its place
  // behind the one above it; the deeper the sheet, the softer its spring, so
  // a quick drag fans the passes out and they settle back. The relit sheet
  // comes first under the photo and takes half the room left; normals and
  // depth share the rest.
  let seam = holdX == null ? 1.0 : clamp(holdX - LEAD, 0, 1);
  const SHARE = [0, 0.5, 0.75];
  const target = (i, s) => s + (1 - s) * SHARE[i];
  const edges = [0, 1, 2].map((i) => ({ x: target(i, seam), v: 0 }));
  const K = [260, 170, 120];
  const Z = [0.92, 0.88, 0.86];
  // Light: rests in the canyon beside the tower until a pointer comes to move it.
  const light = { x: holdLx ?? 0.5, y: holdLy ?? 0.55, tx: holdLx ?? 0.5, ty: holdLy ?? 0.55 };
  let introAt = holdX == null ? performance.now() + 450 : 0;

  const toU = (p) => ({ x: (p.x - rect.x) / rect.w, y: (p.y - rect.y) / rect.h });
  stage.on("down", (p) => {
    introAt = 0;
    const q = toU(p);
    seam = clamp(q.x - LEAD, 0, 1);
    light.tx = clamp(q.x, -0.1, 1.1);
    light.ty = clamp(q.y, -0.1, 1.1);
  });
  stage.on("move", (p) => {
    const q = toU(p);
    if (p.down) seam = clamp(q.x - LEAD, 0, 1);
    light.tx = clamp(q.x, -0.1, 1.1);
    light.ty = clamp(q.y, -0.1, 1.1);
  });

  stage.onFrame((dt, t) => {
    if (introAt && performance.now() > introAt) {
      seam = REST;
      introAt = 0;
    }
    let moving = false;
    for (let i = 0; i < 3; i++) {
      const e = edges[i];
      const k = K[i];
      const c = 2 * Math.sqrt(k) * Z[i];
      // Substep so the stiffest spring stays stable at low frame rates.
      const n = 2;
      const h = dt / n;
      for (let s = 0; s < n; s++) {
        const a = k * (target(i, seam) - e.x) - c * e.v;
        e.v += a * h;
        e.x += e.v * h;
      }
      if (Math.abs(e.v) > 1e-4 || Math.abs(target(i, seam) - e.x) > 1e-4) moving = true;
      else e.x = target(i, seam);
    }
    const kl = 1 - Math.exp(-dt * 10);
    // The lamp follows the pointer anywhere on the print, the tower included.
    const dx = light.tx - light.x;
    const dy = light.ty - light.y;
    if (Math.abs(dx) + Math.abs(dy) > 1e-4) {
      light.x += dx * kl;
      light.y += dy * kl;
      moving = true;
    }
    if (!moving && !dirty) return;
    dirty = false;
    draw();
  });

  function draw() {
    const d = stage.dpr;
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.uniform2f(u.res, stage.canvas.width, stage.canvas.height);
    gl.uniform4f(u.rect, rect.x * d, rect.y * d, rect.w * d, rect.h * d);
    gl.uniform3f(u.edge, edges[0].x, edges[1].x, edges[2].x);
    gl.uniform3f(u.light, light.x, light.y, LAMP_Z);
    gl.uniform3f(u.ground, ground[0], ground[1], ground[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      stage.destroy();
    },
  };
}
