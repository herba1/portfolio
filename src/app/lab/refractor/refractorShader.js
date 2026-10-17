export const FULL_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CARD_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uPhoto;
uniform sampler2D uMask;
uniform sampler2D uBack;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform mat3 uRot;
uniform float uLift;
uniform float uDist;
uniform float uGround;
uniform float uRadius;
uniform float uThick;
uniform vec4 uSleeve;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uFoil;
uniform vec4 uArt;
uniform float uPaper;
uniform float uMaskRes;
uniform float uReady;
uniform float uSeed;
uniform vec3 uGroundTint;

out vec4 outColor;

const float PI = 3.14159265;

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float boxSdf(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float safeDiv(float a, float b) {
  return a / (abs(b) < 1e-5 ? (b < 0.0 ? -1e-5 : 1e-5) : b);
}

float bump(float x, float c, float w) {
  float t = (x - c) / w;
  float v = max(1.0 - t * t, 0.0);
  return v * v;
}

vec3 spectral(float nm) {
  float x = (nm - 380.0) / 330.0;
  return vec3(bump(x, 0.8, 0.27) + 0.22 * bump(x, 0.06, 0.12), bump(x, 0.5, 0.25), bump(x, 0.18, 0.22));
}

vec3 grating(vec2 s, vec2 k, float d, float spread) {
  float u = abs(dot(s, k));
  float w = dot(s, vec2(-k.y, k.x));
  float lobe = exp(-min(w * w * spread, 40.0));
  vec3 c = spectral(d * u) + 0.62 * spectral(d * u * 0.5) + 0.34 * spectral(d * u / 3.0);
  return c * lobe;
}

vec3 envAt(vec3 r, vec3 keyDir, vec3 fillDir) {
  vec3 col = mix(vec3(0.19, 0.195, 0.205), vec3(0.6, 0.605, 0.615), smoothstep(-0.7, 0.85, r.y));
  col *= 0.92 + 0.08 * smoothstep(-1.0, 1.0, r.x);
  float k = dot(r, keyDir);
  col += vec3(1.7, 1.67, 1.62) * smoothstep(0.955, 0.993, k);
  col += vec3(0.4) * smoothstep(0.76, 0.97, k);
  float f = dot(r, fillDir);
  col += vec3(0.95, 0.97, 1.0) * smoothstep(0.972, 0.994, f);
  float az = atan(r.x, r.z);
  float tall = smoothstep(0.9, 0.25, abs(r.y));
  float stripL = smoothstep(0.17, 0.05, abs(az + 0.9));
  float stripR = smoothstep(0.13, 0.04, abs(az - 0.82));
  col += vec3(1.25, 1.24, 1.2) * stripL * tall + vec3(0.8, 0.82, 0.86) * stripR * tall;
  return col;
}

struct Foil {
  vec2 k;
  vec2 tilt;
  float d;
  float tex;
  float seam;
};

Foil refractorFoil(vec2 q, float aa) {
  Foil f;
  vec2 o = q - vec2(0.04, 0.2);
  float r = length(o);
  f.k = o / max(r, 1e-4);
  f.tilt = vec2(0.0);
  f.d = 1000.0;
  float freq = 150.0;
  float fade = 1.0 - smoothstep(0.22, 0.5, aa * freq);
  float ring = sin(r * freq * 2.0 * PI);
  float swirl = vnoise(vec2(r * 9.0, atan(o.y, o.x) * 2.0)) - 0.5;
  f.tex = 1.0 + 0.07 * ring * fade + 0.05 * swirl;
  f.seam = 0.0;
  return f;
}

vec3 voronoi(vec2 g, out vec2 cellId) {
  vec2 ip = floor(g);
  vec2 fp = fract(g);
  vec2 mr = vec2(0.0);
  vec2 mo = vec2(0.0);
  float md = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + 0.08 + 0.84 * hash22(ip + o) - fp;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mo = o;
      }
    }
  }
  float edge = 8.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 o = mo + vec2(float(x), float(y));
      vec2 r = o + 0.08 + 0.84 * hash22(ip + o) - fp;
      vec2 dr = r - mr;
      float l2 = dot(dr, dr);
      if (l2 > 1e-5) edge = min(edge, dot(0.5 * (mr + r), dr * inversesqrt(l2)));
    }
  }
  cellId = ip + mo;
  return vec3(mr, edge);
}

