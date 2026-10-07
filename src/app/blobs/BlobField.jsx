"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { blobActions } from "./blobActions";
import { DEFAULTS } from "./blobPresets";
import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

const MAX_PETALS = 8;
const LOBES_PER_FLOWER = MAX_PETALS + 1;
const COLORS_PER_PALETTE = 6;
const POINTER_IDLE_MS = 2500;
const PAGE_PIXEL_CAP = 2;
const EMBEDDED_PIXEL_CAP = 1.5;
const PIXELATED_PIXEL_CAP = 1.25;
const MIN_RESOLUTION_SCALE = 0.55;
const POP_STRENGTH = 5.5;
const EXIT_MS = 450;
const PUSH_FADE_RATE = 6;
const PUSH_FOLLOW_RATE = 9;
const PUSH_MAX_SPEED = 2.2;
const INTRO_SETTLE_SECONDS = 2.2;

const PALETTES = [
  [
    [0.92, 0.85, 0.16],
    [0.98, 1.0, 0.33],
    [0.92, 0.76, 0.12],
    [0.76, 0.38, 0.04],
    [0.6, 0.25, 0.03],
    [0.72, 0.5, 0.05],
  ],
  [
    [1.0, 0.55, 0.75],
    [1.0, 0.74, 0.89],
    [0.98, 0.45, 0.66],
    [0.82, 0.2, 0.4],
    [0.5, 0.07, 0.22],
    [0.86, 0.36, 0.58],
  ],
  [
    [0.52, 0.5, 1.0],
    [0.72, 0.74, 1.0],
    [0.45, 0.42, 0.95],
    [0.3, 0.22, 0.78],
    [0.14, 0.1, 0.45],
    [0.38, 0.35, 0.85],
  ],
  [
    [1.0, 0.62, 0.2],
    [1.0, 0.83, 0.42],
    [0.98, 0.6, 0.14],
    [0.86, 0.34, 0.05],
    [0.5, 0.14, 0.02],
    [0.8, 0.44, 0.08],
  ],
];

const easeOutBack = (value) => {
  const overshoot = 1.5;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
};

const smootherstep = (value) => value * value * value * (value * (value * 6 - 15) + 10);

const lerp = (from, to, amount) => from + (to - from) * amount;

const hexToRgb = (hex) => {
  const value = parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const FLOWERS = [
  {
    bloomDelay: 0,
    size: 0.31,
    startDegrees: 45,
    distance: 0.31,
    petalRadius: 0.22,
    centerRadius: 0.16,
    coreRadius: 0.17,
    spin: 0.12,
    depth: 0.9,
    scenes: [
      { x: 0.166, y: 0.34, scale: 1, open: 1, turn: 0 },
      { x: 0.74, y: 0.42, scale: 2, open: 1.05, turn: 0.6 },
      { x: 0.2, y: 0.28, scale: 0.55, open: 0.25, turn: 1.1 },
      { x: 0.5, y: 0.5, scale: 2.5, open: 1.12, turn: 1.7 },
      { x: 0.166, y: 0.34, scale: 1, open: 1, turn: 2.3 },
    ],
  },
  {
    bloomDelay: 0.3,
    size: 0.22,
    startDegrees: 45,
    distance: 0.31,
    petalRadius: 0.235,
    centerRadius: 0.16,
    coreRadius: 0.15,
    spin: -0.1,
    depth: 0.6,
    scenes: [
      { x: 0.5575, y: 0.405, scale: 1, open: 1, turn: 0 },
      { x: 0.22, y: 0.62, scale: 1.15, open: 1, turn: -0.5 },
      { x: 0.5, y: 0.26, scale: 0.5, open: 0.25, turn: -1 },
      { x: 0.28, y: 0.42, scale: 1.9, open: 1.12, turn: -1.5 },
      { x: 0.5575, y: 0.405, scale: 1, open: 1, turn: -2 },
    ],
  },
  {
    bloomDelay: 0.6,
    size: 0.17,
    startDegrees: 45,
    distance: 0.31,
    petalRadius: 0.235,
    centerRadius: 0.16,
    coreRadius: 0.14,
    spin: 0.14,
    depth: 0.4,
    scenes: [
      { x: 0.82, y: 0.64, scale: 1, open: 1, turn: 0 },
      { x: 0.46, y: 0.2, scale: 0.9, open: 1, turn: 0.7 },
      { x: 0.82, y: 0.28, scale: 0.5, open: 0.25, turn: 1.3 },
      { x: 0.78, y: 0.62, scale: 2.1, open: 1.1, turn: 1.9 },
      { x: 0.82, y: 0.64, scale: 1, open: 1, turn: 2.5 },
    ],
  },
];

const SCENE_COUNT = FLOWERS[0].scenes.length;

const VERTEX = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uLobe[${FLOWERS.length * LOBES_PER_FLOWER}];
uniform vec3 uCore[${FLOWERS.length}];
uniform vec2 uShape[${FLOWERS.length}];
uniform vec3 uPalette[${FLOWERS.length * COLORS_PER_PALETTE}];
uniform vec2 uLight;
uniform vec4 uLook;
uniform vec4 uSurface;
uniform vec4 uOrganic;
uniform vec4 uRetro;
uniform vec4 uStipple;
uniform vec4 uGrade;
uniform vec2 uGrain;
uniform vec4 uSpace;
uniform vec4 uSpaceB;
uniform vec3 uInk;
uniform float uSubject;
uniform vec4 uLayoutA;
uniform vec4 uLayoutB;
uniform vec4 uLayoutC;
uniform float uIntro;
uniform float uOutro;
uniform vec3 uPush;
uniform vec3 uSubj[${FLOWERS.length}];

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}

float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

float bayer8(vec2 a) {
  return bayer4(0.5 * a) * 0.25 + bayer2(a);
}

