import { createStage, clamp } from "../_kit/stage";

// One photograph and the passes under it, the way a renderer or a
// photogrammetry tool keeps them: depth, surface normals, and the scene relit.
// Everything but the light is baked offline (bake.py, kept outside the repo): the photo, a
// Depth Anything V2 map snapped to the photo's edges, and normals from
// back-projecting that depth through the phone's lens. The depth PNG's green
// channel holds depth minus a wide blur: zero on smooth surfaces, large only
// at discontinuities, so offsetting each sheet's edge by it makes the edge
// step around herb's silhouette like paper laid over something standing up.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uPhoto, uDepth, uNormal;
uniform vec2 uRes;        // canvas px
uniform vec4 uRect;       // print rect in canvas px: x, y (top), w, h
uniform vec3 uEdge;       // sheet edges in image u: photo|lit, lit|normal, normal|depth
uniform vec3 uLight;      // light in image u, v (top-down), height
uniform vec3 uGround;
out vec4 o;

float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  float px = 1.0 / uRect.z;                     // one canvas pixel in u
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    // A soft contact shadow under the print, nothing more.
    vec2 q = max(vec2(0.0), max(-uv, uv - 1.0)) * uRect.zw;
    float sh = exp(-dot(q, q) / (uRect.z * uRect.z * 0.0009)) * 0.10;
    o = vec4(uGround * (1.0 - sh), 1.0);
    return;
  }
  vec4 dp = texture(uDepth, uv);
  float D = dp.r;
  float bend = (dp.g - 0.5) * 2.0;
  // Where the sheet edge sits for this pixel. Near things hold their sheet
  // a little longer, so the edge steps around them.
  float x = uv.x - bend * 0.055;

  vec3 photo = texture(uPhoto, uv).rgb;

  // Depth: a soft greyscale with a breath of warmth, dithered against banding.
  float dv = smoothstep(0.0, 1.0, pow(D, 0.6));
  vec3 depth = mix(vec3(0.13, 0.128, 0.135), vec3(0.955, 0.945, 0.925), dv);
  depth += (hash(frag) - 0.5) / 255.0;

  vec3 n = normalize(texture(uNormal, uv).rgb * 2.0 - 1.0);
  vec3 normal = mix(n * 0.5 + 0.5, vec3(0.97, 0.96, 0.95), 0.3);

  // Relit: the photograph's own surfaces under one warm lamp that was never
  // in the street. Albedo is the photo itself, taken to linear light, so the
  // pool lands on his coat and the pavement in their own colours. Where the
  // depth jumps (|bend| large) the baked normals swing sideways across a
  // silhouette that isn't a surface; ease them back to facing the camera
  // there so edges don't ring with dark halos. The bad normals live on the
  // far side of the jump (bend < 0, the street hugging his outline); on the
  // near side (bend > 0) his coat really does turn away, so it keeps most
  // of its shape. The far field gets the same treatment: back there depth
  // is a sliver, its normals are noise, and the street reads as a backdrop.
  float aspect = uRect.z / uRect.w;
  float settle = max(smoothstep(0.06, 0.26, -bend), 0.5 * smoothstep(0.35, 0.6, bend));
  settle = max(settle, 1.0 - smoothstep(0.06, 0.22, D));
  vec3 nl = normalize(mix(n, vec3(0.0, 0.0, 1.0), settle));
  vec3 P = vec3(uv.x * aspect, -uv.y, D * 0.55);
  // The lamp hovers a hand's height above whatever surface is under it, so
  // it stays close enough to throw a pool rather than a flat wash.
  float Dl = texture(uDepth, clamp(uLight.xy, 0.0, 1.0)).r;
  vec3 L = vec3(uLight.x * aspect, -uLight.y, Dl * 0.55 + uLight.z);
  vec3 dl = L - P;
  float dist2 = dot(dl, dl);
  vec3 l = dl * inversesqrt(dist2);
  // A touch of wrap so the terminator rolls off instead of cutting to black.
  float lam = max((dot(nl, l) + 0.15) / 1.15, 0.0);
  float fall = 1.0 / (1.0 + dist2 * 5.0);
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(nl, h), 0.0), 24.0);
  // Linear albedo, lifted a touch so his black coat still answers the lamp.
  vec3 albedo = pow(photo, vec3(2.2)) * 0.9 + 0.015;
  vec3 lamp = vec3(1.0, 0.62, 0.32);
  float sky = 0.5 + 0.5 * nl.y;
  // The street's own lights go out: a cool, low ambient, so the lamp's
  // warmth is the only warmth left in the sheet.
  vec3 amb = albedo * mix(vec3(0.1, 0.115, 0.14), vec3(0.12, 0.135, 0.165), sky);
  vec3 lit = amb + albedo * lamp * (lam * fall * 7.0) + lamp * spec * fall * 0.12;
  lit = pow(lit / (1.0 + lit * 0.45), vec3(1.0 / 2.2));

  // Sheets, crisp to a pixel, each one casting a thin shadow on the next.
  float a0 = clamp((x - uEdge.x) / px + 0.5, 0.0, 1.0);
  float a1 = clamp((x - uEdge.y) / px + 0.5, 0.0, 1.0);
  float a2 = clamp((x - uEdge.z) / px + 0.5, 0.0, 1.0);
  vec3 c = mix(photo, lit, a0);
  c = mix(c, normal, a1);
  c = mix(c, depth, a2);
  float s0 = a0 * exp(-max(0.0, x - uEdge.x) / (px * 5.0));
  float s1 = a1 * exp(-max(0.0, x - uEdge.y) / (px * 5.0));
  float s2 = a2 * exp(-max(0.0, x - uEdge.z) / (px * 5.0));
  float sh = max(s0 * step(x, uEdge.y), max(s1 * step(x, uEdge.z), s2));
  c *= 1.0 - 0.2 * sh;
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 1536 / 2048;
// The photo|lit seam trails the hand by LEAD, so the lamp under your finger
// always sits over the relit sheet. At rest (hand at 0.4) the lit sheet spans
// herb, about u 0.3-0.65.
const LEAD = 0.1;
// Lamp height above the surface under it, in the shader's scene units
// (the whole depth range spans 0.55).
const LAMP_Z = 0.2;
const REST = 0.3;

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
  const [photo, depth, normal] = await Promise.all(["photo.webp", "depth.png", "normal.webp"].map((f) => loadImage(SRC + f)));

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
  const u = { res: U("uRes"), rect: U("uRect"), edge: U("uEdge"), light: U("uLight"), ground: U("uGround") };

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
  // Light: rests just in front of herb's chest until a pointer comes to move it.
  const light = { x: holdLx ?? 0.44, y: holdLy ?? 0.62, tx: holdLx ?? 0.44, ty: holdLy ?? 0.62 };
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
    // The lamp follows the pointer anywhere on the print, herb included.
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
