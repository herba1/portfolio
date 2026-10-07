const WIDE = {
  sizeTop: 0.2,
  sizeRatio: 0.84,
  armTop: 0.45,
  armRatio: 0.78,
  armThread: 0.25,
  coverThread: 0.1,
  directions: [1],
  curlFromEnd: 1,
};
const TALL = {
  sizeTop: 0.2,
  sizeRatio: 0.9,
  armTop: 0.3,
  armRatio: 0.86,
  armThread: 0.8,
  coverThread: 0.1,
  directions: [1, -1],
  curlFromEnd: 0,
};
const MIN_THREAD_PX = 14;
const ARM_DROOP = 0.07;
const ROD_MASS = 0.06;
const TILT_MIN = 0.035;
const TILT_MAX = 0.11;
const MAX_TOP_COVER_PX = 300;
const HOOK_SHARE = 0.5;
const GAP_SHARE = 0.16;
const SEARCH_ATTEMPTS = 28;
const THREAD_STRETCH = 0.3;
const THREAD_STEPS = [1.15, 0.87];

export const FOLD_ANGLE = -Math.PI * 0.46;

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function slotTilt(id, seed) {
  const random = mulberry32(hashString(`${id}|${seed}`));
  const magnitude = TILT_MIN + (TILT_MAX - TILT_MIN) * random();
  return random() < 0.5 ? -magnitude : magnitude;
}

function shapeFor(width, height) {
  return width / Math.max(1, height) < 0.8 ? TALL : WIDE;
}

function unitStructure(count, shape) {
  const sizes = [];
  const masses = [];
  for (let index = 0; index < count; index += 1) {
    const size = shape.sizeTop * shape.sizeRatio ** index;
    sizes.push(size);
    masses.push((size / shape.sizeTop) ** 2);
  }
  const armCount = count - 1;
  const arms = [];
  for (let index = 0; index < armCount; index += 1) {
    const length = shape.armTop * shape.armRatio ** index;
    arms.push({
      length,
      depth: ARM_DROOP * length,
      mass: ROD_MASS * (length / shape.armTop),
      thread: shape.armThread * length,
      coverThread: shape.coverThread * length,
      direction:
        shape.directions[index % shape.directions.length] *
        (shape.curlFromEnd && index === armCount - shape.curlFromEnd && armCount > 3 ? -1 : 1),
    });
  }
  for (let index = armCount - 1; index >= 0; index -= 1) {
    const arm = arms[index];
    const next = arms[index + 1];
    arm.outer = masses[index];
    arm.inner = next ? next.mass + next.outer + next.inner : masses[count - 1];
    arm.total = arm.outer + arm.inner + arm.mass;
    arm.balance = (arm.inner * arm.length + arm.mass * arm.length * 0.5) / arm.total;
    arm.momentY = (arm.outer + arm.inner) * arm.depth + (arm.mass * arm.depth) / 3;
  }
  return { sizes, masses, arms };
}

export function pivotShift(arm, tilt) {
  return (-arm.direction * Math.tan(tilt) * arm.momentY) / arm.total;
}

function rotate(angle, x, y, out) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out.x = x * cos - y * sin;
  out.y = x * sin + y * cos;
  return out;
}

export function poseStructure(structure, pivots, angles, topPivot) {
  const { sizes, arms } = structure;
  const armPoses = [];
  const coverPoses = [];
  const scratch = { x: 0, y: 0 };
  let pivotX = topPivot.x;
  let pivotY = topPivot.y;
  for (let index = 0; index < arms.length; index += 1) {
    const arm = arms[index];
    const angle = angles[index];
    const along = pivots[index];
    const direction = arm.direction;
    rotate(angle, direction * (arm.length * 0.5 - along), arm.depth / 3, scratch);
    const comX = pivotX + scratch.x;
    const comY = pivotY + scratch.y;
    rotate(angle, -direction * along, arm.depth, scratch);
    const outerX = pivotX + scratch.x;
    const outerY = pivotY + scratch.y;
    rotate(angle, direction * (arm.length - along), arm.depth, scratch);
    const innerX = pivotX + scratch.x;
    const innerY = pivotY + scratch.y;
    armPoses.push({ x: comX, y: comY, angle, pivotX, pivotY, outerX, outerY, innerX, innerY });
    coverPoses.push({ x: outerX, y: outerY + arm.coverThread + sizes[index] * 0.5, angle: 0 });
    if (index === arms.length - 1) {
      coverPoses.push({ x: innerX, y: innerY + arm.coverThread + sizes[index + 1] * 0.5, angle: 0 });
    } else {
      pivotX = innerX;
      pivotY = innerY + arms[index + 1].thread;
    }
  }
  return { arms: armPoses, covers: coverPoses };
}

function worstGap(pose, sizes) {
  let worst = Infinity;
  let pairA = -1;
  let pairB = -1;
  const covers = pose.covers;
  for (let a = 0; a < covers.length; a += 1) {
    for (let b = a + 1; b < covers.length; b += 1) {
      const reach = (sizes[a] + sizes[b]) * 0.5;
      const gapX = Math.abs(covers[a].x - covers[b].x) - reach;
      const gapY = Math.abs(covers[a].y - covers[b].y) - reach;
      const gap = Math.max(gapX, gapY);
      if (gap < worst) {
        worst = gap;
        pairA = a;
        pairB = b;
      }
    }
  }
  return { worst, pairA, pairB };
}

function withThreads(structure, threads) {
  return { ...structure, arms: structure.arms.map((arm, index) => ({ ...arm, coverThread: threads[index] })) };
}