vec3 hueRotate(vec3 color, float degrees) {
  float angle = radians(degrees);
  float cosine = cos(angle);
  float sine = sin(angle);
  mat3 rotation = mat3(
    0.299 + 0.701 * cosine + 0.168 * sine, 0.587 - 0.587 * cosine + 0.330 * sine, 0.114 - 0.114 * cosine - 0.497 * sine,
    0.299 - 0.299 * cosine - 0.328 * sine, 0.587 + 0.413 * cosine + 0.035 * sine, 0.114 - 0.114 * cosine + 0.292 * sine,
    0.299 - 0.300 * cosine + 1.250 * sine, 0.587 - 0.588 * cosine - 1.050 * sine, 0.114 + 0.886 * cosine - 0.203 * sine
  );
  return clamp(color * rotation, 0.0, 1.0);
}

vec4 backdrop(vec2 p) {
  float gridMode = uSpace.x;
  float gridSize = max(uSpace.y, 4.0);
  float gridWarp = uSpace.z;
  float gridStrength = uSpace.w;
  float gridReveal = uSpaceB.x;
  if (gridMode < 0.5 || uLayoutA.x > 0.5) {
    return vec4(0.0);
  }

  vec2 warped = p;
  float reveal = 0.0;
  for (int f = 0; f < ${FLOWERS.length}; f++) {
    vec3 core = uCore[f];
    float radius = max(core.z, 0.5) * 3.2;
    vec2 d = p - core.xy;
    float near = exp(-dot(d, d) / (radius * radius));
    warped -= d * gridWarp * 0.35 * near;
    reveal = max(reveal, exp(-dot(d, d) / (radius * radius * 2.5)));
  }

  vec2 toLight = p - uLight;
  float lightRadius = gridSize * 5.0;
  float lightNear = exp(-dot(toLight, toLight) / (lightRadius * lightRadius));
  warped -= toLight * gridWarp * 0.3 * lightNear;
  reveal = max(reveal, lightNear * 0.9);

  vec2 local = fract(warped / gridSize) - 0.5;
  float alpha;
  if (gridMode < 1.5) {
    float grow = 0.06 + 0.12 * reveal;
    alpha = 1.0 - smoothstep(grow - 0.03, grow + 0.03, length(local));
  } else if (gridMode < 2.5) {
    float width = 0.012 + 0.025 * reveal;
    alpha = 1.0 - smoothstep(width, width + 0.012, min(abs(local.x), abs(local.y)));
  } else {
    float width = 0.025 + 0.03 * reveal;
    float arm = 0.2 + 0.18 * reveal;
    float vertical = (1.0 - smoothstep(width, width + 0.02, abs(local.x))) * (1.0 - smoothstep(arm, arm + 0.03, abs(local.y)));
    float horizontal = (1.0 - smoothstep(width, width + 0.02, abs(local.y))) * (1.0 - smoothstep(arm, arm + 0.03, abs(local.x)));
    alpha = max(vertical, horizontal);
  }
  alpha *= gridStrength * mix(1.0, reveal, gridReveal);
  return vec4(uInk * alpha, alpha);
}

float subjectField(vec2 p, vec2 center, float radius, float turn, float count, float mode) {
  vec2 d = p - center;
  float dist = length(d);
  float t = dist / radius;
  float angle = atan(d.y, d.x) - turn;
  float envelope = exp(-pow(t, 3.0));

  if (mode < 0.5) {
    float lobe = pow(abs(cos(0.5 * count * angle)), 0.9);
    float edge = mix(0.5, 1.0, lobe);
    return 1.3 * exp(-pow(dist / (edge * radius), 2.4));
  }

  if (mode < 1.5) {
    float lobe = pow(abs(cos(0.5 * count * angle)), 2.2);
    float edge = mix(0.38, 1.0, lobe);
    return 1.3 * exp(-pow(dist / (edge * radius), 2.4));
  }
  if (mode < 2.5) {
    float wave = 0.5 + 0.5 * cos(dist / (radius * 0.22) * 6.2832);
    return envelope * (0.3 + 1.1 * wave) + exp(-pow(t / 0.18, 2.0));
  }
  if (mode < 3.5) {
    float c = cos(turn);
    float s = sin(turn);
    vec2 grid = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / (radius * 0.3);
    vec2 cell = fract(grid) - 0.5;
    float bump = exp(-dot(cell, cell) * 9.0);
    float lines = exp(-pow(min(abs(cell.x), abs(cell.y)) * 6.0, 2.0));
    return envelope * (0.2 + 0.55 * lines + 0.9 * bump);
  }
  if (mode < 4.5) {
    float spike = pow(0.5 + 0.5 * cos(count * 2.0 * angle), 3.0);
    float radial = smoothstep(0.08, 0.28, t) * exp(-pow(t, 3.0));
    return 1.4 * spike * radial + 0.5 * exp(-pow(t / 0.2, 2.0));
  }
  if (mode < 5.5) {
    float ribbon = pow(0.5 + 0.5 * cos((dist / (radius / 3.0) - angle / 6.2832) * 6.2832), 2.0);
    return envelope * (0.15 + 1.2 * ribbon);
  }
  float c = cos(turn);
  float s = sin(turn);
  vec2 r = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float cheb = max(abs(r.x), abs(r.y));
  float wave = 0.5 + 0.5 * cos(cheb / (radius * 0.17) * 6.2832);
  return exp(-pow(cheb / (radius * 0.9), 4.0)) * (0.3 + 1.1 * wave) + exp(-pow(cheb / (radius * 0.16), 2.0));
}

