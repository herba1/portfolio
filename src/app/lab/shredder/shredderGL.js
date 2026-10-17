export const mat4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  },
  ortho(l, r, b, t, n, f) {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l);
    m[5] = 2 / (t - b);
    m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l);
    m[13] = -(t + b) / (t - b);
    m[14] = -(f + n) / (f - n);
    m[15] = 1;
    return m;
  },
  lookAt(eye, at, up) {
    let zx = eye[0] - at[0];
    let zy = eye[1] - at[1];
    let zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz) || 1;
    zx /= l;
    zy /= l;
    zz /= l;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1;
    xx /= l;
    xy /= l;
    xz /= l;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx;
    m[1] = yx;
    m[2] = zx;
    m[4] = xy;
    m[5] = yy;
    m[6] = zy;
    m[8] = xz;
    m[9] = yz;
    m[10] = zz;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  },
  mul(a, b) {
    const m = new Float32Array(16);
    for (let c = 0; c < 4; c += 1) {
      for (let r = 0; r < 4; r += 1) {
        m[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return m;
  },
  invert(a) {
    const m = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    const inv = Math.abs(det) > 1e-12 ? 1 / det : 0;
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
    m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
    m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
    m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
    m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
    m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
    m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
    m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
    m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
    m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
    m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
    m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
    m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
    return m;
  },
  apply(m, x, y, z, out) {
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return out;
  },
};

export function program(gl, vsSource, fsSource) {
  const make = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  };
  const vs = make(gl.VERTEX_SHADER, vsSource);
  const fs = make(gl.FRAGMENT_SHADER, fsSource);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const u = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export function imageTexture(gl, source, { repeat = false, mip = true } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return tex;
}

function profile(ha, hb, r, seg) {
  const pts = [];
  const corners = [
    [ha - r, hb - r, 0],
    [-(ha - r), hb - r, Math.PI / 2],
    [-(ha - r), -(hb - r), Math.PI],
    [ha - r, -(hb - r), (3 * Math.PI) / 2],
  ];
  for (const [ca, cb, a0] of corners) {
    for (let s = 0; s <= seg; s += 1) {
      const a = a0 + (s / seg) * (Math.PI / 2);
      const na = Math.cos(a);
      const nb = Math.sin(a);
      pts.push([ca + na * r, cb + nb * r, na, nb]);
    }
  }
  return pts;
}

export function roundedBox(out, { hx, ha, hb, r, re, center, X, A, B, part }) {
  const seg = 5;
  const rings = 4;
  const start = out.verts.length / 7;
  const ringList = [];
  for (let side = -1; side <= 1; side += 2) {
    const order = [];
    for (let j = 0; j <= rings; j += 1) order.push(side < 0 ? rings - j : j);
    for (const j of order) {
      const th = (j / rings) * (Math.PI / 2);
      const inset = re * (1 - Math.cos(th));
      ringList.push({ x: side * (hx - re + re * Math.sin(th)), inset, c: Math.cos(th), s: side * Math.sin(th) });
    }
  }
  const per = 4 * (seg + 1);
  for (const ring of ringList) {
    const pts = profile(ha - ring.inset, hb - ring.inset, Math.max(0.0015, r - ring.inset), seg);
    for (const [a, b, na, nb] of pts) {
      const lx = ring.x;
      const px = center[0] + X[0] * lx + A[0] * a + B[0] * b;
      const py = center[1] + X[1] * lx + A[1] * a + B[1] * b;
      const pz = center[2] + X[2] * lx + A[2] * a + B[2] * b;
      const nx = X[0] * ring.s + (A[0] * na + B[0] * nb) * ring.c;
      const ny = X[1] * ring.s + (A[1] * na + B[1] * nb) * ring.c;
      const nz = X[2] * ring.s + (A[2] * na + B[2] * nb) * ring.c;
      const nl = Math.hypot(nx, ny, nz) || 1;
      out.verts.push(px, py, pz, nx / nl, ny / nl, nz / nl, part);
    }
  }
  for (let rI = 0; rI < ringList.length - 1; rI += 1) {
    for (let p = 0; p < per; p += 1) {
      const a = start + rI * per + p;
      const b = start + rI * per + ((p + 1) % per);
      const c = a + per;
      const d = b + per;
      out.idx.push(a, c, b, b, c, d);
    }
  }
  for (let side = 0; side < 2; side += 1) {
    const ring = side === 0 ? 0 : ringList.length - 1;
    const sx = side === 0 ? -1 : 1;
    const cx = center[0] + X[0] * sx * hx;
    const cy = center[1] + X[1] * sx * hx;
    const cz = center[2] + X[2] * sx * hx;
    const ci = out.verts.length / 7;
    out.verts.push(cx, cy, cz, X[0] * sx, X[1] * sx, X[2] * sx, part);
    for (let p = 0; p < per; p += 1) {
      const a = start + ring * per + p;
      const b = start + ring * per + ((p + 1) % per);
      out.idx.push(ci, a, b);
    }
  }
}
