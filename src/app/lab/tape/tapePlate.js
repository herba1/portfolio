const VERTEX = `#version 300 es
void main() {
  float x = gl_VertexID == 1 ? 3.0 : -1.0;
  float y = gl_VertexID == 2 ? 3.0 : -1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrint;
uniform vec2 uResolution;
uniform float uScale;
uniform float uHeadX;
uniform float uPosition;
uniform float uPeriod;
uniform float uPxPerSecond;
uniform float uColumnsPerSecond;
uniform vec3 uLayout;
uniform float uWarp;
uniform float uWarpRadius;
uniform float uReveal;
uniform float uWear;
uniform float uHasPrint;
uniform float uSmear;
out vec4 fragColor;

const vec3 OXIDE_SHADE = vec3(0.098, 0.071, 0.059);
const vec3 OXIDE = vec3(0.157, 0.114, 0.090);
const vec3 OXIDE_LIT = vec3(0.208, 0.153, 0.122);
const vec3 SIGNAL = vec3(0.306, 0.231, 0.184);
const vec3 SLIT = vec3(0.400, 0.337, 0.294);
const vec3 SHEEN = vec3(0.945, 0.890, 0.835);
const vec3 SCRAPE = vec3(0.357, 0.286, 0.239);
const vec3 TICK = vec3(0.478, 0.404, 0.353);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float loopNoise(vec2 p, float span) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, span);
  float x1 = mod(i.x + 1.0, span);
  float a = hash21(vec2(x0, i.y));
  float b = hash21(vec2(x1, i.y));
  float c = hash21(vec2(x0, i.y + 1.0));
  float d = hash21(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float bell(float x, float centre, float width) {
  float t = (x - centre) / width;
  return exp(-t * t);
}

float readPrint(float seconds, float bin) {
  float column = mod(seconds, uPeriod) * uColumnsPerSecond;
  float band = min(floor(column / uLayout.x), uLayout.y - 1.0);
  float local = column - band * uLayout.x;
  float row = band * uLayout.z + clamp(bin, 0.5, uLayout.z - 0.5);
  vec2 coord = vec2((local + 0.5) / uLayout.x, row / (uLayout.y * uLayout.z));
  return texture(uPrint, coord).r;
}

float inkOf(float level) {
  return pow(smoothstep(0.35, 0.97, level), 1.5);
}

void main() {
  vec2 point = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);

  float dx = point.x - uHeadX;
  float paper = dx - uWarp * uWarpRadius * tanh(dx / uWarpRadius);
  float seconds = uPosition + paper / uPxPerSecond;
  float looped = mod(seconds, uPeriod);
  float turn = looped / uPeriod;
  float paperX = looped * uPxPerSecond / uScale;
  float cssY = point.y / uScale;
  float cssH = uResolution.y / uScale;
  float across = point.y / uResolution.y;
  float smearCss = uSmear / uScale;
  float streak = 1.0 + smearCss * 0.3;
  float still = 1.0 - smoothstep(0.0, 24.0, smearCss);

  vec3 col = mix(OXIDE, OXIDE_LIT, 0.6 * bell(across, 0.26, 0.24));
  float lower = smoothstep(0.5, 1.0, across);
  col = mix(col, OXIDE_SHADE, 0.5 * lower * lower);

  float coat = loopNoise(vec2(turn * 13.0, cssY * 0.21), 13.0) - 0.5;
  float lines = loopNoise(vec2(turn * 41.0, cssY * 0.9), 41.0) - 0.5;
  float grain = hash21(floor(vec2(paperX / streak, cssY) * uScale)) - 0.5;
  col *= 1.0 + coat * 0.07 + lines * 0.06 + grain * 0.05 * mix(0.35, 1.0, still);

  float ripple = loopNoise(vec2(turn * 17.0, 1.5), 17.0) - 0.5;
  float flutter = loopNoise(vec2(turn * 53.0, 4.5), 53.0) - 0.5;
  float gloss = loopNoise(vec2(turn * 7.0, 9.5), 7.0);
  float tension = abs(uWarp) * bell(dx, 0.0, uWarpRadius);
  float pool = bell(point.x / uResolution.x, 0.56, 0.62);
  float crest = 0.33 + ripple * 0.12 + flutter * 0.035 - tension * 0.1;
  float sheen = bell(across, crest, 0.11 + 0.05 * gloss) * (0.55 + 0.45 * gloss);
  sheen += 0.3 * bell(across, 0.8 - ripple * 0.06, 0.07);
  sheen *= pool * (1.0 + 2.2 * tension) * (1.0 - 0.55 * uWear);

  float edge = min(cssY, cssH - cssY);
  float slit = 1.0 - smoothstep(0.4, 2.2, edge);
  float curl = 1.0 - smoothstep(0.0, 12.0, edge);
  float upper = 1.0 - step(0.5, across);
  col = mix(col, SLIT, slit * mix(0.7, 0.85, upper));
  col += SHEEN * curl * curl * mix(0.025, 0.05, upper);

  float top = 14.0 * uScale;
  float bottom = uResolution.y - 22.0 * uScale;
  float fy = (bottom - point.y) / (bottom - top);
  float inside = smoothstep(top - 4.0 * uScale, top + 10.0 * uScale, point.y) * (1.0 - smoothstep(bottom - 10.0 * uScale, bottom + 4.0 * uScale, point.y));

  float density = 0.0;
  float reliefX = 0.0;
  float reliefY = 0.0;
  if (uHasPrint > 0.5) {
    float bin = clamp(fy, 0.0, 1.0) * uLayout.z;
    float binsPerPx = uLayout.z * uScale / (bottom - top);
    float secondsPerPx = uScale / uPxPerSecond;
    float level = inkOf(readPrint(seconds, bin));
    if (uSmear > 0.5) {
      float jitter = hash21(point + 11.0) - 0.5;
      float total = 0.0;
      for (int tap = 0; tap < 5; tap++) {
        float along = (float(tap) + 0.5 + jitter) / 5.0 - 0.5;
        total += inkOf(readPrint(seconds + along * uSmear / uPxPerSecond, bin));
      }
      density = total / 5.0;
    } else {
      density = level;
    }
    if (still > 0.01) {
      reliefX = (inkOf(readPrint(seconds + 1.5 * secondsPerPx, bin)) - level) / 1.5;
      reliefY = (inkOf(readPrint(seconds, bin - 1.5 * binsPerPx)) - level) / 1.5;
    }
  }

  float row = floor(point.y / (1.5 * uScale));
  float rowSeed = hash21(vec2(row, 7.0));
  float scratch = step(1.0 - 0.07 * uWear, rowSeed) * smoothstep(0.3, 0.7, valueNoise(vec2(paperX * 0.03 / streak, row)));
  float blotch = 0.78 + 0.22 * valueNoise(vec2(paperX, cssY) * vec2(0.02, 0.08));
  float kept = mix(1.0, blotch, uWear) * (1.0 - 0.8 * scratch);

  float reach = max(uHeadX, uResolution.x - uHeadX) + 160.0 * uScale;
  float front = uReveal * (reach + 48.0 * uScale) - 48.0 * uScale;
  float ragged = (valueNoise(vec2(point.y / (7.0 * uScale), dx / (28.0 * uScale))) - 0.5) * 48.0 * uScale;
  float spread = abs(dx) + ragged;
  float printShown = 1.0 - smoothstep(front - 112.0 * uScale, front - 20.0 * uScale, spread);
  float mask = inside * printShown * kept;
  density = clamp(density, 0.0, 1.0) * mask;
  float relief = clamp((0.4 * reliefX + 0.9 * reliefY) * mask * still * 2.4, -1.0, 1.0);

  col = mix(col, SIGNAL, density * 0.5);
  col += SHEEN * sheen * (0.09 + 0.11 * density);
  col += SHEEN * relief * (0.035 + 0.12 * sheen);
  col = mix(col, SCRAPE, scratch * 0.45);

  float tickY = uResolution.y - 9.0 * uScale;
  float whole = floor(looped + 0.5);
  float near = (looped - whole) * uPxPerSecond;
  float major = 1.0 - step(0.5, mod(mod(whole, uPeriod) + 0.25, 5.0));
  float halfLength = mix(1.5, 3.0, major) * uScale;
  float stretched = max(abs(near) - uSmear * 0.5, 0.0);
  float ring = length(vec2(stretched, max(abs(point.y - tickY) - halfLength, 0.0))) - 0.75 * uScale;
  float tick = (1.0 - smoothstep(-0.75, 0.75, ring)) * printShown * mix(0.6, 1.0, still);
  col = mix(col, TICK, tick * mix(0.45, 0.7, major));

  col += (hash21(gl_FragCoord.xy + fract(uPosition)) - 0.5) / 255.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "shader failed");
  }
  return shader;
}

export function createTapePlate(canvas, onRestored) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "default",
  });
  if (!gl) return null;

  let program = null;
  let vertex = null;
  let fragment = null;
  let vao = null;
  let texture = null;
  let uniforms = {};
  let print = null;
  let lost = false;
  const layout = { width: 1, height: 1, scale: 1, headX: 0, pxPerSecond: 160, warpRadius: 110, period: 29 };

  const build = () => {
    vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link failed");
    uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    vao = gl.createVertexArray();
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    if (print) upload();
  };

  const upload = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, print.width, print.height, 0, gl.RED, gl.UNSIGNED_BYTE, print.data);
  };

  const release = () => {
    if (texture) gl.deleteTexture(texture);
    if (vao) gl.deleteVertexArray(vao);
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    texture = null;
    vao = null;
    program = null;
    vertex = null;
    fragment = null;
  };

  const onLost = (event) => {
    event.preventDefault();
    lost = true;
  };
  const onContextRestored = () => {
    lost = false;
    texture = null;
    vao = null;
    program = null;
    vertex = null;
    fragment = null;
    try {
      build();
    } catch {
      release();
      return;
    }
    if (onRestored) onRestored();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  try {
    build();
  } catch (error) {
    release();
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    throw error;
  }

  return {
    setPrint(next) {
      print = next;
      if (!lost) upload();
    },
    resize(cssWidth, cssHeight, scale, settings) {
      const width = Math.max(1, Math.round(cssWidth * scale));
      const height = Math.max(1, Math.round(cssHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      layout.width = width;
      layout.height = height;
      layout.scale = width / Math.max(1, cssWidth);
      Object.assign(layout, settings);
    },
    draw(position, warp, reveal, wear, smear) {
      if (lost || !program) return;
      const s = layout.scale;
      gl.viewport(0, 0, layout.width, layout.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.uPrint, 0);
      gl.uniform2f(uniforms.uResolution, layout.width, layout.height);
      gl.uniform1f(uniforms.uScale, s);
      gl.uniform1f(uniforms.uHeadX, layout.headX * s);
      gl.uniform1f(uniforms.uPosition, position);
      gl.uniform1f(uniforms.uPeriod, layout.period);
      gl.uniform1f(uniforms.uPxPerSecond, layout.pxPerSecond * s);
      gl.uniform1f(uniforms.uColumnsPerSecond, print ? print.columns / layout.period : 1);
      gl.uniform3f(uniforms.uLayout, print ? print.width : 1, print ? print.bands : 1, print ? print.bins : 1);
      gl.uniform1f(uniforms.uWarp, warp);
      gl.uniform1f(uniforms.uWarpRadius, layout.warpRadius * s);
      gl.uniform1f(uniforms.uReveal, reveal);
      gl.uniform1f(uniforms.uWear, wear);
      gl.uniform1f(uniforms.uHasPrint, print ? 1 : 0);
      gl.uniform1f(uniforms.uSmear, smear * s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      release();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
