export const BACKDROP_DEFAULTS = {
  renderScale: 0.5,
  maxFPS: 30,
  referenceExtent: 1440,
  artworkSize: 512,
  spriteRatios: [1.25, 0.8, 0.5, 0.25],
  rotationStep: [0.003, -0.008, -0.006, 0.004],
  reducedRotationStep: 0.001,
  orbitRate: 0.75,
  orbitRadius: 0.25,
  orbitDrift: 0.05,
  twistAngle: -3.25,
  twistRadius: 900,
  blurScale: 1,
  saturation: 2.75,
  contrast: 1.9,
  brightness: 0.7,
  gamma: 1,
  blackScrim: 0.5,
  whiteScrim: 0.05,
  crossfadeMS: 1666,
  speed: 1,
  twistDriftRate: 0.004,
  twistDriftRadius: 0.06,
  modSmoothing: 0.08,
  modSpeedSource: "bass",
  modSpeedDepth: 0.27,
  modTwistDriftSource: "lowMid",
  modTwistDriftDepth: 0.4,
  modSpriteScaleSource: "bass",
  modSpriteScaleDepth: 0.35,
  modBlurScaleSource: "off",
  modBlurScaleDepth: 0,
  modSaturationSource: "level",
  modSaturationDepth: 0.37,
  modBrightnessSource: "level",
  modBrightnessDepth: 0.14,
};

export const MOD_SOURCES = ["off", "bass", "lowMid", "presence", "air", "level"];

const BAND_INDEX = { bass: 0, lowMid: 1, presence: 2, air: 3 };

const MOD_TARGETS = [
  { key: "speed", range: 3, mode: "mul", kind: "rate" },
  { key: "twistDrift", range: 0.02, mode: "add", kind: "rate" },
  { key: "spriteScale", range: 0.35, mode: "mul", kind: "value" },
  { key: "blurScale", range: -0.6, mode: "mul", kind: "value" },
  { key: "saturation", range: 2, mode: "add", kind: "value" },
  { key: "brightness", range: 0.5, mode: "add", kind: "value" },
].map((target) => ({
  ...target,
  sourceKey: `mod${target.key[0].toUpperCase()}${target.key.slice(1)}Source`,
  depthKey: `mod${target.key[0].toUpperCase()}${target.key.slice(1)}Depth`,
}));

const KAWASE_KERNELS = [5, 10, 20, 10, 40, 20, 80, 40];
const BASE_PADDING = 121;
const MAX_LAYERS = 3;
const DELTA_REFERENCE_MS = 100 / 3;

const SPRITE_VERT = `
attribute vec2 aCorner;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uSize;
uniform float uRotation;
varying vec2 vUv;
void main() {
  vUv = aCorner + 0.5;
  float s = sin(uRotation);
  float c = cos(uRotation);
  vec2 p = aCorner * uSize;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + uCenter;
  vec2 clip = (p / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const SPRITE_FRAG = `
