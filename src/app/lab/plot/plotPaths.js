export function plotJob(job) {
  const { gray, size, count, seed } = job;
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const W = size;
  const N2 = W * W;
  const hist = new Uint32Array(256);
  for (let i = 0; i < N2; i += 1)
    hist[Math.min(255, Math.max(0, Math.round(gray[i] * 255)))] += 1;
  const pick = (q) => {
    let acc = 0;
    for (let i = 0; i < 256; i += 1) {
      acc += hist[i];
      if (acc >= q * N2) return i / 255;
    }
    return 1;
  };
  const lo = pick(0.02);
  const hi = Math.max(lo + 0.1, pick(0.985));
  const dark = new Float32Array(N2);
  const blurred = new Float32Array(N2);
  const box = (src, dst, r) => {
    const tmp = new Float32Array(N2);
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let acc = 0;
        let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const xx = x + k;
          if (xx < 0 || xx >= W) continue;
          acc += src[y * W + xx];
          c += 1;
        }
        tmp[y * W + x] = acc / c;
      }
    }
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let acc = 0;
        let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const yy = y + k;
          if (yy < 0 || yy >= W) continue;
          acc += tmp[yy * W + x];
          c += 1;
        }
        dst[y * W + x] = acc / c;
      }
    }
  };
  const wide = new Float32Array(N2);
  box(gray, wide, Math.max(2, Math.round(W / 64)));
  box(gray, blurred, 1);
  const sharpen = job.sharpen ?? 1.2;
  for (let i = 0; i < N2; i += 1)
    blurred[i] = blurred[i] + sharpen * (blurred[i] - wide[i]);
  for (let i = 0; i < N2; i += 1) {
    const l = Math.min(1, Math.max(0, (blurred[i] - lo) / (hi - lo)));
    dark[i] = Math.pow(1 - l, job.gamma || 1.3) * (job.cap || 0.86);
  }
  const darkAt = (u, v) => {
    const x = Math.min(W - 1, Math.max(0, u * W - 0.5));
    const y = Math.min(W - 1, Math.max(0, v * W - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(W - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = dark[y0 * W + x0] * (1 - fx) + dark[y0 * W + x1] * fx;
    const b = dark[y1 * W + x0] * (1 - fx) + dark[y1 * W + x1] * fx;
    return a * (1 - fy) + b * fy;
  };

  const n = count;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  let placed = 0;
  let guard = 0;
  while (placed < n && guard < n * 400) {
    guard += 1;
    const u = rand();
    const v = rand();
    if (rand() < darkAt(u, v)) {
      px[placed] = u;
      py[placed] = v;
      placed += 1;
    }
  }
  const total = placed;
  const G = Math.max(8, Math.floor(Math.sqrt(total) * 0.7));
  const cellHead = new Int32Array(G * G);
  const cellNext = new Int32Array(total);
  const rebuild = () => {
    cellHead.fill(-1);
    for (let i = 0; i < total; i += 1) {
      const c =
        Math.min(G - 1, Math.floor(py[i] * G)) * G +
        Math.min(G - 1, Math.floor(px[i] * G));
      cellNext[i] = cellHead[c];
      cellHead[c] = i;
    }
  };
  const nearest = (u, v) => {
    const gx = Math.min(G - 1, Math.floor(u * G));
    const gy = Math.min(G - 1, Math.floor(v * G));
    let best = -1;
    let bd = Infinity;
    for (let ring = 0; ring < G; ring += 1) {
      for (let yy = gy - ring; yy <= gy + ring; yy += 1) {
        if (yy < 0 || yy >= G) continue;
        for (let xx = gx - ring; xx <= gx + ring; xx += 1) {
          if (xx < 0 || xx >= G) continue;
          if (
            ring > 0 &&
            yy !== gy - ring &&
            yy !== gy + ring &&
            xx !== gx - ring &&
            xx !== gx + ring
          )
            continue;
          for (let i = cellHead[yy * G + xx]; i !== -1; i = cellNext[i]) {
            const dx = px[i] - u;
            const dy = py[i] - v;
            const dd = dx * dx + dy * dy;
            if (dd < bd) {
              bd = dd;
              best = i;
            }
          }
        }
      }
      if (best !== -1 && ring >= 1) {
        const reach = ring / G;
        if (bd <= reach * reach) break;
      }
    }
    return best;
  };
  const sx = new Float64Array(total);
  const sy = new Float64Array(total);
  const sw = new Float64Array(total);
  const iterations = job.iterations || 14;
  for (let it = 0; it < iterations; it += 1) {
    rebuild();
    sx.fill(0);
    sy.fill(0);
    sw.fill(0);
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const w = dark[y * W + x] * dark[y * W + x];
        if (w < 0.0004) continue;
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / W;
        const k = nearest(u, v);
        sx[k] += u * w;
        sy[k] += v * w;
        sw[k] += w;
      }
    }
    for (let i = 0; i < total; i += 1) {
      if (sw[i] > 0) {
        px[i] = sx[i] / sw[i];
        py[i] = sy[i] / sw[i];
      }
    }
  }

  rebuild();
  const K = 8;
  const neigh = new Int32Array(total * K);
  for (let i = 0; i < total; i += 1) {
    const gx = Math.min(G - 1, Math.floor(px[i] * G));
    const gy = Math.min(G - 1, Math.floor(py[i] * G));
    const cand = [];
    for (let ring = 1; ring < G && cand.length < K + 1; ring += 1) {
      cand.length = 0;
      for (
        let yy = Math.max(0, gy - ring);
        yy <= Math.min(G - 1, gy + ring);
        yy += 1
      ) {
        for (
          let xx = Math.max(0, gx - ring);
          xx <= Math.min(G - 1, gx + ring);
          xx += 1
        ) {
          for (let j = cellHead[yy * G + xx]; j !== -1; j = cellNext[j])
            if (j !== i) cand.push(j);
        }
      }
    }
    cand.sort(
      (a, b) =>
        (px[a] - px[i]) ** 2 +
        (py[a] - py[i]) ** 2 -
        ((px[b] - px[i]) ** 2 + (py[b] - py[i]) ** 2),
    );
    for (let k = 0; k < K; k += 1)
      neigh[i * K + k] =
        k < cand.length ? cand[k] : (cand[cand.length - 1] ?? i);
  }

  const used = new Uint8Array(total);
  const tour = new Int32Array(total);
  let cur = nearest(0.5, 0.5);
  for (let step = 0; step < total; step += 1) {
    tour[step] = cur;
    used[cur] = 1;
    let next = -1;
    let bd = Infinity;
    for (let k = 0; k < K; k += 1) {
      const j = neigh[cur * K + k];
      if (used[j]) continue;
      const dd = (px[j] - px[cur]) ** 2 + (py[j] - py[cur]) ** 2;
      if (dd < bd) {
        bd = dd;
        next = j;
      }
    }
    if (next === -1) {
      const gx = Math.min(G - 1, Math.floor(px[cur] * G));
      const gy = Math.min(G - 1, Math.floor(py[cur] * G));
      for (let ring = 0; ring < G && next === -1; ring += 1) {
        for (
          let yy = Math.max(0, gy - ring);
          yy <= Math.min(G - 1, gy + ring);
          yy += 1
        ) {
          for (
            let xx = Math.max(0, gx - ring);
            xx <= Math.min(G - 1, gx + ring);
            xx += 1
          ) {
            if (
              ring > 0 &&
              yy !== gy - ring &&
              yy !== gy + ring &&
              xx !== gx - ring &&
              xx !== gx + ring
            )
              continue;
            for (let j = cellHead[yy * G + xx]; j !== -1; j = cellNext[j]) {
              if (used[j]) continue;
              const dd = (px[j] - px[cur]) ** 2 + (py[j] - py[cur]) ** 2;
              if (dd < bd) {
                bd = dd;
                next = j;
              }
            }
          }
        }
      }
    }
    if (next === -1) break;
    cur = next;
  }

  const pos = new Int32Array(total);
  for (let i = 0; i < total; i += 1) pos[tour[i]] = i;
  const dist = (a, b) => Math.hypot(px[a] - px[b], py[a] - py[b]);
  const succ = (a) => tour[(pos[a] + 1) % total];
  const pred = (a) => tour[(pos[a] - 1 + total) % total];
  const reverse = (i, j) => {
    let len = ((j - i + total) % total) + 1;
    if (len * 2 > total) {
      const ni = (j + 1) % total;
      const nj = (i - 1 + total) % total;
      i = ni;
      j = nj;
      len = total - len;
    }
    for (let k = 0; k < len >> 1; k += 1) {
      const a = (i + k) % total;
      const b = (j - k + total) % total;
      const ta = tour[a];
      const tb = tour[b];
      tour[a] = tb;
      tour[b] = ta;
      pos[tb] = a;
      pos[ta] = b;
    }
  };
  const active = new Uint8Array(total).fill(1);
  const queue = [];
  for (let i = 0; i < total; i += 1) queue.push(tour[i]);
  let budget = total * 80;
  const runTwoOpt = () => {
    while (queue.length && budget > 0) {
      budget -= 1;
      const a = queue.pop();
      active[a] = 0;
      let improved = false;
      for (let dir = 0; dir < 2 && !improved; dir += 1) {
        const b = dir === 0 ? succ(a) : pred(a);
        const dab = dist(a, b);
        for (let k = 0; k < K; k += 1) {
          const c = neigh[a * K + k];
          const dac = dist(a, c);
          if (dac >= dab) break;
          const d = dir === 0 ? succ(c) : pred(c);
          if (c === b || d === a) continue;
          const delta = dac + dist(b, d) - dab - dist(c, d);
          if (delta < -1e-9) {
            if (dir === 0) reverse(pos[b], pos[c]);
            else reverse(pos[c], pos[b]);
            for (const z of [a, b, c, d]) {
              if (!active[z]) {
                active[z] = 1;
                queue.push(z);
              }
            }
            improved = true;
            break;
          }
        }
      }
    }
  };
  runTwoOpt();

  for (let round = 0; round < 6; round += 1) {
    const lens = [];
    for (let i = 0; i < total; i += 1)
      lens.push([dist(tour[i], tour[(i + 1) % total]), tour[i]]);
    lens.sort((x, y) => y[0] - x[0]);
    const longs = lens
      .slice(0, Math.min(240, Math.ceil(total * 0.02)))
      .map((e) => e[1]);
    let changed = 0;
    for (let i = 0; i < longs.length; i += 1) {
      for (let j = i + 1; j < longs.length; j += 1) {
        const a = longs[i];
        const c = longs[j];
        const b = succ(a);
        const d = succ(c);
        if (a === c || b === c || d === a) continue;
        const delta = dist(a, c) + dist(b, d) - dist(a, b) - dist(c, d);
        if (delta < -1e-9) {
          reverse(pos[b], pos[c]);
          changed += 1;
          for (const z of [a, b, c, d]) {
            if (!active[z]) {
              active[z] = 1;
              queue.push(z);
            }
          }
        }
      }
    }
    if (!changed) break;
    runTwoOpt();
  }

  let cut = 0;
  let longest = -1;
  for (let i = 0; i < total; i += 1) {
    const l = dist(tour[i], tour[(i + 1) % total]);
    if (l > longest) {
      longest = l;
      cut = i;
    }
  }
  const out = new Float32Array(total * 2);
  for (let k = 0; k < total; k += 1) {
    const id = tour[(cut + 1 + k) % total];
    out[k * 2] = px[id];
    out[k * 2 + 1] = py[id];
  }
  return out;
}
