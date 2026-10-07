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
uniform float uLane;
uniform float uHasPrint;
uniform float uSmear;
out vec4 fragColor;

const vec3 PAPER = vec3(0.973, 0.980, 0.988);
const vec3 MIST = vec3(0.886, 0.910, 0.941);
const vec3 SLATE = vec3(0.580, 0.639, 0.722);
const vec3 DEEP = vec3(0.200, 0.255, 0.333);
const vec3 INK = vec3(0.102, 0.102, 0.102);
const vec3 SUNKEN = vec3(0.914, 0.929, 0.953);

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

vec3 inkRamp(float d) {
  vec3 col = mix(PAPER, MIST, smoothstep(0.0, 0.25, d));
  col = mix(col, SLATE, smoothstep(0.25, 0.5, d));
  col = mix(col, DEEP, smoothstep(0.5, 0.75, d));
  return mix(col, INK, smoothstep(0.75, 1.0, d));
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
  vec2 frag = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 point = frag;

  float dx = point.x - uHeadX;
  float paper = dx - uWarp * uWarpRadius * tanh(dx / uWarpRadius);
  float seconds = uPosition + paper / uPxPerSecond;
  float paperX = mod(seconds, uPeriod) * uPxPerSecond / uScale;
  vec2 fibre = vec2(paperX, point.y / uScale);
  float smearCss = uSmear / uScale;
  float streak = 1.0 + smearCss * 0.3;
  float still = 1.0 - smoothstep(0.0, 24.0, smearCss);

  float top = uLane + 4.0 * uScale;
  float bottom = uResolution.y - 18.0 * uScale;
  float fy = (bottom - point.y) / (bottom - top);
  float inside = smoothstep(-1.5 * uScale, 0.5 * uScale, point.y - top) * smoothstep(-1.5 * uScale, 0.5 * uScale, bottom - point.y);

  float density = 0.0;
  if (uHasPrint > 0.5) {
    float bin = clamp(fy, 0.0, 1.0) * uLayout.z;
    if (uSmear > 0.5) {
      float jitter = hash21(frag + 11.0) - 0.5;
      float total = 0.0;
      for (int tap = 0; tap < 5; tap++) {
        float along = (float(tap) + 0.5 + jitter) / 5.0 - 0.5;
        total += inkOf(readPrint(seconds + along * uSmear / uPxPerSecond, bin));
      }
      density = total / 5.0;
    } else {
      density = inkOf(readPrint(seconds, bin));
    }
  }
  float grain = valueNoise(vec2(fibre.x * 0.18 / streak, fibre.y * 1.4)) - 0.5;
  float speck = (hash21(floor(fibre * 1.5)) - 0.5) * still;
  density += grain * mix(0.16, 0.08, still) * density + speck * 0.22 * density * (1.0 - density);

  float row = floor(point.y / (1.5 * uScale));
  float rowSeed = hash21(vec2(row, 7.0));
  float scratch = step(1.0 - 0.07 * uWear, rowSeed) * smoothstep(0.3, 0.7, valueNoise(vec2(paperX * 0.03 / streak, row)));
  float blotch = 0.78 + 0.22 * valueNoise(fibre * vec2(0.02, 0.08));
  density *= mix(1.0, blotch, uWear) * (1.0 - 0.8 * scratch);

  float reach = max(uHeadX, uResolution.x - uHeadX) + 160.0 * uScale;
  float front = uReveal * (reach + 48.0 * uScale) - 48.0 * uScale;
  float ragged = (valueNoise(vec2(point.y / (7.0 * uScale), dx / (28.0 * uScale))) - 0.5) * 48.0 * uScale;
  float spread = abs(dx) + ragged;
  float paperShown = 1.0 - smoothstep(front - 28.0 * uScale, front, spread);
  float inkShown = 1.0 - smoothstep(front - 112.0 * uScale, front - 20.0 * uScale, spread);
  density = clamp(density, 0.0, 1.0) * inside * inkShown;

  vec3 col = inkRamp(density);
  col -= grain * 0.014 * (1.0 - density);

  float tickY = uResolution.y - 9.0 * uScale;
  float wrapped = mod(seconds, uPeriod);
  float whole = floor(wrapped + 0.5);
  float near = (wrapped - whole) * uPxPerSecond;
  float major = 1.0 - step(0.5, mod(mod(whole, uPeriod) + 0.25, 5.0));
  float radius = mix(1.25, 2.25, major) * uScale;
  float stretched = max(abs(near) - uSmear * 0.5, 0.0);
  float ring = length(vec2(stretched, point.y - tickY)) - radius;
  float tick = (1.0 - smoothstep(-0.75, 0.75, ring)) * inkShown * mix(0.72, 1.0, still);
  col = mix(col, mix(SLATE, DEEP, major), tick);

  col = mix(SUNKEN, col, paperShown);

  col += (hash21(gl_FragCoord.xy + fract(uPosition)) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
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

export function createTapePlate(canvas) {
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
  const layout = { width: 1, height: 1, scale: 1, headX: 0, pxPerSecond: 160, warpRadius: 110, lane: 48, period: 29 };

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
  const onRestored = () => {
    lost = false;
    texture = null;
    vao = null;
    program = null;
    vertex = null;
    fragment = null;
    build();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  try {
    build();
  } catch (error) {
    release();
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
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
      gl.uniform1f(uniforms.uLane, layout.lane * s);
      gl.uniform1f(uniforms.uHasPrint, print ? 1 : 0);
      gl.uniform1f(uniforms.uSmear, smear * s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      release();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