precision mediump float;
uniform sampler2D uSampler;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uSampler, vUv);
  gl_FragColor = vec4(t.rgb * t.a * uAlpha, t.a * uAlpha);
}
`;

const SCREEN_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const TWIST_FRAG = `
precision mediump float;
uniform sampler2D uSampler;
uniform vec2 uSize;
uniform vec2 uOffset;
uniform float uRadius;
uniform float uAngle;
varying vec2 vUv;
void main() {
  vec2 coord = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  coord -= uOffset;
  float dist = length(coord);
  if (dist < uRadius) {
    float ratioDist = (uRadius - dist) / uRadius;
    float angleMod = ratioDist * ratioDist * uAngle;
    float s = sin(angleMod);
    float c = cos(angleMod);
    coord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
  }
  coord += uOffset;
  vec2 uv = coord / uSize;
  gl_FragColor = texture2D(uSampler, vec2(uv.x, 1.0 - uv.y));
}
`;

const KAWASE_FRAG = `
precision mediump float;
uniform sampler2D uSampler;
uniform vec2 uOffset;
varying vec2 vUv;
void main() {
  vec4 color = vec4(0.0);
  color += texture2D(uSampler, vec2(vUv.x - uOffset.x, vUv.y + uOffset.y));
  color += texture2D(uSampler, vec2(vUv.x + uOffset.x, vUv.y + uOffset.y));
  color += texture2D(uSampler, vec2(vUv.x + uOffset.x, vUv.y - uOffset.y));
  color += texture2D(uSampler, vec2(vUv.x - uOffset.x, vUv.y - uOffset.y));
  gl_FragColor = color * 0.25;
}
`;

const COMPOSITE_FRAG = `
precision mediump float;
uniform sampler2D uSampler;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform float uGamma;
uniform float uSaturation;
uniform float uContrast;
uniform float uBrightness;
uniform float uBlackScrim;
uniform float uWhiteScrim;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uSampler, vUv * uUvScale + uUvOffset);
  if (c.a > 0.0) {
    c.rgb /= c.a;
    vec3 rgb = pow(c.rgb, vec3(1.0 / uGamma));
    rgb = mix(vec3(0.5), mix(vec3(dot(vec3(0.2125, 0.7154, 0.0721), rgb)), rgb, uSaturation), uContrast);
    c.rgb = rgb * uBrightness;
    c.rgb *= c.a;
  }
  vec3 overWhite = c.rgb + (1.0 - c.a);
  vec3 shaded = overWhite * (1.0 - uBlackScrim);
  shaded = shaded * (1.0 - uWhiteScrim) + uWhiteScrim;
  gl_FragColor = vec4(shaded, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL context unavailable");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl, vertSource, fragSource, attribName) {
  const program = gl.createProgram();
  const vert = compile(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSource);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms, attrib: gl.getAttribLocation(program, attribName) };
}

function createTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

function fitToSquare(image, size) {
  const source = image.naturalWidth || image.width;
  if (source <= size) return image;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size, size);
  return canvas;
}

