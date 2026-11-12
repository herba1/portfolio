import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "./film";

// Film test: one photograph developed through the film kit, shot through a
// circular polariser you turn by dragging sideways.
//
// The polariser sits in front of the lens, so it acts on the scene light
// before the film sees it. Clear summer sky is strongly polarised skylight;
// sunlit cloud is not. Turning the filter by an angle d from the sky's
// polarisation passes the polarised share P of the skylight as 2 sin^2(d)
// (the camera has opened up a stop for the filter, so unpolarised light
// passes as it was): the sky goes from 1+P of its light down to 1-P,
// t = 1 - P cos(2d), a cos^2 response with a half-turn period. The cloud's
// blue-grey shade is lit by that same skylight and darkens with it, so the
// lobes gain drawing as the sky deepens. The local polarisation direction
// swings across a wide frame (the darkest band runs 90 degrees from the sun),
// so the deepest blue sweeps across the sky as the ring turns. The film's dye
// density on the sky follows the same response.
//
// The ring has weight: it follows the drag on a spring (time constant about
// 300 ms, damping 0.85), keeps turning when let go and slows under friction,
// and drifts a few degrees on its own when left alone. The frame opens
// overexposed, white-blue, and settles into the developed exposure.
//
// Query: ?x=0..1 starting angle as a share of a half-turn (0 = sky darkest),
// ?lift=0..1 holds the reveal at that point (1 = the white-blue opening),
// ?preset=summer|dusk|night, ?motion=0 still grain and no drift, and any
// numeric film param to override the preset (?halation=0.6&bloom=0.3).

const SRC = "/lab/film-test/cumulus-wires.jpg";

// Summer, re-tuned for this photograph: a towering cumulus shot straight up
// past three power lines, its lobes drawn by a soft high sun and a hazy blue.
// Only light past the knee scatters, and the knee is narrow, so the shaded
// lower lobes keep their mid-greys out of the veil; a steeper mid slope gives
// them back the separation the haze took. The shoulder rolls off warm-neutral
// so the brightest tops read as sunlit rather than paper white. Nothing in the
// cloud is clipped, so it does not need to glow past itself.
const SUMMER = {
  ...FILM_PRESETS.summer,
  exposure: 0.12,
  contrast: 1.5,
  headroom: 0.8,
  bloomThreshold: 0.62,
  bloomKnee: 0.18,
  highlightTint: [1.04, 1, 0.94],
  shoulderTint: [1.005, 0.991, 0.962],
  whitePoint: 1.0,
};
const PRESETS = { ...FILM_PRESETS, summer: SUMMER };

// Polariser and ring.
const POL = 0.22; // polarised share of the clear sky's light at its strongest
const TAU = 0.3; // spring time constant: 63% of a step in 300 ms
const ZETA = 0.85; // spring damping ratio
const OMEGA = 1.9 / TAU; // natural frequency, rad/s (1.9 rad at ZETA 0.85 is 63%)
const FRICTION = 0.6; // s, time constant of a flicked ring spinning down
const DRIFT = (9 * Math.PI) / 180; // idle drift amplitude
const DRIFT_PERIOD = 13; // s
const IDLE_AFTER = 2.5; // s without input before the ring drifts
// The sky's depth on film: the dye pull at the filter's two extremes.
const DEPTH = [0.55, 1];
const REVEAL = 2.4; // s from overexposed to developed
const REVEAL_TINT = [0.88, 0.935, 1];

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Draws the photograph cover-fitted through the polariser.
const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec4 uXform;
uniform float uAngle;   // ring angle, radians
uniform float uPol;     // polarised share of clear skylight
uniform float uAspect;
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec3 c = toLinear(texture(uTex, vUv * uXform.xy + uXform.zw).rgb);
  // How much of this pixel is skylight: clear sky by its blue chroma, the
  // cloud's blue-grey shade (lit by that sky) by a lighter share of it. White
  // sunlit cloud and the dark wires carry none.
  float chroma = (c.b - c.r) / (c.b + 1e-3);
  float sky = smoothstep(0.38, 0.85, chroma);
  float shade = smoothstep(0.04, 0.3, chroma) * (1.0 - sky);
  // Polarisation is strongest 90 degrees from the sun (up and to the left
  // here) and weaker towards the haze near the horizon.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float dop = uPol * (0.82 + 0.18 * clamp(0.5 + p.y - 0.3 * p.x, 0.0, 1.0));
  // Its direction swings across the frame, so the darkest band moves.
  float psi = 0.32 * p.x - 0.22 * p.y;
  float swing = cos(2.0 * (uAngle - psi));
  // In the clear sky the polariser cuts the haze's whiter glare a little
  // harder than the deep blue, so the sky deepens rather than greys; the
  // cloud's shade, lit by the deep blue overhead, keeps its blue.
  vec3 w = mix(vec3(1.0, 1.06, 0.92), vec3(1.25, 1.12, 0.9), sky);
  c *= max(1.0 - dop * (sky + 0.6 * shade) * swing * w, 0.0);
  outColor = vec4(toSrgb(c), 1.0);
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
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (const name of ["uTex", "uXform", "uAngle", "uPol", "uAspect"]) u[name] = gl.getUniformLocation(p, name);
  return { p, u };
}

