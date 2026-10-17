import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { HAND_EXTENT, handPressure } from "./pinsHand";
import { loadRelief, sampleRelief } from "./pinsPortrait";
import {
  ACRYLIC_FRAGMENT,
  BG_FRAGMENT,
  BG_VERTEX,
  DEPTH_FRAGMENT,
  HOUSING_FRAGMENT,
  PIN_FRAGMENT,
  PIN_VERTEX,
  PLATE_FRAGMENT,
  PLATE_VERTEX,
  SOLID_VERTEX,
} from "./pinsShader";
import { identity, lookAt, multiply, normalize, ortho, perspective, rotation, transformPoint, translation, transposeDir } from "./pinsMath";

const MAX_DPR = 2;
const TARGET_PINS = 20000;
const MIN_PITCH_DEVICE = 6.4;
const MIN_PITCH_PX = 3.2;
const EXTENT = 0.16;
const PIN_RADIUS = 0.34;
const PIN_SINK = 0.02;
const BORDER = 0.05;
const BACK = 0.045;
const LIP = EXTENT + 0.014;
const FOV = (24 * Math.PI) / 180;
const CAM_YAW = 0.44;
const CAM_PITCH = 0.12;
const LIGHT = normalize([0.5, 0.74, 0.4]);
const WALL_Z = -0.3;
const GRAVITY = 9;
const MAX_SPEED = 2.6;
const HAND_SIZE = 0.46;
const PORTRAIT_DEPTH = 0.72;
const WAVE_SECONDS = 2.4;
const RISE_SECONDS = 1.1;
const TIP_LEAN = 0.42;
const LEAN_LIMIT = 0.5;
const YAW_LIMIT = 0.32;
const SIDES = 8;
const CAP_RINGS = 3;
const CAP_HEIGHT = 0.6;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function smootherstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hash(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash(a * 57 + b * 131);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * ux;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * ux;
  return a + (b - a) * uy;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || "shader failed");
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(info || "link failed");
  }
  const uniforms = {};
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < total; i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function pinMesh() {
  const positions = [];
  const normals = [];
  const ride = [];
  const indices = [];
  const push = (p, n, r) => {
    positions.push(p[0], p[1], p[2]);
    normals.push(n[0], n[1], n[2]);
    ride.push(r);
    return ride.length - 1;
  };
  for (let k = 0; k < SIDES; k += 1) {
    const a = (k / SIDES) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    push([c, s, 0], [c, s, 0], 0);
    push([c, s, 0], [c, s, 0], 1);
  }
  for (let k = 0; k < SIDES; k += 1) {
    const b0 = k * 2;
    const b1 = ((k + 1) % SIDES) * 2;
    indices.push(b0, b1, b0 + 1, b1, b1 + 1, b0 + 1);
  }
  const capStart = ride.length;
  for (let j = 0; j < CAP_RINGS; j += 1) {
    const phi = (j / CAP_RINGS) * (Math.PI / 2);
    for (let k = 0; k < SIDES; k += 1) {
      const a = (k / SIDES) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const n = normalize([Math.cos(phi) * c, Math.cos(phi) * s, Math.sin(phi) / CAP_HEIGHT]);
      push([Math.cos(phi) * c, Math.cos(phi) * s, Math.sin(phi) * CAP_HEIGHT + (j === 0 ? 0.0005 : 0)], n, 1);
    }
  }
  const apex = push([0, 0, CAP_HEIGHT], [0, 0, 1], 1);
  for (let j = 0; j < CAP_RINGS - 1; j += 1) {
    for (let k = 0; k < SIDES; k += 1) {
      const a0 = capStart + j * SIDES + k;
      const a1 = capStart + j * SIDES + ((k + 1) % SIDES);
      const b0 = a0 + SIDES;
      const b1 = a1 + SIDES;
      indices.push(a0, a1, b0, a1, b1, b0);
    }
  }
  const last = capStart + (CAP_RINGS - 1) * SIDES;
  for (let k = 0; k < SIDES; k += 1) indices.push(last + k, last + ((k + 1) % SIDES), apex);
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), ride: new Float32Array(ride), indices: new Uint16Array(indices) };
}

function quadInto(list, p0, p1, p2, p3, n) {
  const w = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
  const corners = [
    [p0, 0, 0],
    [p1, 1, 0],
    [p2, 1, 1],
    [p0, 0, 0],
    [p2, 1, 1],
    [p3, 0, 1],
  ];
  for (const [p, u, v] of corners) list.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, w, h);
}

