import { createStage, clamp } from "../_kit/stage";

// An invented transit diagram after Vignelli and Unimark (1972): lines only
// at 0, 45 and 90 degrees, in parallel bundles at one constant spacing.
//
// Stations live on a grid (in grid units). Every edge between two stations
// is routed octilinearly in the current geometry: a straight stub, a 45°
// run, a straight stub. Lines that share an edge are offset from its
// centreline in a fixed lane order, so bundles stay parallel; bends are arcs
// on a common centre, so the bundle turns concentrically. Dragging a station
// moves it freely; the routing keeps everything octilinear on the way. On
// release a small search puts every station back on whole grid points, in
// the cleanest octilinear layout near where the hand left it, and springs
// carry the network there.

const STATIONS = {
  A: [2, 2], B: [5, 2], C: [8, 5], D: [11, 5], E: [14, 5], F: [17, 8], G: [20, 8],
  H: [2, 8], I: [5, 8], K: [17, 2], L: [20, 2], M: [8, 1], O: [11, 8], P: [11, 11],
  Q: [2, 5], R: [5, 5], T: [20, 11], V: [14, 1], Y: [14, 8], Z: [14, 11],
  W: [2, 11], X: [5, 11], U: [8, 8],
};

// Lane order is the order here: earlier lines sit on the left of a bundle's
// canonical direction (top of a horizontal run, right of a vertical one).
const LINES = [
  { color: "#0b8a45", stops: ["M", "C", "D", "E", "K", "L"] },
  { color: "#e5352b", stops: ["A", "B", "C", "D", "E", "F", "G"] },
  { color: "#f4672a", stops: ["Q", "R", "C", "D", "E", "F", "T"] },
  { color: "#f6c207", stops: ["V", "E", "Y", "Z"] },
  { color: "#1f47a3", stops: ["H", "I", "C", "D", "O", "P"] },
  { color: "#a43a98", stops: ["W", "X", "U", "O", "Y", "F", "G"] },
];

const INK = "#111111";
const PAPER = "#ffffff";

