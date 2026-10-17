import { PAPER_FRAGMENT_BODY, PAPER_FRAGMENT_HEAD, PAPER_VERTEX_BODY, PAPER_VERTEX_HEAD } from "./receiptGLSL";
import { EDGE_N, hash } from "./receiptSim";

export const ROW = 1.4;
export const COLS = 13;
export const WIDTH = 80;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function sampleChain(pts, s, hint, out) {
  const n = pts.length;
  if (n === 1) {
    out.a = pts[0].a;
    out.h = pts[0].h;
    out.ta = out.fa;
    out.th = out.fh;
    out.k = 0;
    return hint;
  }
  if (s <= pts[0].s) {
    const A = pts[0];
    const B = pts[1];
    const len = Math.hypot(B.a - A.a, B.h - A.h) || 1;
    const ta = (B.a - A.a) / len;
    const th = (B.h - A.h) / len;
    const back = A.s - s;
    out.a = A.a - ta * back;
    out.h = A.h - th * back;
    out.ta = ta;
    out.th = th;
    return 0;
  }
  if (s >= pts[n - 1].s) {
    const A = pts[n - 2];
    const B = pts[n - 1];
    const len = Math.hypot(B.a - A.a, B.h - A.h) || 1;
    const ta = (B.a - A.a) / len;
    const th = (B.h - A.h) / len;
    const fwd = s - B.s;
    out.a = B.a + ta * fwd;
    out.h = B.h + th * fwd;
    out.ta = ta;
    out.th = th;
    return n - 2;
  }
  let i = Math.max(0, Math.min(n - 2, hint));
  while (i < n - 2 && pts[i + 1].s <= s) i += 1;
  while (i > 0 && pts[i].s > s) i -= 1;
  const P1 = pts[i];
  const P2 = pts[i + 1];
  const P0 = pts[i - 1] || P1;
  const P3 = pts[i + 2] || P2;
  const span = P2.s - P1.s || 1;
  const t = (s - P1.s) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const m1a = i > 0 ? ((P2.a - P0.a) * span) / (P2.s - P0.s) : P2.a - P1.a;
  const m1h = i > 0 ? ((P2.h - P0.h) * span) / (P2.s - P0.s) : P2.h - P1.h;
  const m2a = i + 2 < n ? ((P3.a - P1.a) * span) / (P3.s - P1.s) : P2.a - P1.a;
  const m2h = i + 2 < n ? ((P3.h - P1.h) * span) / (P3.s - P1.s) : P2.h - P1.h;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  out.a = h00 * P1.a + h10 * m1a + h01 * P2.a + h11 * m2a;
  out.h = h00 * P1.h + h10 * m1h + h01 * P2.h + h11 * m2h;
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  const ta = d00 * P1.a + d10 * m1a + d01 * P2.a + d11 * m2a;
  const th = d00 * P1.h + d10 * m1h + d01 * P2.h + d11 * m2h;
  const len = Math.hypot(ta, th) || 1;
  out.ta = ta / len;
  out.th = th / len;
  return i;
}

