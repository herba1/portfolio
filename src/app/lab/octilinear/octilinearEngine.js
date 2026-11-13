import { createStage, clamp } from "../_kit/stage";

// An invented transit diagram after Vignelli and Unimark (1972): lines only
// at 0, 45 and 90 degrees, in parallel bundles at one constant spacing.
//
// Stations live on a grid (in grid units). Every edge between two stations
// is routed octilinearly in the current geometry: a straight stub, a 45°
// run, a straight stub when there is room, otherwise one straight run and
// one 45° run, and every bend is an arc of one radius. While the network
// moves, stations are drawn where a ruling hand would put them, so a small
// offset never becomes a tight S. Lines that share a corridor hold one lane
// each, fixed for the whole run of the corridor and kept on both sides of
// every station in it, so bundles stay parallel and pass straight through
// their stations; bends are arcs on a common centre, so the bundle turns
// concentrically. Dragging a station
// moves it freely; the routing keeps everything octilinear on the way. On
// release a small search puts every station back on whole grid points, in
// the cleanest octilinear layout near where the hand left it, and springs
// carry the network there.
//
// Every station but a bend is named, in Geist at the ui-sm step, terminals
// heavier. Each name stands at one of the eight octilinear positions around
// its mark and is re-placed every frame by a small cost (clear of lines,
// marks and other names, level with its mark if it can, and staying put
// unless its place is blocked), so under the hand the names step aside.

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

// Names, invented. Terminals are set heavier; a bend in a line is not a
// station and carries no name.
const NAMES = {
  A: "Ashby", Q: "Quarry", H: "Holm", W: "Wren End", M: "Moss Hill", V: "Vale",
  C: "Canal", D: "Market", E: "Exchange", F: "Ferry", G: "Greys", O: "Orchard", Y: "Foundry",
  L: "Lark Rise", T: "Tanner", Z: "Sedge", P: "Pier", R: "Rook Lane",
};
const TERM = new Set(LINES.flatMap((l) => [l.stops[0], l.stops[l.stops.length - 1]]));
const STOP = new Set(Object.keys(NAMES).filter((id) => !TERM.has(id) && LINES.filter((l) => l.stops.includes(id)).length === 1));

const INK = "#111111";
const PAPER = "#ffffff";