export function balancedHang(structure, ids, seed, { stretch = false } = {}) {
  const { arms, sizes } = structure;
  const tilts = arms.map((arm, index) => slotTilt(ids[index] ?? index, seed));
  const baseThreads = arms.map((arm) => arm.coverThread);
  const threads = baseThreads.slice();
  const margin = sizes[0] * GAP_SHARE;
  const origin = { x: 0, y: 0 };
  const poseFor = (candidateTilts, candidateThreads) =>
    poseStructure(
      withThreads(structure, candidateThreads),
      arms.map((arm, index) => arm.balance + pivotShift(arm, candidateTilts[index])),
      candidateTilts,
      origin,
    );
  let current = worstGap(poseFor(tilts, threads), sizes);
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS && current.worst < margin; attempt += 1) {
    let best = null;
    const consider = (candidateTilts, candidateThreads) => {
      const result = worstGap(poseFor(candidateTilts, candidateThreads), sizes);
      if (!best || result.worst > best.result.worst) best = { tilts: candidateTilts, threads: candidateThreads, result };
    };
    const first = Math.max(0, current.pairA - 1);
    const last = Math.min(arms.length - 1, current.pairB);
    for (let armIndex = first; armIndex <= last; armIndex += 1) {
      for (const change of [-1, 0.45]) {
        const candidate = tilts.slice();
        candidate[armIndex] *= change;
        consider(candidate, threads);
      }
      if (!stretch) continue;
      for (const change of THREAD_STEPS) {
        const candidate = threads.slice();
        const low = baseThreads[armIndex] * (1 - THREAD_STRETCH);
        const high = baseThreads[armIndex] * (1 + THREAD_STRETCH);
        candidate[armIndex] = Math.min(high, Math.max(low, candidate[armIndex] * change));
        if (candidate[armIndex] !== threads[armIndex]) consider(tilts, candidate);
      }
    }
    if (!best || best.result.worst <= current.worst + 1e-9) break;
    for (let index = 0; index < tilts.length; index += 1) {
      tilts[index] = best.tilts[index];
      threads[index] = best.threads[index];
    }
    current = best.result;
  }
  return { tilts, threads };
}

function boundsOf(pose, sizes) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  pose.arms.forEach((arm) => {
    include(arm.pivotX, arm.pivotY);
    include(arm.outerX, arm.outerY);
    include(arm.innerX, arm.innerY);
  });
  pose.covers.forEach((cover, index) => {
    const half = sizes[index] * 0.5;
    include(cover.x - half, cover.y - half);
    include(cover.x + half, cover.y + half);
  });
  return { minX, maxX, minY, maxY };
}

export function buildMobile({ count, seed, width, height, ids, insets }) {
  const shape = shapeFor(width, height);
  const structure = unitStructure(count, shape);
  const unitHang = balancedHang(structure, ids, seed, { stretch: true });
  const tilts = unitHang.tilts;
  const unitStructureHung = withThreads(structure, unitHang.threads);
  const pivots = structure.arms.map((arm, index) => arm.balance + pivotShift(arm, tilts[index]));
  const unitPose = poseStructure(unitStructureHung, pivots, tilts, { x: 0, y: 0 });
  const bounds = boundsOf(unitPose, structure.sizes);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const availableWidth = Math.max(120, width - insets.side * 2);
  const availableHeight = Math.max(120, height - insets.top - insets.bottom);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY, MAX_TOP_COVER_PX / shape.sizeTop);
  const slackY = availableHeight - spanY * scale;
  const anchorX = width * 0.5 - (bounds.minX + bounds.maxX) * 0.5 * scale;
  const topPivotY = insets.top + slackY * 0.38 - bounds.minY * scale;

  const arms = structure.arms.map((arm, index) => ({
    length: arm.length * scale,
    depth: arm.depth * scale,
    mass: arm.mass,
    inertia: (arm.mass * (arm.length * scale) ** 2) / 12,
    balance: arm.balance * scale,
    momentY: arm.momentY * scale,
    total: arm.total,
    thread: index === 0 ? topPivotY : Math.max(MIN_THREAD_PX, arm.thread * scale),
    coverThread: Math.max(MIN_THREAD_PX, unitHang.threads[index] * scale),
    direction: arm.direction,
  }));
  const covers = structure.sizes.map((size, index) => {
    const pixels = size * scale;
    const mass = structure.masses[index];
    return {
      size: pixels,
      mass,
      inertia: (mass * pixels * pixels) / 6,
      hookMass: mass * HOOK_SHARE,
      hookInertia: (mass * HOOK_SHARE * pixels * pixels) / 6,
    };
  });

  const pxStructure = { sizes: covers.map((cover) => cover.size), arms };
  const restTilts = balancedHang(pxStructure, ids, seed).tilts;
  const restPivots = arms.map((arm, index) => arm.balance + pivotShift(arm, restTilts[index]));
  const rest = poseStructure(pxStructure, restPivots, restTilts, { x: anchorX, y: topPivotY });
  const folded = poseStructure(
    pxStructure,
    restPivots,
    arms.map((arm) => arm.direction * FOLD_ANGLE),
    { x: anchorX, y: topPivotY },
  );

  return {
    count,
    seed,
    width,
    height,
    scale,
    anchor: { x: anchorX, y: 0 },
    arms,
    covers,
    tilts: restTilts,
    pivots: restPivots,
    rest,
    folded,
    structure: pxStructure,
  };
}

export function pivotsFor(mobile, ids) {
  const { tilts } = balancedHang(mobile.structure, ids, mobile.seed);
  return mobile.arms.map((arm, index) => arm.balance + pivotShift(arm, tilts[index]));
}