const ids = Object.keys(STATIONS);
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function createOctilinear(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;

  // ---- topology -------------------------------------------------------
  const st = {};
  for (const id of ids) {
    const [x, y] = STATIONS[id];
    st[id] = { id, x, y, vx: 0, vy: 0, hx: x, hy: y, tx: x, ty: y, adj: new Set(), lines: [], grow: 0, release: 0 };
  }
  const edges = new Map();
  LINES.forEach((line, li) => {
    for (let i = 0; i < line.stops.length; i++) {
      const s = line.stops[i];
      if (!st[s].lines.includes(li)) st[s].lines.push(li);
      if (i === 0) continue;
      const a = line.stops[i - 1];
      st[a].adj.add(s);
      st[s].adj.add(a);
      const k = key(a, s);
      if (!edges.has(k)) {
        const [ax, ay] = STATIONS[a];
        const [bx, by] = STATIONS[s];
        const fwd = bx - ax > 0 || (bx === ax && by > ay);
        const from = fwd ? a : s;
        const to = fwd ? s : a;
        edges.set(k, { from, to, members: [], design: [STATIONS[to][0] - STATIONS[from][0], STATIONS[to][1] - STATIONS[from][1]] });
      }
      edges.get(k).members.push(li);
    }
  });
  for (const e of edges.values()) e.members.sort((p, q) => p - q);

  // ---- metrics --------------------------------------------------------
  let u = 40;
  let ox = 0;
  let oy = 0;
  let W = 7;
  let lane = 9.5;
  let R = 30;
  let bounds = [0, 0, 22, 12];
  stage.onResize((w, h) => {
    u = Math.min((w * 0.8) / 18, (h * 0.74) / 10);
    ox = w / 2 - 11 * u;
    oy = h / 2 - 6 * u;
    W = clamp(u * 0.15, 3.5, 9);
    lane = W * 1.6;
    R = Math.max(u * 0.85, lane * 2.6);
    bounds = [Math.ceil(-ox / u + 0.6), Math.ceil(-oy / u + 0.6), Math.floor((w - ox) / u - 0.6), Math.floor((h - oy) / u - 0.6)];
  });
  const X = (x) => ox + x * u;
  const Y = (y) => oy + y * u;

  // ---- routing --------------------------------------------------------
  // Centreline of one edge in px: stub, 45° run, stub.
  function route(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const d = Math.min(adx, ady);
    const half = (Math.max(adx, ady) - d) / 2;
    const pts = [[ax, ay]];
    let px = ax;
    let py = ay;
    const push = (x, y) => {
      if (Math.hypot(x - px, y - py) > 0.05) pts.push([x, y]);
      px = x;
      py = y;
    };
    if (adx >= ady) push(ax + sx * half, ay);
    else push(ax, ay + sy * half);
    push(px + sx * d, py + sy * d);
    if (Math.hypot(bx - px, by - py) > 0.05) pts.push([bx, by]);
    else if (pts.length > 1) pts[pts.length - 1] = [bx, by];
    else pts.push([bx + 0.05, by]);
    return pts;
  }

  // Build every line's offset polyline with per-vertex radii, plus where each
  // line passes each of its stations.
  function build() {
    const cl = new Map();
    for (const [k, e] of edges) {
      const a = st[e.from];
      const b = st[e.to];
      cl.set(k, route(X(a.x), Y(a.y), X(b.x), Y(b.y)));
    }
    const marks = {};
    const paths = LINES.map((line, li) => {
      const segs = [];
      for (let i = 1; i < line.stops.length; i++) {
        const a = line.stops[i - 1];
        const b = line.stops[i];
        const e = edges.get(key(a, b));
        const n = e.members.length;
        let o = (e.members.indexOf(li) - (n - 1) / 2) * lane;
        let pts = cl.get(key(a, b));
        if (e.from !== a) {
          pts = pts.slice().reverse();
          o = -o;
        }
        for (let j = 1; j < pts.length; j++) {
          const [px, py] = pts[j - 1];
          const [qx, qy] = pts[j];
          const len = Math.hypot(qx - px, qy - py) || 1e-6;
          const dx = (qx - px) / len;
          const dy = (qy - py) / len;
          segs.push({ px, py, qx, qy, dx, dy, nx: -dy, ny: dx, o, len, startStop: j === 1 ? a : null, endStop: j === pts.length - 1 ? b : null });
        }
      }
      // Vertices: {x, y, r, tan, stop}
      const vs = [];
      const s0 = segs[0];
      vs.push({ x: s0.px + s0.nx * s0.o, y: s0.py + s0.ny * s0.o, r: 0, stop: line.stops[0], end: true });
      for (let k = 0; k < segs.length - 1; k++) {
        const s1 = segs[k];
        const s2 = segs[k + 1];
        const stop = s1.endStop;
        const cross = s1.dx * s2.dy - s1.dy * s2.dx;
        const dot = s1.dx * s2.dx + s1.dy * s2.dy;
        if (Math.abs(cross) < 1e-4) {
          if (dot < 0 || Math.abs(s1.o - s2.o) < 0.01) {
            if (stop) vs.push({ x: s1.qx + s1.nx * s1.o, y: s1.qy + s1.ny * s1.o, r: 0, stop, pass: true });
            continue;
          }
          // Lane change on a straight run: a short 45° jog.
          const j = Math.abs(s2.o - s1.o) / 2;
          const a = { x: s1.qx - s1.dx * j + s1.nx * s1.o, y: s1.qy - s1.dy * j + s1.ny * s1.o, r: lane * 0.6, tan: Math.tan(Math.PI / 8) };
          const b = { x: s1.qx + s1.dx * j + s2.nx * s2.o, y: s1.qy + s1.dy * j + s2.ny * s2.o, r: lane * 0.6, tan: Math.tan(Math.PI / 8) };
          vs.push(a, b);
          if (stop) vs.push({ mark: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, stop });
          continue;
        }
        // Miter point of the two offset segments.
        const ax = s1.px + s1.nx * s1.o;
        const ay = s1.py + s1.ny * s1.o;
        const bx = s2.px + s2.nx * s2.o;
        const by = s2.py + s2.ny * s2.o;
        const t = ((bx - ax) * s2.dy - (by - ay) * s2.dx) / cross;
        const theta = Math.acos(clamp(dot, -1, 1));
        const tan = Math.tan(theta / 2);
        const rc = Math.min(R, (Math.min(s1.len, s2.len) * 0.5) / tan);
        const om = (s1.o + s2.o) / 2;
        const r = Math.max(0, cross > 0 ? rc - om : rc + om);
        vs.push({ x: ax + s1.dx * t, y: ay + s1.dy * t, r, tan, theta, d1: [s1.dx, s1.dy], d2: [s2.dx, s2.dy], stop });
      }
      const sl = segs[segs.length - 1];
      vs.push({ x: sl.qx + sl.nx * sl.o, y: sl.qy + sl.ny * sl.o, r: 0, stop: line.stops[line.stops.length - 1], end: true });

      // Clamp radii to the room on the offset segments.
      const real = vs.filter((v) => !v.mark);
      for (let i = 1; i < real.length - 1; i++) {
        const v = real[i];
        if (!v.r) continue;
        const p = real[i - 1];
        const q = real[i + 1];
        const room = Math.min(Math.hypot(v.x - p.x, v.y - p.y) * (p.r ? 0.5 : 1), Math.hypot(q.x - v.x, q.y - v.y) * (q.r ? 0.5 : 1));
        if (v.r * v.tan > room) v.r = room / v.tan;
      }
      // Where the line actually passes each station: on the arc, not the corner.
      for (const v of vs) {
        if (!v.stop) continue;
        let x = v.x;
        let y = v.y;
        if (v.d1 && v.r > 0) {
          let bx = v.d2[0] - v.d1[0];
          let by = v.d2[1] - v.d1[1];
          const bl = Math.hypot(bx, by) || 1;
          const dist = v.r / Math.cos(v.theta / 2) - v.r;
          x += (bx / bl) * dist;
          y += (by / bl) * dist;
        }
        (marks[v.stop] ||= []).push({ x, y, li });
      }
      return real;
    });
    return { paths, marks, cl };
  }

  // ---- drawing --------------------------------------------------------
  function draw() {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, stage.width, stage.height);
    const { paths, marks, cl } = build();

    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    ctx.lineWidth = W;
    paths.forEach((vs, li) => {
      ctx.strokeStyle = LINES[li].color;
      ctx.beginPath();
      ctx.moveTo(vs[0].x, vs[0].y);
      for (let i = 1; i < vs.length - 1; i++) {
        const v = vs[i];
        if (v.r > 0.2) ctx.arcTo(v.x, v.y, vs[i + 1].x, vs[i + 1].y, v.r);
        else ctx.lineTo(v.x, v.y);
      }
      ctx.lineTo(vs[vs.length - 1].x, vs[vs.length - 1].y);
      ctx.stroke();
    });

    // Stations: a black dot on a single line, a white pill across a bundle.
    for (const id of ids) {
      const s = st[id];
      const pts = marks[id] || [];
      if (!pts.length) continue;
      const g = 1 + s.grow * 0.22;
      if (s.lines.length === 1) {
        const p = pts[0];
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(p.x, p.y, W * 0.5 * g, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Square the pill across the station's busiest corridor.
      let best = -1;
      let pa = null;
      let pb = null;
      let score = Infinity;
      for (const n of s.adj) {
        const e = edges.get(key(id, n));
        const cp = cl.get(key(e.from, e.to));
        const fwd = e.from === id;
        const p0 = fwd ? cp[0] : cp[cp.length - 1];
        const p1 = fwd ? cp[1] : cp[cp.length - 2];
        const tl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const tx = (p1[0] - p0[0]) / tl;
        const ty = (p1[1] - p0[1]) / tl;
        const nx = -ty;
        const ny = tx;
        let lo = Infinity;
        let hi = -Infinity;
        let alo = Infinity;
        let ahi = -Infinity;
        for (const m of pts) {
          const a = (m.x - p0[0]) * nx + (m.y - p0[1]) * ny;
          const b = (m.x - p0[0]) * tx + (m.y - p0[1]) * ty;
          lo = Math.min(lo, a);
          hi = Math.max(hi, a);
          alo = Math.min(alo, b);
          ahi = Math.max(ahi, b);
        }
        // The corridor whose cross-section holds every line most squarely.
        const sc = ahi - alo - e.members.length * 1000;
        if (sc < score) {
          score = sc;
          const along = clamp((alo + ahi) / 2, -W, W);
          const cx = p0[0] + tx * along;
          const cy = p0[1] + ty * along;
          pa = { x: cx + nx * lo, y: cy + ny * lo };
          pb = { x: cx + nx * hi, y: cy + ny * hi };
          best = hi - lo;
        }
      }
      const wPill = W * 1.18 * g;
      const rim = Math.max(1.5, W * 0.26);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x + (best < 0.01 ? 0.01 : 0), pb.y);
      ctx.strokeStyle = INK;
      ctx.lineWidth = wPill + rim * 2;
      ctx.stroke();
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = wPill;
      ctx.stroke();
    }
  }

  // ---- settling: the tidy hand -------------------------------------------
  const octDiff = (ax, ay, bx, by) => {
    let d = Math.abs(Math.atan2(ay, ax) - Math.atan2(by, bx));
    if (d > Math.PI) d = Math.PI * 2 - d;
    return Math.round(d / (Math.PI / 4));
  };
  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  };
  function edgeCost(e, P) {
    const a = P[e.from];
    const b = P[e.to];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const len = Math.max(adx, ady);
    if (len < 1) return 1000;
    let c = 0;
    const mis = Math.min(adx, ady, Math.abs(adx - ady));
    if (mis > 0) c += 3 + 0.3 * mis;
    const L0 = Math.max(Math.abs(e.design[0]), Math.abs(e.design[1]));
    c += (0.5 * (len - L0) ** 2) / L0;
    if (len < 2) c += 4;
    c += 3.5 * octDiff(dx, dy, e.design[0], e.design[1]);
    return c * e.members.length ** 0.5;
  }
  function stationCost(id, P, start) {
    const [x, y] = P[id];
    let c = 0;
    for (const n of st[id].adj) c += edgeCost(edges.get(key(id, n)), P);
    for (const o of ids) {
      if (o === id) continue;
      const d = Math.max(Math.abs(P[o][0] - x), Math.abs(P[o][1] - y));
      if (d === 0) c += 1000;
      else if (d === 1) c += 6;
    }
    // A station must not sit on a line that does not serve it, either way round.
    const edgeList = [...edges.values()];
    for (const e of edgeList) {
      const touches = e.from === id || e.to === id;
      const a = P[e.from];
      const b = P[e.to];
      const pts = route(a[0], a[1], b[0], b[1]);
      const others = touches ? ids : [id];
      for (const o of others) {
        if (o === e.from || o === e.to) continue;
        const [px, py] = P[o];
        for (let i = 1; i < pts.length; i++) {
          if (segDist(px, py, pts[i - 1], pts[i]) < 0.5) {
            c += 12;
            break;
          }
        }
      }
    }
    // Two corridors must not run on top of each other.
    for (const n of st[id].adj) {
      const e = edges.get(key(id, n));
      const ep = route(P[e.from][0], P[e.from][1], P[e.to][0], P[e.to][1]);
      for (const f of edgeList) {
        if (f === e) continue;
        const fp = route(P[f.from][0], P[f.from][1], P[f.to][0], P[f.to][1]);
        let hit = false;
        for (let i = 1; i < ep.length && !hit; i++)
          for (let j = 1; j < fp.length && !hit; j++) {
            const [a0, a1] = [ep[i - 1], ep[i]];
            const [b0, b1] = [fp[j - 1], fp[j]];
            const cr = (a1[0] - a0[0]) * (b1[1] - b0[1]) - (a1[1] - a0[1]) * (b1[0] - b0[0]);
            if (Math.abs(cr) > 1e-6) continue;
            const am = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
            const bm = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
            if (segDist(am[0], am[1], b0, b1) < 0.3 || segDist(bm[0], bm[1], a0, a1) < 0.3) hit = true;
          }
        if (hit) c += 10;
      }
    }
    // Lines prefer to run straight through a station.
    for (const li of st[id].lines) {
      const s = LINES[li].stops;
      const i = s.indexOf(id);
      if (i <= 0 || i >= s.length - 1) continue;
      const a = P[s[i - 1]];
      const b = P[s[i + 1]];
      const t = octDiff(x - a[0], y - a[1], b[0] - x, b[1] - y);
      c += t >= 3 ? 8 : t * 0.6;
    }
    c += 0.9 * Math.hypot(x - start[id][0], y - start[id][1]);
    return c;
  }
  function tidy(pinned) {
    const P = {};
    const start = {};
    for (const id of ids) {
      P[id] = [clamp(Math.round(st[id].x), bounds[0], bounds[2]), clamp(Math.round(st[id].y), bounds[1], bounds[3])];
      start[id] = [st[id].x, st[id].y];
    }
    const touched = (id) => [id, ...st[id].adj, ...[...st[id].adj].flatMap((n) => [...st[n].adj])];
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (const id of ids) {
        if (id === pinned) continue;
        const local = () => [...new Set(touched(id))].reduce((c, k) => c + stationCost(k, P, start), 0);
        const [x0, y0] = P[id];
        let best = local();
        let bp = P[id];
        for (let i = -2; i <= 2; i++)
          for (let j = -2; j <= 2; j++) {
            if (!i && !j) continue;
            const nx = x0 + i;
            const ny = y0 + j;
            if (nx < bounds[0] || nx > bounds[2] || ny < bounds[1] || ny > bounds[3]) continue;
            P[id] = [nx, ny];
            const c = local();
            if (c < best - 1e-6) {
              best = c;
              bp = [nx, ny];
            }
          }
        P[id] = bp;
        if (bp[0] !== x0 || bp[1] !== y0) moved = true;
      }
      if (!moved) break;
    }
    return P;
  }

  // ---- interaction ------------------------------------------------------
  let drag = null; // { id, hop, gx, gy }
  let hover = null;
  const hops = (from) => {
    const h = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const c = q.shift();
      for (const n of st[c].adj) if (h[n] == null) (h[n] = h[c] + 1), q.push(n);
    }
    return h;
  };
  const pick = (px, py) => {
    let best = null;
    let bd = Math.max(22, u * 0.7);
    for (const id of ids) {
      const d = Math.hypot(X(st[id].x) - px, Y(st[id].y) - py);
      if (d < bd) (bd = d), (best = id);
    }
    return best;
  };
  const grabTo = (gx, gy) => {
    drag.gx = clamp(gx, bounds[0] - 0.4, bounds[2] + 0.4);
    drag.gy = clamp(gy, bounds[1] - 0.4, bounds[3] + 0.4);
  };
  const begin = (id, gx, gy) => {
    const s = st[id];
    drag = { id, hop: hops(id), ox: s.x - gx, oy: s.y - gy, gx: s.x, gy: s.y };
  };
  const end = () => {
    if (!drag) return;
    const P = tidy(drag.id);
    const now = performance.now();
    for (const id of ids) {
      st[id].hx = P[id][0];
      st[id].hy = P[id][1];
      st[id].release = now + (drag.hop[id] || 0) * 45;
    }
    drag = null;
  };

  stage.on("down", (p) => {
    const id = pick(p.x, p.y);
    if (!id) return;
    begin(id, (p.x - ox) / u, (p.y - oy) / u);
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      grabTo((p.x - ox) / u + drag.ox, (p.y - oy) / u + drag.oy);
      return;
    }
    hover = pick(p.x, p.y);
    canvas.style.cursor = hover ? "grab" : "";
  });
  stage.on("up", () => {
    end();
    canvas.style.cursor = hover ? "grab" : "";
  });

  // Targets: during a drag the neighbours share the displacement, falling off
  // with distance along the network; afterwards everything heads home.
  const FALL = [1, 0.46, 0.12, 0, 0];
  function step(dt, now) {
    let dx = 0;
    let dy = 0;
    if (drag) {
      const s = st[drag.id];
      dx = drag.gx - s.hx;
      dy = drag.gy - s.hy;
    }
    for (const id of ids) {
      const s = st[id];
      s.grow += ((drag?.id === id ? 1 : hover === id && !drag ? 0.5 : 0) - s.grow) * (1 - Math.exp(-dt * 18));
      if (drag && drag.id === id) {
        const k = 1 - Math.exp(-dt * 40);
        s.x += (drag.gx - s.x) * k;
        s.y += (drag.gy - s.y) * k;
        s.vx = 0;
        s.vy = 0;
        continue;
      }
      if (drag) {
        const f = FALL[Math.min(4, drag.hop[id] ?? 4)];
        s.tx = s.hx + dx * f;
        s.ty = s.hy + dy * f;
      } else if (now >= s.release) {
        s.tx = s.hx;
        s.ty = s.hy;
      }
      // Near-critically damped spring: a hand, not a bounce.
      const k = drag ? 140 : 190;
      const c = 2 * Math.sqrt(k) * 0.88;
      s.vx += (k * (s.tx - s.x) - c * s.vx) * dt;
      s.vy += (k * (s.ty - s.y) - c * s.vy) * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  // ?drag=0..1 (or ?t=) holds a drag of the trunk station mid-way.
  const q = new URLSearchParams(location.search);
  const hold = q.has("drag") ? +q.get("drag") : q.has("t") ? +q.get("t") : null;
  if (hold != null && Number.isFinite(hold)) {
    const s = st.D;
    begin("D", s.x, s.y);
    grabTo(s.x + 2.3 * hold, s.y - 2.9 * hold);
    for (let i = 0; i < 240; i++) step(1 / 60, 0);
  }

  stage.onFrame((dt) => {
    const sub = 2;
    for (let i = 0; i < sub; i++) step(dt / sub, performance.now());
    draw();
  });

  return { destroy: () => stage.destroy() };
}
