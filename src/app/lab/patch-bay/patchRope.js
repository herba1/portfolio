const LEAN = 0.32;
const SIN = Math.sin(LEAN);
const COS = Math.cos(LEAN);

export function createRope(length, spacing) {
  const n = Math.max(14, Math.min(72, Math.round(length / spacing) + 1));
  return {
    n,
    length,
    seg: length / (n - 1),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    pz: new Float32Array(n),
    w: new Float32Array(n).fill(1),
    touch: new Uint8Array(n),
  };
}

export function layRope(rope, a, b, sag) {
  const { n } = rope;
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * sag;
    const z = a[2] + (b[2] - a[2]) * t;
    rope.x[i] = rope.px[i] = x;
    rope.y[i] = rope.py[i] = y;
    rope.z[i] = rope.pz[i] = z;
  }
}

function pin(rope, i, p) {
  rope.x[i] = p[0];
  rope.y[i] = p[1];
  rope.z[i] = p[2];
}

function collide(rope, i, env, radius) {
  let x = rope.x[i];
  let y = rope.y[i];
  let z = rope.z[i];
  let touch = 0;
  if (z < radius) {
    z = radius;
    touch = 1;
  }
  if (y > env.floor - radius) {
    y = env.floor - radius;
    touch = 2;
  }
  if (x < env.left + radius) x = env.left + radius;
  if (x > env.right - radius) x = env.right - radius;
  const cols = env.colliders;
  for (let c = 0; c < cols.length; c += 1) {
    const col = cols[c];
    if (col.skip === rope && (i < 5 || i > rope.n - 6)) continue;
    const reach = col.r + radius;
    const dx = x - col.x;
    const dy = y - col.y;
    if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
    const top = col.h + radius;
    if (z >= top) continue;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= reach) continue;
    const radial = reach - dist;
    const lift = top - z;
    if (lift < radial) {
      z = top;
      touch = 1;
    } else if (dist > 1e-4) {
      x += (dx / dist) * radial;
      y += (dy / dist) * radial;
    } else {
      x += radial;
    }
  }
  rope.x[i] = x;
  rope.y[i] = y;
  rope.z[i] = z;
  rope.touch[i] = touch;
}

export function stepRope(rope, env, h, ends) {
  const { n, x, y, z, px, py, pz, w } = rope;
  const gy = env.gravity * COS * h * h;
  const gz = -env.gravity * SIN * h * h;
  const damp = env.damping;
  for (let i = 0; i < n; i += 1) {
    if (w[i] === 0) continue;
    let vx = x[i] - px[i];
    let vy = y[i] - py[i];
    let vz = z[i] - pz[i];
    const speed = Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
    const k = speed < env.settle ? damp * (0.97 + (0.03 * speed) / env.settle) : damp;
    vx *= k;
    vy *= k;
    vz *= k;
    px[i] = x[i];
    py[i] = y[i];
    pz[i] = z[i];
    x[i] += vx;
    y[i] += vy + gy;
    z[i] += vz + gz;
  }
  const head = ends[0];
  const tail = ends[1];
  if (head.pinned) {
    px[0] = x[0];
    py[0] = y[0];
    pz[0] = z[0];
    pin(rope, 0, head.tail);
  }
  if (tail.pinned) {
    px[n - 1] = x[n - 1];
    py[n - 1] = y[n - 1];
    pz[n - 1] = z[n - 1];
    pin(rope, n - 1, tail.tail);
  }
  w[0] = head.pinned ? 0 : 0.35;
  w[n - 1] = tail.pinned ? 0 : 0.35;
  const seg = rope.seg;
  const minBend = seg * 1.86;
  const radius = env.radius;
  for (let it = 0; it < env.iterations; it += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const j = i + 1;
      const wi = w[i];
      const wj = w[j];
      const sum = wi + wj;
      if (sum === 0) continue;
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const k = (dist - seg) / (dist * sum);
      x[i] += dx * k * wi;
      y[i] += dy * k * wi;
      z[i] += dz * k * wi;
      x[j] -= dx * k * wj;
      y[j] -= dy * k * wj;
      z[j] -= dz * k * wj;
    }
    for (let i = 0; i < n - 2; i += 1) {
      const j = i + 2;
      const wi = w[i];
      const wj = w[j];
      const sum = wi + wj;
      if (sum === 0) continue;
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      if (dist >= minBend) continue;
      const k = ((dist - minBend) / (dist * sum)) * 0.5;
      x[i] += dx * k * wi;
      y[i] += dy * k * wi;
      z[i] += dz * k * wi;
      x[j] -= dx * k * wj;
      y[j] -= dy * k * wj;
      z[j] -= dz * k * wj;
    }
    if (head.pinned) {
      const a = head.axis;
      x[1] += (head.tail[0] + a[0] * seg - x[1]) * 0.5;
      y[1] += (head.tail[1] + a[1] * seg - y[1]) * 0.5;
      z[1] += (head.tail[2] + a[2] * seg - z[1]) * 0.5;
    }
    if (tail.pinned) {
      const a = tail.axis;
      x[n - 2] += (tail.tail[0] + a[0] * seg - x[n - 2]) * 0.5;
      y[n - 2] += (tail.tail[1] + a[1] * seg - y[n - 2]) * 0.5;
      z[n - 2] += (tail.tail[2] + a[2] * seg - z[n - 2]) * 0.5;
    }
    if (it % 2 === 1 || it === env.iterations - 1) {
      for (let i = 0; i < n; i += 1) {
        if (w[i] === 0) continue;
        collide(rope, i, env, i === 0 || i === n - 1 ? env.plugRadius : radius);
      }
    }
  }
  let motion = 0;
  for (let i = 0; i < n; i += 1) {
    if (w[i] === 0) continue;
    const t = rope.touch[i];
    if (t) {
      const mu = t === 2 ? env.floorFriction : env.friction;
      px[i] += (x[i] - px[i]) * mu;
      py[i] += (y[i] - py[i]) * mu;
    }
    const m = Math.abs(x[i] - px[i]) + Math.abs(y[i] - py[i]) + Math.abs(z[i] - pz[i]);
    if (m > motion) motion = m;
  }
  return motion;
}