function boxShell(hx, hy, z0, z1, inward) {
  const list = [];
  const s = inward ? -1 : 1;
  const walls = [
    [[-hx, -hy], [hx, -hy], [0, -1]],
    [[hx, -hy], [hx, hy], [1, 0]],
    [[hx, hy], [-hx, hy], [0, 1]],
    [[-hx, hy], [-hx, -hy], [-1, 0]],
  ];
  for (const [a, b, n] of walls) {
    const normal = [n[0] * s, n[1] * s, 0];
    const p0 = [a[0], a[1], z0];
    const p1 = [b[0], b[1], z0];
    const p2 = [b[0], b[1], z1];
    const p3 = [a[0], a[1], z1];
    if (inward) quadInto(list, p1, p0, p3, p2, normal);
    else quadInto(list, p0, p1, p2, p3, normal);
  }
  return list;
}

function frameGeometry(hw, hh) {
  const ow = hw + BORDER;
  const oh = hh + BORDER;
  const list = [];
  const z = LIP;
  const n = [0, 0, 1];
  quadInto(list, [-ow, -oh, z], [ow, -oh, z], [ow, -hh, z], [-ow, -hh, z], n);
  quadInto(list, [-ow, hh, z], [ow, hh, z], [ow, oh, z], [-ow, oh, z], n);
  quadInto(list, [-ow, -hh, z], [-hw, -hh, z], [-hw, hh, z], [-ow, hh, z], n);
  quadInto(list, [hw, -hh, z], [ow, -hh, z], [ow, hh, z], [hw, hh, z], n);
  list.push(...boxShell(ow, oh, -BACK, LIP, false));
  list.push(...boxShell(hw, hh, 0, LIP, true));
  return new Float32Array(list);
}