const ids = Object.keys(STATIONS);
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function createOctilinear(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;

  // Type from the scale: ui-sm, caption weight, terminals semibold, tracking
  // from the law (zero at 12px).
  const css = getComputedStyle(document.documentElement);
  const tok = (n, f) => css.getPropertyValue(n).trim() || f;
  const SANS = tok("--font-sans", "system-ui, sans-serif");
  const SIZE = parseFloat(tok("--text-ui-sm", "12px")) || 12;
  const W_STOP = tok("--font-weight-caption", "520");
  const W_TERM = tok("--font-weight-semibold", "600");
  const law = -0.043 * (SIZE - 12);
  const TRACK = SIZE < 20 ? `${law.toFixed(2)}px` : `${(law / SIZE).toFixed(4)}em`;
  let alive = true;
  Promise.all([W_STOP, W_TERM].map((w) => document.fonts?.load(`${w} ${SIZE}px ${SANS}`)))
    .catch(() => null)
    .then(() => {
      if (alive) for (const k of Object.keys(metrics)) delete metrics[k];
    });

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
  // Centreline of one edge: stub, 45° run, stub, when both stubs and the run
  // have room for a full-radius bend. Otherwise (a small offset, or stubs
  // shorter than the radius) it is one straight stub plus one 45° run, with
  // the run anchored at one end (anchor -1: at a, +1: at b; chooseAnchors
  // picks it, by default the end nearer the hand), so a nudge costs one bend
  // of radius R instead of a tight S. anchor 0 asks for the symmetric form
  // (the tidy search works in grid units).
  function route(ax, ay, bx, by, anchor = 0, rad = 0) {
    const dx = bx - ax;
    const dy = by - ay;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const d = Math.min(adx, ady);
    const rest = Math.max(adx, ady) - d;
    const pts = [[ax, ay]];
    let px = ax;
    let py = ay;
    const push = (x, y) => {
      if (Math.hypot(x - px, y - py) > 0.05) pts.push([x, y]);
      px = x;
      py = y;
    };
    const straight = (len) => (adx >= ady ? push(px + sx * len, py) : push(px, py + sy * len));
    const diagonal = () => push(px + sx * d, py + sy * d);
    const short = rad > 0 && (d < 2 * rad || rest / 2 < rad);
    if (anchor === 0 && short) anchor = 1;
    if (anchor === 1 && short) {
      straight(rest);
      diagonal();
    } else if (anchor === -1 && short) {
      diagonal();
      straight(rest);
    } else {
      straight(rest / 2);
      diagonal();
    }
    if (Math.hypot(bx - px, by - py) > 0.05) pts.push([bx, by]);
    else if (pts.length > 1) pts[pts.length - 1] = [bx, by];
    else pts.push([bx + 0.05, by]);
    return pts;
  }

  // ---- the ruled hand ---------------------------------------------------
  // Stations are drawn where the hand would rule them, not where the springs
  // happen to hold them. Working outward-in from the far side of the map, a
  // station whose offset from an already ruled neighbour is too small to hold
  // a full-radius 45° bend is set flush with that neighbour (or onto its
  // diagonal), within a radius-sized reach. So every edge is either exactly
  // straight or has room for its bends at R, and no frame shows a sub-radius
  // S. A change of mind (a new alignment) glides over a few frames.
  let near = Object.fromEntries(ids.map((id) => [id, 0]));
  const dp = {};
  const ruled = new Set();
  const snapSig = {};
  const resid = {};
  const tidyEdge = (dx, dy, tau) => {
    const a = Math.abs(dx);
    const b = Math.abs(dy);
    const mi = Math.min(a, b);
    const ma = Math.max(a, b) - mi;
    return (mi < 0.5 || mi >= tau * 0.75) && (ma < 0.5 || ma >= tau);
  };
  function rule(dt) {
    const tau = R;
    const k = 1 - Math.exp(-dt * 26);
    ruled.clear();
    // Stations standing still at home are the ruled world, and the station in
    // the hand stays under the hand; the rest are ruled growing out from the
    // world, farthest from the hand first, so every station has a ruled
    // neighbour to align to when its turn comes.
    const order = [];
    const left = new Set(ids);
    for (const id of ids) {
      const s = st[id];
      if (drag?.id === id || (Math.abs(s.x - s.hx) * u < 0.5 && Math.abs(s.y - s.hy) * u < 0.5)) {
        order.push(id);
        left.delete(id);
      }
    }
    while (left.size) {
      let pick = null;
      let tie = -1;
      for (const id of left) {
        let t = 0;
        for (const n of st[id].adj) if (!left.has(n)) t++;
        if (order.length && !t) continue;
        if (pick == null || near[id] > near[pick] || (near[id] === near[pick] && t > tie)) {
          pick = id;
          tie = t;
        }
      }
      pick ??= left.values().next().value;
      order.push(pick);
      left.delete(pick);
    }
    for (const id of order) {
      const s = st[id];
      const px = X(s.x);
      const py = Y(s.y);
      const N = [];
      // The station in the hand is ruled first, against its neighbours' home
      // positions, with a short reach: a light magnet that lets it leave the
      // grid cleanly and never strays far from the pointer.
      const hand = drag?.id === id;
      const reach = hand ? tau * 0.5 : tau;
      for (const n of s.adj) {
        if (hand) N.push({ x: X(st[n].hx), y: Y(st[n].hy) });
        else if (ruled.has(n)) N.push(dp[n]);
      }
      let bx = px;
      let by = py;
      let sig = "pp";
      if (N.length) {
        const xs = [[px, "p"]];
        const ys = [[py, "p"]];
        N.forEach((n, i) => {
          xs.push([n.x, `x${i}`]);
          ys.push([n.y, `y${i}`]);
        });
        const xb = xs.slice();
        const yb = ys.slice();
        N.forEach((n, i) => {
          for (const [y] of yb) {
            const d = Math.abs(y - n.y);
            xs.push([n.x + d, `d${i}+`], [n.x - d, `d${i}-`]);
          }
          for (const [x] of xb) {
            const d = Math.abs(x - n.x);
            ys.push([n.y + d, `d${i}+`], [n.y - d, `d${i}-`]);
          }
        });
        let best = Infinity;
        for (const [x, lx] of xs) {
          if (Math.abs(x - px) > reach) continue;
          for (const [y, ly] of ys) {
            if (Math.abs(y - py) > reach) continue;
            let bad = 0;
            for (const n of N) if (!tidyEdge(x - n.x, y - n.y, tau)) bad++;
            // Hold the current alignment unless another is clearly nearer.
            const c = bad * 1e4 + Math.hypot(x - px, y - py) - (lx + ly === snapSig[id] ? 4 : 0);
            if (c < best) {
              best = c;
              bx = x;
              by = y;
              sig = lx + ly;
            }
          }
        }
      }
      const r = (resid[id] ||= [0, 0]);
      if (dp[id] && snapSig[id] !== undefined && snapSig[id] !== sig) {
        r[0] = dp[id].x - bx;
        r[1] = dp[id].y - by;
      }
      snapSig[id] = sig;
      r[0] *= 1 - k;
      r[1] *= 1 - k;
      if (Math.hypot(r[0], r[1]) < 0.1) r[0] = r[1] = 0;
      dp[id] = { x: bx + r[0], y: by + r[1] };
      ruled.add(id);
    }
  }
  // Which end of each short edge carries its 45° run, chosen for the whole
  // network at once. Lines are charged for turning harder at a station than
  // the design asks (a line that ran straight through keeps running straight
  // through; a right angle may stay a right angle; anything sharper, and
  // above all a hairpin, is expensive), and every end is charged a little for
  // leaving its station off the design heading. Ties go to the end nearer
  // the hand, and a choice holds unless another is clearly better, so the
  // routing does not flicker under a moving hand.
  const unit = (x, y) => [Math.sign(Math.round(x * 1000)), Math.sign(Math.round(y * 1000))];
  const designOut = (e, id) => (e.from === id ? unit(e.design[0], e.design[1]) : unit(-e.design[0], -e.design[1]));
  const choice = new Map();
  const heads = new Map();
  const turnPenalty = (t, t0) => Math.max(0, t - t0) ** 2 + (t >= 3 && t > t0 ? 4 : 0) + (t === 4 ? 20 : 0);
  const headAt = (k, id) => {
    const h = heads.get(k);
    return h.opts[choice.get(k)][edges.get(k).from === id ? 0 : 1];
  };
  function stationTurns(id) {
    let c = 0;
    for (const li of st[id].lines) {
      const s = LINES[li].stops;
      const i = s.indexOf(id);
      if (i <= 0 || i >= s.length - 1) continue;
      const ka = key(s[i - 1], id);
      const kb = key(id, s[i + 1]);
      const ha = headAt(ka, id);
      const hb = headAt(kb, id);
      const da = designOut(edges.get(ka), id);
      const db = designOut(edges.get(kb), id);
      c += turnPenalty(4 - octDiff(ha[0], ha[1], hb[0], hb[1]), 4 - octDiff(da[0], da[1], db[0], db[1]));
    }
    return c;
  }
  function endCost(k, prev) {
    const e = edges.get(k);
    let c = 0;
    for (const id of [e.from, e.to]) {
      const h = headAt(k, id);
      const d = designOut(e, id);
      c += 0.3 * e.members.length * octDiff(h[0], h[1], d[0], d[1]);
    }
    const diagEnd = choice.get(k) === 1 ? e.to : e.from;
    return c + 0.01 * near[diagEnd] + (prev.get(k) !== choice.get(k) ? 0.4 : 0);
  }
  // A run must hold the tangents of the bends at both its ends at radius R.
  const TAN = [0, Math.tan(Math.PI / 8), 1, Math.tan((3 * Math.PI) / 8), 4];
  function roomCost(k) {
    const h = heads.get(k);
    if (!h.free) return 0;
    const e = edges.get(k);
    const c = choice.get(k);
    let cost = 0;
    for (const id of [e.from, e.to]) {
      // Length of this edge's run at that station: the straight or the 45°.
      const diagHere = (c === 1) === (id === e.to);
      const len = diagHere ? h.d * Math.SQRT2 : h.rest;
      const mine = headAt(k, id);
      let turn = 0;
      for (const li of e.members) {
        const s = LINES[li].stops;
        const i = s.indexOf(id);
        for (const j of [i - 1, i + 1]) {
          const nb = s[j];
          if (nb == null || key(id, nb) === k) continue;
          const o = headAt(key(id, nb), id);
          turn = Math.max(turn, 4 - octDiff(mine[0], mine[1], o[0], o[1]));
        }
      }
      const need = R * (TAN[1] + TAN[turn]);
      if (len < need * 0.97) cost += 3 * Math.min(1, (need - len) / need + 0.3);
    }
    return cost;
  }
  function chooseAnchors() {
    const prev = new Map(choice);
    const free = [];
    for (const [k, e] of edges) {
      const a = dp[e.from];
      const b = dp[e.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const sx = Math.sign(dx);
      const sy = Math.sign(dy);
      const d = Math.min(adx, ady);
      const rest = Math.max(adx, ady) - d;
      const axis = adx >= ady ? [sx, 0] : [0, sy];
      const diag = [sx, sy];
      const neg = (v) => [-v[0], -v[1]];
      const short = d < 2 * R || rest / 2 < R;
      let opts;
      if (d < 0.5) opts = { 1: [axis, neg(axis)], [-1]: [axis, neg(axis)] };
      else if (rest < 0.5) opts = { 1: [diag, neg(diag)], [-1]: [diag, neg(diag)] };
      else if (!short) opts = { 1: [axis, neg(axis)], [-1]: [axis, neg(axis)] };
      else {
        opts = { 1: [axis, neg(diag)], [-1]: [diag, neg(axis)] };
        free.push(k);
      }
      heads.set(k, { opts, free: free.at(-1) === k, d, rest });
      if (!choice.has(k)) choice.set(k, near[e.from] < near[e.to] ? -1 : 1);
    }
    const local = (k) => {
      const e = edges.get(k);
      let c = stationTurns(e.from) + stationTurns(e.to) + endCost(k, prev);
      for (const id of [e.from, e.to]) for (const n of st[id].adj) c += roomCost(key(id, n));
      return c;
    };
    for (let sweep = 0; sweep < 4; sweep++) {
      let flipped = false;
      for (const k of free) {
        const c0 = local(k);
        choice.set(k, -choice.get(k));
        if (local(k) < c0 - 1e-6) flipped = true;
        else choice.set(k, -choice.get(k));
      }
      if (!flipped) break;
    }
  }

  // ---- lanes ------------------------------------------------------------
  // One lane order per corridor run, held through every station in it. A
  // line is linked across a station when it runs straight through (in the
  // home layout) or when it turns there together with at least one other line,
  // so the bundle bends as one. Each maximal linked stretch of one line is a
  // chain; chains that share an edge form a run. Every chain in a run gets one
  // signed offset, sorted once by which side it peels off at its two ends, and
  // keeps it on both sides of every station: a line leaving the bundle takes
  // its lane with it and the rest do not re-centre, so they pass straight
  // through. The run is shifted (by half lanes) to keep lone stretches on
  // their station centreline.
  const homeHead = (k, id) => {
    const e = edges.get(k);
    const a = st[e.from];
    const b = st[e.to];
    const pts = route(a.hx, a.hy, b.hx, b.hy);
    const fwd = e.from === id;
    const p0 = fwd ? pts[0] : pts[pts.length - 1];
    const p1 = fwd ? pts[1] : pts[pts.length - 2];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    return [(p1[0] - p0[0]) / l, (p1[1] - p0[1]) / l];
  };
  let laneSig = "";
  let lanePlan = new Map();
  function planLanes() {
    const sig = ids.map((id) => `${st[id].hx},${st[id].hy}`).join(";");
    if (sig === laneSig) return lanePlan;
    laneSig = sig;
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const join = (a, b) => parent.set(find(a), find(b));
    const node = (li, k) => `${li}#${k}`;
    const turns = new Map();
    LINES.forEach(({ stops: s }, li) => {
      for (let i = 1; i < s.length; i++) parent.set(node(li, key(s[i - 1], s[i])), node(li, key(s[i - 1], s[i])));
      for (let i = 1; i < s.length - 1; i++) {
        const ka = key(s[i - 1], s[i]);
        const kb = key(s[i], s[i + 1]);
        const tk = `${s[i]}/${ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`}`;
        if (!turns.has(tk)) turns.set(tk, { id: s[i], ka, kb, lines: [] });
        turns.get(tk).lines.push(li);
      }
    });
    for (const t of turns.values()) {
      const ha = homeHead(t.ka, t.id);
      const hb = homeHead(t.kb, t.id);
      if (ha[0] * hb[0] + ha[1] * hb[1] < -0.999 || t.lines.length >= 2) for (const li of t.lines) join(node(li, t.ka), node(li, t.kb));
    }
    // Chains, in travel order.
    const chains = [];
    LINES.forEach(({ stops: s }, li) => {
      let c = null;
      for (let i = 1; i < s.length; i++) {
        const k = key(s[i - 1], s[i]);
        const r = find(node(li, k));
        if (!c || c.root !== r) chains.push((c = { li, root: r, ks: [], tau: [], i0: i - 1, i1: i }));
        c.ks.push(k);
        c.tau.push(edges.get(k).from === s[i - 1] ? 1 : -1);
        c.i1 = i;
      }
    });
    // Runs: chains that share an edge.
    const onEdge = new Map();
    chains.forEach((c, ci) => c.ks.forEach((k) => (onEdge.get(k) || onEdge.set(k, []).get(k)).push(ci)));
    const runOf = chains.map((_, i) => i);
    const rfind = (i) => (runOf[i] === i ? i : (runOf[i] = rfind(runOf[i])));
    for (const cs of onEdge.values()) for (const ci of cs) runOf[rfind(ci)] = rfind(cs[0]);
    const runs = new Map();
    chains.forEach((_, ci) => (runs.get(rfind(ci)) || runs.set(rfind(ci), []).get(rfind(ci))).push(ci));
    const plan = new Map();
    for (const members of runs.values()) {
      // Orient the run from its busiest edge outward.
      const ks = [...new Set(members.flatMap((ci) => chains[ci].ks))];
      ks.sort((a, b) => onEdge.get(b).length - onEdge.get(a).length);
      const sg = new Map([[ks[0], 1]]);
      const rho = new Map();
      const queue = [ks[0]];
      while (queue.length) {
        const k = queue.shift();
        for (const ci of onEdge.get(k)) {
          if (rho.has(ci)) continue;
          const c = chains[ci];
          const r = sg.get(k) * c.tau[c.ks.indexOf(k)];
          rho.set(ci, r);
          c.ks.forEach((f, j) => {
            if (!sg.has(f)) {
              sg.set(f, r * c.tau[j]);
              queue.push(f);
            }
          });
        }
      }
      // Which side each chain peels off to at its ends: the signed angle of
      // the branch it leaves by, measured from straight on, toward +normal.
      const endSide = (c, atStart) => {
        const s = LINES[c.li].stops;
        const id = atStart ? s[c.i0] : s[c.i1];
        const nb = atStart ? s[c.i0 - 1] : s[c.i1 + 1];
        if (nb == null) return 0;
        const k = atStart ? c.ks[0] : c.ks[c.ks.length - 1];
        const h = homeHead(k, id);
        const canon = edges.get(k).from === id ? h : [-h[0], -h[1]];
        const nx = -canon[1] * sg.get(k);
        const ny = canon[0] * sg.get(k);
        const t = homeHead(key(id, nb), id);
        return Math.atan2(t[0] * nx + t[1] * ny, -(t[0] * h[0] + t[1] * h[1]));
      };
      const side = new Map(members.map((ci) => [ci, endSide(chains[ci], true) + endSide(chains[ci], false)]));
      members.sort((a, b) => side.get(a) - side.get(b) || chains[a].li - chains[b].li);
      // Shift the whole run by half lanes so lone stretches sit on centre.
      const n = members.length;
      let best = Infinity;
      let shift = 0;
      for (let b = -n; b <= 1; b += 0.5) {
        let c = Math.abs(b + (n - 1) / 2) * 1e-3;
        members.forEach((ci, i) => {
          for (const k of chains[ci].ks) c += Math.abs(i + b) * (onEdge.get(k).length === 1 ? 1 : 0.3);
        });
        if (c < best - 1e-9) {
          best = c;
          shift = b;
        }
      }
      members.forEach((ci, i) => {
        const c = chains[ci];
        for (const k of c.ks) (plan.get(k) || plan.set(k, new Map()).get(k)).set(c.li, sg.get(k) * (i + shift));
      });
    }
    lanePlan = plan;
    return plan;
  }

  // Build every line's offset polyline with per-vertex radii, plus where each
  // line passes each of its stations. Lane offsets at each end of each edge
  // are eased, so a re-planned run slides over rather than jumping.
  const portEase = new Map();
  function build(dt) {
    rule(dt);
    chooseAnchors();
    const cl = new Map();
    for (const [k, e] of edges) {
      const a = dp[e.from];
      const b = dp[e.to];
      cl.set(k, route(a.x, a.y, b.x, b.y, choice.get(k), R));
    }
    const plan = planLanes();
    const target = new Map();
    for (const [k, e] of edges) {
      const m = new Map(e.members.map((li) => [li, (plan.get(k)?.get(li) ?? 0) * lane]));
      target.set(`${k}|0`, m);
      target.set(`${k}|1`, new Map(m));
    }
    // Safety net: edges of different runs that leave a station on the same
    // heading (only ever mid-drag) would overprint, so that one port is
    // re-laned as a single set, ordered by which way each edge goes on to turn.
    for (const id of ids) {
      const outs = [];
      for (const nb of st[id].adj) {
        const k = key(id, nb);
        const e = edges.get(k);
        const pts = cl.get(k);
        const fwd = e.from === id;
        const p0 = fwd ? pts[0] : pts[pts.length - 1];
        const p1 = fwd ? pts[1] : pts[pts.length - 2];
        const far = fwd ? pts[pts.length - 1] : pts[0];
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        outs.push({ k, e, fwd, p0, far, tx: (p1[0] - p0[0]) / l, ty: (p1[1] - p0[1]) / l, m: target.get(`${k}|${fwd ? 0 : 1}`) });
      }
      const seen = new Set();
      for (const g of outs) {
        if (seen.has(g)) continue;
        const group = outs.filter((h) => !seen.has(h) && g.tx * h.tx + g.ty * h.ty > 0.999);
        group.forEach((h) => seen.add(h));
        if (group.length < 2) continue;
        const out = (h, li) => (h.fwd ? h.m.get(li) : -h.m.get(li));
        const taken = [];
        let clash = false;
        for (const h of group)
          for (const li of h.e.members) {
            const v = out(h, li);
            if (taken.some(([w, hh]) => hh !== h && Math.abs(w - v) < lane * 0.9)) clash = true;
            taken.push([v, h]);
          }
        if (!clash) continue;
        // The busiest edge keeps its lanes; the others stack beside it on the
        // side they go on to turn to, and carry that lane along their whole
        // edge unless a line runs straight on at the far end.
        const side = (h) => (h.far[0] - h.p0[0]) * -g.ty + (h.far[1] - h.p0[1]) * g.tx;
        group.sort((p, q) => side(p) - side(q));
        let ai = 0;
        group.forEach((h, i) => {
          if (h.e.members.length > group[ai].e.members.length) ai = i;
        });
        const vals = group[ai].e.members.map((li) => out(group[ai], li));
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        const place = (h, li, v) => {
          h.m.set(li, h.fwd ? v : -v);
          const farEnd = target.get(`${h.k}|${h.fwd ? 1 : 0}`);
          const s = LINES[li].stops;
          const fid = h.fwd ? h.e.to : h.e.from;
          const i = s.indexOf(fid);
          const pts = cl.get(h.k);
          const q0 = h.fwd ? pts[pts.length - 1] : pts[0];
          const q1 = h.fwd ? pts[pts.length - 2] : pts[1];
          let straightOn = false;
          for (const j of [i - 1, i + 1]) {
            const nb = s[j];
            if (nb == null || key(fid, nb) === h.k) continue;
            const ok = key(fid, nb);
            const op = cl.get(ok);
            const of = edges.get(ok).from === fid;
            const r0 = of ? op[0] : op[op.length - 1];
            const r1 = of ? op[1] : op[op.length - 2];
            const c = ((q1[0] - q0[0]) * (r1[0] - r0[0]) + (q1[1] - q0[1]) * (r1[1] - r0[1])) / ((Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) * Math.hypot(r1[0] - r0[0], r1[1] - r0[1])) || 1);
            if (c < -0.999) straightOn = true;
          }
          if (!straightOn) farEnd.set(li, h.m.get(li));
        };
        for (let i = ai - 1; i >= 0; i--) {
          const ls = group[i].e.members.slice().sort((p, q) => out(group[i], q) - out(group[i], p));
          for (const li of ls) place(group[i], li, (lo -= lane));
        }
        for (let i = ai + 1; i < group.length; i++) {
          const ls = group[i].e.members.slice().sort((p, q) => out(group[i], p) - out(group[i], q));
          for (const li of ls) place(group[i], li, (hi += lane));
        }
      }
    }
    const ke = 1 - Math.exp(-dt * 14);
    const endOff = new Map();
    const portAt = (k, end, li) => {
      const pk = `${k}|${end}`;
      const t = target.get(pk).get(li);
      const ek = `${pk}|${li}`;
      const cur = portEase.has(ek) ? portEase.get(ek) : t;
      const v = Math.abs(t - cur) < 0.02 ? t : cur + (t - cur) * ke;
      portEase.set(ek, v);
      (endOff.get(pk) || endOff.set(pk, new Map()).get(pk)).set(li, v);
      return v;
    };
    const marks = {};
    const paths = LINES.map((line, li) => {
      const segs = [];
      for (let i = 1; i < line.stops.length; i++) {
        const a = line.stops[i - 1];
        const b = line.stops[i];
        const k = key(a, b);
        const e = edges.get(k);
        let pts = cl.get(k);
        const oFrom = portAt(k, 0, li);
        const oTo = portAt(k, 1, li);
        // A one-run edge whose two ends disagree changes lane at its middle.
        if (pts.length === 2 && Math.abs(oFrom - oTo) > 0.01) pts = [pts[0], [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], pts[1]];
        const ns = pts.length - 1;
        let offs = [];
        for (let j = 1; j <= ns; j++) offs.push(j === 1 ? oFrom : j === ns ? oTo : (oFrom + oTo) / 2);
        if (e.from !== a) {
          pts = pts.slice().reverse();
          offs = offs.reverse().map((v) => -v);
        }
        for (let j = 1; j < pts.length; j++) {
          const [px, py] = pts[j - 1];
          const [qx, qy] = pts[j];
          const len = Math.hypot(qx - px, qy - py) || 1e-6;
          const dx = (qx - px) / len;
          const dy = (qy - py) / len;
          segs.push({ px, py, qx, qy, dx, dy, nx: -dy, ny: dx, o: offs[j - 1], len, startStop: j === 1 ? a : null, endStop: j === pts.length - 1 ? b : null });
        }
      }
      // Vertices: {x, y, r, tan, stop}
      const vs = [];
      const s0 = segs[0];
      vs.push({ x: s0.px + s0.nx * s0.o, y: s0.py + s0.ny * s0.o, r: 0, stop: line.stops[0], end: true, t: [-s0.dx, -s0.dy] });
      for (let k = 0; k < segs.length - 1; k++) {
        const s1 = segs[k];
        const s2 = segs[k + 1];
        const stop = s1.endStop;
        const cross = s1.dx * s2.dy - s1.dy * s2.dx;
        const dot = s1.dx * s2.dx + s1.dy * s2.dy;
        if (Math.abs(cross) < 1e-4) {
          if (dot < 0 || Math.abs(s1.o - s2.o) < 0.01) {
            if (stop) vs.push({ x: s1.qx + s1.nx * s1.o, y: s1.qy + s1.ny * s1.o, r: 0, stop, pass: dot > 0, t: [s1.dx, s1.dy] });
            continue;
          }
          // Lane change on a straight run: a short 45° jog.
          const j = Math.abs(s2.o - s1.o) / 2;
          const a = { x: s1.qx - s1.dx * j + s1.nx * s1.o, y: s1.qy - s1.dy * j + s1.ny * s1.o, r: lane * 0.6, tan: Math.tan(Math.PI / 8) };
          const b = { x: s1.qx + s1.dx * j + s2.nx * s2.o, y: s1.qy + s1.dy * j + s2.ny * s2.o, r: lane * 0.6, tan: Math.tan(Math.PI / 8) };
          vs.push(a, b);
          if (stop) vs.push({ mark: true, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, stop, pass: true, t: [s1.dx, s1.dy] });
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
        const rc = R;
        const om = (s1.o + s2.o) / 2;
        const r = Math.max(0, cross > 0 ? rc - om : rc + om);
        vs.push({ x: ax + s1.dx * t, y: ay + s1.dy * t, r, tan, theta, d1: [s1.dx, s1.dy], d2: [s2.dx, s2.dy], stop });
      }
      const sl = segs[segs.length - 1];
      vs.push({ x: sl.qx + sl.nx * sl.o, y: sl.qy + sl.ny * sl.o, r: 0, stop: line.stops[line.stops.length - 1], end: true, t: [sl.dx, sl.dy] });

      // Clamp radii to the room on the offset segments.
      // Each run is shared by the bends at its two ends in proportion to what
      // they need; with the ruled positions this is a safety net, not a rule.
      const real = vs.filter((v) => !v.mark);
      const need = real.map((v) => (v.r ? v.r * v.tan : 0));
      const fit = real.map(() => 1);
      for (let i = 1; i < real.length; i++) {
        const tot = need[i - 1] + need[i];
        if (!tot) continue;
        const len = Math.hypot(real[i].x - real[i - 1].x, real[i].y - real[i - 1].y);
        if (tot > len) {
          const f = len / tot;
          fit[i - 1] = Math.min(fit[i - 1], f);
          fit[i] = Math.min(fit[i], f);
        }
      }
      real.forEach((v, i) => {
        if (v.r) v.r *= fit[i];
      });
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
        (marks[v.stop] ||= []).push({ x, y, li, end: !!v.end, straight: !!v.pass, t: v.t });
      }
      return real;
    });
    return { paths, marks, cl, endOff };
  }

  // ---- drawing --------------------------------------------------------
  function draw(dt) {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, stage.width, stage.height);
    const { paths, marks, cl, endOff } = build(dt);

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

    // Stations. An interchange is a white pill squared across its bundle; a
    // terminal is a short bar across the end of its line; an ordinary stop is
    // a tick on a straight run, on the side its name is set. A bend in a line
    // is only a bend: it carries no mark and no name.
    clock += dt;
    const sm = [];
    for (const id of ids) {
      const s = st[id];
      const pts = marks[id] || [];
      if (!pts.length) continue;
      const g = 1 + s.grow * 0.22;
      if (s.lines.length === 1) {
        const p = pts.find((m) => m.end) || pts.find((m) => m.straight) || pts[0];
        const t = p.t || [1, 0];
        const n = [-t[1], t[0]];
        if (p.end) {
          // The bar sits flush with the end of the line, across it.
          const half = W * 1.25 * g;
          const cx = p.x - t[0] * W * 0.5;
          const cy = p.y - t[1] * W * 0.5;
          const a = { x: cx + n[0] * half, y: cy + n[1] * half };
          const b = { x: cx - n[0] * half, y: cy - n[1] * half };
          sm.push({ id, kind: "bar", a, b, li: p.li, bb: box([a, b], W * 0.5) });
          continue;
        }
        const tick = (tickOn[id] ??= 0);
        tickOn[id] = tick + ((STOP.has(id) && p.straight ? 1 : 0) - tick) * (1 - Math.exp(-dt * 20));
        if (!NAMES[id]) {
          sm.push({ id, kind: "way", p, bb: box([p], W * 0.5) });
          continue;
        }
        const reach = W * 0.5 + W * 1.1 * g;
        sm.push({ id, kind: "tick", p, n, li: p.li, reach, bb: box([{ x: p.x + n[0] * reach, y: p.y + n[1] * reach }, { x: p.x - n[0] * reach, y: p.y - n[1] * reach }], W * 0.5) });
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
        // Span the lanes of the corridor as they stand at the station (not
        // where bending lines happen to cross it), plus any crossing line.
        const offs = endOff.get(`${key(e.from, e.to)}|${fwd ? 0 : 1}`);
        let lo = Infinity;
        let hi = -Infinity;
        for (const li of e.members) {
          const v = fwd ? offs.get(li) : -offs.get(li);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        let alo = Infinity;
        let ahi = -Infinity;
        let cross = 0;
        let nc = 0;
        for (const m of pts) {
          const a = (m.x - p0[0]) * nx + (m.y - p0[1]) * ny;
          const b = (m.x - p0[0]) * tx + (m.y - p0[1]) * ty;
          if (!e.members.includes(m.li)) {
            lo = Math.min(lo, a);
            hi = Math.max(hi, a);
            cross += b;
            nc++;
          }
          alo = Math.min(alo, b);
          ahi = Math.max(ahi, b);
        }
        // The corridor whose cross-section holds every line most squarely;
        // on a tie, a level or upright pill over a slanted one.
        const sc = ahi - alo - e.members.length * 1000 + (Math.abs(tx * ty) > 0.25 ? 500 : 0);
        if (sc < score) {
          score = sc;
          // A line crossing the bundle pins the pill onto itself.
          const along = clamp(nc ? cross / nc : (alo + ahi) / 2, -W, W);
          const cx = p0[0] + tx * along;
          const cy = p0[1] + ty * along;
          pa = { x: cx + nx * lo, y: cy + ny * lo };
          pb = { x: cx + nx * hi, y: cy + ny * hi };
          best = hi - lo;
        }
      }
      const wPill = W * 1.18 * g;
      const rim = Math.max(1.5, W * 0.26);
      sm.push({ id, kind: "pill", pa, pb, best, wPill, rim, bb: box([pa, pb], wPill / 2 + rim) });
    }

    // Names: each set at one of the eight octilinear positions around its
    // mark, at a fixed gap, wherever it is clearest of the lines, the marks
    // and the other names, holding its place unless that place is blocked.
    const obstacles = flatten(paths);
    const placed = [];
    const clear = W * 0.5 + 3;
    const order = sm.filter((m) => NAMES[m.id]).sort((p, q) => rank(p) - rank(q));
    for (const m of order) {
      const lab = (labels[m.id] ||= { pos: -1, prev: -1, t0: -1e9 });
      const f = metric(m.id);
      let bestPos = 0;
      let bestCost = Infinity;
      for (let i = 0; i < 8; i++) {
        const r = labelRect(m.bb, i, f);
        // A stop's name stands off the end of its tick, square to the line.
        let c = PREF[i];
        if (m.kind === "tick") {
          const [dx, dy] = DIRS[i];
          c = 2.4 * (1 - Math.abs(dx * m.n[0] + dy * m.n[1]) / Math.hypot(dx, dy));
        }
        for (const sg of obstacles) {
          const len = clipLen(sg, r, clear);
          if (len > 0) c += 30 + len;
        }
        for (const o of sm) if (o !== m && o.kind !== "way" && hits(r, o.bb, 2)) c += 40;
        for (const o of placed) if (hits(r, o, 3)) c += 60;
        if (r.x0 < 8 || r.y0 < 8 || r.x1 > stage.width - 8 || r.y1 > stage.height - 8) c += 200;
        if (lab.pos >= 0 && i !== lab.pos) c += drag ? 10 : 1;
        if (c < bestCost) {
          bestCost = c;
          bestPos = i;
        }
      }
      if (lab.pos !== bestPos) {
        lab.prev = lab.pos;
        lab.pos = bestPos;
        lab.t0 = lab.prev < 0 ? -1e9 : clock;
      }
      placed.push(labelRect(m.bb, bestPos, f));
    }

    // Marks.
    for (const m of sm) {
      const s = st[m.id];
      ctx.lineCap = "butt";
      if (m.kind === "pill") {
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.pa.x, m.pa.y);
        ctx.lineTo(m.pb.x + (m.best < 0.01 ? 0.01 : 0), m.pb.y);
        ctx.strokeStyle = INK;
        ctx.lineWidth = m.wPill + m.rim * 2;
        ctx.stroke();
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = m.wPill;
        ctx.stroke();
      } else if (m.kind === "bar") {
        ctx.strokeStyle = LINES[m.li].color;
        ctx.lineWidth = W;
        ctx.beginPath();
        ctx.moveTo(m.a.x, m.a.y);
        ctx.lineTo(m.b.x, m.b.y);
        ctx.stroke();
      } else if (m.kind === "tick") {
        const a = tickOn[m.id];
        if (a < 0.01) continue;
        // The tick points to the name; a name set square along the line
        // leaves it on the upper or right-hand side.
        const d = DIRS[labels[m.id]?.pos ?? 2];
        let side = Math.sign(d[0] * m.n[0] + d[1] * m.n[1]);
        if (!side) side = m.n[1] < 0 || (!m.n[1] && m.n[0] > 0) ? 1 : -1;
        const r0 = W * 0.5 - 0.5;
        const r1 = r0 + (m.reach - r0) * a;
        ctx.strokeStyle = LINES[m.li].color;
        ctx.lineWidth = W * 0.8;
        ctx.beginPath();
        ctx.moveTo(m.p.x + m.n[0] * side * r0, m.p.y + m.n[1] * side * r0);
        ctx.lineTo(m.p.x + m.n[0] * side * r1, m.p.y + m.n[1] * side * r1);
        ctx.stroke();
      } else if (s.grow > 0.02) {
        // A bend is still something to hold: under the hand it shows a dot.
        ctx.globalAlpha = Math.min(1, s.grow * 1.5);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(m.p.x, m.p.y, W * 0.5 * (1 + s.grow * 0.22), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Lettering, over everything. A change of place is a short cross-fade:
    // the old name draws in toward its mark and goes, the new one comes out
    // from it, so nothing slides across a line.
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = TRACK;
    for (const m of order) {
      const lab = labels[m.id];
      const f = metric(m.id);
      ctx.font = f.font;
      const k = clamp((clock - lab.t0) / 0.16, 0, 1);
      const e = 1 - (1 - k) ** 3;
      const put = (pos, alpha, pull) => {
        if (alpha < 0.01) return;
        const r = labelRect(m.bb, pos, f);
        const d = DIRS[pos];
        const l = Math.hypot(d[0], d[1]);
        ctx.globalAlpha = alpha;
        const x = r.x0 - (d[0] / l) * pull;
        const y = r.y0 + f.cap - (d[1] / l) * pull;
        ctx.fillText(NAMES[m.id], x, Math.round(y * dpr) / dpr);
      };
      put(lab.pos, e, (1 - e) * 4);
      if (k < 1 && lab.prev >= 0) put(lab.prev, 1 - e, e * 4);
    }
    ctx.globalAlpha = 1;
    ctx.letterSpacing = "0px";
  }

  // ---- lettering ----------------------------------------------------------
  // E, NE, N, NW, W, SW, S, SE: a preference for setting a name level with its
  // mark, then on a corner, then above or below.
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
  const PREF = [0, 1.2, 2.4, 1.6, 0.4, 1.6, 2.4, 1.2];
  const GAP = 6;
  const labels = {};
  const tickOn = {};
  let clock = 0;
  const rank = (m) => (m.kind === "pill" ? 0 : TERM.has(m.id) ? 1 : 2);
  const box = (ps, pad) => ({
    x0: Math.min(...ps.map((p) => p.x)) - pad,
    y0: Math.min(...ps.map((p) => p.y)) - pad,
    x1: Math.max(...ps.map((p) => p.x)) + pad,
    y1: Math.max(...ps.map((p) => p.y)) + pad,
  });
  const hits = (a, b, pad) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  // The name's box runs from cap height to descender. Level with the mark it
  // centres its capitals on the mark; above, its baseline sits the gap clear.
  function labelRect(bb, i, f) {
    const [dx, dy] = DIRS[i];
    const g = dx && dy ? GAP * 0.6 : GAP;
    const x0 = dx > 0 ? bb.x1 + g : dx < 0 ? bb.x0 - g - f.w : (bb.x0 + bb.x1) / 2 - f.w / 2;
    const y0 = dy > 0 ? bb.y1 + g : dy < 0 ? bb.y0 - g - f.cap : (bb.y0 + bb.y1) / 2 - f.cap / 2;
    return { x0, y0, x1: x0 + f.w, y1: y0 + f.cap + f.desc };
  }
  // Every line as straight pieces, its bends cut to three chords of the arc.
  // The line ends square, so its two ends are drawn in by half a stroke, or
  // a name set beyond the end of a line would read as touching it.
  function flatten(paths) {
    const out = [];
    const inset = (v, w) => {
      const l = Math.hypot(w.x - v.x, w.y - v.y) || 1;
      const k = Math.min(W * 0.5, l * 0.5) / l;
      return [v.x + (w.x - v.x) * k, v.y + (w.y - v.y) * k];
    };
    for (const vs of paths) {
      let [px, py] = inset(vs[0], vs[1]);
      const to = (x, y) => {
        out.push([px, py, x, y]);
        px = x;
        py = y;
      };
      for (let i = 1; i < vs.length; i++) {
        const v = vs[i];
        if (i === vs.length - 1) to(...inset(v, vs[i - 1]));
        else if (v.r > 0.2 && v.d1) {
          const t = v.r * v.tan;
          const bx = v.d2[0] - v.d1[0];
          const by = v.d2[1] - v.d1[1];
          const bl = Math.hypot(bx, by) || 1;
          const dm = v.r / Math.cos(v.theta / 2) - v.r;
          to(v.x - v.d1[0] * t, v.y - v.d1[1] * t);
          to(v.x + (bx / bl) * dm, v.y + (by / bl) * dm);
          to(v.x + v.d2[0] * t, v.y + v.d2[1] * t);
        } else to(v.x, v.y);
      }
    }
    return out;
  }
  // Length of a segment inside a box grown by pad (Liang-Barsky).
  function clipLen([ax, ay, bx, by], r, pad) {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - (r.x0 - pad), r.x1 + pad - ax, ay - (r.y0 - pad), r.y1 + pad - ay];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-9) {
        if (q[i] < 0) return 0;
        continue;
      }
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return 0;
    }
    return (t1 - t0) * Math.hypot(dx, dy);
  }
  const metrics = {};
  function metric(id) {
    if (metrics[id]) return metrics[id];
    const font = `${TERM.has(id) ? W_TERM : W_STOP} ${SIZE}px ${SANS}`;
    ctx.font = font;
    ctx.letterSpacing = TRACK;
    const w = ctx.measureText(NAMES[id]).width;
    const cap = ctx.measureText("H").actualBoundingBoxAscent || SIZE * 0.71;
    ctx.letterSpacing = "0px";
    return (metrics[id] = { font, w, cap, desc: SIZE * 0.24 });
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
    near = Object.fromEntries(ids.map((n) => [n, drag.hop[n] ?? 99]));
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
    draw(Math.min(dt, 0.1));
  });

  return {
    destroy: () => {
      alive = false;
      stage.destroy();
    },
  };
}
