import { MAX_FILINGS } from "./filingsParams";
import { FILING_FRAGMENT, FILING_VERTEX, PAPER_FRAGMENT, PAPER_VERTEX } from "./filingsShader";
import { GROW_OVERSHOOT, MORPH_OVERSHOOT, easeOutBack } from "./filingsSim";

const STATIC_FLOATS = 14;

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
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "link failed");
  }
  const uniforms = {};
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < total; index += 1) {
    const info = gl.getActiveUniform(program, index);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

export function createGlRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const filings = link(gl, FILING_VERTEX, FILING_FRAGMENT);
  const paper = link(gl, PAPER_VERTEX, PAPER_FRAGMENT);
  const staticData = new Float32Array(MAX_FILINGS * STATIC_FLOATS);
  let count = 0;

  const cornerBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const paperBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, paperBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const staticBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, staticData.byteLength, gl.STATIC_DRAW);

  const stateBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_FILINGS * 3 * 4, gl.DYNAMIC_DRAW);

  const filingVao = gl.createVertexArray();
  gl.bindVertexArray(filingVao);
  const attribute = (name) => gl.getAttribLocation(filings.program, name);
  const corner = attribute("aCorner");
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
  const stride = STATIC_FLOATS * 4;
  const layout = [
    ["aHome", 2, 0],
    ["aShape", 4, 2],
    ["aColourFrom", 3, 6],
    ["aColourTo", 3, 9],
    ["aTiming", 2, 12],
  ];
  for (const [name, size, offset] of layout) {
    const location = attribute(name);
    if (location < 0) continue;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer);
  const stateLocation = attribute("aState");
  gl.enableVertexAttribArray(stateLocation);
  gl.vertexAttribPointer(stateLocation, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(stateLocation, 1);
  gl.bindVertexArray(null);

  const paperVao = gl.createVertexArray();
  gl.bindVertexArray(paperVao);
  const paperCorner = gl.getAttribLocation(paper.program, "aCorner");
  gl.bindBuffer(gl.ARRAY_BUFFER, paperBuffer);
  gl.enableVertexAttribArray(paperCorner);
  gl.vertexAttribPointer(paperCorner, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    kind: "webgl",
    uploadStatic(sim) {
      count = sim.count;
      for (let index = 0; index < count; index += 1) {
        const at = index * STATIC_FLOATS;
        staticData[at] = sim.homeX[index];
        staticData[at + 1] = sim.homeY[index];
        for (let k = 0; k < 4; k += 1) staticData[at + 2 + k] = sim.shape[index * 4 + k];
        for (let k = 0; k < 6; k += 1) staticData[at + 6 + k] = sim.colour[index * 6 + k];
        staticData[at + 12] = sim.introDelay[index];
        staticData[at + 13] = sim.morphDelay[index];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, staticData, 0, count * STATIC_FLOATS);
    },
    uploadState(sim) {
      gl.bindBuffer(gl.ARRAY_BUFFER, stateBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sim.state, 0, sim.count * 3);
    },
    resize(width, height) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    draw(frame) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(paper.program);
      gl.uniform3fv(paper.uniforms.uPaper, frame.paper);
      gl.uniform1f(paper.uniforms.uDpr, frame.dpr);
      gl.uniform1f(paper.uniforms.uGrain, frame.grain);
      gl.bindVertexArray(paperVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (count > 0 && frame.showFilings) {
        gl.enable(gl.BLEND);
        gl.useProgram(filings.program);
        const u = filings.uniforms;
        gl.uniform1f(u.uPlate, frame.plate);
        gl.uniform1f(u.uDpr, frame.dpr);
        gl.uniform1f(u.uIntro, frame.intro);
        gl.uniform1f(u.uIntroSpan, frame.introSpan);
        gl.uniform1f(u.uMorph, frame.morph);
        gl.uniform1f(u.uMorphSpan, frame.morphSpan);
        gl.uniform1f(u.uLength, frame.length);
        gl.bindVertexArray(filingVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      gl.bindVertexArray(null);
    },
    isLost() {
      return gl.isContextLost();
    },
    dispose() {
      gl.deleteVertexArray(filingVao);
      gl.deleteVertexArray(paperVao);
      gl.deleteBuffer(cornerBuffer);
      gl.deleteBuffer(paperBuffer);
      gl.deleteBuffer(staticBuffer);
      gl.deleteBuffer(stateBuffer);
      gl.deleteProgram(filings.program);
      gl.deleteProgram(paper.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function toCss(red, green, blue) {
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;
}

export function createCanvasRenderer(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  let sim = null;

  return {
    kind: "canvas",
    uploadStatic(next) {
      sim = next;
    },
    uploadState() {},
    resize(width, height) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    draw(frame) {
      const scale = canvas.width / frame.plate;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = toCss(frame.paper[0], frame.paper[1], frame.paper[2]);
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!sim || !frame.showFilings) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.lineCap = "round";
      const plate = frame.plate;
      let lastStyle = "";
      for (let index = 0; index < sim.count; index += 1) {
        const grow = easeOutBack((frame.intro - sim.introDelay[index]) / frame.introSpan, GROW_OVERSHOOT);
        if (grow <= 0) continue;
        const morph = easeOutBack((frame.morph - sim.morphDelay[index]) / frame.morphSpan, MORPH_OVERSHOOT);
        const s = index * 4;
        const c = index * 6;
        const length = (sim.shape[s] + (sim.shape[s + 2] - sim.shape[s]) * morph) * plate * frame.length * grow * 1.15;
        const width = Math.max(0.6, (sim.shape[s + 1] + (sim.shape[s + 3] - sim.shape[s + 1]) * morph) * plate) * grow * 1.3;
        const mix = Math.min(1, morph);
        const style = toCss(
          sim.colour[c] + (sim.colour[c + 3] - sim.colour[c]) * mix,
          sim.colour[c + 1] + (sim.colour[c + 4] - sim.colour[c + 1]) * mix,
          sim.colour[c + 2] + (sim.colour[c + 5] - sim.colour[c + 2]) * mix,
        );
        if (style !== lastStyle) {
          context.strokeStyle = style;
          lastStyle = style;
        }
        const angle = sim.state[index * 3];
        const x = (sim.homeX[index] + sim.state[index * 3 + 1]) * plate;
        const y = (sim.homeY[index] + sim.state[index * 3 + 2]) * plate;
        const dx = Math.cos(angle) * length * 0.5;
        const dy = Math.sin(angle) * length * 0.5;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(x - dx, y - dy);
        context.lineTo(x + dx, y + dy);
        context.stroke();
      }
    },
    isLost() {
      return false;
    },
    dispose() {
      sim = null;
    },
  };
}
