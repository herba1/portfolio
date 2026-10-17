const EPS = 1e-9;

export function makeSheet(width, height) {
  return {
    pts: new Float64Array([0, 0, width, 0, width, height, 0, height]),
    nm: new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    b: new Uint8Array([1, 1, 1, 1]),
    R: new Float64Array([1, 0, 0, 0, -1, 0, 0, 0, -1]),
    t: new Float64Array([-width / 2, height / 2, 0]),
  };
}

export function worldPoint(piece, i, out) {
  const u = piece.pts[i * 2];
  const v = piece.pts[i * 2 + 1];
  const R = piece.R;
  out[0] = R[0] * u + R[1] * v + piece.t[0];
  out[1] = R[3] * u + R[4] * v + piece.t[1];
  out[2] = R[6] * u + R[7] * v + piece.t[2];
  return out;
}

export function frontNormal(piece, out) {
  out[0] = -piece.R[2];
  out[1] = -piece.R[5];
  out[2] = -piece.R[8];
  return out;
}

export function area(pts) {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    a += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return a / 2;
}

export function centroid(pts) {
  let x = 0;
  let y = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i += 1) {
    x += pts[i * 2];
    y += pts[i * 2 + 1];
  }
  return [x / n, y / n];
}

function linear(piece, frameP, axis) {
  const R = piece.R;
  const t = piece.t;
  return [
    R[0] * axis[0] + R[3] * axis[1] + R[6] * axis[2],
    R[1] * axis[0] + R[4] * axis[1] + R[7] * axis[2],
    (t[0] - frameP[0]) * axis[0] + (t[1] - frameP[1]) * axis[1] + (t[2] - frameP[2]) * axis[2],
  ];
}

export function clip(piece, a, b, c) {
  const pts = piece.pts;
  const nm = piece.nm;
  const n = pts.length / 2;
  const outP = [];
  const outN = [];
  const outB = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const fi = a * pts[i * 2] + b * pts[i * 2 + 1] + c;
    const fj = a * pts[j * 2] + b * pts[j * 2 + 1] + c;
    const inI = fi >= 0;
    const inJ = fj >= 0;
    if (inI) {
      outP.push(pts[i * 2], pts[i * 2 + 1]);
      outN.push(nm[i * 3], nm[i * 3 + 1], nm[i * 3 + 2]);
      outB.push(piece.b[i]);
    }
    if (inI !== inJ) {
      const k = fi / (fi - fj);
      outP.push(pts[i * 2] + (pts[j * 2] - pts[i * 2]) * k, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * k);
      const x = nm[i * 3] + (nm[j * 3] - nm[i * 3]) * k;
      const y = nm[i * 3 + 1] + (nm[j * 3 + 1] - nm[i * 3 + 1]) * k;
      const z = nm[i * 3 + 2] + (nm[j * 3 + 2] - nm[i * 3 + 2]) * k;
      const l = Math.hypot(x, y, z) || 1;
      outN.push(x / l, y / l, z / l);
      outB.push(inI ? 0 : piece.b[i]);
    }
  }
  if (outP.length < 6) return null;
  const P = new Float64Array(outP);
  if (Math.abs(area(P)) < 1e-11) return null;
  return { pts: P, nm: new Float64Array(outN), b: new Uint8Array(outB), R: piece.R, t: piece.t };
}

function rotation(frame, angle) {
  const n = frame.n;
  const m = frame.m;
  const c = Math.cos(angle) - 1;
  const s = Math.sin(angle);
  const G = new Float64Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let k = 0; k < 3; k += 1) {
      G[r * 3 + k] = (r === k ? 1 : 0) + c * (n[r] * n[k] + m[r] * m[k]) + s * (m[r] * n[k] - n[r] * m[k]);
    }
  }
  return G;
}

function mul3(A, B) {
  const C = new Float64Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let k = 0; k < 3; k += 1) C[r * 3 + k] = A[r * 3] * B[k] + A[r * 3 + 1] * B[3 + k] + A[r * 3 + 2] * B[6 + k];
  }
  return C;
}

