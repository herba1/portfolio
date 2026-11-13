// Cloth for Sentaku: every garment cut out of the photograph is a sheet of
// position-based cloth (XPBD, "small steps": many substeps, one projection
// each, Macklin et al. 2019), hanging from the clothesline by its pegs.
//
// One world, metres: X along the line, Y up, Z level and away from the camera
// (the camera is below the line, looking up past it). A vertex's rest place
// is its pixel in the photograph read as X = u / PX, Y = -v / PX, Z = 0: the
// garments hang in the line's vertical plane. Drawing maps a vertex's
// displacement from that rest back onto the photograph (project()), so with
// no wind the frame is the photograph to the pixel.
//
// The photograph is the equilibrium: there weight and tension balance, and
// away from it weight pulls each vertex back as it would a pendulum the
// length of the cloth's hang below its pegs (g / hang per metre). Without
// that, a drape read off a flat photograph is in compression and buckles.
//
// Forces: that restoring weight, and the wind as a pressure on each triangle, the
// normal component of the relative air speed squared (0.5 rho Cd A (v.n)|v.n|),
// plus a little skin friction along it. That alone makes cloth billow,
// flutter and lift toward the angle where the push and its weight balance.
//
// The line is not rigid. Its sag plane swings about the chord like a
// pendulum, toward atan(lateral load / weight), and sags a little deeper
// under the wind's downward share; a second, antisymmetric mode lets the
// two halves disagree. The pegged vertices ride on it.

export const PX = 700; // image px per metre, across and down the hanging plane
// The lens is below the line and in front of it, along CAM (about 40 degrees
// under the level). The photograph's vertical is already foreshortened by
// that slant (cos 40), so a metre of level motion away from the camera reads
// as PX * 0.64 / 0.77 px down the frame. Taken any smaller, a skirt swinging
// away and up, towards square-on to the lens, would read as shrinking into a
// stub when it really opens out to its full length.
const LOOK = [0.64, 0.77]; // sin and cos of the camera's slant under the line
const SZ = (PX * LOOK[0]) / LOOK[1]; // image px per metre of Z: level motion away from the camera reads as down
const CZ = LOOK[1]; // depth change per metre of Z ...
const CY = LOOK[0]; // ... and of Y (the camera looks up, so up is further)
const DIST = 3.0; // metres from the lens to the line
const G = 9.81;
const RHO = 1.2;
const CD = 1.15;
const CT = 0.04;
const SUB = 10; // substeps per 1/60 s
export const PHANTOM = 4; // cells simulated past the frame edge
const BEND = 4e-5; // compliance across two cells
const BEND4 = 4e-4; // and across four
// A heavier, doubled cotton top does not crease like the sheer dress: its
// bending compliance is scaled down, and it gets bending across the
// diagonals too, so a full gust cannot fold its hem up into a sliver.
const STIFF = { bw: 0.08 };
// How far a garment may yaw (turn about the vertical, edge-on to the lens)
// before its own width resists: past this the projection pulls it back. The
// narrow top, pegged at one corner, would otherwise spin edge-on to a sliver,
// and a gust turning the whole dress past this wrings it into a tube.
const YAW_MAX = { bw: 0.45, dress: 0.32, other: 0.42 }; // rad
// Across. A garment is cloth with air in it, not a printed sheet twisted
// about its long axis: seen from the lens, each row can open out (billow)
// but never draws in below ACROSS of its width in the photograph. One-sided
// links along every row, between neighbours and across two cells, push a
// pair back apart, along the line the lens sees between them, wherever its
// projected length (perspective and the slant of the view included) would
// close past that. A row may still swing round in the frame; it may not be
// wrung edge-on.
const ACROSS = 0.86;
// ... and a row may not turn past the line through its left end along the
// rest normal (straight down the frame): the right end stays at least
// ROW_MIN of its rest run to the right, or the pair, once crossed, would be
// pushed further apart the wrong way and the row would be printed mirrored.
const ROW_MIN = 0.3;
// Down. The same along every column, from the pegs to the hem: as the lens
// sees it, each vertex stays at least DOWN of its rest run below the one
// above it (and the one two above). Cloth lifted toward the lens
// foreshortens, but a hem can never come up past the cloth above it and
// fold over it into a shelf, its underside showing as a flat band.
const DOWN = 0.32;
// And no vertex strays further from where it hangs than REACH of its hang
// below the pegs: a pendulum that long, swung about 40 degrees. Past that
// the gust is folding the cloth through itself, not lifting it.
const REACH = 0.7;
// Billow. A skirt is not a flat sheet: the photograph shows it gathered into
// folds, a cone pressed flat. A gust fills it, and filled it opens. Each
// garment's lower part (from about its waist to its hem, not its narrow ties)
// is let out across as the air in it rises: its pull back to the photograph
// fans out about its middle by up to FLARE of its half width at the hem, and
// its cloth is let out further than that (FLARE * EXCESS), so the hem has
// more length than the bell needs and buckles into the waves of a real hem:
// only the short links (stretch, shear) take the excess; the long bending
// links, the chords of a wave four cells long, open only as far as the bell,
// so the cloth between them has to arc out of the plane to fit.
// The air caught inside pushes the middle of the skirt out more than its
// edges (BELLY, in g at the hem), so it bellies and its sides curl back.
// And it holds the skirt open as the gust carries it away from the lens:
// the opening grows with the skirt's mean distance (A.far, against the
// photograph's), so a filled skirt carried off does not shrink into a tube
// in perspective while it swings toward square-on and lengthens.
const BILLOW = { dress: 1, red: 0.3, floral: 0.4, bw: 0.4 }; // how full each garment is
const FLARE = 0.25;
const EXCESS = 1.3;
const BELLY = 0.45;
// The air caught in a skirt is a pressure, not a push: it acts along each
// triangle's normal, out toward the lens, in proportion to how much air the
// garment holds and how deep into its skirt the triangle is (its belly most,
// its fill some). Flat, it bellies the middle out; once curved, the normals
// at the sides turn outward and the same pressure spreads it across, so a
// filled skirt widens as it streams downwind instead of being wrung narrow.
// PRESS is in g on the cloth's own weight at full fill.
const PRESS = 3;
const SPREAD = 0.6; // and a share pushed downwind along the skirt's width
// The free side edge downwind is the least held part of a garment, and the
// air peeling off it sheds eddies down it: it flutters and curls while the
// rest leans. A travelling wave of pressure along the edge's normal, with a
// bias that rolls it toward the lens, strongest at the hem's corner and
// with the air across it, rolling it in. Across its two outermost cells the
// row may close further (EDGE_ACROSS), as a rolled edge does.
const FLUTTER = 6; // in g, at the hem's corner in a full gust
const FLUTTER_L = 0.26; // m, the wave's length down the edge
const FLUTTER_F = 1.7; // Hz
const EDGE_ACROSS = 0.6;
const EDGE_SOFT = 10;
const WAIST = { dress: 0.36, other: 0.22 }; // share of the hang above where it opens
const FILL = [0.3, 0.9]; // s for the air to fill a skirt, and to leave it

