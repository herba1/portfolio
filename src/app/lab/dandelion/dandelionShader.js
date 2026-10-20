export const seedVertex = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aPos;
layout(location = 2) in vec3 aPose;
layout(location = 3) in vec2 aLook;
layout(location = 4) in vec4 aHome;
layout(location = 5) in vec2 aRest;

uniform vec2 uCenter;
uniform float uUnit;
uniform vec2 uSize;
uniform float uDpr;
uniform float uSp;
uniform int uMode;
uniform vec2 uLight;
uniform mat3 uTurn;
uniform float uDome;

out vec2 vLocal;
out float vRpx;
out float vTone;
out float vTilt;
out float vSpin;
out float vBlur;
out float vZ;
out float vBack;
flat out float vCount;
flat out float vSeed;
flat out float vWave;

void main() {
  vec2 pos = aPos.xy;
  float z = aPos.z;
  float theta = aPose.x;
  float tilt = aPose.y;
  float spin = aPose.z;
  float tone = aLook.x;
  float present = aLook.y;
  float show = step(0.015, tone);
  float R = uSp * (0.16 + 0.98 * sqrt(max(tone, 0.0))) * (1.0 + 0.4 * max(z, 0.0));

  if (uMode == 1) {
    pos = aHome.xy;
    z = 0.0;
    theta = aRest.x;
    tilt = aRest.y;
    spin = 0.0;
    R = uSp * 0.5;
    show *= step(0.02, 1.0 - present);
  } else {
    show *= step(-0.5, z);
    R *= mix(1.0, 0.6, clamp(-present, 0.0, 1.0));
  }
  if (uMode == 2) {
    show *= step(0.01, z);
    pos += uLight * z * 0.16;
  } else {
    float att = uMode == 1 ? 1.0 : clamp(1.0 - z * 5.0, 0.0, 1.0) * clamp(present, 0.0, 1.0);
    if (att > 0.0) {
      vec3 sp = vec3(pos, uDome * sqrt(max(1.0 - dot(pos, pos), 0.0)));
      vec3 rp = uTurn * sp;
      vec3 ax = vec3(sin(tilt) * cos(theta), sin(tilt) * sin(theta), cos(tilt));
      vec3 ra = normalize(mix(ax, uTurn * ax, att));
      pos = mix(pos, rp.xy, att);
      theta = atan(ra.y, ra.x);
      tilt = min(1.35, acos(clamp(abs(ra.z), 0.0, 1.0)));
    }
  }

  if (show < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(0.0);
    vRpx = 1.0;
    vTone = 0.0;
    vTilt = 0.0;
    vSpin = 0.0;
    vBlur = 0.0;
    vZ = 0.0;
    vBack = 0.0;
    vCount = 12.0;
    vSeed = 0.0;
    vWave = 0.0;
    return;
  }

  float s = sin(tilt);
  float c = max(cos(tilt), 0.22);
  float hs = min(0.42 * s, 0.8 * c);
  float rpx = max(R * uUnit * uDpr, 0.5);
  float blur = 1.6 * max(z, 0.0) * uDpr;
  float pad = (2.0 + blur * 1.5) / rpx;
  vec2 lo = vec2(-1.1 - pad, -(2.35 * s + 0.15) - pad);
  vec2 hi = vec2(1.1 + pad, 1.0 + hs + 0.12 + pad);
  if (uMode == 2) {
    lo = vec2(-1.8);
    hi = vec2(1.8);
  }
  vec2 local = mix(lo, hi, aCorner * 0.5 + 0.5);
  vec2 up = vec2(cos(theta), sin(theta));
  vec2 right = vec2(-up.y, up.x);
  vec2 world = pos + (right * local.x + up * local.y) * R;
  vec2 px = uCenter + world * uUnit;
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);

  vLocal = local;
  vRpx = rpx;
  vTone = tone;
  vTilt = tilt;
  vSpin = spin;
  vBlur = blur;
  vZ = max(z, 0.0);
  vBack = uMode == 1 ? 0.0 : clamp(-present, 0.0, 1.0);
  vCount = floor(9.0 + aHome.z * 4.0 + tone * 3.0);
  vSeed = aHome.w;
  vWave = clamp(0.5 + 0.42 * aHome.x - 0.12 * aHome.y + 0.1 * aHome.z, 0.0, 1.0);
}
`;

export const seedFragment = `#version 300 es
precision highp float;
precision highp int;

in vec2 vLocal;
in float vRpx;
in float vTone;
in float vTilt;
in float vSpin;
in float vBlur;
in float vZ;
in float vBack;
flat in float vCount;
flat in float vSeed;
flat in float vWave;

uniform int uMode;
uniform vec2 uForm;
uniform float uMorph;
uniform float uDpr;
uniform vec3 uInk;
uniform vec3 uHusk;
uniform vec3 uShade;
uniform vec3 uFluff;

out vec4 outColor;

float hash(float n) {
  return fract(sin(n * 12.9898 + 4.1414) * 43758.5453);
}

float fall(float a, float b, float x) {
  return 1.0 - smoothstep(a, b, x);
}

float hair(float d, float w, float aa) {
  float hw = max(w, 0.5);
  return clamp((hw + 0.5 * aa - d) / aa, 0.0, 1.0) * min(1.0, w / hw);
}