export function makePaperMaterial(THREE, shared, piece) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.55,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  const uniforms = {
    uAtlas: shared.atlas,
    uHeat: shared.heat,
    uRing: shared.ring,
    uHeatGrid: shared.heatGrid,
    uLead: { value: piece.lead },
    uTail: { value: piece.tail || piece.lead },
    uHasTail: { value: piece.tail ? 1 : 0 },
    uSeed: { value: (piece.seed % 97) * 0.731 },
    uFade: { value: 1 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PAPER_VERTEX_HEAD}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${PAPER_VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PAPER_FRAGMENT_HEAD}`)
      .replace("#include <map_fragment>", PAPER_FRAGMENT_BODY);
  };
  material.customProgramCacheKey = () => "receipt-paper";
  material.userData.uniforms = uniforms;
  return material;
}

export function makePaperMesh(THREE, shared, piece, maxRows) {
  const count = maxRows * COLS;
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const paper = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  paper.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setAttribute("paper", paper);
  geometry.setAttribute("uv", paper);
  const index = new Uint32Array((maxRows - 1) * (COLS - 1) * 6);
  let k = 0;
  for (let r = 0; r < maxRows - 1; r += 1) {
    for (let c = 0; c < COLS - 1; c += 1) {
      const a = r * COLS + c;
      const b = (r + 1) * COLS + c;
      index[k++] = a;
      index[k++] = b;
      index[k++] = a + 1;
      index[k++] = b;
      index[k++] = b + 1;
      index[k++] = a + 1;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = makePaperMaterial(THREE, shared, piece);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.piece = piece;
  return { mesh, geometry, material, maxRows, rows: 0 };
}

const S = { a: 0, h: 0, ta: 1, th: 0, fa: 1, fh: 0 };

export function edgeRange(edge) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < EDGE_N; i += 1) {
    lo = Math.min(lo, edge[i]);
    hi = Math.max(hi, edge[i]);
  }
  return [lo, hi];
}

export function updatePaperMesh(view, piece, env) {
  const pts = piece.pts;
  if (!pts.length) return;
  const [leadLo] = edgeRange(piece.lead);
  const start = leadLo - 0.8;
  let end;
  if (piece.tail) end = edgeRange(piece.tail)[1] + 0.8;
  else end = env.exitS + 8;
  let rows = Math.ceil((end - start) / ROW) + 1;
  let step = ROW;
  if (rows > view.maxRows) {
    rows = view.maxRows;
    step = (end - start) / (rows - 1);
  }
  const pos = view.geometry.attributes.position.array;
  const nor = view.geometry.attributes.normal.array;
  const pap = view.geometry.attributes.paper.array;
  const sy = Math.sin(piece.yaw);
  const cy = Math.cos(piece.yaw);
  const dx = sy;
  const dz = -cy;
  const px = cy;
  const pz = sy;
  const ox = piece.ox + px * piece.perp;
  const oz = piece.oz + pz * piece.perp;
  S.fa = env.dirA;
  S.fh = env.dirH;
  const strip = piece.kind === "strip";
  const root = pts[pts.length - 1];
  const twistAmp = piece.twist;
  let hint = 0;
  for (let r = 0; r < rows; r += 1) {
    const s = start + r * step;
    if (strip && s > root.s) {
      const back = s - root.s;
      const inside = Math.max(0, s - env.exitS);
      S.a = root.a - env.dirA * (back - inside) - inside;
      S.h = root.h - env.dirH * (back - inside);
      S.ta = env.dirA;
      S.th = env.dirH;
    } else hint = sampleChain(pts, s, hint, S);
    const local = s - leadLo;
    const tw = twistAmp * (1 - smooth(0, 70, local)) + (piece.tail ? twistAmp * 0.6 * smooth(-60, 0, s - (end - 0.8)) : 0);
    const ct = Math.cos(tw);
    const st = Math.sin(tw);
    const na = S.th;
    const nh = -S.ta;
    const nwx = dx * na;
    const nwy = nh;
    const nwz = dz * na;
    const wx = px * ct + nwx * st;
    const wy = nwy * st;
    const wz = pz * ct + nwz * st;
    const wander = piece.wander * Math.sin(s * 0.021 + piece.seed);
    const cx = ox + dx * S.a + px * wander;
    const cyy = S.h;
    const cz = oz + dz * S.a + pz * wander;
    const freeEnd = strip ? smooth(0, 60, env.exitS - s) : 1;
    const cup = piece.cup * freeEnd;
    for (let c = 0; c < 13; c += 1) {
      const u = c / 12;
      const lat = (u - 0.5) * 80;
      const q = (u - 0.5) * 2;
      const lift = cup * q * q;
      const o = (r * 13 + c) * 3;
      pos[o] = cx + wx * lat + nwx * lift;
      pos[o + 1] = cyy + wy * lat + nwy * lift;
      pos[o + 2] = cz + wz * lat + nwz * lift;
      const pp = (r * 13 + c) * 2;
      pap[pp] = u;
      pap[pp + 1] = s;
    }
  }
  for (let r = 0; r < rows; r += 1) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(rows - 1, r + 1);
    for (let c = 0; c < 13; c += 1) {
      const c0 = Math.max(0, c - 1);
      const c1 = Math.min(12, c + 1);
      const a0 = (r0 * 13 + c) * 3;
      const a1 = (r1 * 13 + c) * 3;
      const b0 = (r * 13 + c0) * 3;
      const b1 = (r * 13 + c1) * 3;
      const sx = pos[a1] - pos[a0];
      const sy2 = pos[a1 + 1] - pos[a0 + 1];
      const sz = pos[a1 + 2] - pos[a0 + 2];
      const ux = pos[b1] - pos[b0];
      const uy = pos[b1 + 1] - pos[b0 + 1];
      const uz = pos[b1 + 2] - pos[b0 + 2];
      let nx = sy2 * uz - sz * uy;
      let ny = sz * ux - sx * uz;
      let nz = sx * uy - sy2 * ux;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (r * 13 + c) * 3;
      nor[o] = nx;
      nor[o + 1] = ny;
      nor[o + 2] = nz;
    }
  }
  view.rows = rows;
  view.geometry.setDrawRange(0, (rows - 1) * 12 * 6);
  view.geometry.attributes.position.needsUpdate = true;
  view.geometry.attributes.normal.needsUpdate = true;
  view.geometry.attributes.paper.needsUpdate = true;
  view.geometry.computeBoundingSphere();
}

export function tearProfile(base, slant, seed) {
  const edge = new Float32Array(EDGE_N);
  const pitch = 2.6;
  for (let i = 0; i < EDGE_N; i += 1) {
    const u = i / (EDGE_N - 1);
    const x = u * WIDTH;
    const phase = (x / pitch + hash(seed) * 3) % 1;
    const tooth = Math.abs(phase - 0.5) * 2;
    const fibre = (hash(seed * 1.7 + i * 3.1) - 0.5) * 0.55;
    const wobble = Math.sin(x * 0.09 + seed) * 0.45 + Math.sin(x * 0.23 + seed * 2.3) * 0.2;
    edge[i] = base + Math.tan(slant) * (x - WIDTH / 2) + tooth * 0.75 + fibre + wobble;
  }
  return edge;
}

export function straightProfile(base) {
  return new Float32Array(EDGE_N).fill(base);
}