export const ROPE = { left: -320, right: 1760, sag: 0.11 };

export function project(u0, v0, dx, dy, dz, cu, cv, out, o) {
  const u1 = u0 + PX * dx;
  const v1 = v0 - PX * dy + SZ * dz;
  const depth = Math.max(-0.3 * DIST, CZ * dz + CY * dy);
  const k = DIST / (DIST + depth);
  out[o] = cu + (u1 - cu) * k;
  out[o + 1] = cv + (v1 - cv) * k;
}

const LENS = [0, -LOOK[0], -LOOK[1]]; // from the cloth toward the lens

export function createCloth(meta, { density = 0.32 } = {}) {
  const { cell: CELL, rope } = meta;
  const ropeY = (u) => rope.poly[0] * u * u + rope.poly[1] * u + rope.poly[2];
  const garments = [];
  let nv = 0;
  // count first so all garments share flat arrays
  const plans = meta.garments.map((g) => {
    // A garment the frame cuts off goes on past it: its unseen part is
    // simulated too, or the visible strip would flap like a ribbon, and drawn
    // too (textured by mirroring the band inside the edge), so when it swings
    // inward the cloth carries on instead of showing the crop. The phantom
    // cells copy the last full column at that edge.
    const IW = meta.size[0];
    const [bx0, gy0, nx0, ny] = g.grid;
    const padL = bx0 <= 0 ? PHANTOM : 0;
    const padR = bx0 + nx0 * CELL >= IW - 1 ? PHANTOM : 0;
    const nx = nx0 + padL + padR;
    const gx0 = bx0 - padL * CELL;
    const cov = new Float32Array(nx * ny);
    const act = new Uint8Array(nx * ny);
    const read = (i, j) => {
      const ch = g.cov[j][i];
      return ch === "." ? 0 : Math.max(0.02, (ch.charCodeAt(0) - 48) / 74);
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const i0 = i - padL;
        let c;
        if (i0 < 0) c = read(0, j) > 0 ? read(Math.min(1, nx0 - 1), j) : 0;
        else if (i0 >= nx0) c = read(nx0 - 1, j) > 0 ? read(Math.max(0, nx0 - 2), j) : 0;
        else c = read(i0, j);
        if (c <= 0) continue;
        act[j * nx + i] = 1;
        cov[j * nx + i] = c;
      }
    }
    const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const c = (a, b) => a >= 0 && b >= 0 && a < nx && b < ny && act[b * nx + a];
        if (c(i - 1, j - 1) || c(i, j - 1) || c(i - 1, j) || c(i, j)) vid[j * (nx + 1) + i] = nv++;
      }
    return { g, gx0, gy0, nx, ny, cov, act, vid, padL, padR };
  });

  const N = nv;
  const rest = new Float32Array(N * 2); // image px
  const x = new Float32Array(N * 3);
  const p = new Float32Array(N * 3);
  const v = new Float32Array(N * 3);
  const x0 = new Float32Array(N * 3); // settled reference
  const w = new Float32Array(N); // inverse mass
  const mass = new Float32Array(N);
  const pinS = new Float32Array(N).fill(-1); // rope parameter of a pegged vertex
  const nrm = new Float32Array(N * 3);
  const nrm0 = new Float32Array(N * 3);
  const gid = new Uint8Array(N);
  const cons = []; // [a, b, rest, compliance]
  const across = []; // [a, b]: b right of a on the same row
  const down = []; // [a, b]: b below a in the same column
  const tris = []; // [a, b, c, area * coverage]

  for (const pl of plans) {
    const { g, gx0, gy0, nx, ny, cov, act, vid } = pl;
    // pom-poms are wool balls, not sheets: heavy, and a sphere's drag is a
    // fraction of a flat panel's, so they swing on their cords and do not tilt
    const pom = g.name === "pom";
    const dens = density * (pom ? 7 : 1);
    const stiff = STIFF[g.name] ?? 1;
    const bend = BEND * stiff, bend4 = BEND4 * stiff;
    const sail = pom ? 0.2 : 1;
    const at = (i, j) => (i < 0 || j < 0 || i > nx || j > ny ? -1 : vid[j * (nx + 1) + i]);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const k = at(i, j);
        if (k < 0) continue;
        const u = gx0 + i * CELL;
        const vv = gy0 + j * CELL;
        rest[k * 2] = u;
        rest[k * 2 + 1] = vv;
        x[k * 3] = u / PX;
        x[k * 3 + 1] = -vv / PX;
        x[k * 3 + 2] = 0;
        gid[k] = g.id;
      }
    const cellArea = (CELL / PX) ** 2;
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!act[j * nx + i]) continue;
        const c = Math.max(0.02, cov[j * nx + i]);
        const a = at(i, j), b = at(i + 1, j), cc = at(i, j + 1), d = at(i + 1, j + 1);
        const m4 = (dens * cellArea * Math.max(0.3, c)) / 4;
        mass[a] += m4; mass[b] += m4; mass[cc] += m4; mass[d] += m4;
        // alternate the diagonal so the sheet has no grain
        if ((i + j) & 1) {
          tris.push([a, b, d, (cellArea / 2) * c * sail], [a, d, cc, (cellArea / 2) * c * sail]);
        } else {
          tris.push([a, b, cc, (cellArea / 2) * c * sail], [b, d, cc, (cellArea / 2) * c * sail]);
        }
      }
    const len = (a, b) => Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1]);
    const add = (a, b, comp) => {
      if (a >= 0 && b >= 0) cons.push([a, b, len(a, b), comp]);
    };
    const cellOn = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && act[j * nx + i];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        // stretch: the edges of active cells, nearly inextensible
        if (cellOn(i, j) || cellOn(i, j - 1)) add(at(i, j), at(i + 1, j), 2e-7);
        if (cellOn(i, j) || cellOn(i - 1, j)) add(at(i, j), at(i, j + 1), 2e-7);
        // shear: both diagonals
        if (cellOn(i, j)) {
          add(at(i, j), at(i + 1, j + 1), 4e-6);
          add(at(i + 1, j), at(i, j + 1), 4e-6);
        }
        // bending: across two cells, soft, so it folds rather than creases
        if (cellOn(i, j) && cellOn(i + 1, j)) add(at(i, j), at(i + 2, j), bend);
        if (cellOn(i, j) && cellOn(i, j + 1)) add(at(i, j), at(i, j + 2), bend);
        if (stiff < 1 && cellOn(i, j) && cellOn(i + 1, j + 1)) add(at(i, j), at(i + 2, j + 2), bend);
        if (stiff < 1 && cellOn(i + 1, j) && cellOn(i, j + 1)) add(at(i + 2, j), at(i, j + 2), bend);
        // across: one-sided, along the row, to the next vertex and across two
        if (!pom && (cellOn(i, j) || cellOn(i, j - 1))) {
          if (at(i, j) >= 0 && at(i + 1, j) >= 0) across.push(at(i, j), at(i + 1, j));
          if ((cellOn(i + 1, j) || cellOn(i + 1, j - 1)) && at(i, j) >= 0 && at(i + 2, j) >= 0) across.push(at(i, j), at(i + 2, j));
        }
        // down: one-sided, along the column, to the next vertex and two down
        if (!pom && (cellOn(i, j) || cellOn(i - 1, j))) {
          if (at(i, j) >= 0 && at(i, j + 1) >= 0) down.push(at(i, j), at(i, j + 1));
          if ((cellOn(i, j + 1) || cellOn(i - 1, j + 1)) && at(i, j) >= 0 && at(i, j + 2) >= 0) down.push(at(i, j), at(i, j + 2));
        }
        // and across four, so folds come at the scale of fabric, not of the grid
        if (cellOn(i, j) && cellOn(i + 1, j) && cellOn(i + 2, j) && cellOn(i + 3, j)) add(at(i, j), at(i + 4, j), bend4);
        if (cellOn(i, j) && cellOn(i, j + 1) && cellOn(i, j + 2) && cellOn(i, j + 3)) add(at(i, j), at(i, j + 4), bend4);
      }
    // pegs: the vertices of the cloth's top band that touch the line
    let pinned = 0;
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const k = at(i, j);
        if (k < 0) continue;
        const u = rest[k * 2];
        const dv = rest[k * 2 + 1] - ropeY(u);
        if (dv > -CELL * 0.9 && dv < CELL * 0.75 && u > -40 - PHANTOM * CELL && u < meta.size[0] + 40 + PHANTOM * CELL) {
          // only where the cut-out itself reaches the line (a filled cell either side)
          const ci = Math.min(nx - 1, i), cj = Math.min(ny - 1, j);
          const near = [cellOn(ci, cj), cellOn(ci - 1, cj), cellOn(ci, cj - 1), cellOn(ci - 1, cj - 1)];
          const ok = near.some(Boolean) && Math.max(...[[ci, cj], [ci - 1, cj], [ci, cj - 1], [ci - 1, cj - 1]].map(([a, b]) => (cellOn(a, b) ? cov[b * nx + a] : 0))) > 0.25;
          if (ok) {
            pinS[k] = (u - ROPE.left) / (ROPE.right - ROPE.left);
            pinned++;
          }
        }
      }
    // a garment cut by the frame edge keeps hanging: if nothing reached the
    // line, peg its top row
    if (!pinned) {
      let top = Infinity;
      for (let k = 0; k < N; k++) if (gid[k] === g.id) top = Math.min(top, rest[k * 2 + 1]);
      for (let k = 0; k < N; k++)
        if (gid[k] === g.id && rest[k * 2 + 1] <= top + 0.1) pinS[k] = (rest[k * 2] - ROPE.left) / (ROPE.right - ROPE.left);
    }
    garments.push({ ...g, plan: pl });
  }
  for (let k = 0; k < N; k++) {
    mass[k] = Math.max(mass[k], density * (CELL / PX) ** 2 * 0.05);
    w[k] = pinS[k] >= 0 ? 0 : 1 / mass[k];
  }
  const C = new Float32Array(cons.length * 4);
  cons.forEach((c, i) => C.set(c, i * 4));
  const T = new Float32Array(tris.length * 4);
  tris.forEach((t, i) => T.set(t, i * 4));
  const nT = tris.length;
  const triWind = new Float32Array(nT * 3);

  // ---- the line
  const line = { th: 0, om: 0, m2: 0, o2: 0, sag: 1, fz: 0, fz2: 0, fy: 0 };
  let weight = 0;
  for (let k = 0; k < N; k++) weight += mass[k] * G;
  weight += 0.35 * G; // the rope and pegs
  const W0 = 2 * Math.PI * 1.15; // the line's swing, ~1.15 Hz
  const ropeDisp = (s, out) => {
    const shape = 4 * s * (1 - s);
    const S = ROPE.sag * line.sag * shape;
    const s2 = Math.sin(2 * Math.PI * s) * 0.045 * line.m2;
    out[0] = 0;
    out[1] = S * (1 - Math.cos(line.th));
    out[2] = S * Math.sin(line.th) + s2;
    return out;
  };
  const tmp = [0, 0, 0];
  const placePins = (arr) => {
    for (let k = 0; k < N; k++) {
      if (pinS[k] < 0) continue;
      ropeDisp(pinS[k], tmp);
      arr[k * 3] = x0[k * 3] + tmp[0];
      arr[k * 3 + 1] = x0[k * 3 + 1] + tmp[1];
      arr[k * 3 + 2] = x0[k * 3 + 2] + tmp[2];
    }
  };
  x0.set(x);
  // where each vertex hangs in the photograph, and how far below its pegs
  const xr = Float32Array.from(x);
  const K = new Float32Array(N);
  const reach = new Float32Array(N); // REACH of the hang, m
  const nearS = new Float32Array(N).fill(0.5);
  {
    const pins = [];
    for (let k = 0; k < N; k++) if (pinS[k] >= 0) pins.push(k);
    for (let k = 0; k < N; k++) {
      let hang = Infinity;
      for (const q of pins) {
        if (gid[q] !== gid[k]) continue;
        const d = Math.hypot(x[k * 3] - x[q * 3], x[k * 3 + 1] - x[q * 3 + 1]);
        if (d < hang) {
          hang = d;
          nearS[k] = pinS[q];
        }
      }
      const h = Math.max(0.12, Number.isFinite(hang) ? hang : 0.5);
      K[k] = G / h;
      reach[k] = REACH * h;
    }
  }
  // per garment, the free vertices and their rest offset across the garment,
  // for the yaw limit
  const yawGroups = [];
  for (const gm of garments) {
    if (gm.name === "pom") continue;
    const ks = [];
    let mx = 0;
    for (let k = 0; k < N; k++)
      if (gid[k] === gm.id && w[k] > 0) {
        ks.push(k);
        mx += xr[k * 3];
      }
    if (ks.length < 4) continue;
    mx /= ks.length;
    const ix = Int32Array.from(ks);
    const dx = Float32Array.from(ks, (k) => xr[k * 3] - mx);
    let vx = 0;
    for (const d of dx) vx += d * d;
    yawGroups.push({ ix, dx, vx: vx || 1, tmax: Math.tan(YAW_MAX[gm.name] ?? YAW_MAX.other) });
  }
  const limitYaw = () => {
    for (const { ix, dx, vx, tmax } of yawGroups) {
      // the garment's turn about the vertical: depth against rest x
      let s = 0;
      for (let n = 0; n < ix.length; n++) s += (p[ix[n] * 3 + 2] - xt[ix[n] * 3 + 2]) * dx[n];
      s /= vx;
      const over = s > tmax ? s - tmax : s < -tmax ? s + tmax : 0;
      if (!over) continue;
      for (let n = 0; n < ix.length; n++) p[ix[n] * 3 + 2] -= 0.5 * over * dx[n];
    }
  };

  // the side edges: each row's three outermost free vertices on either side
  // (fully, 0.6, 0.3), which side, and how far down the garment they are
  const edgeW = new Float32Array(N);
  const edgeS = new Int8Array(N);
  const edgeO = new Uint8Array(N); // the outermost
  for (const gm of garments) {
    if (gm.name === "pom") continue;
    const rows = new Map();
    for (let k = 0; k < N; k++) {
      if (gid[k] !== gm.id) continue;
      const r = Math.round(rest[k * 2 + 1]);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(k);
    }
    const ys = [...rows.keys()];
    const top = Math.min(...ys), bot = Math.max(...ys);
    for (const [r, ks] of rows) {
      if (ks.length < 6) continue;
      // nothing at the pegs, all of it from about two thirds of the way down
      const dn = Math.min(1, Math.max(0, ((r - top) / Math.max(1, bot - top) - 0.15) / 0.5));
      const down = dn * dn * (3 - 2 * dn);
      ks.sort((a, b) => xr[a * 3] - xr[b * 3]);
      for (const [k, wgt, side] of [[ks[0], 1, -1], [ks[1], 0.6, -1], [ks[2], 0.3, -1], [ks.at(-1), 1, 1], [ks.at(-2), 0.6, 1], [ks.at(-3), 0.3, 1]]) {
        if (w[k] === 0) continue;
        edgeW[k] = wgt * down;
        edgeS[k] = side;
        edgeO[k] = wgt > 0.5 ? 1 : 0;
      }
    }
  }
  // and the edge bends easily: its bending links (not its stretch or shear)
  // are let go EDGE_SOFT times, so it can roll rather than flap as a board
  for (let c = 0; c < cons.length; c++) {
    const a = C[c * 4] | 0, b = C[c * 4 + 1] | 0;
    if (C[c * 4 + 3] >= 1e-5 && (edgeO[a] || edgeO[b]) && edgeW[a] + edgeW[b] > 0) C[c * 4 + 3] *= EDGE_SOFT;
  }
  const AC = Int32Array.from(across);
  // rest length along the row, image px, for each across pair
  const ACr = Float32Array.from({ length: AC.length / 2 }, (_, n) => Math.abs(rest[AC[2 * n + 1] * 2] - rest[AC[2 * n] * 2]));
  const SY = SZ / PX;
  const openRows = () => {
    for (let n = 0; n < AC.length; n += 2) {
      const a = AC[n], b = AC[n + 1];
      const wa = w[a], wb = w[b];
      if (wa + wb === 0) continue;
      const ia = a * 3, ib = b * 3;
      // the pair as the lens sees it now: X across, and Y and Z both read
      // as down the frame; the photograph's offsets are the rest
      const depth = 0.5 * (CZ * (p[ia + 2] - x0[ia + 2] + p[ib + 2] - x0[ib + 2]) + CY * (p[ia + 1] - x0[ia + 1] + p[ib + 1] - x0[ib + 1]));
      const kp = DIST / (DIST + Math.max(-0.3 * DIST, depth));
      const sx = kp * (rest[b * 2] - rest[a * 2] + PX * (p[ib] - x0[ib] - p[ia] + x0[ia]));
      const sy = kp * (rest[b * 2 + 1] - rest[a * 2 + 1] + PX * (-(p[ib + 1] - x0[ib + 1] - p[ia + 1] + x0[ia + 1]) + SY * (p[ib + 2] - x0[ib + 2] - p[ia + 2] + x0[ia + 2])));
      const d = Math.hypot(sx, sy);
      // the two outermost columns of either side may roll in further
      const rolled = (edgeO[a] && edgeS[a] < 0) || (edgeO[b] && edgeS[b] > 0);
      const r = ACr[n >> 1];
      const need = (rolled ? EDGE_ACROSS : ACROSS) * r;
      const minX = (rolled ? 0.5 : 1) * ROW_MIN * r;
      let ux, uy, short;
      if (sx < minX) {
        // turned past the rest normal (or about to): push b back across
        // along the row's rest direction, not along the seen one
        ux = 1; uy = 0; short = minX - sx + Math.max(0, need - d);
      } else if (d < need) {
        // closed: push b from a along the seen direction
        ux = sx / d; uy = sy / d; short = need - d;
      } else continue;
      const gx = kp * PX * ux, gy = -kp * PX * uy, gz = kp * PX * SY * uy;
      const g2 = gx * gx + gy * gy + gz * gz;
      const c = short / ((wa + wb) * g2);
      p[ia] -= c * wa * gx; p[ia + 1] -= c * wa * gy; p[ia + 2] -= c * wa * gz;
      p[ib] += c * wb * gx; p[ib + 1] += c * wb * gy; p[ib + 2] += c * wb * gz;
    }
  };
  const DC = Int32Array.from(down);
  // rest run down the frame, image px, for each down pair
  const DCr = Float32Array.from({ length: DC.length / 2 }, (_, n) => rest[DC[2 * n + 1] * 2 + 1] - rest[DC[2 * n] * 2 + 1]);
  const holdColumns = () => {
    for (let n = 0; n < DC.length; n += 2) {
      const a = DC[n], b = DC[n + 1];
      if (w[b] === 0) continue;
      const ia = a * 3, ib = b * 3;
      const depth = 0.5 * (CZ * (p[ia + 2] - x0[ia + 2] + p[ib + 2] - x0[ib + 2]) + CY * (p[ia + 1] - x0[ia + 1] + p[ib + 1] - x0[ib + 1]));
      const kp = DIST / (DIST + Math.max(-0.3 * DIST, depth));
      // how far b sits below a as the lens sees it
      const sy = kp * (DCr[n >> 1] + PX * (-(p[ib + 1] - x0[ib + 1] - p[ia + 1] + x0[ia + 1]) + SY * (p[ib + 2] - x0[ib + 2] - p[ia + 2] + x0[ia + 2])));
      const need = DOWN * kp * DCr[n >> 1];
      if (sy >= need) continue;
      // push b down the frame from a (down and away, in world units). The
      // cloth above is held from the pegs, so b moves, not a: pushing a back
      // up toward the lens would hoist the whole skirt by its hem.
      const gy = -kp * PX, gz = kp * PX * SY;
      const c = (need - sy) / (gy * gy + gz * gz);
      p[ib + 1] += c * gy; p[ib + 2] += c * gz;
    }
  };
  // no vertex further from where it hangs than its reach
  const clampReach = () => {
    for (let k = 0; k < N; k++) {
      if (w[k] === 0) continue;
      const i = k * 3;
      const dx = p[i] - xt[i], dy = p[i + 1] - xt[i + 1], dz = p[i + 2] - xt[i + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d <= reach[k]) continue;
      const s = reach[k] / d;
      p[i] = xt[i] + dx * s; p[i + 1] = xt[i + 1] + dy * s; p[i + 2] = xt[i + 2] + dz * s;
    }
  };

  // ---- billow: per garment, how far down each vertex is into its skirt
  // (0 above the waist, 1 at the hem), its place across it (-1..1), and the
  // middle it opens about
  const fill = new Float32Array(N); // the flare weight, garment's fullness included
  const belly = new Float32Array(N); // the same, most in the middle across
  const mid = new Float32Array(N); // the garment's middle, world X
  const gIndex = new Uint8Array(N);
  const air = garments.map(() => ({ now: 0, dir: [0, 0, 1], far: 1 }));
  garments.forEach((gm, gi) => {
    const amt = BILLOW[gm.name] ?? 0;
    const ks = [];
    for (let k = 0; k < N; k++) if (gid[k] === gm.id) ks.push(k);
    for (const k of ks) gIndex[k] = gi;
    if (!amt || !ks.length) return;
    // rows, and how wide the garment is on each: a narrow tie below the hem
    // does not open
    const rows = new Map();
    for (const k of ks) {
      const r = Math.round(rest[k * 2 + 1]);
      const e = rows.get(r) ?? [Infinity, -Infinity];
      e[0] = Math.min(e[0], xr[k * 3]);
      e[1] = Math.max(e[1], xr[k * 3]);
      rows.set(r, e);
    }
    let wMax = 0, top = Infinity, bot = -Infinity;
    for (const [r, [a, b]] of rows) {
      wMax = Math.max(wMax, b - a);
      top = Math.min(top, r);
    }
    for (const [r, [a, b]] of rows) if (b - a > 0.3 * wMax) bot = Math.max(bot, r);
    const waist = top + (WAIST[gm.name] ?? WAIST.other) * (bot - top);
    let cx = 0;
    for (const k of ks) cx += xr[k * 3];
    cx /= ks.length;
    for (const k of ks) {
      const r = Math.round(rest[k * 2 + 1]);
      const [a, b] = rows.get(r);
      if (b - a < 0.3 * wMax || w[k] === 0) continue;
      const d = Math.min(1, Math.max(0, (rest[k * 2 + 1] - waist) / Math.max(1, bot - waist)));
      const f = d * d * (3 - 2 * d);
      const across = Math.min(1, Math.abs(xr[k * 3] - (a + b) / 2) / Math.max(1e-3, (b - a) / 2));
      fill[k] = amt * f;
      belly[k] = amt * f * (1 - across * across);
      mid[k] = cx;
    }
  });
  // the stretch, shear and bend links that cross the skirt, with their rest
  // run across and down, so they can be let out across only
  const loose = [];
  for (let c = 0; c < cons.length; c++) {
    const a = C[c * 4] | 0, b = C[c * 4 + 1] | 0;
    const f = 0.5 * (fill[a] + fill[b]);
    if (f < 1e-3) continue;
    const dx = xr[a * 3] - xr[b * 3], dy = xr[a * 3 + 1] - xr[b * 3 + 1];
    if (Math.abs(dx) < 1e-6) continue;
    // cells across: 1 a stretch or shear link, 2 and 4 the bending chords
    const n = Math.abs(dx) * PX / CELL;
    const ex = n < 1.5 ? EXCESS : n < 2.5 ? 0.5 + 0.5 * EXCESS : 1;
    loose.push(c, dx, dy, f * ex);
  }
  const L = Float32Array.from(loose);
  // each triangle's share of the skirt's pressure, and which side of the
  // garment's middle it hangs (for the downwind spread)
  const triP = new Float32Array(nT);
  const triSide = new Float32Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 4] | 0, b = T[t * 4 + 1] | 0, c = T[t * 4 + 2] | 0;
    triP[t] = (0.7 * (belly[a] + belly[b] + belly[c]) + 0.3 * (fill[a] + fill[b] + fill[c])) / 3;
    const cx = (xr[a * 3] + xr[b * 3] + xr[c * 3]) / 3;
    triSide[t] = triP[t] ? cx - mid[a] : 0;
  }
  // the air in each garment rises with the wind on it and leaves more slowly
  const fillAir = (dt) => {
    const sum = garments.map(() => [0, 0, 0, 0]);
    for (let t = 0; t < nT; t++) {
      const g = sum[gIndex[T[t * 4] | 0]];
      const ar = T[t * 4 + 3];
      g[0] += triWind[t * 3] * ar;
      g[1] += triWind[t * 3 + 1] * ar;
      g[2] += triWind[t * 3 + 2] * ar;
      g[3] += ar;
    }
    air.forEach((A, gi) => {
      const [sx, sy, sz, sa] = sum[gi];
      if (!sa) return;
      const wx = sx / sa, wy = sy / sa, wz = sz / sa;
      const sp = Math.hypot(wx, wy, wz) || 1;
      // the push into the cloth's face (Z at rest) fills it
      const e = Math.min(1, Math.max(0, (wz - 0.7) / 2.3));
      const target = e * e * (3 - 2 * e);
      const tau = target > A.now ? FILL[0] : FILL[1];
      A.now += (target - A.now) * (1 - Math.exp(-dt / tau));
      A.dir = [wx / sp, Math.max(0.25, wy / sp + 0.3), wz / sp];
      const dl = Math.hypot(...A.dir);
      A.dir = A.dir.map((q) => q / dl);
    });
    // how far the filled skirt has been carried from the lens: in
    // perspective that would shrink it, though it is opening
    const dep = garments.map(() => [0, 0]);
    for (let k = 0; k < N; k++) {
      if (!fill[k]) continue;
      const i = k * 3;
      const d = dep[gIndex[k]];
      d[0] += fill[k] * (CZ * (x[i + 2] - x0[i + 2]) + CY * (x[i + 1] - x0[i + 1]));
      d[1] += fill[k];
    }
    air.forEach((A, gi) => {
      const [sd, sw] = dep[gi];
      A.far = sw ? Math.min(1.35, (DIST + Math.max(0, sd / sw)) / DIST) : 1;
    });
    for (let n = 0; n < L.length; n += 4) {
      const c = L[n] | 0;
      const A = air[gIndex[C[c * 4] | 0]];
      const f = L[n + 3];
      C[c * 4 + 2] = Math.hypot(L[n + 1] * (1 + FLARE * A.now * f) * (1 + (A.far - 1) * A.now * Math.min(1, f)), L[n + 2]);
    }
  };

  // ... and that place rides with the line as it swings, and opens out
  // across the skirt as it fills
  const xt = Float32Array.from(xr);
  const followLine = () => {
    for (let k = 0; k < N; k++) {
      ropeDisp(nearS[k], tmp);
      const A = air[gIndex[k]];
      const open = fill[k] ? (1 + FLARE * A.now * fill[k]) * (1 + (A.far - 1) * A.now * fill[k]) : 1;
      xt[k * 3] = mid[k] + (xr[k * 3] - mid[k]) * open + tmp[0];
      xt[k * 3 + 1] = xr[k * 3 + 1] + tmp[1];
      xt[k * 3 + 2] = xr[k * 3 + 2] + tmp[2];
    }
  };

  // ---- one substep
  const lambdaFree = true;
  let clock = 0;
  const substep = (dt, windAt) => {
    clock += dt;
    // forces: gravity + wind pressure on triangles
    const fx = p; // reuse p as force accumulator before prediction
    fx.fill(0);
    let FZ = 0, FZ2 = 0, FY = 0;
    for (let t = 0; t < nT; t++) {
      const a = T[t * 4] | 0, b = T[t * 4 + 1] | 0, c = T[t * 4 + 2] | 0, area = T[t * 4 + 3];
      const ax = x[a * 3], ay = x[a * 3 + 1], az = x[a * 3 + 2];
      const e1x = x[b * 3] - ax, e1y = x[b * 3 + 1] - ay, e1z = x[b * 3 + 2] - az;
      const e2x = x[c * 3] - ax, e2y = x[c * 3 + 1] - ay, e2z = x[c * 3 + 2] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const rx = triWind[t * 3] - (v[a * 3] + v[b * 3] + v[c * 3]) / 3;
      const ry = triWind[t * 3 + 1] - (v[a * 3 + 1] + v[b * 3 + 1] + v[c * 3 + 1]) / 3;
      const rz = triWind[t * 3 + 2] - (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3;
      const vn = rx * nx + ry * ny + rz * nz;
      const q = 0.5 * RHO * area;
      const fn = q * CD * vn * Math.abs(vn);
      const tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz;
      const tl = Math.hypot(tx, ty, tz);
      const ft = q * CT * tl;
      let Fx = (fn * nx + ft * tx) / 3, Fy = (fn * ny + ft * ty) / 3, Fz = (fn * nz + ft * tz) / 3;
      // the wind's load reaches the line; the air inside pushes on the
      // cloth all round and does not
      FZ += 3 * Fz;
      FY += 3 * Fy;
      const s = (ax * PX - ROPE.left) / (ROPE.right - ROPE.left);
      FZ2 += 3 * Fz * Math.sin(2 * Math.PI * s);
      if (triP[t]) {
        // the air inside: a pressure along the normal, out toward the lens
        const A = air[gIndex[a]];
        const P = (PRESS * G * density * area * triP[t] * A.now) / 3;
        const sgn = ny * LENS[1] + nz * LENS[2] < 0 ? -P : P;
        // the skirt streams downwind and fills on that side: its downwind
        // half is pushed out that way, its upwind half follows it, half as
        // hard, so it widens downwind rather than out over both sides
        const dw = SPREAD * A.dir[0] * P * (A.dir[0] * triSide[t] > 0 ? 1 : 0.5);
        Fx += sgn * nx + dw;
        Fy += sgn * ny;
        Fz += sgn * nz;
      }
      fx[a * 3] += Fx; fx[a * 3 + 1] += Fy; fx[a * 3 + 2] += Fz;
      fx[b * 3] += Fx; fx[b * 3 + 1] += Fy; fx[b * 3 + 2] += Fz;
      fx[c * 3] += Fx; fx[c * 3 + 1] += Fy; fx[c * 3 + 2] += Fz;
    }
    line.fz = FZ; line.fz2 = FZ2; line.fy = FY;
    // the line: a damped pendulum about its chord, toward atan(load)
    const thEq = Math.atan2(FZ, weight);
    line.om += (W0 * W0 * (thEq - line.th) - 2 * 0.16 * W0 * line.om) * dt;
    line.th += line.om * dt;
    const m2Eq = Math.max(-1, Math.min(1, FZ2 / weight));
    line.o2 += (4 * W0 * W0 * (m2Eq - line.m2) - 2 * 0.2 * 2 * W0 * line.o2) * dt;
    line.m2 += line.o2 * dt;
    const sagEq = 1 + 0.35 * Math.max(-0.5, Math.min(0.6, -FY / weight));
    line.sag += (sagEq - line.sag) * Math.min(1, dt * 6);

    // predict
    const damp = Math.exp(-0.35 * dt);
    for (let k = 0; k < N; k++) {
      const i = k * 3;
      if (w[k] === 0) continue;
      // the photographed drape is where weight and tension balance; away
      // from it, weight pulls back as it does on a pendulum of the cloth's
      // hang below its pegs (K = g / hang)
      const kk = K[k];
      // the air caught in the skirt, pushing its middle out along the wind
      let bx = 0, by = 0, bz = 0;
      if (edgeW[k]) {
        // the downwind edge's flutter, along its normal and in and out
        const A = air[gIndex[k]];
        const across = edgeS[k] * A.dir[0];
        if (across > 0.05) {
          const amp = FLUTTER * G * edgeW[k] * Math.min(1, across * 1.6) * (0.25 + 0.75 * A.now);
          const ph = 2 * Math.PI * (-xr[i + 1] / FLUTTER_L - FLUTTER_F * clock);
          const sn = Math.sin(ph) + 0.45;
          bx += amp * (sn * nrm[i] + edgeS[k] * (0.7 * Math.cos(ph) - 0.45));
          by += amp * sn * nrm[i + 1];
          bz += amp * sn * nrm[i + 2];
        }
      }
      if (belly[k]) {
        const A = air[gIndex[k]];
        const bg = BELLY * G * belly[k] * A.now;
        bx += bg * A.dir[0]; by += bg * A.dir[1]; bz += bg * A.dir[2];
      }
      v[i] = (v[i] + (fx[i] * w[k] + bx + kk * (xt[i] - x[i])) * dt) * damp;
      v[i + 1] = (v[i + 1] + (fx[i + 1] * w[k] + by + kk * (xt[i + 1] - x[i + 1])) * dt) * damp;
      v[i + 2] = (v[i + 2] + (fx[i + 2] * w[k] + bz + kk * (xt[i + 2] - x[i + 2])) * dt) * damp;
    }
    for (let k = 0; k < N * 3; k++) p[k] = x[k] + v[k] * dt;
    placePins(p);
    // project: one Gauss-Seidel sweep of the distance constraints
    const idt2 = 1 / (dt * dt);
    const nc = C.length / 4;
    for (let c = 0; c < nc; c++) {
      const a = C[c * 4] | 0, b = C[c * 4 + 1] | 0;
      const wa = w[a], wb = w[b];
      const ws = wa + wb;
      if (ws === 0) continue;
      const ia = a * 3, ib = b * 3;
      const dx = p[ia] - p[ib], dy = p[ia + 1] - p[ib + 1], dz = p[ia + 2] - p[ib + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const Cn = d - C[c * 4 + 2];
      const dl = -Cn / (ws + C[c * 4 + 3] * idt2);
      const gx = (dx / d) * dl, gy = (dy / d) * dl, gz = (dz / d) * dl;
      p[ia] += gx * wa; p[ia + 1] += gy * wa; p[ia + 2] += gz * wa;
      p[ib] -= gx * wb; p[ib + 1] -= gy * wb; p[ib + 2] -= gz * wb;
    }
    limitYaw();
    clampReach();
    holdColumns();
    openRows();
    const idt = 1 / dt;
    for (let k = 0; k < N * 3; k++) {
      v[k] = (p[k] - x[k]) * idt;
      x[k] = p[k];
    }
  };
  void lambdaFree;

  // per-triangle wind, set once a frame by the caller
  const setWind = (fn) => {
    for (let t = 0; t < nT; t++) {
      const a = T[t * 4] | 0, b = T[t * 4 + 1] | 0, c = T[t * 4 + 2] | 0;
      const cx = (x[a * 3] + x[b * 3] + x[c * 3]) / 3;
      const cy = (x[a * 3 + 1] + x[b * 3 + 1] + x[c * 3 + 1]) / 3;
      fn(cx, cy, t, triWind, t * 3);
    }
  };

  const step = (frameDt, windFn) => {
    setWind(windFn);
    fillAir(frameDt);
    followLine();
    const h = frameDt / Math.max(1, Math.round((SUB * frameDt) / (1 / 60)));
    const n = Math.max(1, Math.round(frameDt / h));
    for (let i = 0; i < n; i++) substep(h, windFn);
  };

  // settle with no wind, then call that the photograph
  const settle = (seconds) => {
    const still = (cx, cy, t, out, o) => {
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
    };
    for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60, still);
    x0.set(x);
    v.fill(0);
    for (const A of air) A.now = 0;
    line.th = line.om = line.m2 = line.o2 = 0;
    line.sag = 1;
    computeNormals(nrm0);
    viewCos(nrm0, mu0);
  };

  // vertex normals from the grid neighbours, facing the camera
  const CAM = [0, -0.64, -0.77]; // from the cloth toward the lens
  // the lens itself: DIST along CAM from the middle of the frame
  const EYE = [meta.size[0] / 2 / PX + DIST * CAM[0], -meta.size[1] / 2 / PX + DIST * CAM[1], DIST * CAM[2]];
  // The view cosine mu = |n . v|, v from the vertex toward the lens: how
  // square to the camera the cloth is there. A sheer fabric seen at a
  // grazing angle is looked through along a longer path, so its
  // transmission goes as tau^(1/mu) and its matte as 1 - (1 - a)^(1/mu).
  const mu = new Float32Array(N).fill(1);
  const mu0 = new Float32Array(N).fill(1);
  const viewCos = (n, out) => {
    for (let k = 0; k < N; k++) {
      const i = k * 3;
      const vx = EYE[0] - x[i], vy = EYE[1] - x[i + 1], vz = EYE[2] - x[i + 2];
      const vl = Math.hypot(vx, vy, vz) || 1;
      out[k] = Math.abs(n[i] * vx + n[i + 1] * vy + n[i + 2] * vz) / vl;
    }
  };
  const computeNormals = (out) => {
    for (const gm of garments) {
      const { nx, ny, vid } = gm.plan;
      const at = (i, j) => (i < 0 || j < 0 || i > nx || j > ny ? -1 : vid[j * (nx + 1) + i]);
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const k = at(i, j);
          if (k < 0) continue;
          let l = at(i - 1, j), r = at(i + 1, j), u = at(i, j - 1), d = at(i, j + 1);
          if (l < 0) l = k;
          if (r < 0) r = k;
          if (u < 0) u = k;
          if (d < 0) d = k;
          const tx = x[r * 3] - x[l * 3], ty = x[r * 3 + 1] - x[l * 3 + 1], tz = x[r * 3 + 2] - x[l * 3 + 2];
          const bx = x[d * 3] - x[u * 3], by = x[d * 3 + 1] - x[u * 3 + 1], bz = x[d * 3 + 2] - x[u * 3 + 2];
          let nx_ = ty * bz - tz * by, ny_ = tz * bx - tx * bz, nz_ = tx * by - ty * bx;
          const nl = Math.hypot(nx_, ny_, nz_);
          if (nl < 1e-9) {
            nx_ = 0; ny_ = 0; nz_ = -1;
          } else {
            nx_ /= nl; ny_ /= nl; nz_ /= nl;
          }
          if (nx_ * CAM[0] + ny_ * CAM[1] + nz_ * CAM[2] < 0) {
            nx_ = -nx_; ny_ = -ny_; nz_ = -nz_;
          }
          out[k * 3] = nx_; out[k * 3 + 1] = ny_; out[k * 3 + 2] = nz_;
        }
    }
  };

  return {
    N,
    rest,
    x,
    x0,
    nrm,
    nrm0,
    gid,
    pinS,
    garments,
    tris: T,
    nT,
    line,
    CAM,
    step,
    settle,
    ropeDisp,
    mu,
    mu0,
    computeNormals: () => {
      computeNormals(nrm);
      viewCos(nrm, mu);
    },
  };
}
