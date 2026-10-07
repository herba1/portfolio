const SUBSTEPS = 16;
const THREAD_PASSES = 5;
const GRAB_FORCE_SHARE = 6;
const FLING_SPIN = 0.0016;
const FLING_SPIN_CAP = 6;
const MAX_FRAME = 1 / 30;
const MIN_FRAME = 1 / 240;
const GRAB_COMPLIANCE = 2e-4;
const WIND_RADIUS = 160;
const WIND_GAIN = 3.5;
const WIND_CAP = 760;
const WIND_MIN_SPEED = 60;
const WIND_FULL_SPEED = 2400;
const YAW_GAIN = 0.01;
const YAW_CAP = 36;
const YAW_STIFFNESS = 1.1;
const YAW_DAMPING_TIME = 4.2;
const ARM_YAW_STIFFNESS = 0.9;
const ARM_YAW_LIMIT = 0.9;
const PIVOT_SLIDE_TIME = 0.22;
const ARM_DRAG = 2.4;
const ARM_INERTIA_BOOST = 10;
const REACH_SOFT = 0.8;
const REACH_HARD = 0.92;
const GRAB_VELOCITY_BLEND = 0.15;
const GRAB_SPIN_TIME = 0.16;
const KNOT_SPIN = 0.6;
const KNOT_SPIN_TIME = 0.25;
const KNOT_DRIFT = 30;
const KNOT_DRIFT_TIME = 0.7;

export const PHYSICS_DEFAULTS = {
  gravity: 2000,
  linearDamping: 2,
  angularDamping: 1.5,
  wind: 1,
};

