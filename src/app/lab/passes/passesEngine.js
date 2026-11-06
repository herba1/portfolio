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
uniform vec3 uEdge;       // sheet edges in image u: photo|depth, depth|normal, normal|lit
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

  // Relit: the photograph's own geometry under one warm lamp. The lamp sits
  // in front of the scene at the pointer; distance and facing do the rest.
  float aspect = uRect.z / uRect.w;
  vec3 P = vec3(uv.x * aspect, -uv.y, D * 0.55);
  vec3 L = vec3(uLight.x * aspect, -uLight.y, uLight.z);
  vec3 dl = L - P;
  float dist2 = dot(dl, dl);
  vec3 l = dl * inversesqrt(dist2);
  float lam = max(dot(n, l), 0.0);
  float fall = 1.0 / (1.0 + dist2 * 22.0);
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 40.0) * 0.35;
  float luma = dot(photo, vec3(0.3, 0.55, 0.15));
  vec3 albedo = mix(vec3(luma), photo, 0.7);
  albedo = mix(vec3(0.86, 0.84, 0.81), pow(albedo, vec3(0.5)), 0.5);
  vec3 lamp = vec3(1.0, 0.86, 0.68);
  float sky = 0.5 + 0.5 * n.y;
  vec3 amb = albedo * mix(vec3(0.05, 0.05, 0.06), vec3(0.1, 0.11, 0.13), sky);
  vec3 lit = photo * 0.05 + amb + albedo * lamp * (lam * fall * 4.0) + lamp * spec * fall;
  lit = lit / (1.0 + lit * 0.35);

  // Sheets, crisp to a pixel, each one casting a thin shadow on the next.
  float a0 = clamp((x - uEdge.x) / px + 0.5, 0.0, 1.0);
  float a1 = clamp((x - uEdge.y) / px + 0.5, 0.0, 1.0);
  float a2 = clamp((x - uEdge.z) / px + 0.5, 0.0, 1.0);
  vec3 c = mix(photo, depth, a0);
  c = mix(c, normal, a1);
  c = mix(c, lit, a2);
  float s0 = a0 * exp(-max(0.0, x - uEdge.x) / (px * 5.0));
  float s1 = a1 * exp(-max(0.0, x - uEdge.y) / (px * 5.0));
  float s2 = a2 * exp(-max(0.0, x - uEdge.z) / (px * 5.0));
  float sh = max(s0 * step(x, uEdge.y), max(s1 * step(x, uEdge.z), s2));
  c *= 1.0 - 0.2 * sh;
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 1536 / 2048;
const REST = 0.16;

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
  // a quick drag fans the passes out and they settle back into even bands.
  let seam = holdX ?? 1.0;
  const target = (i, s) => s + ((1 - s) * i) / 3;
  const edges = [0, 1, 2].map((i) => ({ x: target(i, seam), v: 0 }));
  const K = [260, 170, 120];
  const Z = [0.92, 0.88, 0.86];
  // Light: rests over the lit sheet until a pointer comes to move it.
  const light = { x: holdLx ?? 0.8, y: holdLy ?? 0.42, tx: holdLx ?? 0.8, ty: holdLy ?? 0.42 };
  let introAt = holdX == null ? performance.now() + 450 : 0;

  const toU = (p) => ({ x: (p.x - rect.x) / rect.w, y: (p.y - rect.y) / rect.h });
  stage.on("down", (p) => {
    introAt = 0;
    seam = clamp(toU(p).x, 0, 1);
    const q = toU(p);
    light.tx = clamp(q.x, -0.1, 1.1);
    light.ty = clamp(q.y, -0.1, 1.1);
  });
  stage.on("move", (p) => {
    const q = toU(p);
    if (p.down) seam = clamp(q.x, 0, 1);
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
    // The lamp lives over the lit sheet: it follows the pointer, but never
    // further left than just inside that sheet's edge.
    const dx = Math.max(light.tx, edges[2].x + 0.08) - light.x;
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
    gl.uniform3f(u.light, light.x, light.y, 0.78);
    gl.uniform3f(u.ground, ground[0], ground[1], ground[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      stage.destroy();
    },
  };
}