vec4 shadeField(
  float field,
  vec2 slope,
  vec2 q,
  vec2 p,
  vec2 center,
  float coreSize,
  float turn,
  float petals,
  vec3 rim,
  vec3 lime,
  vec3 gold,
  vec3 amber,
  vec3 brown,
  vec3 shadeColor,
  float valleyScale
) {
  float edgeLow = uLook.x;
  float edgeHigh = uLook.y;
  float valleyAmount = uLook.z;
  float glossAmount = uLook.w;
  float glossSharpness = uSurface.x;
  float rimAmount = uSurface.y;
  float ambient = uSurface.z;
  float outlineAmount = uSurface.w;

  float alpha = smoothstep(edgeLow, edgeHigh, field);
  vec2 dc = (q - center) / coreSize;
  float heat = exp(-dot(dc, dc) * 0.55);
  vec3 color = mix(rim, lime, smoothstep(0.45, 1.5, field));
  vec2 toPoint = q - center;
  float theta = atan(toPoint.y, toPoint.x);
  float petalness = 0.5 + 0.5 * cos(petals * (theta - turn));
  float reach = length(toPoint) / (coreSize * 2.6);
  float valley = pow(max(1.0 - petalness, 0.0), 1.4) * smoothstep(1.5, 0.2, reach) * smoothstep(0.05, 0.4, reach);
  color = mix(color, shadeColor, valley * valleyAmount * valleyScale);
  color = mix(color, gold, smoothstep(0.0, 0.55, heat) * 0.85);
  color = mix(color, amber, smoothstep(0.35, 0.85, heat));
  color = mix(color, brown, smoothstep(0.75, 1.0, heat));
  vec3 normal = normalize(vec3(-slope * coreSize * 0.9, 1.0));
  vec3 toLight = normalize(vec3((uLight - p) / (coreSize * 3.0), 1.2));
  float diffuse = clamp(dot(normal, toLight) * 0.5 + 0.5, 0.0, 1.0);
  vec3 halfway = normalize(toLight + vec3(0.0, 0.0, 1.0));
  float gloss = pow(max(dot(normal, halfway), 0.0), glossSharpness);
  float glow = pow(1.0 - normal.z, 2.0);
  color = color * (ambient + (1.0 - ambient) * 1.8 * diffuse) + vec3(1.0, 0.97, 0.85) * gloss * glossAmount + lime * glow * rimAmount;
  float band = 1.0 - clamp(abs(field - mix(edgeLow, edgeHigh, 0.5)) * 7.0, 0.0, 1.0);
  color = mix(color, color * 0.3, band * outlineAmount);
  return vec4(color * alpha, alpha);
}

float introGrow(float delay) {
  float t = clamp((uIntro - delay) / 0.8, 0.0, 1.0);
  float shifted = t - 1.0;
  return 1.0 + 2.5 * shifted * shifted * shifted + 1.5 * shifted * shifted;
}

float outroScale(float delay) {
  float local = clamp((uOutro - delay) / 0.57, 0.0, 1.0);
  return 1.0 - local * local * (3.0 - 2.0 * local);
}

vec2 rotate2(vec2 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void tileElement(vec2 cell, float mode, out vec2 center, out float radius, out float turn, out float palette, out float present) {
  float cellSize = uLayoutA.y;
  float jitter = uLayoutA.z;
  float sizeVar = uLayoutA.w;
  float density = uLayoutB.x;
  float spin = uLayoutB.y;
  float drift = uLayoutB.w;
  vec2 hashCell = cell;
  vec2 base = cell + 0.5;
  if (mode > 1.5 && mode < 2.5) {
    base.x += 0.5 * mod(cell.y, 2.0);
  }
  if (mode > 3.5 && mode < 4.5) {
    float direction = mod(cell.y, 2.0) < 0.5 ? 1.0 : -1.0;
    float travel = uTime * drift * direction;
    hashCell.x = cell.x - floor(travel);
    base.x += fract(travel);
  }
  float h1 = hash(hashCell + 3.1);
  float h2 = hash(hashCell + 17.7);
  float h3 = hash(hashCell + 41.3);
  float h4 = hash(hashCell + 5.5);
  center = (base + (vec2(h1, h2) - 0.5) * jitter) * cellSize;
  float wave = 0.5 + 0.5 * sin(cell.x * 0.6 + cell.y * 0.8 + uTime * 0.8);
  float variation = mode < 1.5 ? 1.0 - wave : h3;
  radius = uLayoutC.x * cellSize * (1.0 - sizeVar * variation);
  if (mode > 6.5) {
    float across = clamp((center.x + center.y) / (uResolution.x + uResolution.y), 0.0, 1.0);
    radius *= mix(0.35, 1.35, across);
  }
  float checker = mod(hashCell.x + hashCell.y, 2.0);
  float baseTurn = (mode < 1.5 || mode > 6.5) ? checker * 0.78 : h3 * 6.2832;
  turn = baseTurn + uTime * spin * (checker < 0.5 ? 1.0 : -1.0);
  float introDelay = hash(hashCell + 9.9) * 0.45 + length(center - 0.5 * uResolution) / length(uResolution) * 0.9;
  float introProgress = clamp((uIntro - introDelay) / 0.8, 0.0, 1.0);
  float outroDelay = (hash(hashCell + 23.1) * 0.35 + length(center - 0.5 * uResolution) / length(uResolution) * 0.5) * 0.5;
  float outroProgress = clamp((uOutro - outroDelay) / 0.57, 0.0, 1.0);
  radius *= introGrow(introDelay) * outroScale(outroDelay);
  turn += (1.0 - introProgress) * (1.0 - introProgress) * 1.6 + outroProgress * outroProgress * 1.2;
  palette = floor(hash(hashCell + 7.7) * 2.999);
  present = step(h4, density);
}

float tileField(vec2 p, out vec2 winCenter, out float winRadius, out float winTurn, out float winPalette) {
  float mode = uLayoutA.x;
  float cellSize = uLayoutA.y;
  float scene = uLayoutB.z;
  float count = uLayoutC.y;
  vec2 mid = 0.5 * uResolution;
  winCenter = vec2(0.0);
  winRadius = 1.0;
  winTurn = 0.0;
  winPalette = 0.0;
  float total = 0.0;
  float best = 0.0;

  vec2 wobble = vec2(
    valueNoise(p / (cellSize * 1.3) + uTime * 0.3 * uOrganic.y),
    valueNoise(p / (cellSize * 1.3) + 17.0 - uTime * 0.25 * uOrganic.y)
  ) - 0.5;
  p += wobble * cellSize * 0.3 * uOrganic.x;

  if (mode > 4.5 && mode < 5.5) {
    for (int k = 0; k < 5; k++) {
      float fk = float(k);
      vec2 anchor = k == 0 ? vec2(0.14, 0.2) : (k == 1 ? vec2(0.95, 0.88) : (k == 2 ? vec2(0.74, 0.18) : (k == 3 ? vec2(0.33, 0.84) : vec2(0.58, 0.5))));
      float size = k == 0 ? 0.62 : (k == 1 ? 0.5 : (k == 2 ? 0.17 : (k == 3 ? 0.14 : 0.09)));
      vec2 center = anchor * uResolution + vec2(sin(uTime * 0.2 + fk), cos(uTime * 0.17 + fk * 1.3)) * uResolution.y * 0.02;
      float radius = size * uResolution.y * introGrow(fk * 0.12) * outroScale(fk * 0.04);
      float turn = uTime * 0.12 * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) + scene * 0.4 + fk;
      vec2 d = p - center;
      if (dot(d, d) > radius * radius * 2.6) {
        continue;
      }
      float f = subjectField(p, center, radius, turn, count, uSubject);
      total += f;
      if (f > best) {
        best = f;
        winCenter = center;
        winRadius = radius;
        winTurn = turn;
        winPalette = mod(fk, 3.0);
      }
    }
    return total;
  }

  if (mode > 5.5 && mode < 6.5) {
    float reference = min(uResolution.x, uResolution.y);
    float ringRadius = reference * 0.34;
    float small = reference * 0.12;
    for (int k = 0; k < 13; k++) {
      float fk = float(k);
      vec2 center = mid;
      float radius = small * 1.7;
      if (k < 12) {
        float a = fk / 12.0 * 6.2832 + uTime * 0.15 + scene * 0.8;
        center = mid + vec2(cos(a), sin(a)) * ringRadius * (1.0 + 0.06 * sin(uTime + fk));
        radius = small * (0.8 + 0.3 * sin(fk * 1.7 + uTime * 0.7));
      }
      radius *= introGrow(fk * 0.07) * outroScale(fk * 0.03);
      float turn = uTime * 0.2 * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) + fk * 0.5;
      vec2 d = p - center;
      if (dot(d, d) > radius * radius * 2.6) {
        continue;
      }
      float f = subjectField(p, center, radius, turn, count, uSubject);
      total += f;
      if (f > best) {
        best = f;
        winCenter = center;
        winRadius = radius;
        winTurn = turn;
        winPalette = mod(fk, 3.0);
      }
    }
    return total;
  }

  float tilt = scene * 0.12 + (mode > 6.5 ? 0.55 : 0.0);
  float zoom = 1.0 + 0.1 * sin(scene * 1.7);
  vec2 scroll = vec2(scene * cellSize * 1.2, scene * cellSize * 0.8);
  vec2 lp = rotate2(p - mid, -tilt) / zoom + mid + scroll;
  vec2 pushLp = rotate2(uPush.xy - mid, -tilt) / zoom + mid + scroll;
  vec2 base = floor(lp / cellSize);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec2 center;
      float radius;
      float turn;
      float palette;
      float present;
      tileElement(cell, mode, center, radius, turn, palette, present);
      if (present < 0.5) {
        continue;
      }
      vec2 away = center - pushLp;
      float pushRadius = cellSize * 1.6;
      center += away * 0.12 * uPush.z * exp(-dot(away, away) / (pushRadius * pushRadius));
      vec2 d = lp - center;
      if (dot(d, d) > radius * radius * 2.6) {
        continue;
      }
      float f = subjectField(lp, center, radius, turn, count, uSubject);
      total += f;
      if (f > best) {
        best = f;
        winCenter = center;
        winRadius = radius;
        winTurn = turn;
        winPalette = palette;
      }
    }
  }
  winCenter = rotate2((winCenter - mid - scroll) * zoom, tilt) + mid;
  winRadius *= zoom;
  winTurn += tilt;
  return total;
}