function readParams(search) {
  const q = new URLSearchParams(search);
  const preset = PRESETS[q.get("preset")] || PRESETS.summer;
  const params = { ...FILM_DEFAULTS, ...preset };
  for (const key of Object.keys(FILM_DEFAULTS)) {
    if (typeof FILM_DEFAULTS[key] !== "number") continue;
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) params[key] = +v;
  }
  const x = q.get("x");
  return {
    params,
    angle: x != null && Number.isFinite(+x) ? clamp(+x, 0, 1) * Math.PI : 0,
    still: q.get("motion") === "0",
    hold: q.get("lift") != null && Number.isFinite(+q.get("lift")) ? clamp(+q.get("lift"), 0, 1) : null,
  };
}

export async function createFilmTest(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const img = await loadImage(SRC);
  const photo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, photo);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const prog = compile(gl, VERT, SCENE);
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });

  // The scene the film develops: the photograph through the polariser,
  // cover-fitted at canvas size, sRGB-encoded as any RGBA8 render would be.
  let scene = null;
  const makeScene = (w, h) => {
    if (scene) {
      gl.deleteTexture(scene.tex);
      gl.deleteFramebuffer(scene.fbo);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    scene = { tex, fbo, w, h };
  };

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const q = readParams(window.location.search);
  const { params } = q;
  let still = q.still || reduce;

  // The ring: `rest` is where the hand left it, `target` adds the idle drift,
  // `angle` follows `target` on the spring.
  let rest = q.angle;
  let spin = 0; // rad/s, after a flick
  let angle = rest;
  let vel = 0;
  let dragX = 0;
  let idle = 0;
  let driftT = 0;
  let driftAmp = 0;
  let born = null; // when the first frame reached the screen
  let clock = 0;
  let fence = null; // the frame still developing on the GPU
  let fenceAt = 0;
  let slow = 0;
  let frame = 0;
  let sinceFrame = 1;
  let dirty = true;

  stage.onResize(() => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    film.resize(w, h);
    makeScene(w, h);
    dirty = true;
  });

  // A full drag across the frame turns the ring half a turn: one whole cycle
  // of the polariser, deepest to palest and back.
  const perPx = () => Math.PI / Math.max(1, stage.width);
  stage.on("down", (p) => {
    dragX = p.x;
    spin = 0;
    idle = 0;
  });
  stage.on("move", (p) => {
    if (!p.down) return;
    rest += (p.x - dragX) * perPx();
    dragX = p.x;
    idle = 0;
  });
  stage.on("up", (p) => {
    spin = clamp(p.vx * perPx(), -4 * Math.PI, 4 * Math.PI);
    idle = 0;
  });

  const drawScene = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // 1. The photograph through the filter.
    const ca = scene.w / scene.h;
    const ia = img.naturalWidth / img.naturalHeight;
    const sx = ca > ia ? 1 : ca / ia;
    const sy = ca > ia ? ia / ca : 1;
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photo);
    gl.uniform1i(prog.u.uTex, 0);
    gl.uniform4f(prog.u.uXform, sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    gl.uniform1f(prog.u.uAngle, angle);
    gl.uniform1f(prog.u.uPol, POL);
    gl.uniform1f(prog.u.uAspect, w / h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const draw = (exposureLift, coolLift) => {
    drawScene();

    // 2. Developed. The sky's dye density follows the filter at the frame's
    // centre: cos^2 of the ring angle.
    const c2 = Math.cos(angle) ** 2;
    film.render(
      scene.tex,
      {
        ...params,
        blueDepth: params.blueDepth * (DEPTH[0] + (DEPTH[1] - DEPTH[0]) * c2),
        exposure: params.exposure + exposureLift,
        warmth: params.warmth - coolLift,
        saturation: params.saturation * (1 - 0.5 * coolLift),
        // overexposed, the shoulder burns out white-blue, not cream
        shoulderTint: params.shoulderTint.map((v, i) => v + (REVEAL_TINT[i] - v) * Math.min(1, coolLift * 1.6)),
        grainSeed: still ? 0 : frame,
      },
      null,
    );
  };

  stage.onFrame((dt) => {
    if (!scene) return;
    let moving = false;

    // Reveal: overexposed white-blue, settling into the developed frame. On
    // the wall clock, so a slow GPU skips ahead rather than dragging it out.
    let lift = 0;
    if (clock < REVEAL) {
      clock = reduce ? REVEAL : born == null ? 0 : (performance.now() - born) / 1000;
      const u = clamp((clock - 0.25) / (REVEAL - 0.25), 0, 1);
      lift = (1 - u) ** 3;
      moving = true;
    }

    // Inertia: a flicked ring keeps turning and slows under friction.
    if (!stage.pointer.down && Math.abs(spin) > 1e-3) {
      rest += spin * dt;
      spin *= Math.exp(-dt / FRICTION);
      moving = true;
    } else spin = 0;

    // Idle drift: a few degrees either way, eased in after a pause.
    idle += dt;
    const wantDrift = !still && !stage.pointer.down && idle > IDLE_AFTER && clock >= REVEAL ? 1 : 0;
    driftAmp += (wantDrift - driftAmp) * (1 - Math.exp(-dt / 1.5));
    if (driftAmp > 1e-3) driftT += dt;
    const target = rest + DRIFT * driftAmp * Math.sin((2 * Math.PI * driftT) / DRIFT_PERIOD);

    // Spring, in small steps (semi-implicit Euler).
    const n = Math.ceil(dt / (1 / 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      vel += (-2 * ZETA * OMEGA * vel - OMEGA * OMEGA * (angle - target)) * h;
      angle += vel * h;
    }
    const settling = Math.abs(vel) > 1e-4 || Math.abs(angle - target) > 1e-4;

    // Grain moves at 24 frames a second, like the film it pretends to be;
    // the slow drift renders on the same cadence.
    sinceFrame += dt;
    const tick = sinceFrame >= 1 / 24;
    if (tick && !still) {
      sinceFrame = 0;
      frame++;
      dirty = true;
    }
    if (moving || stage.pointer.down) dirty = true;
    else if (settling && (driftAmp < 0.98 || tick)) dirty = true;

    // One frame in flight at a time: a frame still developing on the GPU
    // holds the next back instead of queueing behind it. A GPU that cannot
    // develop about 12 frames a second (software GL, an old integrated chip)
    // keeps the still frame: no moving grain, no drift, and a reveal that
    // would play as a slideshow cuts straight to the print.
    const now = performance.now();
    if (fence) {
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
      gl.deleteSync(fence);
      fence = null;
      const latency = now - fenceAt;
      if (born == null) {
        // The probe: one full-frame pass of the photograph, a sliver of what
        // the film costs. Fast GPUs return it within a frame or two.
        born = now;
        if (latency > 70) slow = 6;
      } else slow = latency > 85 ? slow + (latency > 250 ? 3 : 1) : Math.max(0, slow - 1);
      if (slow > 5 && !still) {
        still = true;
        clock = REVEAL;
        lift = 0;
      }
    }
    if (!dirty) return;
    if (born == null) {
      if (!fence) {
        drawScene();
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        fenceAt = now;
      }
      return;
    }
    dirty = false;
    if (q.hold != null) lift = q.hold;
    draw(lift * 3.2, lift * 0.5);
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    fenceAt = now;
  });

  return {
    destroy() {
      if (fence) gl.deleteSync(fence);
      film.destroy();
      if (scene) {
        gl.deleteTexture(scene.tex);
        gl.deleteFramebuffer(scene.fbo);
      }
      gl.deleteTexture(photo);
      gl.deleteProgram(prog.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
