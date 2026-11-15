import * as THREE from "three";

import { RESOLVE_VERTEX, SKY_GLSL, bindSky, skyUniforms } from "./splatMaterial";
import { FILM } from "./splatVideoParams";

const LUMA = "const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);";

// The analytic sky behind the splats, along each pixel's ray through the same
// stereographic lens.
const SKY_AT = `
uniform float uSkyOn;
uniform float uStereo;
uniform float uStereoShift;
uniform float uAspect;
uniform mat3 uCameraBasis;
${SKY_GLSL}
vec3 skyAt(vec2 uv) {
  vec2 p = (uv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uStereo + vec2(uStereoShift, 0.0);
  float r2 = dot(p, p);
  vec3 local = vec3(4.0 * p, r2 - 4.0) / (4.0 + r2);
  return skyColor(normalize(uCameraBasis * local));
}

// The frame as it will print: the splats and the card over the sky.
vec4 frameAt(sampler2D source, vec2 uv, vec3 sky) {
  vec4 c = texture(source, uv);
  return uSkyOn > 0.5 ? vec4(c.rgb + sky * (1.0 - c.a), 1.0) : c;
}
`;

// Quarter-res pass: four bilinear taps cover the 4x4 block under each texel,
// so neither output aliases on the thin wires. rgb is the frame itself (sky
// included), the light the lens scatters back over the dark steel; a is the
// highlights alone, the halation source.
const BRIGHT_FRAGMENT = `
precision highp float;
${LUMA}

uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
${SKY_AT}
in vec2 vUv;
out vec4 fragColor;

vec4 bright(vec2 uv, vec3 sky) {
  vec4 c = frameAt(uSource, uv, sky);
  if (c.a <= 0.0) return vec4(0.0);
  float l = dot(c.rgb / c.a, LUMA);
  return vec4(c.rgb, smoothstep(uThreshold, uThreshold + uKnee, l) * c.a);
}

void main() {
  vec3 sky = uSkyOn > 0.5 ? skyAt(vUv) : vec3(0.0);
  vec4 b = bright(vUv + uTexel * vec2(-1.0, -1.0), sky);
  b += bright(vUv + uTexel * vec2(1.0, -1.0), sky);
  b += bright(vUv + uTexel * vec2(-1.0, 1.0), sky);
  b += bright(vUv + uTexel * vec2(1.0, 1.0), sky);
  fragColor = b * 0.25;
}
`;

const BLUR_FRAGMENT = `
precision highp float;

uniform sampler2D uSource;
uniform vec2 uStep;
uniform float uSigma;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 sum = vec4(0.0);
  float weights = 0.0;
  for (int i = -8; i <= 8; i += 1) {
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uSource, vUv + uStep * x) * w;
    weights += w;
  }
  fragColor = sum / weights;
}
`;