function apply3(A, v) {
  return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
}

function transformed(piece, frame, alpha, sa, h, Ps, Pz, sCoef, Rf, theta, smooth) {
  const G = rotation(frame, alpha);
  const p = frame.p;
  const Gp = apply3(G, p);
  const anchor = apply3(G, [sa * frame.n[0] + h * frame.m[0], sa * frame.n[1] + h * frame.m[1], sa * frame.n[2] + h * frame.m[2]]);
  const k = [0, 1, 2].map((i) => p[i] - Gp[i] - anchor[i] + Ps * frame.n[i] + Pz * frame.m[i]);
  const Gt = apply3(G, piece.t);
  const t = new Float64Array([Gt[0] + k[0], Gt[1] + k[1], Gt[2] + k[2]]);
  const R = mul3(G, piece.R);
  const count = piece.pts.length / 2;
  const nm = new Float64Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    let rot = G;
    if (smooth) {
      const s = sCoef[0] * piece.pts[i * 2] + sCoef[1] * piece.pts[i * 2 + 1] + sCoef[2];
      const phi = Rf > EPS ? Math.min(theta, Math.max(0, s / Rf)) : theta;
      rot = rotation(frame, phi);
    }
    const v = apply3(rot, [piece.nm[i * 3], piece.nm[i * 3 + 1], piece.nm[i * 3 + 2]]);
    nm[i * 3] = v[0];
    nm[i * 3 + 1] = v[1];
    nm[i * 3 + 2] = v[2];
  }
  return { pts: piece.pts, nm, b: piece.b, R, t };
}