export default class PinsEngine {
  constructor({ host, canvas, insets, onReady, onFail, onBusy }) {
    this.host = host;
    this.canvas = canvas;
    this.insets = insets;
    this.onReady = onReady;
    this.onFail = onFail;
    this.onBusy = onBusy;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.visible = true;
    this.destroyed = false;
    this.ready = false;
    this.grid = null;
    this.relief = null;
    this.pointers = new Map();
    this.press = null;
    this.tiltDrag = null;
    this.keyLean = 0;
    this.keyPress = false;
    this.lean = 0;
    this.leanV = 0;
    this.yaw = 0;
    this.yawV = 0;
    this.leanTarget = 0;
    this.yawTarget = 0;
    this.tip = null;
    this.wave = null;
    this.moving = 0;
    this.heightsDirty = true;
    this.busyState = false;
    this.model = identity();
    this.governor = createResolutionGovernor({ max: 1, min: 0.6 });
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      visibility: () => this.checkVisibility(),
      lost: (e) => e.preventDefault(),
    };
  }

  start() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      this.onFail?.();
      return false;
    }
    this.gl = gl;
    try {
      this.setupGl();
    } catch (error) {
      console.error(error);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.onFail?.();
      return false;
    }
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.host.addEventListener("pointerdown", this.handlers.down);
    this.host.addEventListener("pointermove", this.handlers.move);
    this.host.addEventListener("pointerup", this.handlers.up);
    this.host.addEventListener("pointercancel", this.handlers.up);
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.checkVisibility();
    });
    this.intersection.observe(this.host);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.host);
    this.resize();
    loadRelief()
      .then((relief) => {
        if (this.destroyed || !this.gl) return;
        this.relief = relief;
        this.buildGrid();
        this.fitCamera();
        this.ready = true;
        this.render();
        this.onReady?.();
      })
      .catch((error) => {
        console.error(error);
        this.onFail?.();
      });
    return true;
  }

  setupGl() {
    const gl = this.gl;
    this.programs = {
      bg: link(gl, BG_VERTEX, BG_FRAGMENT),
      pin: link(gl, PIN_VERTEX, PIN_FRAGMENT),
      depth: link(gl, PIN_VERTEX, DEPTH_FRAGMENT),
      plate: link(gl, PLATE_VERTEX, PLATE_FRAGMENT),
      housing: link(gl, SOLID_VERTEX, HOUSING_FRAGMENT),
      acrylic: link(gl, SOLID_VERTEX, ACRYLIC_FRAGMENT),
    };
    this.buffers = [];
    this.vaos = [];
    const buffer = (data, target = gl.ARRAY_BUFFER) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      this.buffers.push(b);
      return b;
    };
    this.triVao = gl.createVertexArray();
    this.vaos.push(this.triVao);
    gl.bindVertexArray(this.triVao);
    buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const mesh = pinMesh();
    this.pinCount = mesh.indices.length;
    this.pinVao = gl.createVertexArray();
    this.vaos.push(this.pinVao);
    gl.bindVertexArray(this.pinVao);
    buffer(mesh.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    buffer(mesh.normals);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    buffer(mesh.ride);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    buffer(mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    this.plateVao = gl.createVertexArray();
    this.plateBuffer = gl.createBuffer();
    this.solidVao = gl.createVertexArray();
    this.solidBuffer = gl.createBuffer();
    this.frameVao = gl.createVertexArray();
    this.frameBuffer = gl.createBuffer();
    this.vaos.push(this.plateVao, this.solidVao, this.frameVao);
    this.buffers.push(this.plateBuffer, this.solidBuffer, this.frameBuffer);
    for (const [vao, buf] of [
      [this.solidVao, this.solidBuffer],
      [this.frameVao, this.frameBuffer],
    ]) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    }
    gl.bindVertexArray(this.plateVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.plateBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.shadowSize = Math.min(max, 2048);
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bedAspect() {
    const ins = this.insets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    const rw = Math.max(1, this.width - ins.left - ins.right);
    const rh = Math.max(1, this.height - ins.top - ins.bottom);
    return { aspect: Math.min(1.3, Math.max(0.78, (rw / rh) * 0.86)), rh, rw };
  }

  buildGrid() {
    const gl = this.gl;
    const { aspect, rh, rw } = this.bedAspect();
    const shownHeight = Math.min(rh, rw / aspect) * 0.8;
    const pitch = Math.max(MIN_PITCH_PX, MIN_PITCH_DEVICE / this.dpr);
    let rows = Math.round(Math.sqrt(TARGET_PINS / (aspect * 0.8660254)));
    rows = Math.max(40, Math.min(rows, Math.floor(shownHeight / (0.8660254 * pitch))));
    const spacing = 1 / (rows * 0.8660254);
    const cols = Math.max(40, Math.round(aspect * rows * 0.8660254 - 0.5));
    const width = (cols + 0.5) * spacing;
    const n = cols * rows;
    const g = {
      aspect,
      cols,
      rows,
      n,
      spacing,
      width,
      height: 1,
      hw: width / 2,
      hh: 0.5,
      px: new Float32Array(n),
      py: new Float32Array(n),
      h: new Float32Array(n),
      v: new Float32Array(n),
      target: new Float32Array(n),
      mu: new Float32Array(n),
      jostle: new Float32Array(n),
      speed: new Float32Array(n),
      tmp: new Float32Array(n),
      nbr: new Float32Array(n),
      start: new Float32Array(n),
      from: new Float32Array(n),
      upload: new Float32Array(n * 2),
    };
    let maxDist = 0;
    const waveX = 0;
    const waveY = 0.06;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const x = (c + 0.25 + 0.5 * (r & 1)) * spacing;
        const y = (r + 0.5) * spacing * 0.8660254;
        g.px[i] = x - g.hw;
        g.py[i] = y - g.hh;
        const u = (x - g.hw) / 1 + 0.5;
        const v = 1 - y;
        const fade = smoothstep(-0.02, 0.06, u) * smoothstep(1.02, 0.94, u);
        g.target[i] = sampleRelief(this.relief, u, v) * fade * PORTRAIT_DEPTH;
        g.mu[i] = (0.35 + 1.25 * valueNoise(c / 7, r / 7)) * (0.75 + 0.5 * hash(i * 0.731));
        const d = Math.hypot(g.px[i] - waveX, g.py[i] - waveY);
        g.start[i] = d;
        maxDist = Math.max(maxDist, d);
      }
    }
    for (let i = 0; i < n; i += 1) g.start[i] = (g.start[i] / maxDist) * WAVE_SECONDS + (hash(i * 1.37) - 0.5) * 0.14;
    g.h.set(g.target);
    if (this.heightTex) gl.deleteTexture(this.heightTex);
    this.heightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16F, cols, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const hw = g.hw;
    const hh = g.hh;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.plateBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, -hh, 0, hw, hh, 0, -hw, hh, 0]), gl.STATIC_DRAW);
    const solid = new Float32Array(boxShell(hw + BORDER * 0.6, hh + BORDER * 0.6, -BACK + 0.004, -0.002, false));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, solid, gl.STATIC_DRAW);
    this.solidCount = solid.length / 10;
    const frame = frameGeometry(hw, hh);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frameBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, frame, gl.STATIC_DRAW);
    this.frameCount = frame.length / 10;
    this.grid = g;
    this.heightsDirty = true;
  }

  resize() {
    if (!this.gl) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const scale = this.governor.scale;
    if (width === this.width && height === this.height && dpr === this.dpr && scale === this.scale) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.scale = scale;
    this.canvas.width = Math.max(1, Math.round(width * dpr * scale));
    this.canvas.height = Math.max(1, Math.round(height * dpr * scale));
    if (!this.ready) return;
    if (Math.abs(this.bedAspect().aspect - this.grid.aspect) > 0.12 && !this.wave) {
      this.buildGrid();
    }
    this.fitCamera();
    this.render();
  }

  modelMatrix(lean, yaw) {
    const pivot = EXTENT * 0.5;
    return multiply(translation(0, 0, pivot), multiply(rotation(-lean, yaw), translation(0, 0, -pivot)));
  }

  corners() {
    const g = this.grid;
    const ow = g.hw + BORDER;
    const oh = g.hh + BORDER;
    const list = [];
    for (const x of [-ow, ow]) for (const y of [-oh, oh]) for (const z of [-BACK, LIP]) list.push([x, y, z]);
    return list;
  }

  fitCamera() {
    const g = this.grid;
    if (!g) return;
    const ins = this.insets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    const aspect = this.width / this.height;
    const rx0 = (ins.left / this.width) * 2 - 1;
    const rx1 = 1 - (ins.right / this.width) * 2;
    const ry0 = 1 - ((this.height - ins.bottom) / this.height) * 2;
    const ry1 = 1 - (ins.top / this.height) * 2;
    const target = [0, 0, EXTENT * 0.4];
    const dir = [Math.sin(CAM_YAW) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(CAM_YAW) * Math.cos(CAM_PITCH)];
    const proj = perspective(FOV, aspect, 0.05, 40);
    const corners = this.corners();
    let distance = 4;
    let view = null;
    let box = null;
    for (let iter = 0; iter < 8; iter += 1) {
      const eye = [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance];
      view = lookAt(eye, target, [0, 1, 0]);
      const vp = multiply(proj, view);
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of corners) {
        const p = transformPoint(vp, c);
        const x = p[0] / p[3];
        const y = p[1] / p[3];
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
      const scale = Math.max((box[2] - box[0]) / (rx1 - rx0), (box[3] - box[1]) / (ry1 - ry0));
      distance *= scale;
    }
    const eye = [target[0] + dir[0] * distance, target[1] + dir[1] * distance, target[2] + dir[2] * distance];
    view = lookAt(eye, target, [0, 1, 0]);
    const shiftX = (rx0 + rx1) / 2 - (box[0] + box[2]) / 2;
    const shiftY = (ry0 + ry1) / 2 - (box[1] + box[3]) / 2;
    proj[8] = -shiftX;
    proj[9] = -shiftY;
    this.view = view;
    this.proj = proj;
    this.eye = eye;
    this.viewProj = multiply(proj, view);
    this.invViewProj = invert(this.viewProj);
  }

  computeLight() {
    const center = [0, 0, EXTENT * 0.4];
    const eye = [center[0] + LIGHT[0] * 4, center[1] + LIGHT[1] * 4, center[2] + LIGHT[2] * 4];
    const view = lookAt(eye, center, [0, 1, 0]);
    const toWorld = this.model;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const c of this.corners()) {
      const w = transformPoint(toWorld, c);
      const p = transformPoint(view, w);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const pad = 0.02;
    const proj = ortho(minX - pad, maxX + pad, minY - pad, maxY + pad, -maxZ - 0.5, -minZ + 0.5);
    this.lightVP = multiply(proj, view);
  }

  localPoint(e) {
    const rect = this.host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  toBed(sx, sy) {
    if (!this.invViewProj) return null;
    const nx = (sx / this.width) * 2 - 1;
    const ny = 1 - (sy / this.height) * 2;
    const a = transformPoint(this.invViewProj, [nx, ny, -1]);
    const b = transformPoint(this.invViewProj, [nx, ny, 1]);
    const ro = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    const rb = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const pivot = EXTENT * 0.5;
    const rot = rotation(-this.lean, this.yaw);
    const o = transposeDir(rot, [ro[0], ro[1], ro[2] - pivot]);
    const d = transposeDir(rot, [rb[0] - ro[0], rb[1] - ro[1], rb[2] - ro[2]]);
    const planeZ = EXTENT * 0.45 - pivot;
    if (Math.abs(d[2]) < 1e-6) return null;
    const t = (planeZ - o[2]) / d[2];
    return [o[0] + d[0] * t, o[1] + d[1] * t];
  }

  pointerDown(e) {
    if (!this.ready || (e.button !== undefined && e.button > 0)) return;
    if (e.target.closest?.("button, a, input, label")) return;
    const [x, y] = this.localPoint(e);
    this.pointers.set(e.pointerId, { x, y });
    this.host.setPointerCapture?.(e.pointerId);
    if (e.shiftKey || this.pointers.size >= 2) {
      this.press = null;
      this.beginTilt();
    } else {
      const bed = this.toBed(x, y);
      if (bed) this.press = { id: e.pointerId, x: bed[0], y: bed[1], lx: bed[0], ly: bed[1], depth: 0.34, fresh: true };
      this.host.setAttribute("data-pressing", "");
    }
    this.wake();
  }

  centroid() {
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = Math.max(1, this.pointers.size);
    return [x / n, y / n];
  }

  beginTilt() {
    this.tip = null;
    const [cx, cy] = this.centroid();
    this.tiltDrag = { x: cx, y: cy, lean: this.lean, yaw: this.yaw };
    this.host.setAttribute("data-tilting", "");
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.localPoint(e);
    p.x = x;
    p.y = y;
    if (this.press && this.press.id === e.pointerId) {
      const bed = this.toBed(x, y);
      if (bed) {
        this.press.x = bed[0];
        this.press.y = bed[1];
      }
    }
    this.wake();
  }

  pointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.press && this.press.id === e.pointerId) this.press = null;
    if (this.tiltDrag) {
      if (this.pointers.size === 0) {
        this.tiltDrag = null;
        this.leanTarget = 0;
        this.yawTarget = 0;
        this.host.removeAttribute("data-tilting");
      } else {
        this.beginTilt();
      }
    }
    if (this.pointers.size === 0) this.host.removeAttribute("data-pressing");
    this.wake();
  }

  setKeyLean(value) {
    this.keyLean = value;
    if (!this.tiltDrag) {
      this.tip = null;
      this.leanTarget = value;
    }
    this.wake();
  }

  setKeyPress(on) {
    if (!this.ready) return;
    if (on && !this.press) {
      this.press = { id: -1, x: 0, y: 0.04, lx: 0, ly: 0.04, depth: 0.34, fresh: true };
    } else if (!on && this.press?.id === -1) {
      this.press = null;
    }
    this.wake();
  }

  tipBack(then = null) {
    if (!this.ready || this.tiltDrag) return;
    this.wave = null;
    this.tip = { phase: "out", t: 0, then };
    this.leanTarget = TIP_LEAN;
    this.yawTarget = 0;
    this.wake();
  }

  pressPortrait() {
    if (!this.ready || this.wave || this.tip) return;
    const g = this.grid;
    let sum = 0;
    for (let i = 0; i < g.n; i += 1) sum += g.h[i];
    if (sum / g.n < 0.01 || this.reduced) {
      if (this.reduced) g.h.fill(0);
      this.startWave();
    } else {
      this.tipBack("wave");
    }
  }

  startWave() {
    const g = this.grid;
    g.from.set(g.h);
    g.v.fill(0);
    this.wave = { t: this.reduced ? WAVE_SECONDS + RISE_SECONDS : 0 };
    this.heightsDirty = true;
    this.wake();
  }

  stepTilt(dt) {
    if (this.tiltDrag) {
      const [cx, cy] = this.centroid();
      const scale = 1 / Math.max(240, Math.min(this.width, this.height));
      this.leanTarget = Math.max(-LEAN_LIMIT, Math.min(LEAN_LIMIT, this.tiltDrag.lean - (cy - this.tiltDrag.y) * scale * 1.3));
      this.yawTarget = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, this.tiltDrag.yaw + (cx - this.tiltDrag.x) * scale * 0.9));
    } else if (!this.tip) {
      this.leanTarget = this.keyLean;
      this.yawTarget = 0;
    }
    const omega = this.tiltDrag ? 9 : this.reduced ? 14 : 6;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let k = 0; k < steps; k += 1) {
      this.leanV += (omega * omega * (this.leanTarget - this.lean) - 2 * omega * this.leanV) * h;
      this.lean += this.leanV * h;
      this.yawV += (omega * omega * (this.yawTarget - this.yaw) - 2 * omega * this.yawV) * h;
      this.yaw += this.yawV * h;
    }
    const resting =
      Math.abs(this.lean - this.leanTarget) < 1e-4 && Math.abs(this.leanV) < 1e-4 && Math.abs(this.yaw - this.yawTarget) < 1e-4 && Math.abs(this.yawV) < 1e-4;
    if (resting) {
      this.lean = this.leanTarget;
      this.yaw = this.yawTarget;
      this.leanV = 0;
      this.yawV = 0;
    }
    return !resting;
  }

  stepTip(dt) {
    const tip = this.tip;
    if (!tip) return false;
    tip.t += dt;
    if (tip.phase === "out") {
      this.leanTarget = TIP_LEAN;
      const settled = this.moving < this.grid.n * 0.004;
      if ((tip.t > 0.7 && settled) || tip.t > 2.6) {
        tip.phase = "back";
        tip.t = 0;
        this.leanTarget = 0;
      }
    } else {
      this.leanTarget = 0;
      if (Math.abs(this.lean) < 0.05) {
        this.tip = null;
        if (tip.then === "wave") this.startWave();
      }
    }
    return true;
  }

  stepGravity(dt) {
    const g = this.grid;
    const rot = rotation(-this.lean, this.yaw);
    const axisY = rot[9];
    const accel = -GRAVITY * axisY;
    const magnitude = Math.abs(accel);
    if (this.moving === 0 && magnitude < 0.3) return false;
    const { h, v, mu, jostle, speed, cols, rows } = g;
    const waveT = this.wave ? this.wave.t : -1;
    let moving = 0;
    let changed = false;
    for (let i = 0; i < g.n; i += 1) {
      if (waveT >= 0 && waveT >= g.start[i]) {
        v[i] = 0;
        continue;
      }
      let vi = v[i];
      const hi = h[i];
      if (vi === 0) {
        const threshold = mu[i] * (1 - jostle[i]);
        if ((accel < -threshold && hi > 0) || (accel > threshold && hi < 1)) vi = accel * dt * 0.5;
        else {
          speed[i] = 0;
          continue;
        }
      } else {
        const before = vi;
        vi += (accel - Math.sign(vi) * mu[i] * 0.45) * dt;
        if (vi * before <= 0) vi = Math.abs(accel) > mu[i] * 0.45 ? accel * dt * 0.5 : 0;
        vi = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, vi));
      }
      let nh = hi + vi * dt;
      if (nh <= 0) {
        nh = 0;
        vi = vi < -0.6 && !this.reduced ? -vi * 0.1 : 0;
      } else if (nh >= 1) {
        nh = 1;
        vi = vi > 0.6 && !this.reduced ? -vi * 0.1 : 0;
      }
      if (nh !== hi) changed = true;
      h[i] = nh;
      v[i] = vi;
      speed[i] = Math.abs(vi);
      if (vi !== 0) moving += 1;
    }
    this.moving = moving;
    if (moving > 0) {
      const tmp = g.tmp;
      for (let r = 0; r < rows; r += 1) {
        const row = r * cols;
        for (let c = 0; c < cols; c += 1) {
          const a = speed[row + Math.max(0, c - 1)];
          const b = speed[row + c];
          const d = speed[row + Math.min(cols - 1, c + 1)];
          tmp[row + c] = a + b + d;
        }
      }
      for (let r = 0; r < rows; r += 1) {
        const up = Math.max(0, r - 1) * cols;
        const mid = r * cols;
        const dn = Math.min(rows - 1, r + 1) * cols;
        for (let c = 0; c < cols; c += 1) {
          const s = (tmp[up + c] + tmp[mid + c] + tmp[dn + c]) / 9;
          jostle[mid + c] = Math.min(0.85, s * 2.2);
        }
      }
    } else {
      jostle.fill(0);
    }
    if (changed) this.heightsDirty = true;
    return moving > 0;
  }

  stepWave(dt) {
    const wave = this.wave;
    if (!wave) return false;
    wave.t += dt;
    const g = this.grid;
    const { h, from, target, start } = g;
    for (let i = 0; i < g.n; i += 1) {
      const k = (wave.t - start[i]) / RISE_SECONDS;
      if (k <= 0) continue;
      h[i] = from[i] + (target[i] - from[i]) * smootherstep(k);
    }
    this.heightsDirty = true;
    if (wave.t > WAVE_SECONDS + 0.1 + RISE_SECONDS) {
      h.set(target);
      this.wave = null;
    }
    return true;
  }

  applyHand(cx, cy, depth, rate) {
    const g = this.grid;
    const size = HAND_SIZE;
    const x0 = cx + HAND_EXTENT.left * size;
    const x1 = cx + HAND_EXTENT.right * size;
    const y0 = cy + HAND_EXTENT.bottom * size;
    const y1 = cy + HAND_EXTENT.top * size;
    const rowStep = g.spacing * 0.8660254;
    const r0 = Math.max(0, Math.floor((y0 + g.hh) / rowStep - 0.5));
    const r1 = Math.min(g.rows - 1, Math.ceil((y1 + g.hh) / rowStep - 0.5));
    const c0 = Math.max(0, Math.floor((x0 + g.hw) / g.spacing - 1));
    const c1 = Math.min(g.cols - 1, Math.ceil((x1 + g.hw) / g.spacing));
    const { h, v, px, py } = g;
    let changed = false;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const i = r * g.cols + c;
        const p = handPressure((px[i] - cx) / size, (py[i] - cy) / size);
        if (p <= 0) continue;
        const want = depth * p;
        if (want > h[i]) {
          h[i] += (want - h[i]) * rate;
          v[i] = 0;
          changed = true;
        }
      }
    }
    if (changed) this.heightsDirty = true;
  }

  stepPress(dt) {
    const p = this.press;
    if (!p) return false;
    const dist = Math.hypot(p.x - p.lx, p.y - p.ly);
    const raw = dist / Math.max(dt, 1 / 240);
    p.speed = (p.speed || 0) + (raw - (p.speed || 0)) * (1 - Math.exp(-dt / 0.08));
    const sliding = smoothstep(0.15, 1.6, p.speed);
    const goal = 1 - 0.55 * sliding;
    const ease = 1 - Math.exp(-dt / (p.depth < goal ? 0.7 : 0.18));
    p.depth += (goal - p.depth) * ease;
    const rate = 1 - Math.exp(-dt * (this.reduced ? 30 : 11));
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / 0.02)));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      this.applyHand(p.lx + (p.x - p.lx) * t, p.ly + (p.y - p.ly) * t, p.depth, rate);
    }
    p.lx = p.x;
    p.ly = p.y;
    return true;
  }

  uploadHeights() {
    if (!this.heightsDirty) return;
    this.heightsDirty = false;
    const g = this.grid;
    const { h, tmp, nbr, cols, rows, upload } = g;
    const R = 3;
    for (let r = 0; r < rows; r += 1) {
      const row = r * cols;
      let sum = 0;
      for (let k = -R; k <= R; k += 1) sum += h[row + Math.min(cols - 1, Math.max(0, k))];
      for (let c = 0; c < cols; c += 1) {
        tmp[row + c] = sum;
        sum += h[row + Math.min(cols - 1, c + R + 1)] - h[row + Math.max(0, c - R)];
      }
    }
    const span = (2 * R + 1) * (2 * R + 1);
    for (let c = 0; c < cols; c += 1) {
      let sum = 0;
      for (let k = -R; k <= R; k += 1) sum += tmp[Math.min(rows - 1, Math.max(0, k)) * cols + c];
      for (let r = 0; r < rows; r += 1) {
        nbr[r * cols + c] = sum / span;
        sum += tmp[Math.min(rows - 1, r + R + 1) * cols + c] - tmp[Math.max(0, r - R) * cols + c];
      }
    }
    for (let i = 0; i < g.n; i += 1) {
      upload[i * 2] = h[i];
      upload[i * 2 + 1] = nbr[i];
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.FLOAT, upload);
  }

  setCommon(prog) {
    const gl = this.gl;
    const u = prog.uniforms;
    if (u.uLight) gl.uniform3fv(u.uLight, LIGHT);
    if (u.uCam) gl.uniform3fv(u.uCam, this.eye);
    if (u.uModel) gl.uniformMatrix4fv(u.uModel, false, this.model);
    if (u.uViewProj) gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    if (u.uLightVP) gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    if (u.uShadowTexel) gl.uniform2f(u.uShadowTexel, 1 / this.shadowSize, 1 / this.shadowSize);
    if (u.uShadow) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(u.uShadow, 1);
    }
    const g = this.grid;
    if (u.uHeights) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.uniform1i(u.uHeights, 0);
    }
    if (u.uGrid) gl.uniform4f(u.uGrid, g.cols, g.rows, g.spacing, EXTENT);
    if (u.uBed) gl.uniform4f(u.uBed, g.hw, g.hh, 0, 0);
    if (u.uPin) gl.uniform2f(u.uPin, g.spacing * PIN_RADIUS, PIN_SINK);
  }

  render() {
    const gl = this.gl;
    const g = this.grid;
    if (!gl || !g || !this.viewProj) return;
    this.model = this.modelMatrix(this.lean, this.yaw);
    this.computeLight();
    this.uploadHeights();
    const lightRender = this.lightVP;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    const depth = this.programs.depth;
    gl.useProgram(depth.program);
    this.setCommon(depth);
    gl.uniformMatrix4fv(depth.uniforms.uViewProj, false, lightRender);
    gl.bindVertexArray(this.pinVao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.pinCount, gl.UNSIGNED_SHORT, 0, g.n);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.82, 0.81, 0.79, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const bg = this.programs.bg;
    gl.useProgram(bg.program);
    this.setCommon(bg);
    gl.uniformMatrix4fv(bg.uniforms.uInvViewProj, false, this.invViewProj);
    gl.uniformMatrix4fv(bg.uniforms.uModelInv, false, invert(this.model));
    gl.uniform4f(bg.uniforms.uOuter, g.hw + BORDER, g.hh + BORDER, BORDER, 0);
    gl.uniform1f(bg.uniforms.uWall, WALL_Z);
    gl.bindVertexArray(this.triVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const plate = this.programs.plate;
    gl.useProgram(plate.program);
    this.setCommon(plate);
    gl.bindVertexArray(this.plateVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const housing = this.programs.housing;
    gl.useProgram(housing.program);
    this.setCommon(housing);
    gl.bindVertexArray(this.solidVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.solidCount);
    const pin = this.programs.pin;
    gl.useProgram(pin.program);
    this.setCommon(pin);
    gl.bindVertexArray(this.pinVao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.pinCount, gl.UNSIGNED_SHORT, 0, g.n);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const acrylic = this.programs.acrylic;
    gl.useProgram(acrylic.program);
    this.setCommon(acrylic);
    gl.bindVertexArray(this.frameVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.frameCount);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  wake() {
    if (this.raf || this.destroyed || !this.gl || !this.visible || document.hidden) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  checkVisibility() {
    if (document.hidden || !this.visible) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.wake();
  }

  setBusy(value) {
    if (value === this.busyState) return;
    this.busyState = value;
    this.onBusy?.(value);
  }

  frame(now) {
    this.raf = 0;
    if (this.destroyed || !this.ready) return;
    const consecutive = this.last !== 0;
    const dt = consecutive ? Math.min(1 / 30, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    if (consecutive && this.governor.sample(now - this.last)) this.resize();
    this.last = now;
    if (dt <= 0) {
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const scripted = this.stepTip(dt);
    const tilting = this.stepTilt(dt);
    const waving = this.stepWave(dt);
    const sliding = this.stepGravity(dt);
    const pressing = this.stepPress(dt);
    this.render();
    this.setBusy(scripted || waving);
    const busy = scripted || tilting || waving || sliding || pressing || Boolean(this.tiltDrag);
    if (busy) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.host.removeEventListener("pointerdown", this.handlers.down);
    this.host.removeEventListener("pointermove", this.handlers.move);
    this.host.removeEventListener("pointerup", this.handlers.up);
    this.host.removeEventListener("pointercancel", this.handlers.up);
    const gl = this.gl;
    if (!gl) return;
    Object.values(this.programs).forEach(({ program }) => gl.deleteProgram(program));
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.vaos.forEach((v) => gl.deleteVertexArray(v));
    gl.deleteTexture(this.heightTex);
    gl.deleteTexture(this.shadowTex);
    gl.deleteFramebuffer(this.shadowFbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}

function invert(m) {
  const inv = new Float32Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-12) return identity();
  det = 1 / det;
  for (let i = 0; i < 16; i += 1) inv[i] *= det;
  return inv;
}