Foil atomicFoil(vec2 q, float aa) {
  Foil f;
  float scale = 6.4;
  vec2 id;
  vec3 v = voronoi(q * scale + uSeed, id);
  float a = hash21(id) * PI;
  f.k = vec2(cos(a), sin(a));
  f.tilt = (hash22(id + 3.7) - 0.5) * 0.3;
  f.d = 820.0 + 460.0 * hash21(id + 9.1);
  vec2 id2;
  float scale2 = 14.0;
  vec3 v2 = voronoi(q * scale2 + uSeed * 1.7 + 4.0, id2);
  float shard = hash21(id2 + 2.3);
  f.tilt += (hash22(id2 + 6.1) - 0.5) * 0.06;
  float w1 = aa * scale * 1.2 + 0.006;
  float w2 = aa * scale2 * 0.9 + 0.004;
  float crack = 1.0 - smoothstep(0.0, w1, v.z);
  float fine = (1.0 - smoothstep(0.0, w2, v2.z)) * step(0.45, hash21(id2 + id * 0.37));
  f.seam = max(crack * 0.7, fine * 0.35);
  f.tex = 0.95 + 0.1 * hash21(id + 5.3) + 0.04 * (shard - 0.5);
  return f;
}

Foil prismFoil(vec2 q, float aa) {
  Foil f;
  float scale = 7.5;
  vec2 g = q * scale;
  vec2 sk = vec2(g.x - g.y * 0.57735, g.y * 1.1547);
  vec2 id = floor(sk);
  vec2 fr = fract(sk);
  float up = step(1.0, fr.x + fr.y);
  vec3 bary = up > 0.5 ? vec3(fr.x + fr.y - 1.0, 1.0 - fr.x, 1.0 - fr.y) : vec3(1.0 - fr.x - fr.y, fr.x, fr.y);
  float edge = min(bary.x, min(bary.y, bary.z)) * 0.866;
  vec2 tid = id * 2.0 + up + 0.5;
  float pick = floor(hash21(tid) * 3.0);
  float a = pick * PI / 3.0 + PI / 6.0 + (hash21(tid + 4.1) - 0.5) * 0.08;
  f.k = vec2(cos(a), sin(a));
  float ta = floor(hash21(tid + 8.3) * 6.0) * PI / 3.0 + PI / 6.0;
  f.tilt = vec2(cos(ta), sin(ta)) * (0.05 + 0.06 * hash21(tid + 1.9));
  f.d = 1080.0;
  float w = aa * scale * 1.1 + 0.005;
  f.seam = (1.0 - smoothstep(0.0, w, edge)) * 0.45;
  f.tex = 0.96 + 0.08 * hash21(tid + 2.0);
  return f;
}

Foil foilAt(float kind, vec2 q, float aa) {
  if (kind < 0.5) return refractorFoil(q, aa);
  if (kind < 1.5) return atomicFoil(q, aa);
  return prismFoil(q, aa);
}