function sRange(piece, coef) {
  let lo = Infinity;
  let hi = -Infinity;
  const n = piece.pts.length / 2;
  for (let i = 0; i < n; i += 1) {
    const s = coef[0] * piece.pts[i * 2] + coef[1] * piece.pts[i * 2 + 1] + coef[2];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return [lo, hi];
}

export function measure(piece, frame) {
  const sc = linear(piece, frame.p, frame.n);
  const hc = linear(piece, frame.p, frame.m);
  const n = piece.pts.length / 2;
  let lo = Infinity;
  let hi = -Infinity;
  let loH = 0;
  let cutH = 0;
  let cuts = 0;
  const seg = [];
  for (let i = 0; i < n; i += 1) {
    const u = piece.pts[i * 2];
    const v = piece.pts[i * 2 + 1];
    const s = sc[0] * u + sc[1] * v + sc[2];
    if (s < lo) {
      lo = s;
      loH = hc[0] * u + hc[1] * v + hc[2];
    }
    if (s > hi) hi = s;
    const j = (i + 1) % n;
    const u2 = piece.pts[j * 2];
    const v2 = piece.pts[j * 2 + 1];
    const s2 = sc[0] * u2 + sc[1] * v2 + sc[2];
    if ((s < 0) !== (s2 < 0)) {
      const k = s / (s - s2);
      const cu = u + (u2 - u) * k;
      const cv = v + (v2 - v) * k;
      cutH += hc[0] * cu + hc[1] * cv + hc[2];
      cuts += 1;
      seg.push(cu, cv);
    }
  }
  const split = lo < -1e-7 && hi > 1e-7;
  return { sc, lo, hi, split, h: split && cuts ? cutH / cuts : loH, seg: split ? seg : null };
}

export function foldPiece(piece, frame, h, dz, theta, radius, chords, out) {
  const sc = linear(piece, frame.p, frame.n);
  const [lo, hi] = sRange(piece, sc);
  if (hi <= 1e-7) {
    out.push(piece);
    return;
  }
  if (lo < -1e-7) {
    const keep = clip(piece, -sc[0], -sc[1], -sc[2]);
    if (keep) out.push(keep);
  }
  const Rf = radius + Math.max(0, dz);
  const arc = Rf * theta;
  const cx = (phi) => Rf * Math.sin(phi);
  const cz = (phi) => h + Rf * (1 - Math.cos(phi));
  for (let k = 0; k < chords; k += 1) {
    const a = (theta * k) / chords;
    const b = (theta * (k + 1)) / chords;
    const sa = Rf * a;
    const sb = Rf * b;
    if (hi <= sa || lo >= sb) continue;
    let part = clip(piece, sc[0], sc[1], sc[2] - sa);
    if (part) part = clip(part, -sc[0], -sc[1], -sc[2] + sb);
    if (!part) continue;
    out.push(transformed(part, frame, (a + b) / 2, sa, h, cx(a), cz(a), sc, Rf, theta, true));
  }
  if (hi > arc) {
    const part = lo >= arc ? piece : clip(piece, sc[0], sc[1], sc[2] - arc);
    if (part) out.push(transformed(part, frame, theta, arc, h, cx(theta), cz(theta), sc, Rf, theta, false));
  }
}

export function toLocal(piece, frame) {
  const R = piece.R;
  const t = piece.t;
  const inv = (v) => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  return {
    p: inv([frame.p[0] - t[0], frame.p[1] - t[1], frame.p[2] - t[2]]),
    n: inv(frame.n),
    m: inv(frame.m),
  };
}

export function toWorld(piece, local) {
  const R = piece.R;
  const t = piece.t;
  const p = apply3(R, local.p);
  return { p: [p[0] + t[0], p[1] + t[1], p[2] + t[2]], n: apply3(R, local.n), m: apply3(R, local.m) };
}

export function liveFold(pieces, frame, theta, radius, chords) {
  const info = pieces.map((piece) => measure(piece, frame));
  let top = -Infinity;
  for (const it of info) if (it.split && it.h > top) top = it.h;
  if (top === -Infinity) {
    for (const it of info) if (it.hi > 1e-7 && it.h > top) top = it.h;
  }
  if (top === -Infinity) top = 0;
  const out = [];
  if (theta > 1e-6) {
    pieces.forEach((piece, i) => foldPiece(piece, frame, info[i].h, top - info[i].h, theta, radius, chords, out));
  } else out.push(...pieces);
  return { pieces: out, info, top };
}

export function makeRecord(pieces, frame, info, top) {
  const regions = pieces.map((piece, i) => {
    const local = toLocal(piece, frame);
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < piece.pts.length; k += 2) {
      minU = Math.min(minU, piece.pts[k]);
      maxU = Math.max(maxU, piece.pts[k]);
      minV = Math.min(minV, piece.pts[k + 1]);
      maxV = Math.max(maxV, piece.pts[k + 1]);
    }
    return { pts: piece.pts, box: [minU, minV, maxU, maxV], local, moving: info[i].hi > 1e-7 };
  });
  return { regions, top };
}

function inside(pts, x, y) {
  const n = pts.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const cr = (pts[j * 2] - pts[i * 2]) * (y - pts[i * 2 + 1]) - (pts[j * 2 + 1] - pts[i * 2 + 1]) * (x - pts[i * 2]);
    if (Math.abs(cr) < 1e-12) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function regionFor(record, piece) {
  const [x, y] = centroid(piece.pts);
  let best = null;
  let bestD = Infinity;
  for (const r of record.regions) {
    const bx = r.box;
    const d = Math.max(bx[0] - x, x - bx[2], bx[1] - y, y - bx[3], 0);
    if (d > 1e-6) {
      if (d < bestD) {
        bestD = d;
        best = r;
      }
      continue;
    }
    if (inside(r.pts, x, y)) return r;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function replayFold(pieces, record, theta, radius, chords) {
  if (theta <= 1e-6) return pieces;
  const out = [];
  for (const piece of pieces) {
    const region = regionFor(record, piece);
    if (!region || !region.moving) {
      out.push(piece);
      continue;
    }
    const frame = toWorld(piece, region.local);
    const info = measure(piece, frame);
    foldPiece(piece, frame, info.h, record.top - info.h, theta, radius, chords, out);
  }
  return out;
}