export class GradientScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.config = { ...BACKDROP_DEFAULTS, ...options.config };
    this.onReady = options.onReady;
    this.gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!this.gl || this.gl.isContextLost()) {
      this.gl = null;
      return;
    }

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.modTargets = Object.fromEntries(MOD_TARGETS.map((target) => [target.key, target]));
    this.sampler = options.sampler || null;
    this.audio = null;
    this.smoothed = { bands: [0, 0, 0, 0], level: 0 };
    this.rotations = [0, 0, 0, 0];
    this.twistPhase = 0;
    this.layers = [];
    this.targets = [];
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.lastTime = 0;
    this.frameHandle = 0;
    this.visible = true;
    this.revealed = false;
    this.dirty = true;

    this.tick = this.tick.bind(this);
    this.handleContextLost = (event) => {
      event.preventDefault();
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.programs = null;
      this.targets = [];
      this.layers = [];
    };
    this.handleContextRestored = () => {
      if (!this.gl || !this.buildResources()) return;
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.measure();
      const url = this.pendingURL;
      this.pendingURL = null;
      if (url) this.setArtwork(url);
      this.frameHandle = requestAnimationFrame(this.tick);
    };
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    if (!this.buildResources()) {
      this.gl = null;
      return;
    }

    this.measure();
    if (options.artworkURL) this.setArtwork(options.artworkURL);
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  buildResources() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return false;
    try {
      this.sprite = createProgram(gl, SPRITE_VERT, SPRITE_FRAG, "aCorner");
      this.twist = createProgram(gl, SCREEN_VERT, TWIST_FRAG, "aPos");
      this.kawase = createProgram(gl, SCREEN_VERT, KAWASE_FRAG, "aPos");
      this.composite = createProgram(gl, SCREEN_VERT, COMPOSITE_FRAG, "aPos");

      this.spriteBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      const quad = [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quad), gl.STATIC_DRAW);

      this.screenBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
      const screenQuad = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(screenQuad), gl.STATIC_DRAW);
      this.programs = true;
      return true;
    } catch {
      this.programs = null;
      return false;
    }
  }

  setConfig(partial) {
    if (!this.gl) return;
    const previous = this.config;
    this.config = { ...previous, ...partial };
    const resized =
      this.config.renderScale !== previous.renderScale ||
      this.config.blurScale !== previous.blurScale ||
      this.config.referenceExtent !== previous.referenceExtent;
    if (resized) this.allocate();
    if (this.config.artworkSize !== previous.artworkSize && this.pendingURL) {
      const url = this.pendingURL;
      this.pendingURL = null;
      this.setArtwork(url);
    }
    this.dirty = true;
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible) this.lastTime = 0;
  }

  setSampler(sampler) {
    this.sampler = sampler;
  }

  sample() {
    const raw = this.sampler ? this.sampler() : null;
    if (!raw) {
      this.audio = null;
      return;
    }
    const rate = Math.min(1, Math.max(0.005, this.config.modSmoothing));
    for (let b = 0; b < 4; b += 1) {
      this.smoothed.bands[b] += (raw.bands[b] - this.smoothed.bands[b]) * rate;
    }
    this.smoothed.level += (raw.level - this.smoothed.level) * rate;
    this.audio = this.smoothed;
  }

  modulation(key) {
    const target = this.modTargets[key];
    const depth = this.config[target.depthKey];
    const source = this.config[target.sourceKey];
    if (!depth || source === "off" || !this.audio) return 0;
    const value =
      source === "level" ? this.audio.level : this.audio.bands[BAND_INDEX[source]] || 0;
    return value * depth * target.range;
  }

  driven(key, base) {
    const target = this.modTargets[key];
    const amount = this.modulation(key);
    const value =
      amount === 0 ? base : target.mode === "mul" ? base * (1 + amount) : base + amount;
    return target.kind === "rate" ? Math.max(0, value) : value;
  }

  measure() {
    if (!this.gl || this.gl.isContextLost()) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === this.cssWidth && height === this.cssHeight) return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.allocate();
  }

  allocate() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const { renderScale, blurScale, referenceExtent } = this.config;
    const extent = Math.max(this.cssWidth, this.cssHeight);

    this.viewportScale = extent / referenceExtent;
    this.unit = this.viewportScale * renderScale;
    this.viewWidth = Math.max(1, Math.round(this.cssWidth * renderScale));
    this.viewHeight = Math.max(1, Math.round(this.cssHeight * renderScale));
    this.padding = Math.min(
      512,
      Math.max(4, Math.ceil(BASE_PADDING * blurScale * this.unit)),
    );
    this.fboWidth = this.viewWidth + this.padding * 2;
    this.fboHeight = this.viewHeight + this.padding * 2;

    this.scaledExtent = extent * renderScale;
    const scaledExtent = this.scaledExtent;
    const centerX = this.viewWidth / 2;
    const centerY = this.viewHeight / 2;
    this.layout = this.config.spriteRatios.map((ratio, index) => ({
      x: index === 1 ? this.viewWidth / 2.5 : centerX,
      y: index === 1 ? this.viewHeight / 2.5 : centerY,
      size: scaledExtent * ratio,
    }));
    this.orbitRadius = scaledExtent * this.config.orbitRadius;
    this.orbitDrift = scaledExtent * this.config.orbitDrift;

    const matches =
      this.targets.length === 2 &&
      this.targets[0].width === this.fboWidth &&
      this.targets[0].height === this.fboHeight;
    if (!matches) {
      this.targets.forEach((target) => {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      });
      this.targets = [
        createTarget(gl, this.fboWidth, this.fboHeight),
        createTarget(gl, this.fboWidth, this.fboHeight),
      ];
    }
    this.dirty = true;
  }

  resize() {
    this.measure();
  }

  setArtwork(url) {
    if (!this.gl || !url) return;
    if (url === this.pendingURL) return;
    this.pendingURL = url;

    const gl = this.gl;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (!this.gl || this.gl.isContextLost() || this.pendingURL !== url) return;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        fitToSquare(image, this.config.artworkSize),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.pushLayer(texture);
    };
    image.src = url;
  }

  pushLayer(texture) {
    const gl = this.gl;
    this.layers.forEach((layer) => {
      layer.target = 0;
    });
    this.layers.push({ texture, alpha: this.layers.length ? 0 : 1, target: 1 });
    while (this.layers.length > MAX_LAYERS) {
      const dropped = this.layers.shift();
      gl.deleteTexture(dropped.texture);
    }
    this.dirty = true;
  }

  advance(elapsed) {
    const { speed, crossfadeMS, rotationStep, reducedRotationStep } = this.config;
    const reduced = this.motionQuery.matches;
    const baseDelta = (elapsed / DELTA_REFERENCE_MS) * speed;
    const delta = (elapsed / DELTA_REFERENCE_MS) * this.driven("speed", speed);
    this.twistPhase += this.driven("twistDrift", this.config.twistDriftRate) * baseDelta;

    for (let i = 0; i < 4; i += 1) {
      const step = reduced ? reducedRotationStep : rotationStep[i];
      this.rotations[i] += step * delta;
    }

    const fadeStep = crossfadeMS > 0 ? elapsed / crossfadeMS : 1;
    for (let i = this.layers.length - 1; i >= 0; i -= 1) {
      const layer = this.layers[i];
      if (layer.alpha < layer.target) {
        layer.alpha = Math.min(layer.target, layer.alpha + fadeStep);
      } else if (layer.alpha > layer.target) {
        layer.alpha = Math.max(layer.target, layer.alpha - fadeStep);
      }
      if (layer.alpha <= 0 && layer.target === 0 && this.layers.length > 1) {
        this.gl.deleteTexture(layer.texture);
        this.layers.splice(i, 1);
      }
    }
  }

  drawSprites(layer, spriteScale) {
    const gl = this.gl;
    const { uniforms } = this.sprite;
    const { orbitRate } = this.config;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.uniform1i(uniforms.uSampler, 0);
    gl.uniform1f(uniforms.uAlpha, layer.alpha);

    const cx = this.viewWidth / 2;
    const cy = this.viewHeight / 2;

    for (let i = 0; i < 4; i += 1) {
      const base = this.layout[i];
      const angle = this.rotations[i];
      let x = base.x;
      let y = base.y;
      let rotation = angle;

      if (i === 2 || i === 3) {
        const offset = i === 3 ? this.orbitDrift : 0;
        rotation = -angle;
        x = cx + offset + this.orbitRadius * Math.cos(angle * orbitRate);
        y = cy + offset + this.orbitRadius * Math.sin(angle * orbitRate);
      }

      gl.uniform2f(uniforms.uCenter, x + this.padding, y + this.padding);
      gl.uniform1f(uniforms.uSize, base.size * spriteScale);
      gl.uniform1f(uniforms.uRotation, rotation);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  useScreenProgram(entry) {
    const gl = this.gl;
    gl.useProgram(entry.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
    gl.enableVertexAttribArray(entry.attrib);
    gl.vertexAttribPointer(entry.attrib, 2, gl.FLOAT, false, 0, 0);
  }

  render() {
    const gl = this.gl;
    if (!gl || gl.isContextLost() || !this.programs) return;
    if (!this.layers.length || this.targets.length !== 2) return;

    const { twistAngle, twistRadius } = this.config;
    const blurScale = Math.max(
      0.15,
      Math.min(this.config.blurScale, this.driven("blurScale", this.config.blurScale)),
    );
    const spriteScale = Math.max(0.05, this.driven("spriteScale", 1));
    const [a, b] = this.targets;

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, this.fboWidth, this.fboHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.sprite.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.enableVertexAttribArray(this.sprite.attrib);
    gl.vertexAttribPointer(this.sprite.attrib, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.sprite.uniforms.uResolution, this.fboWidth, this.fboHeight);
    this.layers.forEach((layer) => {
      if (layer.alpha > 0) this.drawSprites(layer, spriteScale);
    });
    gl.disable(gl.BLEND);

    let source = a;
    let destination = b;

    if (twistAngle !== 0) {
      this.useScreenProgram(this.twist);
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform1i(this.twist.uniforms.uSampler, 0);
      gl.uniform2f(this.twist.uniforms.uSize, this.fboWidth, this.fboHeight);
      const driftRadius = this.scaledExtent * this.config.twistDriftRadius;
      gl.uniform2f(
        this.twist.uniforms.uOffset,
        this.viewWidth / 2 + this.padding + driftRadius * Math.cos(this.twistPhase),
        this.viewHeight / 2 + this.padding + driftRadius * Math.sin(this.twistPhase),
      );
      gl.uniform1f(this.twist.uniforms.uRadius, twistRadius * this.unit);
      gl.uniform1f(this.twist.uniforms.uAngle, twistAngle);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      source = destination;
      destination = a;
    }

    this.useScreenProgram(this.kawase);
    gl.uniform1i(this.kawase.uniforms.uSampler, 0);
    for (const kernel of KAWASE_KERNELS) {
      const offset = kernel * blurScale * this.unit + 0.5;
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.texture);
      gl.uniform2f(
        this.kawase.uniforms.uOffset,
        offset / this.fboWidth,
        offset / this.fboHeight,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const swap = source;
      source = destination;
      destination = swap;
    }

    this.useScreenProgram(this.composite);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.cssWidth, this.cssHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(this.composite.uniforms.uSampler, 0);
    gl.uniform2f(
      this.composite.uniforms.uUvScale,
      this.viewWidth / this.fboWidth,
      this.viewHeight / this.fboHeight,
    );
    gl.uniform2f(
      this.composite.uniforms.uUvOffset,
      this.padding / this.fboWidth,
      this.padding / this.fboHeight,
    );
    gl.uniform1f(this.composite.uniforms.uGamma, Math.max(this.config.gamma, 1e-4));
    gl.uniform1f(
      this.composite.uniforms.uSaturation,
      Math.max(0, this.driven("saturation", this.config.saturation)),
    );
    gl.uniform1f(this.composite.uniforms.uContrast, this.config.contrast);
    gl.uniform1f(
      this.composite.uniforms.uBrightness,
      Math.max(0, this.driven("brightness", this.config.brightness)),
    );
    gl.uniform1f(this.composite.uniforms.uBlackScrim, this.config.blackScrim);
    gl.uniform1f(this.composite.uniforms.uWhiteScrim, this.config.whiteScrim);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!this.revealed) {
      this.revealed = true;
      this.onReady?.();
    }
  }

  tick(time) {
    this.frameHandle = requestAnimationFrame(this.tick);
    if (document.hidden || !this.visible) {
      this.lastTime = 0;
      return;
    }

    this.sample();
    const frameMS = 1000 / Math.max(1, this.config.maxFPS);
    const raw = this.lastTime ? time - this.lastTime : frameMS;
    if (raw < frameMS && !this.dirty) return;
    this.lastTime = time;
    this.dirty = false;

    this.advance(Math.min(raw, frameMS * 4));
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.frameHandle);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const gl = this.gl;
    if (!gl || gl.isContextLost()) {
      this.gl = null;
      return;
    }
    this.targets.forEach((target) => {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    });
    this.layers.forEach((layer) => gl.deleteTexture(layer.texture));
    if (this.spriteBuffer) gl.deleteBuffer(this.spriteBuffer);
    if (this.screenBuffer) gl.deleteBuffer(this.screenBuffer);
    [this.sprite, this.twist, this.kawase, this.composite].forEach((entry) => {
      if (entry?.program) gl.deleteProgram(entry.program);
    });
    this.gl = null;
  }
}