const COMPOSITE_FRAGMENT = `
precision highp float;
${LUMA}

uniform sampler2D uScene;
uniform sampler2D uHalo;
uniform vec3 uLift;
uniform vec2 uToe;
uniform vec3 uHaloTint;
uniform float uHaloGain;
uniform float uThreshold;
uniform float uKnee;
uniform vec2 uHaloDark;
uniform float uHaloReach;
uniform float uHaloCap;
uniform float uErodeReach;
uniform float uErode;
uniform float uWrap;
uniform float uShoulder;
uniform float uCap;
uniform float uGrain;
uniform float uGrainFloor;
uniform float uGrainFrame;
uniform float uGrainCell;
uniform vec2 uPixel;
${SKY_AT}
in vec2 vUv;
out vec4 fragColor;

uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float uniformAt(uvec3 p) {
  return float(pcg(p.x + pcg(p.y + pcg(p.z)))) * (1.0 / 4294967295.0);
}

// Near-gaussian, unit variance: three uniforms summed and rescaled.
float normalAt(uvec3 p) {
  float s = uniformAt(p) + uniformAt(p + uvec3(0u, 0u, 7919u)) + uniformAt(p + uvec3(0u, 0u, 104729u));
  return (s - 1.5) * 2.0;
}

// Soft clumps a little over one device pixel wide. Dividing by the length of
// the weights keeps the variance at one everywhere between cell centres.
float grainAt(vec2 pixel) {
  vec2 cell = pixel / uGrainCell;
  vec2 i = floor(cell);
  vec2 f = fract(cell);
  vec2 s = f * f * (3.0 - 2.0 * f);
  uint frame = uint(uGrainFrame);
  uvec2 base = uvec2(i) + 4096u;
  float n00 = normalAt(uvec3(base, frame));
  float n10 = normalAt(uvec3(base + uvec2(1u, 0u), frame));
  float n01 = normalAt(uvec3(base + uvec2(0u, 1u), frame));
  float n11 = normalAt(uvec3(base + uvec2(1u, 1u), frame));
  vec4 w = vec4((1.0 - s.x) * (1.0 - s.y), s.x * (1.0 - s.y), (1.0 - s.x) * s.y, s.x * s.y);
  return dot(w, vec4(n00, n10, n01, n11)) / length(w);
}

vec3 shoulder(vec3 c) {
  float room = uCap - uShoulder;
  vec3 over = max(c - uShoulder, 0.0);
  vec3 rolled = uShoulder + room * (1.0 - exp(-over / room));
  return mix(c, rolled, step(uShoulder, c));
}

// Eight taps on a ring reach device px out: the brightest of them (the
// halation gate: is a highlight that close) and their mean colour (what the
// sky would put here if it bled in).
void ring(vec2 reach, vec3 sky, inout float brightest, inout vec3 mean) {
  for (int i = 0; i < 8; i += 1) {
    float a = float(i) * 0.785398 + 0.392699;
    vec4 t = frameAt(uScene, vUv + vec2(cos(a), sin(a)) * reach * uPixel, sky);
    vec3 rgb = t.a > 0.0 ? t.rgb / t.a : vec3(0.0);
    brightest = max(brightest, dot(rgb, LUMA));
    mean += rgb * 0.125;
  }
}

void main() {
  vec3 sky = uSkyOn > 0.5 ? skyAt(vUv) : vec3(0.0);
  vec4 scene = frameAt(uScene, vUv, sky);
  if (scene.a <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 c = scene.rgb / scene.a;
  float l0 = dot(c, LUMA);
  float dark = 1.0 - smoothstep(uHaloDark.x, uHaloDark.y, l0);

  // The sky erodes the steel: a dark pixel within a pixel or two of anything
  // lighter takes a share of what surrounds it, so a wire over the cloud
  // thins and pales instead of printing as a cut line.
  float inner = 0.0;
  float outer = 0.0;
  vec3 mean = vec3(0.0);
  vec3 wide = vec3(0.0); // the outer ring only gates the halation
  ring(vec2(uErodeReach), sky, inner, mean);
  ring(vec2(uHaloReach), sky, outer, wide);
  c = mix(c, max(c, mean), uErode * dark);

  // Veiling: the light the lens scatters off the open sky lifts every dark
  // pixel by the frame's brightness around it, so thin members read lighter
  // than the post's core.
  vec4 halo = texture(uHalo, vUv);
  c += halo.rgb * (uWrap * dark);

  // Toe: the blacks are exposed film, lifted and tinted cyan-navy. The lift
  // fades out before the sky, so only the silhouette moves.
  float l = dot(c, LUMA);
  float toe = 1.0 - smoothstep(uToe.x, uToe.y, l);
  c = mix(c, uLift + c * (1.0 - uLift), toe);

  // Halation: blurred highlights bleed back, red-weighted, into the dark
  // edges beside them, only within haloReach of a highlight, so it is a thin
  // warm ring and not a wash. Bright pixels take none of it, the antialiased
  // edge itself takes the most, and the cap keeps a wire with cloud on both
  // sides a dark warm line rather than a copper one.
  float near = max(smoothstep(uThreshold, uThreshold + uKnee, inner), 0.8 * smoothstep(uThreshold, uThreshold + uKnee, outer));
  c += uHaloTint * (uHaloGain * min(halo.a, uHaloCap) * dark * near);

  c = shoulder(c);

  // Luminance-only grain, strongest in the midtones, after the halation so it
  // also covers what chroma speckle the splats leave.
  float g = dot(c, LUMA);
  float amount = uGrain * (uGrainFloor + (1.0 - uGrainFloor) * 4.0 * g * (1.0 - g));
  c += grainAt(gl_FragCoord.xy) * amount;

  // Triangular dither of one 8-bit step, fresh per pixel and frame, so the
  // long sky ramp toward the zenith never settles into bands or blotches.
  uvec3 cell = uvec3(uvec2(gl_FragCoord.xy) + 8192u, uint(uGrainFrame) + 50021u);
  c += (uniformAt(cell) - uniformAt(cell + uvec3(0u, 0u, 15485863u))) / 255.0;

  c = clamp(c, 0.0, uCap);
  fragColor = vec4(c * scene.a, scene.a);
}
`;

function passMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RESOLVE_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

function passTarget(filter) {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: filter,
    magFilter: filter,
  });
}