vec4 tiledScene(vec2 p) {
  float cellSize = uLayoutA.y;
  vec2 winCenter;
  float winRadius;
  float winTurn;
  float winPalette;
  float field = tileField(p, winCenter, winRadius, winTurn, winPalette);
  vec2 ignoredCenter;
  float ignoredRadius;
  float ignoredTurn;
  float ignoredPalette;
  float e = max(cellSize * 0.012, 1.0);
  float right = tileField(p + vec2(e, 0.0), ignoredCenter, ignoredRadius, ignoredTurn, ignoredPalette);
  float down = tileField(p + vec2(0.0, e), ignoredCenter, ignoredRadius, ignoredTurn, ignoredPalette);
  vec2 slope = vec2(right - field, down - field) / e;

  vec3 rim = winPalette < 0.5 ? uPalette[0] : (winPalette < 1.5 ? uPalette[6] : uPalette[12]);
  vec3 lime = winPalette < 0.5 ? uPalette[1] : (winPalette < 1.5 ? uPalette[7] : uPalette[13]);
  vec3 gold = winPalette < 0.5 ? uPalette[2] : (winPalette < 1.5 ? uPalette[8] : uPalette[14]);
  vec3 amber = winPalette < 0.5 ? uPalette[3] : (winPalette < 1.5 ? uPalette[9] : uPalette[15]);
  vec3 brown = winPalette < 0.5 ? uPalette[4] : (winPalette < 1.5 ? uPalette[10] : uPalette[16]);
  vec3 shadeColor = winPalette < 0.5 ? uPalette[5] : (winPalette < 1.5 ? uPalette[11] : uPalette[17]);
  float coreSize = max(winRadius * 0.4, 0.5);
  float valleyScale = (uSubject < 1.5 || (uSubject > 3.5 && uSubject < 4.5)) ? 1.0 : 0.0;
  return shadeField(field, slope, p, p, winCenter, coreSize, winTurn, uLayoutC.y, rim, lime, gold, amber, brown, shadeColor, valleyScale);
}