vec3 shadeFoil(float kind, vec2 q, float aa, vec3 tint, vec3 V, vec3 Lk, vec3 Lf, vec3 T, vec3 B, vec3 N) {
  Foil f = foilAt(kind, q, aa);
  vec3 Nf = normalize(N + T * f.tilt.x + B * f.tilt.y);
  vec3 R = reflect(-V, Nf);
  vec3 mirror = envAt(R, Lk, Lf);
  vec3 hk = Lk + V;
  vec3 hf = Lf + V;
  vec2 sk = vec2(dot(hk, T), dot(hk, B)) - f.tilt * dot(hk, N);
  vec2 sf = vec2(dot(hf, T), dot(hf, B)) - f.tilt * dot(hf, N);
  vec3 rainbow = grating(sk, f.k, f.d, 5.0) * 1.05 + grating(sf, f.k, f.d, 7.0) * 0.45;
  float rl = dot(rainbow, vec3(0.3, 0.55, 0.15));
  rainbow = mix(rainbow, vec3(rl), 0.12);
  vec3 tintRainbow = mix(tint, vec3(1.0), 0.4);
  vec3 col = tint * (mirror * 0.78 + 0.24) * f.tex + tintRainbow * rainbow * 0.95 * f.tex;
  vec3 seamCol = tint * (mirror * 0.38 + 0.05);
  col = mix(col, seamCol, f.seam * 0.6);
  return col;
}

float shadowAt(vec3 pg, vec3 n, vec3 c, vec3 l, vec2 halfSize, vec2 offset, float radius, float spread, float base) {
  float denom = dot(n, l);
  float s = safeDiv(dot(n, c - pg), denom);
  vec3 hit = pg + l * s;
  vec3 local = transpose(uRot) * (hit - c);
  float sd = boxSdf(local.xy - offset, halfSize, radius);
  float pw = base + max(s, 0.0) * spread;
  return 1.0 - smoothstep(-pw, pw, sd);
}

