// The chrome is a height field over the page: a sum of compact metaball
// kernels (the liquid), a surface-tension profile that stands its edge up
// like a meniscus, and slow swells carried along with the liquid. A hard
// studio is reflected in it. The result is never shown as tone:
// it is printed as one line screen whose phase is displaced by the surface,
// so every line bends over the forms and crowds where the surface turns, and
// whose width carries the tone. A lavender plate printed a hair out of
// register on the highlights, and a thin-film tint, are the iridescence.

export const MAXB = 56;
// Threads: the neck a pulled drop draws out of the pool.
export const MAXT = 4;

export const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_HEAD = `#version 300 es
precision highp float;
#define MAXB ${MAXB}
#define MAXT ${MAXT}
uniform vec4 uB[MAXB];      // centre x, y (css px), kernel radius (css px), weight
uniform vec4 uD[MAXB];      // displacement from rest (css px): carries the relief; the tilt of the studio
                            // this ball sees (radians, about a horizontal axis), so no two drops reflect alike
uniform int uN;
uniform vec4 uTa[MAXT];     // thread: root end x, y; drop end x, y (css px)
uniform vec4 uTr[MAXT];     // thread kernel radius at the root, at the waist, at the drop; weight
uniform vec4 uTm[MAXT];     // where the waist sits (0 root .. 1 drop); displacement at the drop end
uniform int uNT;
uniform vec2 uRes;          // css px
uniform float uDpr;
uniform float uScale;
uniform float uTime;
uniform float uEnvRot;
uniform vec4 uK;            // least line density (monotone floor), displacement by reflection, by tone; spacing (css px)
uniform vec4 uK2;           // body height per unit field, swell height, reach of the broad body (scale units), its height
uniform vec4 uS;            // relief amount, height (scale units), profile softness, threshold
uniform vec4 uE;            // (unused), ripple slope, screen turn by the reflection, ripple scale
uniform vec4 uG;            // dome slope (per scale unit off the pool's middle), horizon tilt (rad), horizon offset, studio edge (stereographic units)
out vec4 o;
// The carrier: the one fixed direction the screen climbs in (css px, y down).
// Lines run diagonally, falling to the right, across the pool's flow, so they
// cross the forms instead of following their contours, and the surface only
// bends and bunches them.
const vec2 N0 = vec2(-0.4819, 0.8762);
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

// Slow relief: crossing swells, with an exact gradient. The long ones carry
// it; the two shorter ones are kept low, enough to tip the normal across
// the hard studio's edges without making the lines wiggle like a texture.
vec3 relief(vec2 q){
  vec3 r = vec3(0.0);
  // Ridges laid across the flow (the sheet runs low-left to high-right), so
  // the swells stretch along it like poured metal, each one bent by a slow
  // warp along the flow so no two run parallel for long.
  const vec2 AX = vec2(0.91, -0.41);   // along the flow
  const vec4 W[5] = vec4[5](
    vec4( 0.41,  0.91, 3.2, 0.0), vec4( 0.15,  0.99, 4.9, 1.7), vec4( 0.62,  0.78, 6.6, 4.1),
    vec4( 0.25,  0.97, 8.8, 5.3), vec4( 0.91, -0.41, 2.2, 2.3));
  const float A[5] = float[5](0.5, 0.4, 0.3, 0.2, 0.1);
  for (int j = 0; j < 5; j++){
    if (A[j] == 0.0) continue;
    vec2 k = W[j].xy * W[j].z * 0.75;
    vec2 kw = AX * (1.6 + 0.7 * float(j));
    float wp = dot(q, kw) + float(j) * 2.1 + uTime * 0.04;
    float wa = j < 4 ? 0.35 : 0.0;
    float ph = dot(q, k) + wa * sin(wp) + W[j].w + uTime * (0.05 + 0.02 * float(j));
    vec2 gph = k + wa * cos(wp) * kw;
    r.x += A[j] * sin(ph);
    r.yz += A[j] * cos(ph) * gph;
  }
  return r;
}

// The studio, seen from the chrome. Stereographic coordinates around the
// ray straight back at the viewer: |s| = 1 is a quarter turn off it. Graphic,
// not graded: a horizon cut straight across, a touch off level, with a
// near-black floor below it and a bright sky above; two hard-edged softboxes
// (one standing up out of the floor across the horizon, one long strip lying
// in the floor) and a broad one overhead; and one thin black window bar
// standing in the sky. Every edge is a step uG.w wide (plus what one sample
// spans), so the chrome carries bold black shapes with clean edges that
// wrap and pinch with the surface, and the print, whose stroke width is the
// tone, draws those edges as fat lines stopping dead on hairlines. soft
// widens every edge (the displacement reads a softer copy). The floor runs
// on past the quarter turn all round, so the rims go black.
float cut(float d, float ew){ return smoothstep(ew, -ew, d); }
float env(vec3 r, float soft){
  vec2 s = rot(r.xy / (1.0 + max(r.z, -0.95)), uEnvRot);
  float ls = length(s);
  // Anti-aliasing only: what one sample of the surface spans in s.
  float aa = min(0.5 * length(fwidth(s)), 0.12);
  float ew = uG.w + soft + aa;
  // The sky: bright over the horizon, and a step down to a grey vault high
  // up, so the overhead softbox has something to stand in.
  vec2 hn = vec2(-sin(uG.y), cos(uG.y));      // down, off level by the tilt
  float hy = dot(s, hn) - uG.z;               // > 0 below the horizon
  float L = mix(0.92, 0.66, cut(-0.36 - hy, ew));
  // The floor, below the horizon, and past the quarter turn all round.
  L = mix(L, 0.03, cut(-hy, ew));
  L = mix(L, 0.03, cut(1.02 - ls, ew));
  // Softboxes: a tall one standing up out of the floor through the horizon,
  // a long strip lying in the floor, and a broad one overhead.
  vec2 sh = vec2(dot(s, vec2(hn.y, -hn.x)), hy);   // along the horizon, depth below it
  float d = sdBox(sh - vec2(-0.42, -0.02), vec2(0.075, 0.2));
  L = mix(L, 1.0, cut(d, ew));
  d = sdBox(sh - vec2(0.22, 0.34), vec2(0.36, 0.035));
  L = mix(L, 1.0, cut(d, ew));
  d = sdBox(sh - vec2(0.36, -0.58), vec2(0.2, 0.11));
  L = mix(L, 1.0, cut(d, ew));
  // The window bar: one thin black upright standing on the horizon.
  d = sdBox(sh - vec2(0.02, -0.55), vec2(0.028, 0.55));
  L = mix(L, 0.03, cut(d, ew));
  return clamp(L, 0.0, 1.0);
}

// Ripples: short swells, warped along the forms, given as a slope (the
// gradient of a unit-amplitude height, each wave normalised to slope one).
// They tilt the normal only, so the reflection breaks into islands and the
// screen, which follows the reflection, turns with them.
vec2 ripple(vec2 q){
  vec2 g = vec2(0.0);
  const vec4 RW[4] = vec4[4](
    vec4( 0.38,  0.92, 1.00, 0.0), vec4( 0.96,  0.28, 1.31, 1.9),
    vec4(-0.62,  0.78, 1.73, 3.7), vec4( 0.12, -0.99, 2.27, 5.1));
  const float RA[4] = float[4](0.55, 0.45, 0.32, 0.22);
  for (int j = 0; j < 4; j++){
    vec2 k = RW[j].xy * RW[j].z * uE.w;
    vec2 kp = vec2(-RW[j].y, RW[j].x) * uE.w * 0.31;
    float ph = dot(q, k) + 1.1 * sin(dot(q, kp) + RW[j].w) + RW[j].w + uTime * (0.3 + 0.1 * float(j));
    g += RA[j] * cos(ph) * normalize(k + 1.1 * cos(dot(q, kp) + RW[j].w) * kp);
  }
  return g;
}

// A drop's own studio: the reflection turned about a horizontal axis by the
// tilt vector t (radians), so each loose drop catches the boards elsewhere.
vec3 tilt(vec3 r, vec2 t){
  float th = length(t);
  if (th < 1e-4) return r;
  vec3 ax = vec3(t / th, 0.0);
  return r * cos(th) + cross(ax, r) * sin(th) + ax * dot(ax, r) * (1.0 - cos(th));
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
  float f = 0.0; vec2 g = vec2(0.0); vec2 disp = vec2(0.0); vec2 et = vec2(0.0); float ws = 1e-5;
  // The broad body: the same balls through one wide kernel, weighted by
  // their area, so the deep middle rises as two or three heavy curvatures
  // and the small marginal lobes and loose drops barely register in it.
  float Rw = uK2.z * uScale;
  float Rw2 = Rw * Rw;
  float fb = 0.0; vec2 gb = vec2(0.0);
  // The pool's middle: the balls' centre, weighted by area, for the dome.
  vec3 cm = vec3(0.0);
  for (int i = 0; i < MAXB; i++){
    if (i >= uN) break;
    vec4 b = uB[i];
    vec2 d = p - b.xy;
    float dd = dot(d, d);
    float qb = dd / Rw2;
    float ra = b.z / uScale;
    cm += vec3(b.xy, 1.0) * b.w * ra * ra;
    if (qb < 1.0){
      float rb = b.z / (0.25 * uScale);
      float wb = b.w * rb * rb;
      float mb = 1.0 - qb;
      fb += wb * mb * mb * mb;
      gb += wb * 3.0 * mb * mb * (-2.0 * d / Rw2);
    }
    float R2 = b.z * b.z;
    float q = dd / R2;
    if (q < 1.0){
      float m = 1.0 - q;
      float k = m * m * m;
      f += b.w * k;
      g += b.w * 3.0 * m * m * (-2.0 * d / R2);
      disp += k * uD[i].xy;
      et += k * uD[i].zw;
      ws += k;
    }
  }
  // The threads: a kernel swept along a segment, its radius tapering from a
  // broad root in the pool down to a waist and up again into the drop, so
  // the field draws a cone out of the pool, a filament, and a teardrop.
  for (int j = 0; j < MAXT; j++){
    if (j >= uNT) break;
    vec4 rr = uTr[j];
    if (rr.w <= 0.0) continue;
    vec2 a = uTa[j].xy;
    vec2 ab = uTa[j].zw - a;
    float l2 = max(dot(ab, ab), 1e-4);
    float tr = dot(p - a, ab) / l2;
    // Past either end the kernel is the end's own round cap: t holds still
    // there, so it carries no gradient along the thread, and the radius,
    // eased in and out along the thread, has no slope at either end. The
    // field and its gradient run on across the caps without a seam.
    float t = clamp(tr, 0.0, 1.0);
    vec2 d = p - a - ab * t;
    float tm = uTm[j].x;
    float R, dR;
    if (t < tm){
      float u = t / tm;
      R = mix(rr.x, rr.y, u * u * (3.0 - 2.0 * u));
      dR = (rr.y - rr.x) * 6.0 * u * (1.0 - u) / tm;
    } else {
      float u = (t - tm) / (1.0 - tm);
      R = mix(rr.y, rr.z, u * u * (3.0 - 2.0 * u));
      dR = (rr.z - rr.y) * 6.0 * u * (1.0 - u) / (1.0 - tm);
    }
    float R2 = R * R;
    float dd = dot(d, d);
    float q = dd / R2;
    if (q < 1.0){
      float m = 1.0 - q;
      float k = m * m * m;
      vec2 dt = (tr > 0.0 && tr < 1.0) ? ab / l2 : vec2(0.0);
      vec2 dq = 2.0 * d / R2 - 2.0 * dd / (R2 * R) * dR * dt;
      f += rr.w * k;
      g += rr.w * 3.0 * m * m * (-dq);
      disp += k * uTm[j].yz * t;
      ws += k;
    }
  }
  disp /= ws;
  et /= ws;

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
  // The broad body carries all of it. It is not gated by the local field:
  // any such gate brings back a knuckle per ball. It is so wide it is
  // smooth at the edge anyway, where the meniscus stands the rim up.
  float Hb = uK2.w * uScale;
  float bb = log(1.0 + fb);
  float h = H * sqrt(1.0 - e) + H2 * g2 * s2 + Hr * sat * rl.x + Hb * bb;
  float dh = H * e / (2.0 * a * sqrt(max(1.0 - e, 1e-6))) + H2 * (s2 / (1.0 + xe / 0.5) + g2 * exp(-xe / 0.35) / 0.35) + Hr * rl.x * exp(-xe / a2) / a2;
  vec2 gh = dh * gF + Hr * sat * rl.yz / uScale + Hb * gb / (1.0 + fb);
  // The ripples ride with the liquid and die toward the rim, so the
  // silhouette stays a clean meniscus.
  // One large dome over the whole pool: every normal is leaned out from the
  // pool's middle in proportion to its distance, so the reflection sweeps
  // across the body as one continuous band, the horizon cutting it once.
  vec2 cen = cm.z > 1e-6 ? cm.xy / cm.z : uRes * 0.5;
  // Only the body leans: a loose drop, thin in the broad field, keeps its
  // own curvature and its own horizon.
  gh -= uG.x * sat * smoothstep(0.2, 1.2, fb) * (p - cen) / uScale;
  vec3 n0 = normalize(vec3(-gh, 1.0));
  gh += uE.y * sat * ripple((p - disp) / uScale);
  vec3 n = normalize(vec3(-gh, 1.0));

  vec3 v = normalize(vec3((p - uRes * 0.5) / (uScale * 2.6), -1.0));
  vec3 r = tilt(reflect(v, n), et);
  float L = env(r, 0.0);
  float Ls = env(r, 0.22);

  // The reflection pushes the lines by the normal: across a dome that adds
  // to the screen, so the lines sweep over the tops and crowd where the
  // surface turns hard, at the rims and necks. Nothing by height: a term in
  // h closes on itself round every bump top into a bullseye. The print pass
  // keeps the whole displacement monotone across the screen.
  // The screen also turns with the reflected ray: a term in its sideways
  // component tilts the lines across the forms (the ironing pass only holds
  // the screen's climb down the page, not its slope across it), so they
  // swing hard where the surface turns and beat against each other. The
  // ray off the body without its ripples, so the lines sweep round the
  // forms; the ripples reach the lines through n above, as bunching.
  vec3 r0 = tilt(reflect(v, n0), et);
  // It eases off toward the rim, where the ray swings fastest: there the
  // turn would only rule the lines finer than the print can hold.
  vec2 rs = r0.xy / (1.0 + max(r0.z, 0.0));
  float Dsp = uK.y * 15.3 * dot(n.xy, N0) + uE.z * 14.4 * rs.x * smoothstep(0.0, 0.5, x) + uK.z * 3.6 * Ls;
  float tf = 380.0 + 260.0 * (h / (H + Hb)) + 120.0 * n.z;
  return vec4(clamp(sd, -64.0, 64.0), Dsp, L, tf);
}

// The print: one line screen, displaced by the surface, its width carrying
// the tone, over acid stock.
// sf.y is the line displacement D, already made monotone (see FS_MONO).
vec3 printAt(vec2 p, vec4 sf){
  float sd = sf.x;
  float L = sf.z;
  float tf = sf.w;
  float alpha = clamp(sd * uDpr + 0.5, 0.0, 1.0);
  float S = uK.w;
  float D = sf.y;
  float phi = (dot(p, N0) + D) / S;
  vec2 gp = vec2(dFdx(phi), dFdy(phi));
  float fpx = max(length(gp), 1e-4);

  // Width is the only tone carrier, continuously. Where the studio's tone
  // steps, at a cut, the stroke steps with it; across the rims and the swells,
  // where the reflection is graded by the surface itself, the
  // stroke swells with it: a hairline of about a twelfth of the period on a
  // softbox, through every width, to fat strokes nine tenths of the period
  // across a board, which merge with a thread of white between them. The
  // darks are lines, never a painted fill, and the gradient lives in them.
  float T = 1.0 - L;
  float tone = smoothstep(0.05, 0.86, T);
  float w = mix(0.08, 0.9, tone * (0.6 + 0.4 * tone));

  // Two plates: the black key, and a lavender plate printed a hair out of
  // register, which only shows on the light.
  float cK = plate(phi, w, fpx);
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
  vec4 sf = surface(p);
  // Without the ironing pass, a local stand-in: where the screen would fold
  // (dD/dy, from the quad, below -(1 - floor)), ease the displacement down.
  float x = max(-(dFdx(sf.y) * N0.x - dFdy(sf.y) * N0.y) * uDpr, 0.0) / (1.0 - uK.x);
  sf.y *= pow(1.0 + x * x * x * x, -0.25);
  o = vec4(printAt(p, sf), 1.0);
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

// Ironing the screen. The phase is (y + D) / S, y running across the screen
// (along N0). A line closes into a ring only round an extremum of the phase,
// and there is none while the phase keeps climbing down the screen. Write
// the phase as uK.x * y + X, where X = (1 - uK.x) * y + D: if X never falls
// going down the screen, the phase climbs at least uK.x per pixel and the
// lines can only crowd, never turn back. So X is replaced by its running
// (soft) maximum over a reach up the screen. Where the surface would fold
// the screen back on itself (troughs, saddles, under the rims) the lines
// crowd to the fold, run on at the floor's pitch across it, and pick the
// surface up again where it climbs past them: open strokes bunching into
// moire, never a bullseye. Elsewhere X is already rising and D is untouched.
export const FS_MONO = FS_HEAD + `
uniform sampler2D uSurf;
uniform vec2 uSurfRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uSurfRes;
  vec4 sf = texture(uSurf, uv);
  const int NS = 44;
  const float STEP = 2.0;               // css px
  const float TAU = 3.0;                // softness of the max, css px
  // How deep the chrome must stay along the reach for it to count, in
  // css px to the edge. From inside the body the reach must stay inside
  // it: a column that runs out of the body and up a stem into a loose drop
  // would otherwise carry the drop's lines down into the body as a
  // straight-sided strip, and the next column over, which just misses the
  // stem, would not. Close to a rim the reach is let run along the
  // shallows, so the folds under the rims are still ironed.
  float deep = clamp(sf.x * 1.2, 12.0, 36.0);
  float c = 1.0 - uK.x;
  vec2 du = vec2(-N0.x, N0.y) * STEP / uSurfRes;   // one step up the screen
  // Online log-sum-exp of X(y - k) - X(y), and of the same for flat chrome.
  // The reach ends, softly, where it leaves the chrome: past the rim there
  // are no lines to follow, and a ray that only grazes a rim must not tear
  // the screen beside one that crosses it.
  // The visibility is kept as its log, and the reach is only cut once that
  // has discounted any lead the far side could have (D spans ~160 px), so
  // the cut itself never tears the screen between neighbouring columns.
  float m = 0.0, acc = 1.0, ref = 1.0, lv = 0.0;
  for (int k = 1; k <= NS; k++){
    float dk = c * STEP * float(k);
    ref += exp(-dk / TAU);
    vec4 s = texture(uSurf, uv + du * float(k));
    lv += log(max(smoothstep(-2.0, deep, s.x), 1e-30));
    if (lv < -70.0) break;
    float v = s.y - sf.y - dk + TAU * lv;
    if (v > m){ acc = acc * exp((m - v) / TAU) + 1.0; m = v; }
    else acc += exp((v - m) / TAU);
  }
  sf.y += m + TAU * log(acc / ref);
  o = sf;
}`;

// The lead the ironing added, eased across the screen. One column's reach
// can thread something its neighbour's just misses (the flank of a stem up
// into a drop), and the lead then steps from one column to the next: the
// screen would tear along a straight edge running up the screen, or crowd
// finer than the print can hold into a grey wash. So the lead is averaged
// across the screen, over the chrome only, and the screen bends instead.
export const FS_EASE = FS_HEAD + `
uniform sampler2D uSurf;
uniform sampler2D uMono;
uniform vec2 uSurfRes;
void main(){
  vec2 uv = gl_FragCoord.xy / uSurfRes;
  vec4 sf = texture(uSurf, uv);
  vec2 side = vec2(N0.y, N0.x) / uSurfRes;         // one css px across the screen
  const int NB = 12;
  const float BSTEP = 2.0;              // css px
  const float sig = 9.0;                // css px
  float acc = 0.0, wsum = 0.0;
  for (int k = -NB; k <= NB; k++){
    vec2 o = side * BSTEP * float(k);
    float sx = texture(uSurf, uv + o).x;
    float w = exp(-0.5 * pow(BSTEP * float(k) / sig, 2.0)) * smoothstep(-2.0, 6.0, sx);
    acc += w * (texture(uMono, uv + o).y - texture(uSurf, uv + o).y);
    wsum += w;
  }
  float lead = wsum > 1e-4 ? acc / wsum : texture(uMono, uv).y - sf.y;
  sf.y += lead;
  o = sf;
}`;

export const FS_PRINT = FS_HEAD + COMMON + `
uniform sampler2D uSurf;
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec4 sf = texture(uSurf, gl_FragCoord.xy / (uRes * uDpr));
  o = vec4(printAt(p, sf), 1.0);
}`;