export function createFilmPass() {
  const sceneTarget = passTarget(THREE.LinearFilter);
  const haloA = passTarget(THREE.LinearFilter);
  const haloB = passTarget(THREE.LinearFilter);

  // sky uniforms shared by the bright pass and the composite
  const skyShared = {
    uSkyOn: { value: 0 },
    uStereo: { value: 1 },
    uStereoShift: { value: 0 },
    uAspect: { value: 1 },
    uCameraBasis: { value: new THREE.Matrix3() },
    ...skyUniforms(),
  };
  const bright = passMaterial(BRIGHT_FRAGMENT, {
    uSource: { value: sceneTarget.texture },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uThreshold: { value: FILM.haloThreshold },
    uKnee: { value: FILM.haloKnee },
    ...skyShared,
  });
  const blur = passMaterial(BLUR_FRAGMENT, {
    uSource: { value: haloA.texture },
    uStep: { value: new THREE.Vector2(1, 0) },
    uSigma: { value: FILM.haloSigma },
  });
  const composite = passMaterial(COMPOSITE_FRAGMENT, {
    uScene: { value: sceneTarget.texture },
    uHalo: { value: haloA.texture },
    uLift: { value: new THREE.Vector3(...FILM.lift) },
    uToe: { value: new THREE.Vector2(...FILM.toe) },
    uHaloTint: { value: new THREE.Vector3(...FILM.haloTint) },
    uHaloGain: { value: FILM.haloGain },
    uHaloDark: { value: new THREE.Vector2(...FILM.haloDark) },
    uThreshold: { value: FILM.haloThreshold },
    uKnee: { value: FILM.haloKnee },
    uHaloReach: { value: FILM.haloReach },
    uHaloCap: { value: FILM.haloCap },
    uErodeReach: { value: FILM.erodeReach },
    uErode: { value: FILM.erode },
    uWrap: { value: FILM.wrap },
    uPixel: { value: new THREE.Vector2(1, 1) },
    uShoulder: { value: FILM.shoulder },
    uCap: { value: FILM.cap },
    uGrain: { value: FILM.grain },
    uGrainFloor: { value: FILM.grainFloor },
    uGrainFrame: { value: 0 },
    uGrainCell: { value: 1 },
    ...skyShared,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geometry, composite);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const clearColor = new THREE.Color();

  const pass = (gl, material, target) => {
    quad.material = material;
    gl.setRenderTarget(target);
    gl.render(scene, camera);
  };

  return {
    // drawScene renders the resolved splats into whatever target is bound.
    render(gl, drawScene, width, height, { time, still, pixelRatio, sky = null, camera = null }) {
      const haloWidth = Math.max(1, Math.ceil(width / FILM.haloScale));
      const haloHeight = Math.max(1, Math.ceil(height / FILM.haloScale));
      if (sceneTarget.width !== width || sceneTarget.height !== height) sceneTarget.setSize(width, height);
      if (haloA.width !== haloWidth || haloA.height !== haloHeight) {
        haloA.setSize(haloWidth, haloHeight);
        haloB.setSize(haloWidth, haloHeight);
      }

      const previousTarget = gl.getRenderTarget();
      gl.getClearColor(clearColor);
      const previousAlpha = gl.getClearAlpha();

      gl.setRenderTarget(sceneTarget);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      drawScene(gl);

      // the sky uniforms are shared by the bright pass and the composite
      const { uniforms } = composite;
      uniforms.uSkyOn.value = sky && camera ? 1 : 0;
      if (sky && camera) {
        uniforms.uStereo.value = sky.stereo;
        uniforms.uStereoShift.value = sky.stereoShift ?? 0;
        uniforms.uAspect.value = width / height;
        uniforms.uCameraBasis.value.setFromMatrix4(camera.matrixWorld);
        bindSky(uniforms, sky);
      }

      bright.uniforms.uTexel.value.set(1 / width, 1 / height);
      pass(gl, bright, haloA);
      blur.uniforms.uSource.value = haloA.texture;
      blur.uniforms.uStep.value.set(1 / haloWidth, 0);
      pass(gl, blur, haloB);
      blur.uniforms.uSource.value = haloB.texture;
      blur.uniforms.uStep.value.set(0, 1 / haloHeight);
      pass(gl, blur, haloA);

      uniforms.uGrainFrame.value = still ? 0 : Math.floor(time * FILM.grainFps) % 65536;
      uniforms.uGrainCell.value = Math.max(1, FILM.grainCell * pixelRatio);
      uniforms.uPixel.value.set(1 / width, 1 / height);
      uniforms.uHaloReach.value = FILM.haloReach * pixelRatio;
      uniforms.uErodeReach.value = FILM.erodeReach * pixelRatio;
      gl.setRenderTarget(previousTarget);
      gl.setClearColor(clearColor, previousAlpha);
      gl.clear(true, false, false);
      pass(gl, composite, previousTarget);
    },
    dispose() {
      sceneTarget.dispose();
      haloA.dispose();
      haloB.dispose();
      bright.dispose();
      blur.dispose();
      composite.dispose();
      geometry.dispose();
    },
  };
}