float tuft(float form, vec2 p, vec2 q, float r, float c, float px, float aa) {
  float squash = mix(c, 1.0, 0.55);
  float ang = atan(p.y, p.x + 1e-6) + vSpin;
  float count = vCount;
  float w = mix(0.2, 0.46, vTone) * uDpr;
  float plumeK = 0.13;
  float plumeW = 2.4;
  float hazeK = 0.02 + 0.12 * vTone;
  float hubK = 1.0;
  float reachLo = 0.82;
  if (form > 1.5) {
    ang += 0.09 * sin(r * 5.0 + vSeed * 41.0);
    count = floor(vCount * 1.8);
    w *= 0.62;
    plumeK = 0.1;
    plumeW = 2.6;
    hazeK = 0.08 + 0.18 * vTone;
    hubK = 0.6;
    reachLo = 0.72;
  } else if (form > 0.5) {
    count = floor(5.0 + vCount * 0.2);
    w *= 1.12;
    plumeK = 0.2;
    plumeW = 3.6;
    hazeK = 0.015 + 0.06 * vTone;
    reachLo = 0.9;
  }
  float stepA = 6.2831853 / max(count, 3.0);
  float k = floor(ang / stepA + 0.5);
  float da = ang - k * stepA;
  float reach = reachLo + (1.0 - reachLo) * hash(mod(k, 64.0) + vSeed * 97.0);
  float dpx = abs(sin(da)) * r * px * squash;
  float body = fall(reach - 0.12, reach + 0.04, r);
  float line = hair(dpx, w, aa) * body;
  float plume = hair(dpx, w * plumeW + 0.25 * uDpr, aa) * plumeK * smoothstep(0.42, 0.82, r) * fall(reach - 0.05, reach + 0.1, r);
  float haze = form > 1.5 ? hazeK * (1.0 - smoothstep(0.0, 0.95, r)) : hazeK * fall(0.1, 0.62, r);
  float hubR = max(0.07, 0.65 * uDpr / max(px, 0.1));
  float hub = clamp((hubR * px - length(q) * px) / aa + 0.5, 0.0, 1.0) * hubK;
  float web = 0.0;
  if (form > 0.5 && form < 1.5) {
    float e = da >= 0.0 ? da - stepA * 0.5 : da + stepA * 0.5;
    float u = e / (stepA * 0.5);
    float wa = w * 0.55;
    for (int i = 0; i < 2; i++) {
      float rho = i == 0 ? 0.46 : 0.78;
      float chord = rho * cos(stepA * 0.5) - 0.05 * rho * (1.0 - u * u);
      float d = abs(r * cos(e) - chord) * px * squash;
      web = max(web, hair(d, wa, aa) * 0.8);
    }
  }
  return 1.0 - (1.0 - line) * (1.0 - plume) * (1.0 - haze) * (1.0 - hub) * (1.0 - web);
}

void main() {
  vec2 q = vLocal;
  float px = vRpx;
  float aa = 1.0 + vBlur;

  if (uMode == 2) {
    float d = length(q);
    float a = fall(0.1, 1.7, d) * 0.085 * smoothstep(0.0, 0.14, vZ) * (1.0 - 0.5 * min(vZ, 1.0)) * (0.45 + 0.55 * vTone) * (1.0 - 0.6 * vBack);
    outColor = vec4(uShade * a, a);
    return;
  }

  float s = sin(vTilt);
  float c = max(cos(vTilt), 0.22);

  if (uMode == 1) {
    float pit = hair(length(q) * px, 0.42 * uDpr, 1.0);
    float stub = 0.0;
    float stubLen = 0.9 * s;
    if (q.y < 0.0 && -q.y < stubLen) stub = hair(abs(q.x) * px, 0.22 * uDpr, 1.0) * fall(stubLen * 0.6, stubLen, -q.y);
    float a = max(pit, stub * 0.85) * (0.34 + 0.4 * vTone);
    outColor = vec4(uHusk * a, a);
    return;
  }

  float hs = min(0.42 * s, 0.8 * c);
  float r0 = length(vec2(q.x, q.y / c));
  float edge = (1.5 + aa) / px;
  bool stalkZone = q.y < 0.0 && abs(q.x) * px < max(0.075 * px, 0.45 * uDpr) + aa + 0.5;
  if (!stalkZone && r0 > 1.0 + hs + edge && length(vec2(q.x, (q.y - hs) / c)) > 1.0 + edge) discard;
  vec2 p = vec2(q.x, (q.y - hs * min(r0, 1.2)) / c);
  float r1 = length(p);
  p = vec2(q.x, (q.y - hs * min(r1, 1.2)) / c);
  float r = length(p);

  float pappus = tuft(uForm.x, p, q, r, c, px, aa);
  if (uForm.y != uForm.x) {
    float m = clamp((uMorph * 1.6 - vWave * 0.6) * 2.5, 0.0, 1.0);
    if (m > 0.0) pappus = mix(pappus, tuft(uForm.y, p, q, r, c, px, aa), m);
  }

  float husk = 0.0;
  if (s > 0.04) {
    float drop = -q.y;
    float beak = 1.7 * s;
    if (drop > 0.0 && drop < beak) husk = hair(abs(q.x) * px, 0.2 * uDpr, aa) * 0.9;
    float body2 = 0.6 * s;
    float t = (drop - beak) / max(body2, 1e-3);
    if (t > 0.0 && t < 1.0) {
      float girth = max(0.45 * uDpr, 0.075 * px) * pow(max(sin(3.14159265 * t), 0.0), 0.6);
      husk = max(husk, hair(abs(q.x) * px, girth, aa));
    }
  }

  float lift = 1.0 - 0.32 * min(vZ, 1.0);
  float pa = pappus * 0.92 * lift * mix(1.0, 0.7, vBack);
  float ha = husk * 0.9 * (1.0 - pa) * (1.0 - vBack);
  float alpha = pa + ha;
  if (alpha < 0.003) discard;
  vec3 ink = mix(uInk, uFluff, vBack * 0.72);
  outColor = vec4(ink * pa + uHusk * ha, alpha);
}
`;