vec4 flowers(vec2 p) {
  if (uLayoutA.x > 0.5) {
    return tiledScene(p);
  }
  vec4 acc = vec4(0.0);

  for (int f = 0; f < ${FLOWERS.length}; f++) {
    vec3 core = uCore[f];
    float coreSize = max(core.z, 0.5);
    vec2 wobble = vec2(
      valueNoise(p / (coreSize * uOrganic.z) + uTime * 0.35 * uOrganic.y),
      valueNoise(p / (coreSize * uOrganic.z) + 17.0 - uTime * 0.3 * uOrganic.y)
    ) - 0.5;
    vec2 q = p + wobble * coreSize * uOrganic.x;
    float field = 0.0;
    vec2 slope = vec2(0.0);
    if (uSubject > 0.5) {
      vec3 subject = uSubj[f];
      float e = max(subject.x * 0.012, 1.0);
      field = subjectField(q, uCore[f].xy, subject.x, subject.y, subject.z, uSubject);
      float right = subjectField(q + vec2(e, 0.0), uCore[f].xy, subject.x, subject.y, subject.z, uSubject);
      float left = subjectField(q - vec2(e, 0.0), uCore[f].xy, subject.x, subject.y, subject.z, uSubject);
      float down = subjectField(q + vec2(0.0, e), uCore[f].xy, subject.x, subject.y, subject.z, uSubject);
      float up = subjectField(q - vec2(0.0, e), uCore[f].xy, subject.x, subject.y, subject.z, uSubject);
      slope = vec2(right - left, down - up) / (2.0 * e);
    } else {
      for (int i = 0; i < ${LOBES_PER_FLOWER}; i++) {
        vec3 lobe = uLobe[f * ${LOBES_PER_FLOWER} + i];
        if (lobe.z > 0.5) {
          vec2 d = (q - lobe.xy) / lobe.z;
          float distanceSquared = max(dot(d, d), 0.0001);
          float power = pow(distanceSquared, 0.5 * uOrganic.w);
          float bump = exp(-power);
          field += bump;
          slope += -uOrganic.w * power / distanceSquared * d / lobe.z * bump;
        }
      }
    }
    vec3 rim = uPalette[f * ${COLORS_PER_PALETTE} + 0];
    vec3 lime = uPalette[f * ${COLORS_PER_PALETTE} + 1];
    vec3 gold = uPalette[f * ${COLORS_PER_PALETTE} + 2];
    vec3 amber = uPalette[f * ${COLORS_PER_PALETTE} + 3];
    vec3 brown = uPalette[f * ${COLORS_PER_PALETTE} + 4];
    vec3 shadeColor = uPalette[f * ${COLORS_PER_PALETTE} + 5];
    float valleyScale = (uSubject < 1.5 || (uSubject > 3.5 && uSubject < 4.5)) ? 1.0 : 0.0;
    vec4 shaded = shadeField(field, slope, q, p, core.xy, coreSize, uShape[f].x, uShape[f].y, rim, lime, gold, amber, brown, shadeColor, valleyScale);
    acc.rgb = shaded.rgb + acc.rgb * (1.0 - shaded.a);
    acc.a = shaded.a + acc.a * (1.0 - shaded.a);
  }
  return acc;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  float pixelSize = uRetro.x;
  if (pixelSize > 1.0) {
    p = (floor(p / pixelSize) + 0.5) * pixelSize;
  }

  vec4 acc;
  float aberration = uGrade.w;
  if (aberration > 0.1) {
    vec4 red = flowers(p + vec2(aberration, 0.0));
    vec4 green = flowers(p);
    vec4 blue = flowers(p - vec2(aberration, 0.0));
    acc = vec4(red.r, green.g, blue.b, max(max(red.a, green.a), blue.a));
  } else {
    acc = flowers(p);
  }
  vec4 layer = backdrop(p);
  acc = acc + layer * (1.0 - acc.a);

  float alpha = acc.a;
  vec3 color = alpha > 0.001 ? acc.rgb / alpha : vec3(0.0);
  color = hueRotate(color, uGrade.x);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, uGrade.y);
  color = clamp((color - 0.5) * uGrade.z + 0.5, 0.0, 1.0);

  float lumaNow = dot(color, vec3(0.299, 0.587, 0.114));
  float step3 = clamp(lumaNow, 0.0, 1.0) * 3.0;
  vec3 gb0 = vec3(0.06, 0.22, 0.06);
  vec3 gb1 = vec3(0.19, 0.38, 0.19);
  vec3 gb2 = vec3(0.55, 0.67, 0.06);
  vec3 gb3 = vec3(0.61, 0.74, 0.06);
  vec3 ramp = step3 < 1.0 ? mix(gb0, gb1, step3) : (step3 < 2.0 ? mix(gb1, gb2, step3 - 1.0) : mix(gb2, gb3, step3 - 2.0));
  color = mix(color, ramp, uStipple.w);

  vec2 ditherCell = floor(gl_FragCoord.xy / max(uRetro.w, 1.0));
  float threshold = bayer8(ditherCell) - 0.5;
  float levels = uRetro.z;
  if (levels < 31.5) {
    color = floor(color * (levels - 1.0) + threshold * uRetro.y + 0.5) / (levels - 1.0);
  } else {
    color = clamp(color + threshold * uRetro.y * 0.08, 0.0, 1.0);
  }
  alpha = mix(alpha, step(threshold + 0.5, alpha), uStipple.x);

  if (uStipple.y > 0.001) {
    float cellSize = max(uStipple.z, 2.0);
    float c = 0.7071;
    vec2 rotated = vec2(c * p.x - c * p.y, c * p.x + c * p.y) / cellSize;
    vec2 local = fract(rotated) - 0.5;
    float radius = 0.5 * sqrt(clamp(alpha, 0.0, 1.0));
    float dots = 1.0 - smoothstep(radius - 0.06, radius + 0.06, length(local));
    alpha = mix(alpha, dots * step(0.02, alpha), uStipple.y);
  }

  float grain = hash(gl_FragCoord.xy + floor(uTime * uGrain.y)) - 0.5;
  float body = step(0.002, alpha);
  alpha = clamp(alpha + grain * uGrain.x * body, 0.0, 1.0);
  color = clamp(color + grain * uGrain.x, 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function buildProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  return program;
}

function sceneTarget(flower, position) {
  const clamped = Math.min(Math.max(position, 0), SCENE_COUNT - 1);
  const index = Math.min(Math.floor(clamped), SCENE_COUNT - 2);
  const blend = smootherstep(clamped - index);
  const from = flower.scenes[index];
  const to = flower.scenes[index + 1];
  return {
    x: lerp(from.x, to.x, blend),
    y: lerp(from.y, to.y, blend),
    scale: lerp(from.scale, to.scale, blend),
    open: lerp(from.open, to.open, blend),
    turn: lerp(from.turn, to.turn, blend),
    index,
    blend,
  };
}