void main() {
  vec2 css = gl_FragCoord.xy / uDpr;
  css.y = uRes.y / uDpr - css.y;
  vec3 eye = vec3(0.0, 0.0, uDist);
  vec3 dir = normalize(vec3(css.x - uCenter.x, uCenter.y - css.y, 0.0) - eye);
  mat3 inv = transpose(uRot);
  vec3 T = uRot * vec3(1.0, 0.0, 0.0);
  vec3 B = uRot * vec3(0.0, 1.0, 0.0);
  vec3 N = uRot * vec3(0.0, 0.0, 1.0);
  vec3 c = vec3(0.0, 0.0, uLift);
  bool front = dot(N, dir) < 0.0;
  vec3 cf = c + N * (uThick * 0.5);
  vec3 cb = c - N * (uThick * 0.5);
  float tf = safeDiv(dot(N, cf - eye), dot(N, dir));
  float tb = safeDiv(dot(N, cb - eye), dot(N, dir));
  vec3 pf = eye + dir * tf;
  vec3 pb = eye + dir * tb;
  vec2 lf = (inv * (pf - cf)).xy;
  vec2 lb = (inv * (pb - cb)).xy;
  vec2 ln = front ? lf : lb;
  vec2 lfar = front ? lb : lf;
  vec3 pv = front ? pf : pb;
  float pxN = max(length(fwidth(ln)), 1e-3);
  float pxF = max(length(fwidth(lfar)), 1e-3);

  vec2 sOff = vec2(0.0, uSleeve.x);
  vec2 sHalf = uSleeve.yz;
  float sdS = boxSdf(ln - sOff, sHalf, 3.0);
  vec2 sq = abs(ln - sOff) - sHalf;
  vec2 sN = sq.x > sq.y ? vec2(sign(ln.x - sOff.x), 0.0) : vec2(0.0, sign(ln.y - sOff.y));
  float inS = -sdS;
  float topLip = step(0.5, sN.y) * step(sq.x, sq.y);
  float liftW = mix(9.0, 14.0, topLip);
  float wave = vnoise(ln * 0.035 + uSeed) - 0.5;
  float lift = (1.0 - smoothstep(0.0, liftW, inS)) * (0.7 + 0.6 * wave + 0.5 * topLip);
  vec2 refr = -sN * lift * 2.2;
  vec2 lc = ln + refr * step(0.0, inS);

  float sdN = boxSdf(lc, uHalf, uRadius);
  float sdF = boxSdf(lfar, uHalf, uRadius);
  float covN = clamp(0.5 - sdN / pxN, 0.0, 1.0);
  float covF = clamp(0.5 - sdF / pxF, 0.0, 1.0);
  float covS = clamp(0.5 - sdS / pxN, 0.0, 1.0);

  vec2 uv = vec2(lc.x / (2.0 * uHalf.x) + 0.5, 0.5 - lc.y / (2.0 * uHalf.y));
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  vec2 q = lc / max(uHalf.y, 1.0);
  float aa = max(length(fwidth(q)), 1e-4);

  vec3 V = normalize(eye - pv);
  vec3 Lk = normalize(uKey - pv);
  vec3 Lf = normalize(uFill - pv);

  vec2 groundUv = css / max(uRes / uDpr, vec2(1.0));
  vec2 lamp = (groundUv - vec2(0.3, 0.16)) * vec2(1.0, 1.3);
  vec3 col = uGroundTint * (0.885 + 0.125 * exp(-min(dot(lamp, lamp) * 1.5, 30.0)));
  col *= 1.0 + (vnoise(css * 0.9) * 0.6 + vnoise(css * 2.3) * 0.4 - 0.5) * 0.022;
  float tg = safeDiv(-uGround - eye.z, dir.z);
  vec3 pg = eye + dir * tg;
  vec3 sun = normalize(uKey);
  float contact = shadowAt(pg, N, c, sun, uHalf, vec2(0.0), uRadius, 0.1, 3.0);
  float soft = shadowAt(pg + vec3(-4.0, 6.0, 0.0), N, c, normalize(vec3(-0.05, 0.2, 1.0)), sHalf, sOff, 3.0, 0.85, 22.0);
  col *= 1.0 - (0.14 * contact + 0.15 * soft) * uReady;

  if (uReady > 0.0 && covS > 0.0) {
    col = col * 0.975 + vec3(0.018);
  }

  if (uReady > 0.0 && covF > 0.0) {
    vec3 nEdge = normalize(vec3(sign(lfar.x) * step(abs(lfar.y) / uHalf.y, abs(lfar.x) / uHalf.x), 0.0, 0.0) + vec3(0.0, sign(lfar.y), 0.0) * step(abs(lfar.x) / uHalf.x, abs(lfar.y) / uHalf.y) + 1e-4);
    float lit = max(dot(uRot * nEdge, Lk), 0.0);
    vec3 edgeCol = vec3(0.8, 0.79, 0.77) * (0.62 + 0.38 * lit);
    col = mix(col, edgeCol, covF * (1.0 - covN));
  }

  if (uReady > 0.0 && covN > 0.0) {
    vec3 face;
    vec3 Nv = front ? N : -N;
    vec3 Tv = front ? T : -T;
    float lam = max(dot(Nv, Lk), 0.0);
    vec3 R0 = reflect(-V, Nv);
    float coat = smoothstep(0.965, 0.995, dot(R0, Lk));
    if (front) {
      vec3 photo = textureGrad(uPhoto, uv, gx, gy).rgb;
      float plum = dot(photo, vec3(0.3, 0.55, 0.15));
      bool inArt = uv.x > uArt.x && uv.x < uArt.z && uv.y > uArt.y && uv.y < uArt.w;
      float maskAa = min(0.04 + 0.22 * max(length(gx), length(gy)) * uMaskRes, 0.42);
      float bg = smoothstep(0.5 - maskAa, 0.5 + maskAa, textureGrad(uMask, uv, gx, gy).r);
      float dark = clamp((uPaper * 0.84 - plum) / max(uPaper * 0.3, 1e-3), 0.0, 1.0);
      float chrome = inArt ? bg : 1.0 - dark;
      vec3 inkTint = pow(max(photo / max(uPaper, 0.2), vec3(0.0)), vec3(1.1));
      vec3 tint = inArt ? inkTint : vec3(clamp(plum / max(uPaper, 0.2), 0.0, 1.1));
      vec3 foil = shadeFoil(uFoil.x, q, aa, tint, V, Lk, Lf, T, B, N);
      if (uFoil.z > 0.001) foil = mix(foil, shadeFoil(uFoil.y, q, aa, tint, V, Lk, Lf, T, B, N), uFoil.z);
      vec2 sg = lc / max(uHalf.y, 1.0) * 128.0;
      vec2 cell = floor(sg);
      vec2 fp = fract(sg) - 0.5 - (hash22(cell + 5.1) - 0.5) * 0.45;
      float flake = (1.0 - smoothstep(0.16, 0.42, length(fp))) * step(0.68, hash21(cell + 31.7));
      vec2 nt = (hash22(cell + 11.3) - 0.5) * 0.85;
      vec3 nFlake = normalize(N + T * nt.x + B * nt.y);
      float al = max(dot(nFlake, normalize(Lk + V)), 0.0);
      float glint = exp(-min((1.0 - al) * 1800.0, 40.0)) * flake;
      float flakeVis = smoothstep(1.2, 2.4, 1.0 / max(aa * 128.0, 1e-3));
      vec3 sparkCol = mix(vec3(1.0), spectral(400.0 + 290.0 * hash21(cell + 2.2)) * 1.3, 0.55);
      foil += sparkCol * glint * 2.4 * flakeVis;
      vec3 printed = photo * (0.8 + 0.24 * lam);
      printed *= 1.0 + (hash21(floor(uv * 900.0)) - 0.5) * 0.03;
      face = mix(printed, foil, chrome);
    } else {
      vec2 buv = vec2(1.0 - uv.x, uv.y);
      vec3 back = textureGrad(uBack, buv, vec2(-gx.x, gx.y), vec2(-gy.x, gy.y)).rgb;
      face = back * (0.8 + 0.24 * lam);
    }
    float fres = 0.03 + 0.5 * pow(clamp(1.0 - dot(Nv, V), 0.0, 1.0), 5.0);
    face += vec3(1.0, 0.99, 0.97) * (coat * 0.08 + fres * 0.1);
    float edgeIn = -sdN;
    face *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 1.6, edgeIn));
    col = mix(col, face, covN);
  }

  if (uReady > 0.0 && covS > 0.0) {
    vec3 nl = normalize(vec3(sN * lift * 0.42 + vec2(wave, vnoise(ln * 0.02 + 7.0) - 0.5) * 0.05, 1.0));
    vec3 Nw = uRot * vec3(nl.xy, front ? nl.z : -nl.z);
    float nv = abs(dot(Nw, V));
    vec3 Rs = reflect(-V, Nw);
    float fres = 0.035 + 0.965 * pow(clamp(1.0 - nv, 0.0, 1.0), 5.0);
    vec3 refl = envAt(Rs, Lk, Lf);
    float glare = smoothstep(0.9, 0.99, dot(Rs, Lk)) * (0.35 + 0.65 * smoothstep(0.3, 0.75, vnoise(vec2(dot(ln, vec2(0.7, 0.7)) * 0.02, 1.7))));
    float sheet = smoothstep(0.55, 0.95, dot(Rs, Lk)) * (0.7 + 0.6 * vnoise(ln * 0.01 + 3.0));
    col = col * (1.0 - fres * 0.45) + refl * fres * 0.4 + vec3(1.0) * (glare * 0.12 + sheet * 0.03);
    float sealed = 1.0 - topLip;
    float seam = (1.0 - smoothstep(1.0, 2.6, inS)) * smoothstep(0.0, 0.8, inS);
    col = mix(col, col * 0.9 + 0.06, seam * 0.6 * sealed);
    float rim = (1.0 - smoothstep(0.0, 1.2, abs(inS - 0.5))) * (0.06 + 0.22 * lift);
    col += vec3(rim);
  }

  float grain = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col + grain, 1.0);
}
`;