export function createMobileSim(mobile, random) {
  const armCount = mobile.arms.length;
  const coverCount = mobile.covers.length;
  const bodyCount = armCount + coverCount;

  const x = new Float64Array(bodyCount);
  const y = new Float64Array(bodyCount);
  const angle = new Float64Array(bodyCount);
  const prevX = new Float64Array(bodyCount);
  const prevY = new Float64Array(bodyCount);
  const prevAngle = new Float64Array(bodyCount);
  const vx = new Float64Array(bodyCount);
  const vy = new Float64Array(bodyCount);
  const omega = new Float64Array(bodyCount);
  const mass = new Float64Array(bodyCount);
  const invMass = new Float64Array(bodyCount);
  const invInertia = new Float64Array(bodyCount);
  const yaw = new Float64Array(bodyCount);
  const yawVelocity = new Float64Array(bodyCount);
  const yawPhase = new Float64Array(bodyCount);
  const yawRate = new Float64Array(bodyCount);
  const yawReach = new Float64Array(bodyCount);

  const pivotAlong = new Float64Array(armCount);
  const pivotTarget = new Float64Array(armCount);
  const armScale = new Float64Array(armCount);
  const armPivotX = new Float64Array(armCount);
  const armPivotY = new Float64Array(armCount);
  const armHalf = new Float64Array(armCount);
  const armEndY = new Float64Array(armCount);
  const armDirection = new Float64Array(armCount);

  const threadCount = 1 + armCount + coverCount - 1;
  const threadA = new Int32Array(threadCount);
  const threadAPoint = new Int32Array(threadCount);
  const threadB = new Int32Array(threadCount);
  const threadBPoint = new Int32Array(threadCount);
  const threadLength = new Float64Array(threadCount);
  const threadTaut = new Float64Array(threadCount);

  const POINT_ANCHOR = 0;
  const POINT_PIVOT = 1;
  const POINT_OUTER = 2;
  const POINT_INNER = 3;
  const POINT_TIE = 4;

  const anchor = { x: mobile.anchor.x, y: mobile.anchor.y };
  const grab = {
    body: -1,
    localX: 0,
    localY: 0,
    targetX: 0,
    targetY: 0,
    lastX: 0,
    lastY: 0,
    velocityX: 0,
    velocityY: 0,
    reach: Infinity,
  };
  const wind = { x: 0, y: 0, vx: 0, vy: 0, active: 0 };
  const gust = { strength: 0, direction: 1 };
  const point = { x: 0, y: 0 };

  for (let index = 0; index < armCount; index += 1) {
    const arm = mobile.arms[index];
    mass[index] = arm.mass;
    invMass[index] = 1 / arm.mass;
    invInertia[index] = 1 / (arm.inertia * ARM_INERTIA_BOOST);
    pivotAlong[index] = mobile.pivots[index];
    pivotTarget[index] = mobile.pivots[index];
    armHalf[index] = arm.length * 0.5;
    armEndY[index] = (arm.depth * 2) / 3;
    armScale[index] = 1;
    armDirection[index] = arm.direction;
  }
  for (let index = 0; index < coverCount; index += 1) {
    const body = armCount + index;
    const cover = mobile.covers[index];
    mass[body] = cover.mass;
    invMass[body] = 1 / cover.mass;
    invInertia[body] = 1 / cover.inertia;
  }
  let totalMass = 0;
  for (let body = 0; body < bodyCount; body += 1) totalMass += mass[body];
  for (let body = 0; body < bodyCount; body += 1) {
    const isArm = body < armCount;
    yawPhase[body] = random() * Math.PI * 2;
    yawRate[body] = (isArm ? 0.16 : 0.22) + random() * (isArm ? 0.12 : 0.2);
    yawReach[body] = isArm ? (body === 0 ? 0.42 : 0.24 + random() * 0.2) : 0.28 + random() * 0.24;
  }

  let threadIndex = 0;
  const addThread = (a, aPoint, b, bPoint, length) => {
    threadA[threadIndex] = a;
    threadAPoint[threadIndex] = aPoint;
    threadB[threadIndex] = b;
    threadBPoint[threadIndex] = bPoint;
    threadLength[threadIndex] = length;
    threadIndex += 1;
  };
  addThread(-1, POINT_ANCHOR, 0, POINT_PIVOT, mobile.arms[0].thread);
  for (let index = 0; index < armCount; index += 1) {
    const arm = mobile.arms[index];
    addThread(index, POINT_OUTER, armCount + index, POINT_TIE, arm.coverThread);
    if (index < armCount - 1) addThread(index, POINT_INNER, index + 1, POINT_PIVOT, mobile.arms[index + 1].thread);
    else addThread(index, POINT_INNER, armCount + index + 1, POINT_TIE, arm.coverThread);
  }

  const refreshArmGeometry = () => {
    for (let index = 0; index < armCount; index += 1) {
      const arm = mobile.arms[index];
      const scale = Math.cos(yaw[index]);
      armScale[index] = scale;
      armPivotX[index] = armDirection[index] * (pivotAlong[index] - arm.length * 0.5) * scale;
      armPivotY[index] = -arm.depth / 3;
    }
  };

  const localPoint = (body, kind, out) => {
    if (kind === POINT_TIE) {
      out.x = 0;
      out.y = -mobile.covers[body - armCount].size * 0.5;
      return out;
    }
    if (kind === POINT_PIVOT) {
      out.x = armPivotX[body];
      out.y = armPivotY[body];
      return out;
    }
    out.x = (kind === POINT_OUTER ? -armHalf[body] : armHalf[body]) * armScale[body] * armDirection[body];
    out.y = armEndY[body];
    return out;
  };

  const worldPoint = (body, kind, out) => {
    if (body < 0) {
      out.x = anchor.x;
      out.y = anchor.y;
      return out;
    }
    localPoint(body, kind, out);
    const cos = Math.cos(angle[body]);
    const sin = Math.sin(angle[body]);
    const localX = out.x;
    const localY = out.y;
    out.x = x[body] + localX * cos - localY * sin;
    out.y = y[body] + localX * sin + localY * cos;
    return out;
  };

  const setPose = (pose, offsetY = 0) => {
    for (let index = 0; index < armCount; index += 1) {
      x[index] = pose.arms[index].x;
      y[index] = pose.arms[index].y + offsetY;
      angle[index] = pose.arms[index].angle;
    }
    for (let index = 0; index < coverCount; index += 1) {
      const body = armCount + index;
      x[body] = pose.covers[index].x;
      y[body] = pose.covers[index].y + offsetY;
      angle[body] = pose.covers[index].angle;
    }
    vx.fill(0);
    vy.fill(0);
    omega.fill(0);
    refreshArmGeometry();
  };

  const scratchA = { x: 0, y: 0 };
  const scratchB = { x: 0, y: 0 };

  const solveThread = (thread) => {
    const a = threadA[thread];
    const b = threadB[thread];
    worldPoint(a, threadAPoint[thread], scratchA);
    worldPoint(b, threadBPoint[thread], scratchB);
    const dx = scratchB.x - scratchA.x;
    const dy = scratchB.y - scratchA.y;
    const distance = Math.hypot(dx, dy);
    const stretch = distance - threadLength[thread];
    threadTaut[thread] = stretch;
    if (stretch <= 0 || distance < 1e-9) return;
    const nx = dx / distance;
    const ny = dy / distance;
    let weightA = 0;
    let crossA = 0;
    if (a >= 0) {
      const rx = scratchA.x - x[a];
      const ry = scratchA.y - y[a];
      crossA = rx * ny - ry * nx;
      weightA = invMass[a] + invInertia[a] * crossA * crossA;
    }
    const rbx = scratchB.x - x[b];
    const rby = scratchB.y - y[b];
    const crossB = rbx * ny - rby * nx;
    const weightB = invMass[b] + invInertia[b] * crossB * crossB;
    const lambda = stretch / (weightA + weightB);
    if (a >= 0) {
      x[a] += invMass[a] * lambda * nx;
      y[a] += invMass[a] * lambda * ny;
      angle[a] += invInertia[a] * crossA * lambda;
    }
    x[b] -= invMass[b] * lambda * nx;
    y[b] -= invMass[b] * lambda * ny;
    angle[b] -= invInertia[b] * crossB * lambda;
  };

  const solveGrab = (step) => {
    const body = grab.body;
    if (body < 0) return;
    const cos = Math.cos(angle[body]);
    const sin = Math.sin(angle[body]);
    const rx = grab.localX * cos - grab.localY * sin;
    const ry = grab.localX * sin + grab.localY * cos;
    const dx = x[body] + rx - grab.targetX;
    const dy = y[body] + ry - grab.targetY;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-9) return;
    const nx = dx / distance;
    const ny = dy / distance;
    const cross = rx * ny - ry * nx;
    const weight = invMass[body] + invInertia[body] * cross * cross;
    const lambda = Math.min(distance / (weight + GRAB_COMPLIANCE / (step * step)), grabForce * step * step);
    x[body] -= invMass[body] * lambda * nx;
    y[body] -= invMass[body] * lambda * ny;
    angle[body] -= invInertia[body] * cross * lambda;
  };

  const applyWind = (dt, params) => {
    const speed = Math.hypot(wind.vx, wind.vy);
    const strength = params.wind;
    const gustAccel = gust.strength;
    if ((speed < WIND_MIN_SPEED || strength <= 0) && gustAccel <= 0) return false;
    const radius = WIND_RADIUS * Math.min(1.4, Math.max(0.7, mobile.scale / 700));
    const breath = Math.min(1, speed / WIND_FULL_SPEED);
    const push = WIND_GAIN * strength * breath * Math.sqrt(breath);
    const inverseSpread = 1 / (2 * radius * radius);
    for (let body = 0; body < bodyCount; body += 1) {
      if (body === grab.body) continue;
      const isCover = body >= armCount;
      if (gustAccel > 0) {
        const heightShare = 0.55 + 0.45 * Math.min(1, y[body] / Math.max(1, mobile.height));
        vx[body] += gust.direction * gustAccel * heightShare * dt * (isCover ? 1 : 0.4);
        if (isCover) yawVelocity[body] += gust.direction * gustAccel * 0.004 * dt * (0.6 + yawReach[body]);
      }
      if (speed < WIND_MIN_SPEED || strength <= 0) continue;
      const dx = x[body] - wind.x;
      const dy = y[body] - wind.y;
      const falloff = Math.exp(-(dx * dx + dy * dy) * inverseSpread);
      if (falloff < 0.01) continue;
      let ax = push * (wind.vx - vx[body]) * falloff;
      let ay = push * (wind.vy - vy[body]) * falloff * 0.6;
      const magnitude = Math.hypot(ax, ay);
      if (magnitude > WIND_CAP * strength) {
        const clamp = (WIND_CAP * strength) / magnitude;
        ax *= clamp;
        ay *= clamp;
      }
      vx[body] += ax * dt * (isCover ? 1 : 0.5);
      vy[body] += ay * dt * (isCover ? 1 : 0.5);
      let yawAccel = YAW_GAIN * strength * breath * wind.vx * falloff * (isCover ? 1 : 0.18);
      if (yawAccel > YAW_CAP) yawAccel = YAW_CAP;
      if (yawAccel < -YAW_CAP) yawAccel = -YAW_CAP;
      yawVelocity[body] += yawAccel * dt;
    }
    return true;
  };

  let clock = 0;
  let grabForce = Infinity;

  const stepYaw = (dt, ambient, reduced) => {
    for (let body = 0; body < bodyCount; body += 1) {
      const isArm = body < armCount;
      const target = ambient * yawReach[body] * Math.sin(clock * yawRate[body] + yawPhase[body]);
      const stiffness = isArm ? ARM_YAW_STIFFNESS : YAW_STIFFNESS;
      const dampingTime = reduced ? YAW_DAMPING_TIME / 4 : YAW_DAMPING_TIME;
      yawVelocity[body] += (-(yaw[body] - target) * stiffness - yawVelocity[body] / dampingTime) * dt;
      yaw[body] += yawVelocity[body] * dt;
      if (isArm) {
        if (yaw[body] > ARM_YAW_LIMIT) {
          yaw[body] = ARM_YAW_LIMIT;
          yawVelocity[body] *= -0.3;
        } else if (yaw[body] < -ARM_YAW_LIMIT) {
          yaw[body] = -ARM_YAW_LIMIT;
          yawVelocity[body] *= -0.3;
        }
      }
    }
  };

  const step = (frameDt, params, { ambient = 1, reduced = false } = {}) => {
    const dt = Math.min(MAX_FRAME, Math.max(MIN_FRAME, frameDt));
    grabForce = GRAB_FORCE_SHARE * totalMass * params.gravity;
    clock += dt;
    if (gust.strength > 0) gust.strength = Math.max(0, gust.strength - dt * 2600);
    applyWind(dt, params);
    wind.vx *= Math.exp(-dt / 0.09);
    wind.vy *= Math.exp(-dt / 0.09);
    stepYaw(dt, ambient, reduced);
    if (grab.body >= 0) {
      grab.velocityX = (grab.targetX - grab.lastX) / dt;
      grab.velocityY = (grab.targetY - grab.lastY) / dt;
      grab.lastX = grab.targetX;
      grab.lastY = grab.targetY;
    }
    const slide = 1 - Math.exp(-dt / PIVOT_SLIDE_TIME);
    for (let index = 0; index < armCount; index += 1) pivotAlong[index] += (pivotTarget[index] - pivotAlong[index]) * slide;
    refreshArmGeometry();

    const h = dt / SUBSTEPS;
    const dampingScale = reduced ? 3 : 1;
    const linearKeep = Math.exp(-(h * dampingScale) / params.linearDamping);
    const angularKeep = Math.exp(-(h * dampingScale) / params.angularDamping);
    const armLinearKeep = Math.exp(-(h * dampingScale * ARM_DRAG) / params.linearDamping);
    const armAngularKeep = Math.exp(-(h * dampingScale * ARM_DRAG) / params.angularDamping);
    const gravity = params.gravity;
    const knotSpinKeep = Math.exp(-h / KNOT_SPIN_TIME);
    const knotDriftKeep = Math.exp(-h / KNOT_DRIFT_TIME);
    const grabSpinKeep = Math.exp(-h / GRAB_SPIN_TIME);
    const held = grab.body;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      for (let body = 0; body < bodyCount; body += 1) {
        vy[body] += gravity * h;
        prevX[body] = x[body];
        prevY[body] = y[body];
        prevAngle[body] = angle[body];
        x[body] += vx[body] * h;
        y[body] += vy[body] * h;
        angle[body] += omega[body] * h;
      }
      solveGrab(h);
      for (let pass = 0; pass < THREAD_PASSES; pass += 1) {
        if (pass % 2 === 0) for (let thread = 0; thread < threadCount; thread += 1) solveThread(thread);
        else for (let thread = threadCount - 1; thread >= 0; thread -= 1) solveThread(thread);
      }
      for (let body = 0; body < bodyCount; body += 1) {
        const isArm = body < armCount;
        const keepLinear = isArm ? armLinearKeep : linearKeep;
        vx[body] = ((x[body] - prevX[body]) / h) * keepLinear;
        vy[body] = ((y[body] - prevY[body]) / h) * keepLinear;
        omega[body] = ((angle[body] - prevAngle[body]) / h) * (isArm ? armAngularKeep : angularKeep);
        if (held >= 0) continue;
        if (Math.abs(omega[body]) < KNOT_SPIN) omega[body] *= knotSpinKeep;
        if (vx[body] * vx[body] + vy[body] * vy[body] < KNOT_DRIFT * KNOT_DRIFT) {
          vx[body] *= knotDriftKeep;
          vy[body] *= knotDriftKeep;
        }
      }
      if (held >= 0) {
        vx[held] += (grab.velocityX - vx[held]) * GRAB_VELOCITY_BLEND;
        vy[held] += (grab.velocityY - vy[held]) * GRAB_VELOCITY_BLEND;
        omega[held] *= grabSpinKeep;
      }
    }
    return dt;
  };

  const energy = () => {
    let total = 0;
    for (let body = 0; body < bodyCount; body += 1) {
      total += 0.5 * mass[body] * (vx[body] * vx[body] + vy[body] * vy[body]);
      total += (0.5 * omega[body] * omega[body]) / invInertia[body];
    }
    return total;
  };

  const yawEnergy = () => {
    let total = 0;
    for (let body = 0; body < bodyCount; body += 1) total += yawVelocity[body] * yawVelocity[body];
    return total;
  };

  const localSpan = (body, fromKind, toKind) => {
    localPoint(body, fromKind, scratchA);
    localPoint(body, toKind, scratchB);
    return Math.hypot(scratchB.x - scratchA.x, scratchB.y - scratchA.y);
  };

  const reachOf = (slot) => {
    const lastArm = Math.min(slot, armCount - 1);
    let reach = threadLength[0];
    for (let arm = 0; arm < lastArm; arm += 1) reach += localSpan(arm, POINT_PIVOT, POINT_INNER) + threadLength[2 + arm * 2];
    const hangsInner = slot >= armCount;
    reach += localSpan(lastArm, POINT_PIVOT, hangsInner ? POINT_INNER : POINT_OUTER);
    reach += threadLength[hangsInner ? 2 + lastArm * 2 : 1 + lastArm * 2];
    const half = mobile.covers[slot].size * 0.5;
    reach += Math.hypot(grab.localX, grab.localY + half);
    return reach;
  };

  const reachTarget = (worldX, worldY) => {
    grab.targetX = worldX;
    grab.targetY = worldY;
    if (grab.body < 0) return;
    const reach = reachOf(grab.body - armCount);
    grab.reach = reach;
    const dx = worldX - anchor.x;
    const dy = worldY - anchor.y;
    const distance = Math.hypot(dx, dy);
    const soft = reach * REACH_SOFT;
    if (distance <= soft || distance < 1e-6) return;
    const room = reach * (REACH_HARD - REACH_SOFT);
    const allowed = soft + room * (1 - Math.exp(-(distance - soft) / room));
    grab.targetX = anchor.x + (dx / distance) * allowed;
    grab.targetY = anchor.y + (dy / distance) * allowed;
  };

  const startGrab = (slot, worldX, worldY) => {
    const body = armCount + slot;
    const dx = worldX - x[body];
    const dy = worldY - y[body];
    const cos = Math.cos(angle[body]);
    const sin = Math.sin(angle[body]);
    const half = mobile.covers[slot].size * 0.5;
    grab.body = body;
    grab.localX = Math.max(-half, Math.min(half, dx * cos + dy * sin));
    grab.localY = Math.max(-half, Math.min(half, -dx * sin + dy * cos));
    reachTarget(worldX, worldY);
    grab.lastX = grab.targetX;
    grab.lastY = grab.targetY;
    grab.velocityX = 0;
    grab.velocityY = 0;
  };

  const moveGrab = (worldX, worldY) => {
    reachTarget(worldX, worldY);
  };

  const endGrab = (throwX = 0) => {
    if (grab.body >= armCount) {
      const spin = Math.max(-FLING_SPIN_CAP, Math.min(FLING_SPIN_CAP, throwX * FLING_SPIN));
      yawVelocity[grab.body] += spin;
    }
    grab.body = -1;
    grab.reach = Infinity;
  };

  const feedWind = (worldX, worldY, velocityX, velocityY) => {
    wind.x = worldX;
    wind.y = worldY;
    wind.vx = velocityX;
    wind.vy = velocityY;
  };

  const blow = (direction, strength) => {
    gust.direction = direction;
    gust.strength = Math.max(gust.strength, strength);
  };

  const nudge = (slot, deltaX, deltaY) => {
    const body = armCount + slot;
    vx[body] += deltaX;
    vy[body] += deltaY;
    yawVelocity[body] += deltaX * 0.003;
  };

  const kick = (slot, deltaX, deltaY, spin) => {
    const body = armCount + slot;
    vx[body] += deltaX;
    vy[body] += deltaY;
    omega[body] += spin;
  };

  const setHookEmpty = (slot, empty) => {
    const body = armCount + slot;
    const cover = mobile.covers[slot];
    mass[body] = empty ? cover.hookMass : cover.mass;
    invMass[body] = 1 / mass[body];
    invInertia[body] = 1 / (empty ? cover.hookInertia : cover.inertia);
  };

  const setPivotTarget = (armIndex, along) => {
    pivotTarget[armIndex] = along;
  };

  const coverPose = (slot, out) => {
    const body = armCount + slot;
    out.x = x[body];
    out.y = y[body];
    out.angle = angle[body];
    out.yaw = yaw[body];
    out.vx = vx[body];
    out.vy = vy[body];
    return out;
  };

  const threadEnds = (thread, outA, outB) => {
    worldPoint(threadA[thread], threadAPoint[thread], outA);
    worldPoint(threadB[thread], threadBPoint[thread], outB);
  };

  const armPoint = (armIndex, kind, out) => worldPoint(armIndex, kind, out);

  const toWorld = (body, localX, localY, out, offset) => {
    const cos = Math.cos(angle[body]);
    const sin = Math.sin(angle[body]);
    out[offset] = x[body] + localX * cos - localY * sin;
    out[offset + 1] = y[body] + localX * sin + localY * cos;
  };

  const armShape = (armIndex, out) => {
    const arm = mobile.arms[armIndex];
    const direction = armDirection[armIndex];
    const scale = armScale[armIndex];
    const along = pivotAlong[armIndex];
    const pivotX = armPivotX[armIndex];
    const pivotY = armPivotY[armIndex];
    const endY = armEndY[armIndex];
    toWorld(armIndex, -direction * armHalf[armIndex] * scale, endY, out, 0);
    toWorld(armIndex, pivotX - (direction * along * scale) / 2, pivotY, out, 2);
    toWorld(armIndex, pivotX, pivotY, out, 4);
    toWorld(armIndex, pivotX + (direction * (arm.length - along) * scale) / 2, pivotY, out, 6);
    toWorld(armIndex, direction * armHalf[armIndex] * scale, endY, out, 8);
    return out;
  };

  const coverThreadIndex = (slot) => (slot < armCount ? 1 + slot * 2 : armCount * 2);

  return {
    mobile,
    armCount,
    coverCount,
    bodyCount,
    threadCount,
    x,
    y,
    angle,
    yaw,
    yawVelocity,
    vx,
    vy,
    omega,
    armScale,
    armDirection,
    pivotAlong,
    threadLength,
    threadTaut,
    threadB,
    anchor,
    grab,
    reachOf,
    point,
    POINT_PIVOT,
    POINT_OUTER,
    POINT_INNER,
    setPose,
    step,
    energy,
    yawEnergy,
    startGrab,
    moveGrab,
    endGrab,
    feedWind,
    blow,
    nudge,
    kick,
    setHookEmpty,
    setPivotTarget,
    coverPose,
    threadEnds,
    armPoint,
    armShape,
    coverThreadIndex,
  };
}
