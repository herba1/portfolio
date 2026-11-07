// The chrome is a height field over the page: a sum of compact metaball
// kernels (the liquid), a surface-tension profile that stands its edge up
// like a meniscus, and slow swells carried along with the liquid. A hard
// studio environment is reflected in it. The result is never shown as tone:
// it is printed as one line screen whose phase is displaced by the surface,
// so every line bends over the forms and crowds where the surface turns, and
// whose width carries the tone. A lavender plate printed a hair out of
// register on the highlights, and a thin-film tint, are the iridescence.

export const MAXB = 56;

export const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_HEAD = `#version 300 es
precision highp float;
#define MAXB ${MAXB}
uniform vec4 uB[MAXB];      // centre x, y (css px), kernel radius (css px), weight
uniform vec2 uD[MAXB];      // displacement from rest (css px): carries the relief
uniform int uN;
uniform vec2 uRes;          // css px
uniform float uDpr;
uniform float uScale;
uniform float uTime;
uniform float uEnvRot;
uniform vec4 uK;            // line displacement by height, by reflection, by tone; spacing (css px)
uniform vec4 uK2;           // body height per unit field, -, -, -
uniform vec4 uS;            // relief amount, height (scale units), profile softness, threshold
out vec4 o;
`;

const COMMON = `
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float sdBox(vec2 q, vec2 b){ vec2 d = abs(q) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// Slow relief: a few long crossing swells, with an exact gradient.
vec3 relief(vec2 q){
  vec3 r = vec3(0.0);
  // Ridges laid across the flow (the sheet runs low-left to high-right), so
  // the swells stretch along it like poured metal, each one bent by a slow
  // warp along the flow so no two run parallel for long.
  const vec2 AX = vec2(0.91, -0.41);   // along the flow
  const vec4 W[5] = vec4[5](
    vec4( 0.41,  0.91, 3.2, 0.0), vec4( 0.15,  0.99, 4.9, 1.7), vec4( 0.62,  0.78, 6.6, 4.1),
    vec4( 0.25,  0.97, 8.8, 5.3), vec4( 0.91, -0.41, 2.2, 2.3));
  const float A[5] = float[5](0.5, 0.4, 0.26, 0.12, 0.14);
  for (int j = 0; j < 5; j++){
    vec2 k = W[j].xy * W[j].z * 0.75;
    vec2 kw = AX * (1.6 + 0.7 * float(j));
    float wp = dot(q, kw) + float(j) * 2.1 + uTime * 0.04;
    float wa = j < 4 ? 1.1 : 0.0;
    float ph = dot(q, k) + wa * sin(wp) + W[j].w + uTime * (0.05 + 0.02 * float(j));
    vec2 gph = k + wa * cos(wp) * kw;
    r.x += A[j] * sin(ph);
    r.yz += A[j] * cos(ph) * gph;
  }
  return r;
}

// The studio, seen from the chrome. Stereographic coordinates around the
// zenith: |s| = 1 is the horizon. Grey walls, two big softboxes and a strip,
// black flags between them, and a black floor below the horizon.
float env(vec3 r, float soft){
  vec2 s = rot(r.xy / (1.0 + max(r.z, -0.95)), uEnvRot);
  float L = 0.8 + 0.12 * s.x - 0.08 * s.y;
  float d;
  // Softboxes: white. Their edges and the flags cross right around the
  // zenith, so the gentle swells of a flat pool already break into islands.
  d = sdBox(rot(s - vec2(-0.22, 0.02), 0.3), vec2(0.2, 0.3));
  L = mix(L, 1.0, smoothstep(soft, -soft, d));
  d = sdBox(rot(s - vec2(0.36, -0.24), -0.2), vec2(0.16, 0.26));
  L = mix(L, 1.0, smoothstep(soft, -soft, d));
  d = sdBox(rot(s - vec2(0.18, 0.5), 0.1), vec2(0.5, 0.07));
  L = mix(L, 1.0, smoothstep(soft, -soft, d));
  // Black flags: long boards, not discs, so a small drop reads as chrome
  // rather than growing a face.
  d = sdBox(rot(s - vec2(0.14, 0.12), -0.5), vec2(0.2, 0.05)) - 0.03;
  L = mix(L, 0.02, smoothstep(soft, -soft, d));
  d = abs(dot(s - vec2(0.0, -0.34), normalize(vec2(-0.3, 1.0)))) - 0.085;
  L = mix(L, 0.03, smoothstep(soft, -soft, d));
  d = sdBox(rot(s - vec2(-0.5, 0.4), 0.7), vec2(0.24, 0.045));
  L = mix(L, 0.03, smoothstep(soft, -soft, d));
  d = sdBox(rot(s - vec2(0.6, 0.18), 0.9), vec2(0.18, 0.05));
  L = mix(L, 0.04, smoothstep(soft, -soft, d));
  // Low round the walls runs a lit cyclorama band, broken by two black
  // panels; below the horizon the floor is black but for a white bounce
  // card. So a rim reads as a bright band and then a black line, and the
  // line opens where the rim faces the card.
  float ang = atan(s.y, s.x);
  float ls = length(s);
  float panel = smoothstep(0.32, 0.22, abs(ang + 1.75)) + smoothstep(0.25, 0.15, abs(ang - 0.5));
  float cyc = mix(0.97, 0.06, clamp(panel, 0.0, 1.0));
  L = mix(L, cyc, smoothstep(0.7 - soft, 0.74 + soft, ls));
  float card = smoothstep(0.5, 0.3, abs(ang - 2.3)) + smoothstep(0.35, 0.2, abs(ang + 0.6)) * 0.85;
  float floorL = mix(0.0, 0.92, clamp(card, 0.0, 1.0));
  L = mix(L, floorL, smoothstep(0.9 - soft, 0.94 + soft, ls));
  return L;
}

// Coverage of one plate's line at phase ph, width w (fraction of a period),
// for a screen running at fpx cycles per device pixel.
float plate(float ph, float w, float fpx){
  float u = abs(fract(ph + 0.5) - 0.5);
  float c = clamp((0.5 * w - u) / fpx + 0.5, 0.0, 1.0);
  // Finer than the pixel can hold: print the average.
  return mix(c, clamp(w, 0.0, 1.0), smoothstep(0.28, 0.55, fpx));
}

// The surface at a point: signed distance to the edge (css px), the line
// screen's displacement (css px), the reflected tone, and the film thickness.
vec4 surface(vec2 p){
  // The liquid.
  float f = 0.0; vec2 g = vec2(0.0); vec2 disp = vec2(0.0); float ws = 1e-5;
  for (int i = 0; i < MAXB; i++){
    if (i >= uN) break;
    vec4 b = uB[i];
    vec2 d = p - b.xy;
    float R2 = b.z * b.z;
    float q = dot(d, d) / R2;
    if (q < 1.0){
      float m = 1.0 - q;
      float k = m * m * m;
      f += b.w * k;
      g += b.w * 3.0 * m * m * (-2.0 * d / R2);
      disp += k * uD[i];
      ws += k;
    }
  }
  disp /= ws;

  float thr = uS.w;
  // Relief rides with the liquid and only lives inside it.
  vec3 rl = relief((p - disp) / uScale);
  float mk = smoothstep(0.02, thr * 1.6, f);
  float mkd = (f > 0.02 && f < thr * 1.6) ? 6.0 * ((f - 0.02) / (thr * 1.6 - 0.02)) * (1.0 - (f - 0.02) / (thr * 1.6 - 0.02)) / (thr * 1.6 - 0.02) : 0.0;
  float F = f + uS.x * mk * rl.x;
  vec2 gF = g + uS.x * (mkd * g * rl.x + mk * rl.yz / uScale);

  float x = F - thr;
  float gLen = max(length(gF), 1e-6);
  float sd = x / gLen;                        // css px to the edge

  // Surface tension: the edge stands up, the top flattens out.
  float H = uS.y * uScale;
  float a = uS.z;
  float xe = max(x, 1e-5);
  float e = exp(-xe / a);
  // ...and the body keeps undulating: gently with the field (compressed,
  // so deep overlaps don't tower), and with the slow swells riding on it,
  // which die away toward the rim.
  float H2 = uK2.x * uScale;
  float Hr = uK2.y * uScale;
  float a2 = 0.25;
  float sat = 1.0 - exp(-xe / a2);
  // The body's rise only starts past the meniscus, so the rim stays a line.
  float s2 = 1.0 - exp(-xe / 0.35);
  float g2 = 0.5 * log(1.0 + xe / 0.5);
  float h = H * sqrt(1.0 - e) + H2 * g2 * s2 + Hr * sat * rl.x;
  float dh = H * e / (2.0 * a * sqrt(max(1.0 - e, 1e-6))) + H2 * (s2 / (1.0 + xe / 0.5) + g2 * exp(-xe / 0.35) / 0.35) + Hr * rl.x * exp(-xe / a2) / a2;
  vec2 gh = dh * gF + Hr * sat * rl.yz / uScale;
  vec3 n = normalize(vec3(-gh, 1.0));

  vec3 v = normalize(vec3((p - uRes * 0.5) / (uScale * 2.6), -1.0));
  vec3 r = reflect(v, n);
  float L = env(r, 0.05);
  float Ls = env(r, 0.22);

  float S = uK.w;
  float Dsp = uK.x * h + uK.y * S * 4.0 * dot(n.xy, vec2(0.35, 1.0)) + uK.z * S * Ls;
  float tf = 380.0 + 260.0 * (h / H) + 120.0 * n.z;
  return vec4(clamp(sd, -64.0, 64.0), Dsp, L, tf);
}

// The print: one line screen, displaced by the surface, its width carrying
// the tone, over acid stock.
vec3 printAt(vec2 p, vec4 sf){
  float sd = sf.x;
  float L = sf.z;
  float tf = sf.w;
  float alpha = clamp(sd * uDpr + 0.5, 0.0, 1.0);
  float S = uK.w;
  vec2 N0 = normalize(vec2(0.24, 1.0));
  vec2 T0 = vec2(N0.y, -N0.x);
  float phi = (dot(p, N0) + sf.y) / S;
  vec2 gp = vec2(dFdx(phi), dFdy(phi));
  float fpx = max(length(gp), 1e-4);

  float T = 1.0 - L;
  float w = mix(0.08, 1.04, pow(T, 1.6));
  // A cut line is never perfectly even: it swells and thins along its run,
  // which breaks the hairlines into dashes in the highlights.
  float idx = floor(phi + 0.5);
  float along = dot(p, T0) / (S * 1.7);
  w += (vnoise(vec2(along, idx * 7.13)) - 0.5) * 0.22 * (1.0 - T * 0.6);
  // The burin rocks as it cuts, so midtone lines are beaded at about their
  // own pitch; where the lines crowd, the beads of neighbours fall in and
  // out of step, which is the moire.
  float mid = 4.0 * T * (1.0 - T);
  w *= 1.0 + 0.32 * mid * cos(6.2832 * dot(p, T0) / (S * 1.15));

  // Two plates: the black key, and a lavender plate printed a hair out of
  // register, which only shows on the light.
  float cK = plate(phi, w, fpx);
  // In the midtones a second, finer cut crosses the first at a steep angle,
  // displaced by the same surface but less: where the two run nearly
  // together they beat into the dotted moire of the reference.
  vec2 N1 = normalize(vec2(-0.52, 1.0));
  float phi2 = (dot(p, N1) + 0.6 * sf.y) / (S * 0.92);
  float fpx2 = max(length(vec2(dFdx(phi2), dFdy(phi2))), 1e-4);
  float cross = plate(phi2, 0.42 * mid, fpx2) * smoothstep(0.15, 0.4, T) * smoothstep(0.92, 0.7, T);
  cK = max(cK, cross * 0.85);
  float lit = smoothstep(0.35, 0.95, L);
  float cV = plate(phi + 0.12 * lit, 0.12 + w * 0.6, fpx) * lit;
  // The key's hairlines print lighter and bluer than its solids.
  vec3 ink = mix(vec3(0.03, 0.03, 0.06), vec3(0.5, 0.45, 0.74), lit * (1.0 - smoothstep(0.18, 0.5, w)));

  // Thin film on the white: a faint interference tint from the height.
  vec3 lam = vec3(650.0, 540.0, 450.0);
  vec3 film = 0.5 + 0.5 * cos(12.566 * 1.33 * tf / lam);
  // Seen through a printed key, the film reads as peach and lilac.
  float fk = dot(film, vec3(0.6, -0.2, -0.4)) + 0.5;
  vec3 tint = mix(vec3(0.93, 0.89, 1.0), vec3(1.0, 0.92, 0.82), clamp(fk + 0.25, 0.0, 1.0));
  vec3 paper = mix(vec3(0.995, 0.99, 0.98), tint, 0.5 * lit * (0.4 + 0.6 * smoothstep(0.95, 0.7, L)));
  vec3 chrome = mix(paper, vec3(0.78, 0.72, 0.95), cV * 0.4);
  chrome = mix(chrome, ink, cK);

  // The ground: acid yellow-green stock with a printed mottle and tooth.
  vec2 dp = gl_FragCoord.xy;
  float mott = vnoise(p / 90.0) * 0.6 + vnoise(p / 23.0) * 0.4;
  float tooth = hash(floor(dp)) - 0.5;
  vec3 ground = vec3(0.835, 0.925, 0.13) * (0.965 + 0.05 * mott) + tooth * 0.018;
  ground += vec3(0.02, 0.02, 0.0) * (p.x / uRes.x - 0.5);

  // Ink spreads a little into the stock at the edge: a cool, soft trap.
  float spread = exp(-max(-sd, 0.0) / 2.2) * (1.0 - alpha);
  ground = mix(ground, vec3(0.5, 0.52, 0.7), 0.45 * spread);
  vec3 col = mix(ground, chrome, alpha);
  return col;
}

`;

export const FS_ONE = FS_HEAD + COMMON + `
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  o = vec4(printAt(p, surface(p)), 1.0);
}`;

// Two passes: the surface at one sample per css pixel into a half-float
// target, then the print at full resolution reading it back. The surface is
// smooth (its edge is a distance, its tone already softened), so it scales
// up cleanly; the lines, which are not, are drawn at full resolution.
export const FS_SURF = FS_HEAD + COMMON + `
uniform vec2 uSurfRes;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uSurfRes.y - gl_FragCoord.y) * (uRes / uSurfRes);
  o = surface(p);
}`;

export const FS_PRINT = FS_HEAD + COMMON + `
uniform sampler2D uSurf;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec4 sf = texture(uSurf, gl_FragCoord.xy / (uRes * uDpr));
  o = vec4(printAt(p, sf), 1.0);
}`;