function writePalette(target, flowerIndex, index, blend) {
  const from = PALETTES[(flowerIndex + index) % PALETTES.length];
  const to = PALETTES[(flowerIndex + index + 1) % PALETTES.length];
  from.forEach((color, colorIndex) => {
    const offset = (flowerIndex * COLORS_PER_PALETTE + colorIndex) * 3;
    target[offset] = lerp(color[0], to[colorIndex][0], blend);
    target[offset + 1] = lerp(color[1], to[colorIndex][1], blend);
    target[offset + 2] = lerp(color[2], to[colorIndex][2], blend);
  });
}

function createState() {
  return FLOWERS.map((flower) => ({
    ...flower.scenes[0],
    springs: Array.from({ length: MAX_PETALS }, () => ({ x: 0, y: 0, vx: 0, vy: 0 })),
  }));
}

function stepSpring(spring, targetX, targetY, deltaSeconds, config) {
  const accelerationX = (targetX - spring.x) * config.jellyStiffness - spring.vx * config.jellyDamping;
  const accelerationY = (targetY - spring.y) * config.jellyStiffness - spring.vy * config.jellyDamping;
  spring.vx += accelerationX * deltaSeconds;
  spring.vy += accelerationY * deltaSeconds;
  spring.x += spring.vx * deltaSeconds;
  spring.y += spring.vy * deltaSeconds;
}

function layout({
  width,
  height,
  seconds,
  deltaSeconds,
  bloomSeconds,
  position,
  velocity,
  follow,
  state,
  palette,
  pointer,
  parallax,
  config,
}) {
  const reference = Math.max(width, height * 0.9);
  const lobes = new Float32Array(FLOWERS.length * LOBES_PER_FLOWER * 3);
  const cores = new Float32Array(FLOWERS.length * 3);
  const shapes = new Float32Array(FLOWERS.length * 2);
  const subjects = new Float32Array(FLOWERS.length * 3);
  const petalCount = Math.round(config.petals);

  FLOWERS.forEach((flower, flowerIndex) => {
    const target = sceneTarget(flower, position);
    const current = state[flowerIndex];
    current.x = lerp(current.x, target.x, follow);
    current.y = lerp(current.y, target.y, follow);
    current.scale = lerp(current.scale, target.scale, follow);
    current.open = lerp(current.open, target.open, follow);
    current.turn = lerp(current.turn, target.turn, follow);
    writePalette(palette, flowerIndex, target.index, target.blend);

    const size = flower.size * reference * current.scale * config.flowerScale;
    const centerX = current.x * width + parallax.x * flower.depth * reference * config.parallax;
    const centerY = current.y * height + parallax.y * flower.depth * reference * config.parallax;
    const progress = Math.min(
      Math.max((bloomSeconds - flower.bloomDelay) / config.bloomSeconds, 0),
      1,
    );
    const introBloom = easeOutBack(progress);
    const squash = 1 + Math.min(Math.abs(velocity) / 5000, 0.14);
    const breathe =
      (1 + Math.sin(seconds * 0.5 + flowerIndex * 1.7) * config.breathe) *
      introBloom *
      current.open *
      squash;
    const unfurl = (1 - progress) ** 2 * 1.2;
    const turn =
      (flower.startDegrees * Math.PI) / 180 +
      Math.sin(seconds * flower.spin * 2) * 0.18 * config.spinSpeed +
      current.turn * config.spinSpeed +
      velocity * 0.00018 * (flowerIndex % 2 === 0 ? 1 : -1) -
      unfurl;
    const base = flowerIndex * LOBES_PER_FLOWER * 3;

    lobes[base] = centerX;
    lobes[base + 1] = centerY;
    lobes[base + 2] = flower.centerRadius * size * breathe * config.coreSize;

    for (let petal = 0; petal < petalCount; petal += 1) {
      const angle = turn + (petal / petalCount) * Math.PI * 2;
      const reachPx = flower.distance * size * breathe * config.petalReach;
      const restX = centerX + Math.cos(angle) * reachPx;
      const restY = centerY + Math.sin(angle) * reachPx;
      const spring = current.springs[petal];

      let pullX = 0;
      let pullY = 0;
      if (pointer.active) {
        const toPointerX = pointer.x - restX;
        const toPointerY = pointer.y - restY;
        const distance = Math.hypot(toPointerX, toPointerY) || 1;
        const falloff = Math.max(1 - distance / (size * 1.5), 0) ** 2;
        pullX = (toPointerX / distance) * falloff * size * config.lean;
        pullY = (toPointerY / distance) * falloff * size * config.lean;
        spring.vx += pointer.vx * falloff * 0.0035 * deltaSeconds * 60;
        spring.vy += pointer.vy * falloff * 0.0035 * deltaSeconds * 60;
      }
      const alternate = petal % 2 === 0 ? 1 : -1;
      spring.vy += velocity * config.scrollKick * alternate * deltaSeconds;
      stepSpring(spring, pullX, pullY, deltaSeconds, config);

      const offset = base + (petal + 1) * 3;
      lobes[offset] = restX + spring.x;
      lobes[offset + 1] = restY + spring.y;
      lobes[offset + 2] = flower.petalRadius * size * breathe * config.petalSize;
    }

    subjects[flowerIndex * 3] = (flower.distance + flower.petalRadius) * size * breathe * config.petalReach;
    subjects[flowerIndex * 3 + 1] = turn;
    subjects[flowerIndex * 3 + 2] = petalCount;
    shapes[flowerIndex * 2] = turn;
    shapes[flowerIndex * 2 + 1] = petalCount;
    cores[flowerIndex * 3] = centerX;
    cores[flowerIndex * 3 + 1] = centerY;
    cores[flowerIndex * 3 + 2] = flower.coreRadius * size * breathe * config.coreSize;
  });

  return { lobes, cores, shapes, subjects };
}

function popFlowers(state, width, height, config) {
  const reference = Math.max(width, height * 0.9);
  const petalCount = Math.round(config.petals);
  state.forEach((current, flowerIndex) => {
    const flower = FLOWERS[flowerIndex];
    const size = flower.size * reference * current.scale;
    for (let petal = 0; petal < petalCount; petal += 1) {
      const angle = (petal / petalCount) * Math.PI * 2 + (flower.startDegrees * Math.PI) / 180;
      current.springs[petal].vx += Math.cos(angle) * size * POP_STRENGTH;
      current.springs[petal].vy += Math.sin(angle) * size * POP_STRENGTH;
    }
  });
}

export default function BlobField({ config, embedded = false, introKey = 0, exiting = false }) {
  const canvasRef = useRef(null);
  const restartRef = useRef(null);
  const exitRef = useRef({ active: false, start: 0 });
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const page = embedded ? null : document.querySelector(".blobs-page");
    if (!page) return undefined;
    page.style.background = config.customBackground ? config.background : "";
    page.style.color = config.customBackground ? config.textColor : "";
    if (config.customBackground) {
      page.style.setProperty("--blobs-face", config.background);
    } else {
      page.style.removeProperty("--blobs-face");
    }
    return () => {
      page.style.background = "";
      page.style.color = "";
      page.style.removeProperty("--blobs-face");
    };
  }, [embedded, config.customBackground, config.background, config.textColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return undefined;

    const program = buildProgram(gl);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniformNames = [
      "uResolution",
      "uTime",
      "uLobe",
      "uCore",
      "uShape",
      "uPalette",
      "uLight",
      "uLook",
      "uSurface",
      "uOrganic",
      "uRetro",
      "uStipple",
      "uGrade",
      "uGrain",
      "uSpace",
      "uSpaceB",
      "uInk",
      "uSubject",
      "uSubj",
      "uLayoutA",
      "uLayoutB",
      "uLayoutC",
      "uIntro",
      "uOutro",
      "uPush",
    ];
    const uniforms = Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
    );

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const deviceRatio = window.devicePixelRatio || 1;
    const governor = createResolutionGovernor({ max: 1, min: MIN_RESOLUTION_SCALE });
    const pixelCapFor = (layoutIndex) =>
      Math.min(deviceRatio, layoutIndex > 0 ? PIXELATED_PIXEL_CAP : embedded ? EMBEDDED_PIXEL_CAP : PAGE_PIXEL_CAP);
    let pixelCap = pixelCapFor(0);
    let pixelRatio = pixelCap;
    let activeLayout = 0;
    const palette = new Float32Array(FLOWERS.length * COLORS_PER_PALETTE * 3);
    const state = createState();
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false, lastMove: -Infinity };
    const parallax = { x: 0, y: 0 };
    const light = { x: 0, y: 0 };
    const push = { x: 0, y: 0, strength: 0 };
    let frame = 0;
    let running = false;
    let bloomStart = null;
    let lastMilliseconds = null;
    let lastScroll = embedded ? 0 : window.scrollY;
    let velocity = 0;
    let previousPointer = null;
    let latestEvent = null;

    const handleMove = (event) => {
      latestEvent = event;
      pointer.lastMove = performance.now();
    };
    const handleLeave = () => {
      latestEvent = null;
      pointer.lastMove = -Infinity;
    };
    const pop = () => popFlowers(state, canvas.width, canvas.height, configRef.current);
    const replay = () => {
      bloomStart = null;
    };
    blobActions.pop = pop;
    blobActions.replay = replay;
    restartRef.current = replay;

    const resize = () => {
      canvas.width = Math.round(canvas.clientWidth * pixelRatio);
      canvas.height = Math.round(canvas.clientHeight * pixelRatio);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (milliseconds) => {
      const settings = { ...DEFAULTS, ...configRef.current };
      if (settings.layout !== activeLayout) {
        activeLayout = settings.layout;
        pixelCap = pixelCapFor(activeLayout);
        pixelRatio = pixelCap * governor.scale;
        resize();
      }
      if (lastMilliseconds !== null && governor.sample(milliseconds - lastMilliseconds)) {
        pixelRatio = pixelCap * governor.scale;
        resize();
      }
      const viewWidth = embedded ? canvas.clientWidth : window.innerWidth;
      const cellScale = Math.min(Math.max(viewWidth / 1300, embedded ? 0.3 : 0.55), 1.2);
      if (bloomStart === null) bloomStart = milliseconds;
      const elapsed = lastMilliseconds === null ? 16 : Math.min(milliseconds - lastMilliseconds, 64);
      lastMilliseconds = milliseconds;
      const deltaSeconds = Math.min(elapsed / 1000, 1 / 30);
      const scrollY = embedded ? 0 : window.scrollY;
      const instantVelocity = (scrollY - lastScroll) / Math.max(elapsed / 1000, 0.001);
      lastScroll = scrollY;
      velocity = lerp(velocity, reducedMotion ? 0 : instantVelocity, 1 - Math.exp(-deltaSeconds * 8));
      const scenePosition = embedded ? 0 : scrollY / Math.max(window.innerHeight, 1);
      const follow = reducedMotion ? 1 : 1 - Math.exp(-deltaSeconds * settings.followRate);
      const seconds = reducedMotion ? 0 : milliseconds / 1000;
      const bloomSeconds = reducedMotion
        ? settings.bloomSeconds + 1
        : (milliseconds - bloomStart) / 1000;

      const hovering = !reducedMotion && performance.now() - pointer.lastMove < POINTER_IDLE_MS;
      pointer.active = hovering && latestEvent !== null;
      const rect = latestEvent !== null ? canvas.getBoundingClientRect() : null;
      if (pointer.active) {
        const targetX = (latestEvent.clientX - rect.left) * pixelRatio;
        const targetY = (latestEvent.clientY - rect.top) * pixelRatio;
        const smoothing = 1 - Math.exp(-deltaSeconds * 14);
        const nextX = lerp(previousPointer ? pointer.x : targetX, targetX, smoothing);
        const nextY = lerp(previousPointer ? pointer.y : targetY, targetY, smoothing);
        pointer.vx = (nextX - pointer.x) / Math.max(deltaSeconds, 0.001);
        pointer.vy = (nextY - pointer.y) / Math.max(deltaSeconds, 0.001);
        pointer.x = nextX;
        pointer.y = nextY;
        previousPointer = true;
      } else {
        pointer.vx = 0;
        pointer.vy = 0;
        previousPointer = null;
      }

      const settled = !exitRef.current.active && bloomSeconds > INTRO_SETTLE_SECONDS;
      const insideCanvas =
        rect !== null &&
        !reducedMotion &&
        settled &&
        latestEvent.clientX >= rect.left &&
        latestEvent.clientX <= rect.right &&
        latestEvent.clientY >= rect.top &&
        latestEvent.clientY <= rect.bottom;
      const pushFade = 1 - Math.exp(-deltaSeconds * PUSH_FADE_RATE);
      push.strength = lerp(push.strength, insideCanvas ? 1 : 0, pushFade);
      if (insideCanvas) {
        const targetX = (latestEvent.clientX - rect.left) * pixelRatio;
        const targetY = (latestEvent.clientY - rect.top) * pixelRatio;
        if (push.strength < 0.03) {
          push.x = targetX;
          push.y = targetY;
        } else {
          const follow = 1 - Math.exp(-deltaSeconds * PUSH_FOLLOW_RATE);
          let stepX = (targetX - push.x) * follow;
          let stepY = (targetY - push.y) * follow;
          const travel = Math.hypot(stepX, stepY);
          const limit = canvas.height * PUSH_MAX_SPEED * deltaSeconds;
          if (travel > limit) {
            stepX *= limit / travel;
            stepY *= limit / travel;
          }
          push.x += stepX;
          push.y += stepY;
        }
      }

      const parallaxFollow = 1 - Math.exp(-deltaSeconds * 4);
      parallax.x = lerp(parallax.x, pointer.active ? pointer.x / canvas.width - 0.5 : 0, parallaxFollow);
      parallax.y = lerp(parallax.y, pointer.active ? pointer.y / canvas.height - 0.5 : 0, parallaxFollow);

      const idleX = canvas.width * (0.5 + 0.38 * Math.cos(seconds * 0.3));
      const idleY = canvas.height * (0.32 + 0.2 * Math.sin(seconds * 0.4));
      const lightFollow = 1 - Math.exp(-deltaSeconds * 5);
      light.x = lerp(light.x || idleX, pointer.active ? pointer.x : idleX, lightFollow);
      light.y = lerp(light.y || idleY, pointer.active ? pointer.y : idleY, lightFollow);

      const { lobes, cores, shapes, subjects } = layout({
        width: canvas.width,
        height: canvas.height,
        seconds,
        deltaSeconds,
        bloomSeconds,
        position: scenePosition,
        velocity,
        follow,
        state,
        palette,
        pointer,
        parallax,
        config: settings,
      });

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, seconds);
      gl.uniform3fv(uniforms.uLobe, lobes);
      gl.uniform3fv(uniforms.uCore, cores);
      gl.uniform2fv(uniforms.uShape, shapes);
      gl.uniform3fv(uniforms.uPalette, palette);
      gl.uniform2f(uniforms.uLight, light.x, light.y);
      gl.uniform4f(uniforms.uLook, settings.edgeLow, settings.edgeHigh, settings.valley, settings.gloss);
      gl.uniform4f(
        uniforms.uSurface,
        settings.glossSharpness,
        settings.rim,
        settings.ambient,
        settings.outline,
      );
      gl.uniform4f(
        uniforms.uOrganic,
        settings.wobble,
        settings.wobbleSpeed,
        settings.wobbleScale,
        settings.lobeShape,
      );
      gl.uniform4f(
        uniforms.uRetro,
        settings.pixel * pixelRatio,
        settings.dither,
        settings.levels,
        settings.ditherScale * pixelRatio,
      );
      gl.uniform4f(
        uniforms.uStipple,
        settings.alphaDither,
        settings.halftone,
        settings.halftoneSize * pixelRatio,
        settings.mono,
      );
      gl.uniform4f(
        uniforms.uGrade,
        settings.hue,
        settings.saturation,
        settings.contrast,
        settings.aberration * pixelRatio,
      );
      gl.uniform2f(uniforms.uGrain, settings.grain, settings.grainSpeed);
      gl.uniform4f(
        uniforms.uSpace,
        settings.gridMode,
        settings.gridSize * pixelRatio,
        settings.gridWarp,
        settings.gridStrength,
      );
      gl.uniform4f(uniforms.uSpaceB, settings.gridReveal, 0, 0, 0);
      const ink = hexToRgb(settings.customBackground ? settings.textColor : "#16161d");
      gl.uniform3f(uniforms.uInk, ink[0], ink[1], ink[2]);
      gl.uniform1f(uniforms.uIntro, bloomSeconds);
      const outro = exitRef.current.active
        ? Math.min(Math.max((milliseconds - exitRef.current.start) / EXIT_MS, 0), 1)
        : 0;
      gl.uniform1f(uniforms.uOutro, outro);
      gl.uniform3f(uniforms.uPush, push.x, push.y, push.strength);
      gl.uniform1f(uniforms.uSubject, settings.subject);
      gl.uniform4f(
        uniforms.uLayoutA,
        settings.layout,
        settings.cellSize * pixelRatio * cellScale,
        settings.jitter,
        settings.sizeVar,
      );
      gl.uniform4f(uniforms.uLayoutB, settings.density, settings.layoutSpin, scenePosition, settings.drift);
      gl.uniform4f(uniforms.uLayoutC, settings.elementScale, Math.round(settings.petals), 0, 0);
      gl.uniform3fv(uniforms.uSubj, subjects);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.dataset.painted = "";
      frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (running) return;
      running = true;
      lastMilliseconds = null;
      frame = requestAnimationFrame(draw);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
    visibility.observe(canvas);
    window.addEventListener("pointermove", handleMove);
    if (!embedded) window.addEventListener("pointerdown", pop);
    window.addEventListener("pointerleave", handleLeave);
    if (!embedded) window.addEventListener("dblclick", replay);

    return () => {
      stop();
      visibility.disconnect();
      observer.disconnect();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerdown", pop);
      window.removeEventListener("pointerleave", handleLeave);
      window.removeEventListener("dblclick", replay);
    };
  }, []);

  useLayoutEffect(() => {
    if (restartRef.current) restartRef.current();
  }, [introKey]);

  useLayoutEffect(() => {
    exitRef.current = { active: exiting, start: performance.now() };
  }, [exiting]);

  return (
    <canvas
      ref={canvasRef}
      className={embedded ? "blobs-field blobs-field--embedded" : "blobs-field"}
      aria-hidden="true"
    />
  );
}
