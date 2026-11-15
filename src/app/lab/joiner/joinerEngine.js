import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Joiner: after David Hockney's photo joiners. Lie on the quay, look up, and
// take the sky one Polaroid at a time.
//
// The structures are one 360 capture (Poly Haven's Docklands 01, CC0), baked
// offline into a zenith-centred disk of log radiance with a sky matte. Its sky
// was a dull broken overcast, so the sky is a second capture: a sunny
// cumulus pure sky (Poly Haven's Kloofendal 48d Partly Cloudy, CC0) baked into
// the same disk, turned so its sun lands on the facade light and exposed to
// the Docklands open blue at the zenith, as a drifting cloud deck over a
// static blue with the sun in it (tools/depth/bakes/joiner/skyplate.py). The
// table is a stereographic map of that sky: every point on it is a
// direction, the zenith in the middle. A print aimed at a point is a real
// rectilinear camera pointed along that direction, its focal length matched
// to the map's local scale there, so neighbouring prints fit together. Each
// one is still its own camera and its own moment, the way Hockney's are:
//   - its aim and roll are off by a degree or so, like a hand-held shot;
//   - its electric eye meters its own patch of sky, so a print full of wall
//     comes out brighter than one full of cloud, plus a little batch scatter
//     in exposure, white balance and dye;
//   - its clouds are where they were at the moment it was taken: the sky is
//     advected on a cloud deck by a gentle wind (and a little shear), so the
//     cumulus disagree across the borders while walls and lamp posts do not.
// Each frame is developed through the shared film kit (summer preset, a
// polariser deepening the open blue, blacks barely lifted), then its sky is
// graded to a June print: the cumulus on a warm shoulder just under paper
// white with skylight-blue shade, and a clear sky that deepens to cobalt
// towards the zenith (see SKY_GRADE), and in the same pass its structures are
// given that sky's sun: the overcast haze taken off, the walls and glass
// printed down to crisp dark silhouettes, the sunlit faces warmed (see
// STRUCT_GRADE). Last comes the finish (see FINISH):
// a thin red-orange halation ring where bright sky meets a structure, a
// little scan softness and the print's own grain, so the film survives the
// grade.
//
// Drag to shoot prints where you point. Long-press to sweep the table.
// Query: ?prints=N&seed=S lays down a pre-built joiner of N prints;
// ?t=seconds freezes the newest print that long into its fall; ?sweep=seconds
// holds a long-press sweep; ?ev= and any film parameter override the film;
// ?grade=0..1 and the other SKY_GRADE keys override the sky grade, the
// STRUCT_GRADE keys (?structGrade=0 shows the walls as the plate has them)
// the structures grade, and the FINISH keys (?grainAmp=, ?halation=, ?mtf= ...) the finish.

const ASSET = "/lab/joiner/";
const THMAX = (120 * Math.PI) / 180; // disk rim, from the zenith
const LO = -8;
const HI = 5; // log2 radiance range of the 8-bit disk

// Polaroid SX-70 integral print, mm: 88 x 107 frame, 79 mm square image.
const FW = 88 / 79;
const FH = 107 / 79;
const TOP = 6 / 79;
const IMG_OFF = -FH / 2 + TOP + 0.5; // image centre from frame centre, in image widths (y down)

const FIELD = 0.64; // radians across one print at the zenith (about 37 degrees, an SX-70's 116 mm on 79 mm)
const WIND = [0.79, 0.61]; // cloud-deck drift direction (disk frame)
const GUST = 0.04; // cloud-deck displacement per unit of moment (x deck height)
const MAX_PRINTS = 160;

const TABLE = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const FILM_BASE = {
  ...FILM_PRESETS.summer,
  input: "linear",
  toe: 0.04,
  toeColor: [0.92, 1, 1.06],
  contrast: 1.4,
  shoulder: 0.85,
  whitePoint: 4,
  saturation: 1.45,
  blueDepth: 1,
  warmth: 0.4,
  highlightTint: [1.06, 0.96, 0.92],
  shadowTint: [0.82, 0.92, 1.12],
  bloom: 0.18,
  halation: 0.34,
  halationThreshold: 3,
  softness: 0.36,
  vignette: 0.2,
  grain: 0.32,
};

// A polariser on the lens: open blue sky goes deeper and loses its green
// (cyan to cobalt), white cloud and everything off the sky matte are left alone.
// Per channel, in scene light, scaled by how blue the sky is.
const POLARIZER = [0.44, 0.5, 0.78];

// Without float targets the raw view is stored 8-bit; it keeps this much gain
// (stops) so cloud has headroom there, and the film adds the rest back.
const RAW8_EV = -1.7;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// One print's view: a rectilinear camera into the disk.
const VIEW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform sampler2D uSky;   // the cumulus sky, clouds taken out, sun kept (static)
uniform sampler2D uCloud; // the cumulus deck, sun taken out (advected)
uniform sampler2D uOver;  // the Docklands plate's own overcast, structures filled
uniform vec3 uC;
uniform vec3 uR;
uniform vec3 uD;
uniform float uF;      // focal length, in the same units as uHalf
uniform float uHalf;   // half the image width
uniform vec2 uWind;    // cloud-deck displacement (x deck height)
uniform vec3 uShear;   // amplitude, phase x, phase y
uniform float uGain;   // 1 for a float target; < 1 for the RGBA8 fallback
uniform float uSrgb;
const float THMAX = ${THMAX.toFixed(6)};
const float LO = ${LO.toFixed(1)};
const float HI = ${HI.toFixed(1)};
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 POL = vec3(${POLARIZER.map((v) => v.toFixed(3)).join(", ")});

vec2 diskUv(vec3 d) {
  float th = acos(clamp(d.z, -1.0, 1.0));
  float l = length(d.xy);
  vec2 dir = l > 1e-6 ? d.xy / l : vec2(1.0, 0.0);
  return 0.5 + 0.5 * (th / THMAX) * dir;
}
vec3 rad(vec3 v) { return exp2(LO + v * (HI - LO)); }

// The sky matte eroded by r plate pixels (a min over rings one pixel apart),
// then feathered: a structure's anti-aliased rim and the noisy inside of a
// thin pole's matte read as part of the structure, so the drifted cloud never
// shows through a lamp post or a facade edge as a light rim.
float skyWeight(vec2 uv, int r) {
  vec2 t = 1.0 / vec2(textureSize(uMask, 0));
  float e = texture(uMask, uv).r;
  for (int j = 1; j <= r; j++) {
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(j) * 0.39;
      e = min(e, texture(uMask, uv + vec2(cos(a), sin(a)) * t * float(j)).r);
    }
  }
  return smoothstep(0.3, 0.95, e);
}

void main() {
  vec2 s = vec2(vUv.x - 0.5, 0.5 - vUv.y) * 2.0 * uHalf;   // y down
  vec3 d = normalize(uC * uF + uR * s.x + uD * s.y);
  vec2 uv = diskUv(d);
  vec3 base = rad(texture(uScene, uv).rgb);
  float m = texture(uMask, uv).r;

  vec3 col = base;
  float key = 0.0;
  if (d.z > 0.01) {
    // The same sky a moment earlier or later: move the cloud deck under the
    // wind, with a little shear so the shapes have evolved too.
    vec2 P = d.xy / d.z;
    vec2 shear = uShear.x * vec2(sin(P.y * 1.9 + uShear.y), sin(P.x * 1.6 + uShear.z));
    float k = smoothstep(0.02, 0.2, d.z);
    vec2 P2 = P - (uWind + shear) * k;
    vec3 d2 = normalize(vec3(P2, 1.0));
    vec2 uv2 = diskUv(d2);
    // The Docklands sky is replaced outright: the drifted cumulus deck, laid
    // over the static blue (and the sun, which never drifts) by how much
    // cloud it carries there. The deck has no structures in it, so the drift
    // can never drag a wall or a lamp post with it; the Docklands disk only
    // supplies the structures, under its eroded matte.
    vec3 moved = rad(texture(uCloud, uv2).rgb);
    vec3 still = rad(texture(uSky, uv).rgb);
    float cover = 1.0 - smoothstep(0.42, 0.6, (moved.b - moved.r) / (moved.b + 1e-4));
    vec3 sky = mix(still, moved, cover);
    // The structures' rims still hold the old sky: the anti-aliased edge, and
    // the band the eroded matte keeps back from a facade or a pole. Wherever
    // the matte calls a pixel even partly sky, it is read for how much of the
    // old sky it holds, against that sky right beside it (clean sky-matte
    // pixels two to six plate pixels away; the filled overcast plate where
    // there are none) and against the structure beside it: like the sky in
    // light and colour, or its light between the wall's and the sky's (its
    // share of sky). That share is swapped for the new sky, so the edges cut
    // cleanly into the cumulus with no pale outline. A structure's own
    // pixels (the matte at 0, a lamp post's inside included) are never read,
    // however pale; the strips of old sky the matte used to call structure
    // along a roofline are given back to it in the bake (grow.py).
    float w = skyWeight(uv, 2);
    vec3 oc = rad(texture(uOver, uv).rgb);
    vec2 mt = 1.0 / vec2(textureSize(uMask, 0));
    vec3 lsum = vec3(0.0);
    float lw = 0.0;
    float ssum = 0.0;
    float sw = 0.0;
    for (int j = 0; j < 3; j++) {
      float rr = 2.5 + 1.75 * float(j);
      for (int i = 0; i < 8; i++) {
        float an = float(i) * 0.785398 + float(j) * 0.39;
        vec2 q = uv + vec2(cos(an), sin(an)) * mt * rr;
        float mq = texture(uMask, q).r;
        vec3 lq = log2(rad(texture(uScene, q).rgb) + 1e-4);
        float wq = smoothstep(0.92, 1.0, mq);
        lsum += wq * lq;
        lw += wq;
        float wsq = 1.0 - smoothstep(0.02, 0.1, mq);
        ssum += wsq * dot(lq, LUMA);
        sw += wsq;
      }
    }
    vec3 lref = mix(log2(oc + 1e-4), lsum / max(lw, 1e-4), smoothstep(0.5, 3.0, lw));
    vec3 dlog = log2(base + 1e-4) - lref;
    float dl = dot(dlog, LUMA);
    float like = smoothstep(-1.1, -0.3, dl) * (1.0 - smoothstep(0.6, 1.3, dl))
      * (1.0 - smoothstep(0.12, 0.3, length(dlog - dl)));
    float Ys = 1e4;
    if (sw > 0.5) {
      Ys = exp2(ssum / sw);
      float Yk = exp2(dot(lref, LUMA));
      float t = clamp((dot(base, LUMA) - Ys) / (Yk - Ys), 0.0, 1.0) * smoothstep(0.3, 0.8, abs(log2(Yk / Ys)));
      like = max(like, t);
    }
    float a = max(w, like * smoothstep(0.02, 0.4, m));
    // what is left of the pixel is the structure's share, never brighter than
    // the structure beside it, so no part-swapped rim stays pale
    vec3 res = min(max(base - a * exp2(lref), 0.0), (1.0 - a) * base);
    res *= mix(1.0, min(1.0, (1.0 - a) * Ys * 1.3 / (dot(res, LUMA) + 1e-5)), smoothstep(0.0, 0.3, a));
    col = a * sky + res;
    m = a;
    float blue = smoothstep(0.4, 0.85, (col.b - col.r) / (col.b + 1e-4));
    col *= mix(vec3(1.0), POL, blue * a);
    key = m;
  }
  col *= uGain;
  if (uSrgb > 0.5) col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  // the sky matte rides along in alpha for the grades after the film (the
  // sky grade fades itself out at the horizon; the structures grade needs
  // the matte itself there)
  outColor = vec4(col, key);
}`;

// The sky grade, the last step of each print's develop: a June print of the
// cumulus deck, sunlit cloud on cobalt. That is a matter of cloud tonality,
// not exposure (more exposure only pales the blue), so the grade works on the
// developed print, keyed on the sky matte (carried in the view's alpha) and
// on how blue the scene light is there:
//   - cloud: keeps the deck's own modelling. Its log luminance is read
//     against a local mean (two rings a turret across, cloud only), the
//     fine contrast is barely opened and the whole lot runs through a soft filmic
//     shoulder that only reaches a warm near-white (#F4F1EA, never past it)
//     on the sunlit tops;
//   - sun: the cloud is read as a height field (the slope of its log
//     radiance over four rings, a turret to a body across) and lit from one
//     sun shared by every print, the deck's own. The side of a cloud that
//     faces it is pushed up into the warm shoulder, the far side down out
//     of it by a stop and a half at most, and the tone is laid as colour:
//     shade is a pale cyan-grey (#B7C5C5, white vapour lit by the open
//     sky), the faces turned to the sun the warm near-white, flanks a mix of
//     the two, so the cumulus are modelled by light rather than greyed;
//   - cloud to sky: never keyed. Sky and cloud are one field: the cloud's
//     density is unmixed from the scene light against the clear blue the
//     deck was laid over (how much of its chroma the cloud takes away, or
//     how far the light climbs above it), on a wide, nearly linear ramp at
//     a cloud's edge and a firm one inside its body, so the deck's own
//     silhouettes, wisps and soft fringes come through exactly and only
//     their tone and colour change. The blue's deepening fades out under
//     the cloud by the same density (no dark moat), a gentle bloom of the
//     cloud's light spills into the blue just round it, and the print's
//     grain rides back on only after the two are composited;
//   - clear sky: recoloured along a zenith gradient, a dome: deep saturated
//     cobalt straight up (#0C55AC, then skyDeep stops down and skySat more
//     chroma at the centre of the disk, about #0A4FA0 on the print), falling
//     off to a paler, cyaner blue (#4499D6) towards the rim. The fall-off
//     has slope right from the zenith, so every print carries its own piece
//     of the gradient and the pile reads as one dome. It carries the print's own
//     exposure and vignette as a ratio, read off the clear sky round the
//     pixel, so every print still meters for itself.
const srgbHex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255);
const SKY_GRADE = {
  cloudGain: 0.5, // stops into the shoulder at a mid cloud of the deck (x = 1 is the knee)
  cloudToe: 2.1, // log contrast of the cloud's broad modelling (the deck's cumulus have their own)
  detail: 1.1, // log contrast of the fine detail against the local mean (turret scale)
  depth: 2, // stops the shade side can fall below the knee, at most
  cloudSlope: 0.3, // film's slope in the clouds (log out per log exposure), to take the meter out
  cloudKeep: 1, // stops of the print's own exposure put back on the cloud, per stop
  knee: 3, // hardness of the shoulder: higher holds the mids lower and the tops whiter
  splitTone: 1, // 0 leaves cloud neutral, 1 is the full skylight split
  keep: 0.2, // share of the print's own dye cast kept in the cloud (more turns the shade grey-lilac)
  skyKeep: 0.7, // power of the print's own exposure ratio kept in the clear sky
  grade: 1, // overall strength
  // the sun relight gives the cumulus their light: sun-facing tops up into
  // the warm shoulder, far sides down into skylight blue
  sunGain: 2, // stops into the shoulder on the side of a cloud that faces the sun
  sunShade: 1.5, // stops out of the shoulder on the far side, at most, towards the cyan-grey shade
  relief: 0.1, // facing per unit of slope (stops of plate radiance per print width)
  feather: 3, // cloud density blur radius, 4096 px plate pixels (6 of the 8192 px deck's)
  densLo: 0.08, // cloud density ramp: share of the blue's chroma taken away where cloud starts
  densHi: 0.9, // ... and where it is solid cloud, at a cloud's edge (wide: wisps stay wisps)
  densLight: 2.5, // light above the clear blue (in multiples of it) that also reads as solid cloud there
  fillHi: 0.6, // the same two inside a cloud's body, where a shade side lit by the blue keeps
  fillLight: 1.2, // some of its chroma and must not go to lacy holes
  bloom: 0.15, // how much of the cloud's light the blue just round it takes on
  sunAz: -52, // sun azimuth, degrees in the disk frame (table right = 0, up = -90)
  sunEl: 52, // sun elevation, degrees
  skyDeep: 0.7, // stops the clear sky is taken down at the zenith, falling off towards the rim
  skySat: 0.3, // extra chroma at the zenith (share of the sky's own), falling off the same way
  skyFall: 1.6, // zenith angle (radians) where the sky has opened fully to the rim colour
};
// The structures plate is 4096 px across 2 x THMAX of zenith angle (the
// cloud deck is 8192 px, two of its pixels to one of these).
const PLATE_RAD = (2 * THMAX) / 4096;
const CLOUD_HI = srgbHex("#F4F1EA");
const CLOUD_SHADE = srgbHex("#B7C5C5"); // a cumulus shade side lit by the open blue: cyan-grey
const SKY_ZENITH = srgbHex("#0C55AC");
const SKY_RIM = srgbHex("#4499D6");
const SKY_VREF = 0.34; // clear-sky peak channel (linear) the film lays down at the zenith

// The structures grade, in the same pass, wherever the matte says structure.
// The Docklands plate was shot under a broken overcast, so its walls are a
// flat, hazy grey that belongs to another day than the sunny cumulus over
// them. They are given the deck's sun:
//   - haze: the overcast's veil (a pale grey-blue lift on every channel) is
//     taken off before anything else, so the darks can go dark;
//   - contrast and toe: log luminance steepened about a sunlit facade (a
//     slope of 1.3), the walls printed half a stop under (exposed for the
//     sunny sky they stand in, as a real worm's-eye frame would be), and
//     the glass and the shadow sides pulled down on to a deep blue-black
//     (about 0.06 on the print) that they never fall through, so the
//     facades and poles read as crisp, dark silhouettes converging on the
//     sky;
//   - light: the faces bright enough to be in the sun take a slight warm
//     key, the colour of the 52 degree sun that warms the cumulus tops, and
//     the glass takes on the cobalt it would be reflecting; the shade keeps
//     the skylight blue-black. What is pale and cool is no face but the
//     plate's own overcast low among the far roofs, where the matte could
//     not find the sky, and it goes to the pale blue of the sky's rim;
//   - edge: the plate's rim against the old sky (its anti-aliased edge still
//     holds the overcast) is choked to the wall's own tone just inside it,
//     so a roofline cuts cleanly against the blue and only the finish's
//     thin halation ring is left there.
// One warm accent: the Docklands red crane on the quay stays; the red and
// yellow chevrons of the van at the far kerb are muted to a neutral grey so
// they stop competing with it across the cobalt.
const STRUCT_GRADE = {
  structGrade: 1, // overall strength
  structSlope: 1.3, // log contrast about the pivot
  structPivot: 0.85, // pivot (linear print value) the contrast turns about: a sunlit facade
  structHaze: 0.03, // overcast veil taken off (linear print value)
  structEv: -0.5, // stops the walls are printed under: exposed for the sunny sky they stand against, not for themselves
  structFloor: 0.06, // deep blue-black the shadows and glass are pulled on to (print value, sRGB)
  structWarm: 0.45, // strength of the warm key on the sunlit faces
  structGlass: 0.55, // cobalt mixed into the glass
  structEdge: 1, // strength of the rim choke
  mute: 0.95, // how far the van's chevrons are muted
};
const STRUCT_DEEP = srgbHex("#0B111D"); // the blue-black of the shade
const STRUCT_WARM = [1.09, 0.99, 0.88]; // the sun's key on a lit face, linear, about unit luminance
const STRUCT_VEIL = [0.94, 1, 1.08]; // the overcast veil's colour, linear
// the van's chevrons, in plate uv (4096 px plate: x 618..741, y 1265..1430)
const MUTE_AT = [671 / 4096, 1356 / 4096, 0.024, 0.034]; // centre, inner and outer radius
const vec3 = (v) => `vec3(${v.map((x) => x.toFixed(4)).join(", ")})`;

const GRADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDev;  // the developed print (sRGB)
uniform sampler2D uRaw;  // the camera's view, scene light; alpha = sky matte
uniform float uRawSrgb;
uniform vec3 uC;
uniform vec3 uR;
uniform vec3 uD;
uniform float uF;
uniform float uHalf;
uniform vec4 uCloud;     // gain, toe, split, keep
uniform vec4 uModel;     // detail, knee, exposure kept, shade depth
uniform vec2 uEv;        // the print's exposure against the zenith print (stops), film slope there
uniform vec2 uSky;       // keep, strength
uniform vec3 uDome;      // zenith deepening (stops), zenith extra chroma, fall-off angle
uniform vec3 uSun;       // towards the sun, disk frame
uniform vec3 uLight;     // stops of sun on the lit side, of shade on the far side, relief gain
uniform float uFeather;  // cloud density blur radius (print uv)
uniform vec4 uDens;      // density ramp start, end, light above the blue for full cloud, bloom
uniform vec2 uFill;      // ramp end and light for full cloud inside a cloud's body
uniform sampler2D uSkyTex; // the static blue the deck was laid over (log-encoded)
uniform float uRawGain;  // the raw view's gain against scene light
uniform float uSeed;
uniform vec4 uStruct;    // strength, slope, pivot (log2), haze
uniform vec4 uStructKey; // floor (linear), warm, glass, edge
uniform float uMute;     // how far the van's chevrons are muted
uniform float uPlatePx;  // one plate pixel, print uv
uniform float uStructEv; // stops the walls sit under the sky they stand in
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float THMAX = ${THMAX.toFixed(6)};
const vec3 DEEP = ${vec3(STRUCT_DEEP)};
const vec3 WARM = ${vec3(STRUCT_WARM)};
const vec3 VEIL = ${vec3(STRUCT_VEIL)};
const vec4 MUTE = vec4(${MUTE_AT.map((v) => v.toFixed(5)).join(", ")});
const vec3 HI = ${vec3(CLOUD_HI)};
const vec3 SHADE = ${vec3(CLOUD_SHADE)};
const vec3 ZEN = ${vec3(SKY_ZENITH)};
const vec3 RIM = ${vec3(SKY_RIM)};
const float VREF = ${SKY_VREF.toFixed(4)};
const vec3 POL = vec3(${POLARIZER.map((v) => v.toFixed(3)).join(", ")});
const float RLO = ${LO.toFixed(1)};
const float RHI = ${HI.toFixed(1)};

vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rawLin(vec2 p) {
  vec3 c = texture(uRaw, p).rgb;
  return uRawSrgb > 0.5 ? pow(c, vec3(2.2)) : c;
}
// How much cloud the scene light c holds over the clear blue (brS its
// b - r, YS its light): the blue's chroma taken away (cloud is near
// neutral), or light above the blue, whichever says more, on a wide,
// nearly linear ramp so a wisp stays a wisp.
float density(vec3 c, float brS, float YS, vec2 ramp, float firm) {
  float ac = 1.0 - (c.b - c.r) / brS;
  float ay = (dot(c, LUMA) / YS - 1.0) / ramp.y;
  float x = clamp((max(ac, ay) - uDens.x) / (ramp.x - uDens.x), 0.0, 1.0);
  x = mix(x, x * x * (3.0 - 2.0 * x), 0.35);
  // Round the sun the blue it was laid over is the sun's own glare, as pale
  // as the cloud, so inside a body the cloud is also simply what is not
  // blue: no holes punched through it where it meets the glare.
  return max(x, firm * (1.0 - smoothstep(0.28, 0.62, (c.b - c.r) / (c.b + 1e-4))));
}

vec2 diskUv(vec3 d) {
  float th = acos(clamp(d.z, -1.0, 1.0));
  float l = length(d.xy);
  vec2 dir = l > 1e-6 ? d.xy / l : vec2(1.0, 0.0);
  return 0.5 + 0.5 * (th / THMAX) * dir;
}

// The structures, given the deck's sun (see STRUCT_GRADE). lin is the
// developed print, linear; d the direction the pixel looks along.
vec3 structGrade(vec3 lin, vec3 d) {
  // the rim choke: next to the sky the plate's edge still holds the old
  // overcast, a pale fringe several plate pixels deep. Its light is capped
  // at the wall's own, read past the fringe (taps the matte calls
  // structure, eight and ten plate pixels in, a geometric mean so a bright
  // ledge cannot hold the fringe up). A lamp post has no inside that far
  // from the sky, so it is left as it is.
  float dist = 99.0;
  float yin = 0.0;
  float win = 0.0;
  float yloc = 0.0;
  float wloc = 0.0;
  for (int j = 1; j <= 7; j++) {
    float r = 1.4 * float(j) * uPlatePx;
    for (int i = 0; i < 8; i++) {
      float an = float(i) * 0.785398 + float(j) * 0.39;
      vec2 q = vUv + vec2(cos(an), sin(an)) * r;
      float aq = texture(uRaw, q).a;
      if (aq > 0.3) dist = min(dist, float(j));
      if (j >= 2 && j <= 4) {
        float wq = 1.0 - smoothstep(0.02, 0.3, aq);
        yloc += wq * log2(dot(toLin(texture(uDev, q).rgb), LUMA) + 1e-4);
        wloc += wq;
      }
      if (j >= 6) {
        float wq = 1.0 - smoothstep(0.02, 0.1, aq);
        yin += wq * log2(dot(toLin(texture(uDev, q).rgb), LUMA) + 1e-4);
        win += wq;
      }
    }
  }
  float Y0 = dot(lin, LUMA) + 1e-5;
  // the van's chevrons are muted (one warm accent in the frame, and it is
  // the crane); the crane's own paint, the most saturated red on the quay,
  // is kept out of the walls' darkening so that accent stays a lit red
  float mu = (1.0 - smoothstep(MUTE.z, MUTE.w, length(diskUv(d) - MUTE.xy))) * uMute;
  float paint = smoothstep(0.72, 0.84, (lin.r - max(lin.g, lin.b)) / (lin.r + 1e-5)) * (1.0 - mu);
  float edge = (1.0 - smoothstep(2.0, 6.0, dist)) * smoothstep(1.0, 4.0, win) * uStructKey.w;
  float choke = mix(1.0, min(1.0, 1.1 * exp2(yin / max(win, 1e-4)) / Y0), edge);
  vec3 c = lin * choke;
  // The curve is steep, so it reads a grain-free luminance (a little blur
  // of the print) and the film's grain rides back on as a ratio instead of
  // being stretched into a mottle on the walls.
  vec2 tx = 1.5 / vec2(textureSize(uDev, 0));
  float Yb = 0.5 * Y0 + 0.125 * (dot(toLin(texture(uDev, vUv + vec2(tx.x, 0.0)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv - vec2(tx.x, 0.0)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv + vec2(0.0, tx.y)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv - vec2(0.0, tx.y)).rgb), LUMA));
  float grain = clamp((Y0 + 0.004) / (Yb + 0.004), 0.75, 1.33);

  // the overcast veil off
  c = max(c - uStruct.w * VEIL, 0.0) / (1.0 - uStruct.w);
  vec3 ch = c / (dot(c, LUMA) + 1e-5);
  float Yc = max(Yb * choke - uStruct.w, 0.0) / (1.0 - uStruct.w) + 1e-5;
  // glass: the cool, cyan-grey panes that reflected the overcast (bright
  // specular sheets of cloud keep their light)
  float glass = smoothstep(0.06, 0.22, (c.b - c.r) / (c.b + 1e-4)) * (1.0 - smoothstep(0.25, 0.6, Yc));
  // contrast in log about a sunlit facade, with a little clarity (the fine
  // relief against the wall three to six plate pixels round, so mullions,
  // ledges and window reveals stay drawn as the facade goes down), glass a
  // little further down, the walls printed under for the sky they stand
  // in; then a soft shoulder so nothing new clips, and the toe: the darks
  // land on the floor and never pass through it
  float Lc = log2(Yc);
  float rel = wloc > 2.0 ? clamp(log2(Yb * choke) - yloc / wloc, -2.0, 2.0) : 0.0;
  float Lo = uStruct.z + uStruct.y * (Lc - uStruct.z) + 0.3 * rel - 0.7 * glass * uStructKey.z + uStructEv * (1.0 - paint);
  float Yo = exp2(Lo);
  Yo = Yo / pow(1.0 + pow(Yo / 0.95, 3.0), 1.0 / 3.0);
  float fl = uStructKey.x;
  Yo = sqrt(Yo * Yo + fl * fl);
  // colour: shade to the blue-black, glass to the cobalt it reflects, the
  // sunlit faces warm
  vec3 deep = DEEP / dot(DEEP, LUMA);
  vec3 zen = toLin(ZEN);
  zen /= dot(zen, LUMA);
  float shade = 1.0 - smoothstep(fl * 2.0, 0.07, Yo);
  ch = mix(ch, deep, 0.8 * shade * (1.0 - paint));
  ch = mix(ch, mix(vec3(1.0), zen, 0.35), glass * uStructKey.z * (1.0 - 0.6 * shade));
  // a sunlit face loses the overcast's grey-green cast before it takes the
  // sun's colour. Pale and cool is not a face: it is the plate's own hazy
  // overcast low on the horizon, where the matte could not find the sky
  // among the far roofs, and it goes to the pale blue of the sky's rim
  // instead of to a warm wall.
  float cool = smoothstep(0.02, 0.12, (c.b - c.r) / (c.b + 1e-4));
  float haze = cool * smoothstep(0.25, 0.55, Yc) * (1.0 - paint);
  vec3 rim = toLin(RIM);
  ch = mix(ch, rim / dot(rim, LUMA), 0.6 * haze);
  float lit = smoothstep(0.06, 0.3, Yo) * (1.0 - glass) * (1.0 - cool);
  ch = mix(ch, vec3(1.0), 0.55 * lit * (1.0 - paint));
  ch *= mix(vec3(1.0), WARM, lit * uStructKey.y);
  c = Yo * ch * grain;
  float Ym = dot(c, LUMA);
  float hot = smoothstep(0.05, 0.3, (max(c.r, c.g) - c.b) / (max(c.r, c.g) + 1e-4));
  c = mix(c, Ym * vec3(0.98, 1.0, 1.02) * 0.85, mu * hot);
  return mix(lin, c, uStruct.x);
}

void main() {
  vec4 dev = texture(uDev, vUv);
  vec4 raw = texture(uRaw, vUv);
  vec3 lin0 = toLin(dev.rgb);

  // The sky matte, as the view swapped it in: its rims were already cleaned
  // of the old sky there, so it is used as it is (dilating it would grade a
  // pale lamp post or ledge as sky). It is cut tighter than the view's
  // feather: what the matte only half calls sky goes to the structure, whose
  // rim choke then darkens it, so a roofline cuts cleanly into the blue.
  float m = raw.a;
  vec2 s = vec2(vUv.x - 0.5, 0.5 - vUv.y) * 2.0 * uHalf;
  vec3 d = normalize(uC * uF + uR * s.x + uD * s.y);
  float st = 1.0 - smoothstep(0.1, 0.55, m);
  vec3 linS = st > 0.002 ? mix(lin0, structGrade(lin0, d), st) : lin0;
  vec2 dith = vec2(hash12(gl_FragCoord.xy + uSeed), hash12(gl_FragCoord.yx + 5.3 + uSeed));
  m = smoothstep(0.1, 0.55, m) * smoothstep(0.01, 0.06, d.z) * uSky.y;
  if (m < 0.002) {
    outColor = vec4(clamp(toSrgb(linS) + (dith.x + dith.y - 1.0) / 255.0, 0.0, 1.0), 1.0);
    return;
  }

  // The cloud's density: how much of the deck's cumulus lies over the blue
  // here, read as one continuous field rather than keyed. The scene light is
  // unmixed against the clear sky the deck was laid over in this very
  // direction (the static blue, through the same polariser): cloud is close
  // to neutral, so it takes the blue's (b - r) away in proportion to its
  // share, and a thin wisp keeps most of the blue and stays mostly
  // transparent. The ramp is wide and nearly linear, so nothing in the deck
  // is cut: its own silhouettes, wisps and soft fringes are kept as they are.
  // A disk about three plate pixels across smooths the deck's compressed
  // chroma first.
  vec3 still = exp2(RLO + texture(uSkyTex, diskUv(d)).rgb * (RHI - RLO));
  float sb = smoothstep(0.4, 0.85, (still.b - still.r) / (still.b + 1e-4));
  still *= mix(vec3(1.0), POL, sb) * uRawGain;
  float brS = max(still.b - still.r, 1e-5);
  float YS = dot(still, LUMA);
  vec3 rc = rawLin(vUv);
  float aw = 1.0;
  for (int j = 1; j <= 3; j++) {
    float r = uFeather * float(j) / 3.0;
    float w = exp(-2.0 * float(j * j) / 9.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(j) * 0.26;
      rc += w * rawLin(vUv + r * vec2(cos(a), sin(a)));
      aw += w;
    }
  }
  rc /= aw;

  // the print, a little blurred: a grain-free light and colour for the
  // curves, the grain riding back on the composite as a ratio at the end
  vec3 lin = toLin(dev.rgb);
  float Y = dot(lin, LUMA);
  vec2 tx = 1.5 / vec2(textureSize(uDev, 0));
  vec3 linb = 0.5 * lin + 0.125 * (toLin(texture(uDev, vUv + vec2(tx.x, 0.0)).rgb)
    + toLin(texture(uDev, vUv - vec2(tx.x, 0.0)).rgb)
    + toLin(texture(uDev, vUv + vec2(0.0, tx.y)).rgb)
    + toLin(texture(uDev, vUv - vec2(0.0, tx.y)).rgb));
  float Yb = dot(linb, LUMA);
  float L = log2(Yb + 0.002);
  // The local mean, in log luminance, over two rings a cumulus turret
  // across (fractions of the print), weighted to cloud: clear sky and walls
  // are never read as a cloud's surroundings. The same rings, read in scene
  // light (grain-free, the same for every print), give the cloud's relief:
  // the slope of its log radiance, the plate's cloud seen as a height field
  // that the sun then lights. The two inner rings also give the bloom (how
  // much cloud lies just round a pixel) and every ring the clear sky's own
  // exposure on this print, read where the rings find open blue.
  float Lm = 0.0;
  float wm = 0.0;
  float hc = log2(dot(rawLin(vUv), LUMA) + 1e-4);
  vec2 grad = vec2(0.0);
  float onSky = 0.0;
  float bloom = 0.0;
  float vs = 0.0;
  float wv = 0.0;
  for (int j = 0; j < 4; j++) {
    float r = j == 0 ? 0.014 : (j == 1 ? 0.04 : (j == 2 ? 0.08 : 0.14));
    vec2 gj = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(j) * 0.392699;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 p = vUv + dir * r;
      p = 1.0 - abs(1.0 - abs(p)); // mirrored at the print's edge, never smeared
      vec4 rw = texture(uRaw, p);
      vec3 rl = uRawSrgb > 0.5 ? pow(rw.rgb, vec3(2.2)) : rw.rgb;
      float dq = density(rl, brS, YS, uFill, 1.0);
      float cl = rw.a * dq;
      vec3 lq = toLin(texture(uDev, p).rgb);
      if (j == 1 || j == 2) {
        float w = 0.02 + cl;
        Lm += w * log2(dot(lq, LUMA) + 0.002);
        wm += w;
      }
      if (j < 2) bloom += cl * (j == 0 ? 0.6 : 0.4);
      float ws = rw.a * (1.0 - dq) * (1.0 - dq);
      vs += ws * max(lq.r, max(lq.g, lq.b));
      wv += ws;
      // off the sky matte a tap reads as the pixel itself: a wall never
      // lights or shades a cloud's edge
      float h = mix(hc, log2(dot(rl, LUMA) + 1e-4), rw.a);
      gj += (h - hc) * dir;
      onSky += rw.a;
    }
    // weighted to the broad rings: the sun lights a cloud's body, and the
    // small rings alone paint mottled shade streaks inside the masses
    grad += gj / (4.0 * r) * (j == 0 ? 0.12 : (j == 1 ? 0.3 : (j == 2 ? 0.5 : 0.4)));
  }
  onSky /= 32.0;
  bloom /= 8.0;
  // A cloud's edge is read on the wide ramp, so its fringe and wisps thin
  // out into the blue as the deck has them; inside its body (all cloud just
  // round it) on the firm one, so a shade side lit by the blue, which keeps
  // some of the blue's chroma, stays cloud instead of going to lacy holes.
  float dens = mix(density(rc, brS, YS, uDens.yz, 0.0), density(rc, brS, YS, uFill, 1.0), smoothstep(0.5, 0.9, bloom));
  Lm /= wm;
  float rel = L - Lm; // stops above (+) or below (-) its neighbourhood

  // The sun, in this print's frame: the way towards it across the image.
  vec3 ts = uSun - d * dot(uSun, d);
  vec2 su = vec2(dot(ts, uR), -dot(ts, uD));
  su /= max(length(su), 1e-5);
  // The side of a cloud that faces the sun is the side its radiance climbs
  // away from: lit. The far side, where it falls away, is in its own shade.
  // Towards the horizon the deck is foreshortened and the plate's haze is
  // all fine streaks, so the same slope is read as less relief there.
  float th = acos(clamp(d.z, -1.0, 1.0));
  float fx = -dot(grad, su) * uLight.z * mix(1.0, 0.4, smoothstep(0.8, 1.2, th));
  // next to a wall the rings read the wall's edge as relief (raking streaks
  // off the corners), so the relight fades out where the rings leave the sky
  float facing = fx / sqrt(1.0 + fx * fx) * smoothstep(0.6, 0.95, onSky);
  // a thin wisp is mostly the blue behind it, so it carries its body's tone
  // rather than the sky's light read as a dark cloud
  float body = dens;

  // The cloud's light, in stops about the knee of a soft shoulder: log
  // contrast on its broad modelling (the local mean, the print's own exposure
  // taken out first so a print metered down for a bright patch is not crushed
  // three times over), a gentler one on the fine detail against it, then the
  // sun: the side that faces it is pushed up into the shoulder, the far side
  // down out of it, by a stop or so at most. The exposure goes back on, so
  // every print still meters for itself.
  float Lf = Lm - uEv.x * uEv.y + 0.63; // stops from a mid cloud of the plate
  float lx = uCloud.x + uCloud.y * Lf + uModel.x * rel * body;
  lx += facing > 0.0 ? uLight.x * facing : uLight.y * facing;
  // the shade side rolls off towards a floor: undersides go the cyan-grey
  // of a cloud lit by the blue, never to storm cloud
  lx = lx < 0.0 ? -uModel.w * (1.0 - exp(lx / uModel.w)) : lx;
  lx += uEv.x * uEv.y * uModel.z;
  float xs = exp2(clamp(lx, -12.0, 8.0));
  float yc = xs / pow(1.0 + pow(xs, uModel.y), 1.0 / uModel.y); // 0..1, 1 = the top of the shoulder
  // The tone is laid as colour, not as darkness: a cloud is lit by the sun
  // from one side and by the open blue everywhere else, so its shade is the
  // sky's light on white vapour, a pale cyan-grey (#B7C5C5), and only the
  // faces turned to the sun climb to the warm near-white (#F4F1EA). In
  // between the two mix in light, the pale blue-white of a cumulus flank.
  vec3 hiL = toLin(HI);
  vec3 shL = mix(vec3(dot(toLin(SHADE), LUMA)), toLin(SHADE), uCloud.z);
  float sunlit = smoothstep(0.62, 0.95, yc) * smoothstep(-0.25, 0.45, facing);
  // a cloud's bright side away from the sun is a neutral white, not the
  // warm one: the warmth is the sun's
  vec3 top = mix(vec3(dot(hiL, LUMA)) * vec3(0.975, 0.99, 1.02), hiL, sunlit);
  // shade to top along the cloud's light, mixed on a perceptual scale so a
  // flank half way round reads half way between them
  float u = smoothstep(-1.5, 1.6, lx - uEv.x * uEv.y * uModel.z);
  vec3 tint = mix(sqrt(shL), sqrt(top), u);
  tint *= tint;
  // the deepest undersides go a touch below the cyan-grey, never grey-lilac
  tint *= mix(0.9, 1.0, smoothstep(-0.1, 0.3, u));
  // the print's own dye cast stays in the body, but the sunlit tops lose
  // most of it, so they land on the warm white instead of a cool grey. It is
  // read from the cloud only: in a wisp the pixel is mostly the blue, whose
  // cast is the sky's
  vec3 own = mix(vec3(1.0), (linb + 0.002) / (Yb + 0.002), uCloud.w * dens * (1.0 - 0.7 * sunlit));
  vec3 cloud = tint * own;
  // never past the warm white, and never by clipping one channel (that
  // turns blue shade cyan): the whole colour comes down together
  vec3 over = cloud / hiL;
  cloud /= max(1.0, max(over.r, max(over.g, over.b)));

  // clear sky: a dome. The colour opens from cobalt to a pale cyan with
  // slope right from the zenith (a smoothstep would leave the middle prints
  // flat), and the zenith is taken down and saturated on top of that,
  // fading out the same way, so each print carries its piece of the dome.
  // Under a cloud the deepening fades out with its density, so the blue
  // behind a wisp or a fringe is the open sky's own and no dark moat rings
  // the cloud. It carries the print's own exposure as a ratio, read off the
  // clear sky round the pixel (a cloud's light never brightens its blue).
  float tz = clamp(th / uDome.z, 0.0, 1.0);
  float zw = pow(1.0 - tz, 1.4) * (1.0 - dens);
  // The chroma is opened on the print's tone scale, along the hue (away from
  // the top channel, never past where the weakest one runs out), so the
  // cobalt gets richer without sliding towards cyan or violet.
  vec3 sk = mix(ZEN, RIM, tz * (1.4 - 0.4 * tz));
  float tv = max(sk.r, max(sk.g, sk.b));
  float tn = min(sk.r, min(sk.g, sk.b));
  sk = tv - (tv - sk) * min(1.0 + uDome.y * zw, tv / max(tv - tn, 1e-4));
  vec3 tgt = toLin(sk) * exp2(-uDome.x * zw);
  float Vb = max(linb.r, max(linb.g, linb.b));
  float Vs = mix(Vb, wv > 0.5 ? vs / wv : Vb, smoothstep(0.0, 0.5, dens));
  vec3 sky = tgt * pow(clamp(Vs / VREF, 0.55, 1.25), uSky.x);
  // the gentle bloom where cloud meets blue: the blue just round a cloud
  // takes on a little of the cloud's light, falling off over the inner rings
  float halo = max(bloom - dens, 0.0) * (1.0 - dens);
  sky = mix(sky, mix(sky, cloud, 0.5), uDens.w * halo);

  // one field: the blue, with the cloud laid into it by its density; the
  // print's grain only goes back on after, as a ratio on the whole
  vec3 g = mix(sky, cloud, dens);
  g *= clamp((Y + 0.004) / (Yb + 0.004), 0.85, 1.18);
  // Low over the roofs the deck goes to haze and its cumulus are
  // foreshortened to streaks; ease the grade off a little towards the
  // horizon, where a real sky pales anyway (the deck has no fill round the
  // structures to outline, so it keeps most of it).
  m *= mix(1.0, 0.75, smoothstep(1.0, 1.45, th));
  vec3 outc = toSrgb(mix(linS, g, m));
  outc += (dith.x + dith.y - 1.0) / 255.0;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

// The finish, the last pass of each print: what makes it an instant print
// rather than a digital crop. The sky grade above is a smooth curve on a
// grain-free luminance, so whatever grain the film laid down is gone from the
// sky by the time it is graded; the emulsion's character goes back on here,
// after it, in three steps:
//   - halation: light from a bright cloud or open sky that crosses into a
//     dark structure on the matte scatters back off the film base and blooms
//     as a thin red-orange ring just inside the structure's edge; on the
//     bright side the same edge loses its cold paper white to a warm one, so
//     the rim round a roofline reads as the film's ring, not a matte fringe;
//   - scan MTF: a slight, isotropic softening (the same kernel for every
//     channel, so no RGB split), the way edges bleed in an SX-70 print;
//   - grain: the print's own seed, clumped over a couple of texels, a
//     density grain that rides on each channel's own value (hue kept, no
//     chroma speckle) and is strongest in the midtones: about four code
//     values in open sky, less in the deepest cobalt and on the cloud tops.
const FINISH = {
  halation: 0.55, // ring strength on the dark side (share of the bright edge's light)
  halationEdge: 0.5, // warming of the bright side of the same edge
  halationRadius: 0.009, // ring radius, share of the print width (about 3.5 texels)
  mtf: 0.55, // share of the scan blur mixed in
  mtfRadius: 0.0022, // scan blur radius, share of the print width
  grainAmp: 9, // code values of grain at the midtone peak
};
const HALO = [1, 0.3, 0.07]; // halation colour, linear: red-orange off the base

const FIN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImg;  // the graded print (sRGB)
uniform sampler2D uRaw;  // the camera's view; alpha = sky matte
uniform vec3 uHal;       // dark-side strength, bright-side warming, radius (uv)
uniform vec2 uMtf;       // strength, radius (uv)
uniform float uGrain;    // code values at the midtone peak
uniform float uSeed;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 HALO = ${vec3(HALO)};

vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// zero-mean, unit-variance noise on the lattice
float gnoise(vec2 p) {
  return (hash12(p) + hash12(p + 17.31) + hash12(p + 41.7) - 1.5) * 2.0;
}
// clumped: value noise over a lattice a couple of texels across
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gnoise(i), gnoise(i + vec2(1.0, 0.0)), f.x), mix(gnoise(i + vec2(0.0, 1.0)), gnoise(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 c0 = toLin(texture(uImg, vUv).rgb);
  float m0 = texture(uRaw, vUv).a;

  // Scan MTF: a little binomial blur, mixed in.
  vec3 bl = 4.0 * c0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 o = vec2(cos(a), sin(a)) * uMtf.y;
    bl += (i % 2 == 0 ? 2.0 : 1.0) * toLin(texture(uImg, vUv + (i % 2 == 0 ? o : o * 1.4142)).rgb);
  }
  bl /= 16.0;
  vec3 lin = mix(c0, bl, uMtf.x);

  // Halation: the light of the bright sky beside a structure's edge
  // (gathered over two tight rings), how much of the rings is sky, and how
  // much is structure.
  float Y0 = dot(c0, LUMA);
  float sGlow = 0.0;
  float sSky = 0.0;
  float sw = 0.0;
  for (int j = 1; j <= 3; j++) {
    float r = uHal.z * (j == 1 ? 0.45 : (j == 2 ? 0.9 : 1.5));
    float w = j == 1 ? 1.0 : (j == 2 ? 0.6 : 0.35);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + float(j) * 0.39;
      vec2 q = vUv + vec2(cos(a), sin(a)) * r;
      float mq = texture(uRaw, q).a;
      sGlow += w * mq * dot(toLin(texture(uImg, q).rgb), LUMA);
      sSky += w * mq;
      sw += w;
    }
  }
  sSky /= sw;
  // the brightness of the sky across the edge, and how near the edge is
  float glow = smoothstep(0.08, 0.6, sGlow / max(sSky * sw, 1e-4));
  float edgeIn = (1.0 - m0) * smoothstep(0.02, 0.4, sSky) * glow;
  float edgeOut = m0 * smoothstep(0.04, 0.4, 1.0 - sSky) * smoothstep(0.25, 0.7, Y0);
  // structure side: the ring. On a dark wall it is light added, red-orange;
  // on a pale rim (the plate's own edge, which would read as a white matte
  // fringe) the same ring is a filter that takes the white over to it.
  float darkW = 1.0 - smoothstep(0.04, 0.35, Y0);
  lin += uHal.x * edgeIn * darkW * glow * 0.8 * HALO;
  lin *= mix(vec3(1.0), vec3(1.0, 0.7, 0.5), clamp(uHal.x * edgeIn * (1.0 - darkW) * 1.6, 0.0, 1.0));
  // sky side: the white along the same edge warms a little
  lin *= mix(vec3(1.0), vec3(1.0, 0.85, 0.72), clamp(uHal.y * edgeOut, 0.0, 1.0));

  vec3 c = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));

  // Grain: mostly shared across the channels (density), a little each its own
  // (dye clouds), riding on each channel's value so the hue holds.
  vec2 fc = gl_FragCoord.xy + uSeed * vec2(1.618, 2.414);
  float gs = 0.9 * vnoise(fc / 1.9) + 0.3 * gnoise(fc);
  vec3 gc = vec3(gnoise(fc + 3.1), gnoise(fc + 7.7), gnoise(fc + 11.3));
  vec3 n = 0.92 * gs + 0.3 * gc;
  float L = dot(c, LUMA);
  float wL = 0.22 + 0.78 * exp(-pow((L - 0.45) / 0.2, 2.0));
  float mx = max(c.r, max(c.g, c.b));
  vec3 fch = mix(vec3(0.25), vec3(1.0), c / max(mx, 1e-3));
  c += n * fch * wL * uGrain / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// A print on the table: paper, image, and its shadow, drawn in one quad.
const PRINT_VS = `#version 300 es
in vec2 aPos;
uniform vec2 uCenter;   // css px, box frame
uniform vec2 uExt;      // quad half extent, css px (axis aligned, covers shadow)
uniform vec2 uRes;      // box css px
out vec2 vW;
void main() {
  vW = uCenter + aPos * uExt;
  vec2 c = vW / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const PRINT_FS = `#version 300 es
precision highp float;
in vec2 vW;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uCenter;
uniform vec2 uCS;       // cos, sin of rotation
uniform float uScale;
uniform float uImg;     // image side, css px (at scale 1)
uniform float uLift;    // 0 on the table .. 1 held up
uniform float uAlpha;
uniform float uDpr;
uniform float uDevelop; // 0 = fresh grey-green, 1 = developed
const float FW = ${FW.toFixed(6)};
const float FH = ${FH.toFixed(6)};
const float IMG_OFF = ${IMG_OFF.toFixed(6)};

vec2 toLocal(vec2 w) {
  vec2 p = w - uCenter;
  return vec2(uCS.x * p.x + uCS.y * p.y, -uCS.y * p.x + uCS.x * p.y) / uScale;
}
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// erf approximation (Abramowitz-Stegun 7.1.26 grade, plenty for a shadow)
float erf1(float x) {
  float s = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.47047 * x);
  float y = 1.0 - (0.3480242 * t - 0.0958798 * t * t + 0.7478556 * t * t * t) * exp(-x * x);
  return s * y;
}
float boxBlur(vec2 p, vec2 b, float sigma) {
  float k = 0.70710678 / sigma;
  float x = 0.5 * (erf1((b.x - p.x) * k) + erf1((b.x + p.x) * k));
  float y = 0.5 * (erf1((b.y - p.y) * k) + erf1((b.y + p.y) * k));
  return x * y;
}

void main() {
  float img = uImg;
  vec2 half_ = vec2(FW, FH) * img * 0.5;
  float px = 1.0 / (uDpr * uScale); // one device px in local css units

  // Shadows: a tight contact shadow while it lies flat, a soft drop shadow
  // that spreads and drifts away from the light as it is lifted.
  float h = uLift;
  vec2 offA = vec2(0.12, 0.55) * (1.0 + 18.0 * h);
  float sA = 1.4 + 13.0 * h;
  float aA = 0.2 * (1.0 - 0.45 * h);
  float shA = aA * boxBlur(toLocal(vW - offA), half_ - 0.5, sA / uScale);
  float shC = 0.30 * (1.0 - smoothstep(0.0, 0.08, h)) * boxBlur(toLocal(vW - vec2(0.0, 0.45)), half_, 0.75);
  float sh = 1.0 - (1.0 - shA) * (1.0 - shC);

  vec2 q = toLocal(vW);
  float sd = sdBox(q, half_, img * 0.02);
  float cov = clamp(0.5 - sd / px, 0.0, 1.0);

  // Paper: the white frame, a hair cooler under the light when lifted.
  vec3 paper = vec3(0.972, 0.968, 0.952) + 0.006 * h;
  vec2 qi = q - vec2(0.0, IMG_OFF * img);
  float sdi = sdBox(qi, vec2(img * 0.5), img * 0.006);
  float inImg = clamp(0.5 - sdi / px, 0.0, 1.0);
  vec2 uv = vec2(qi.x / img + 0.5, 0.5 - qi.y / img);
  vec3 photo = texture(uTex, uv).rgb;
  // Undeveloped integral film is an opaque blue-grey that clears.
  vec3 raw = vec3(0.36, 0.42, 0.42);
  photo = mix(raw, photo, uDevelop);
  // the frame's mask sits a hair proud of the image: a faint inner line
  float rim = 1.0 - 0.07 * (1.0 - smoothstep(0.0, 1.4 * px + 0.35, abs(sdi)));
  vec3 col = mix(paper * rim, photo, inImg);

  vec3 shadowCol = vec3(0.16, 0.13, 0.10);
  vec3 rgb = col * cov + shadowCol * sh * (1.0 - cov);
  float a = cov + sh * (1.0 - cov);
  outColor = vec4(rgb, a) * uAlpha;
}`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadBitmap(src, max = Infinity) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const opts = { colorSpaceConversion: "none", premultiplyAlpha: "none" };
  const bm = await createImageBitmap(await res.blob(), opts);
  if (bm.width <= max && bm.height <= max) return bm;
  const k = max / Math.max(bm.width, bm.height);
  const small = await createImageBitmap(bm, { ...opts, resizeWidth: Math.round(bm.width * k), resizeHeight: Math.round(bm.height * k), resizeQuality: "high" });
  bm.close();
  return small;
}

function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

// Damped spring, semi-implicit Euler in small steps.
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
const spring = (x, to = x, v = 0) => ({ x, to, v });

// --- the table's map: stereographic, zenith at the centre (units of f) -----
function dirOf(x, y) {
  const r = Math.hypot(x, y);
  const th = 2 * Math.atan(r / 2);
  const s = Math.sin(th);
  const c = r > 1e-9 ? 1 / r : 0;
  return [s * x * c, s * y * c, Math.cos(th)];
}
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export async function createJoiner(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const qn = q.get("prints");
  const still = qn != null && qn !== "" && Number.isFinite(+qn);
  const seed0 = Number.isFinite(+q.get("seed")) && q.get("seed") !== null ? +q.get("seed") : 7;
  const qt = q.get("t");
  const freezeT = qt != null && qt !== "" && Number.isFinite(+qt) ? +qt : null;
  const ev0 = Number.isFinite(+q.get("ev")) && q.get("ev") !== null ? +q.get("ev") : -0.5;
  // Any numeric film parameter can be overridden from the query for stills.
  const film0 = { ...FILM_BASE };
  for (const key of Object.keys(FILM_BASE)) {
    const v = q.get(key);
    if (typeof FILM_BASE[key] === "number" && v != null && v !== "" && Number.isFinite(+v)) film0[key] = +v;
  }
  const grade0 = { ...SKY_GRADE };
  for (const key of Object.keys(SKY_GRADE)) {
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) grade0[key] = +v;
  }
  const struct0 = { ...STRUCT_GRADE };
  for (const key of Object.keys(STRUCT_GRADE)) {
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) struct0[key] = +v;
  }
  const fin0 = { ...FINISH };
  for (const key of Object.keys(FINISH)) {
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) fin0[key] = +v;
  }
  const sunDir = (() => {
    const az = (grade0.sunAz * Math.PI) / 180;
    const el = (grade0.sunEl * Math.PI) / 180;
    return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
  })();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false, alpha: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  // The cloud deck is 8192 px, so a print's cumulus stay crisp at the
  // largest print texture (over two deck px to a print px at the zenith).
  // Where the GPU cannot hold that, or the prints are small enough (under
  // about 320 device px) that a 4096 px deck already gives them two plate
  // pixels each, it is taken down to 4096 on load, which saves 270 MB of
  // video memory.
  const cellGuess = Math.min(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight) * 0.25 * Math.min(2, window.devicePixelRatio || 1);
  const deckMax = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), cellGuess > 320 ? 8192 : 4096);
  const [sceneBm, maskBm, skyBm, cloudBm, overBm] = await Promise.all([
    loadBitmap(`${ASSET}scene.webp`),
    loadBitmap(`${ASSET}mask.webp`),
    loadBitmap(`${ASSET}sky.webp`),
    loadBitmap(`${ASSET}cloud.webp`, deckMax),
    loadBitmap(`${ASSET}overcast.webp`),
  ]);

  // A small copy of the disk for the prints' electric eye: the Docklands
  // structures with the cumulus deck under the sky matte, as the prints see it.
  const METER_N = 128;
  const meterLum = (() => {
    const small = (bm) => {
      const c = document.createElement("canvas");
      c.width = c.height = METER_N;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(bm, 0, 0, METER_N, METER_N);
      return x.getImageData(0, 0, METER_N, METER_N).data;
    };
    const ds = small(sceneBm);
    const dm = small(maskBm);
    const dc = small(cloudBm);
    // log2 luminance, roughly (the channels are log-encoded)
    const lum = (d, i) => LO + ((0.2 * d[i * 4] + 0.7 * d[i * 4 + 1] + 0.1 * d[i * 4 + 2]) / 255) * (HI - LO);
    const out = new Float32Array(METER_N * METER_N);
    for (let i = 0; i < out.length; i++) {
      const m = dm[i * 4] / 255;
      out[i] = Math.log2((1 - m) * 2 ** lum(ds, i) + m * 2 ** lum(dc, i));
    }
    return out;
  })();
  const meterAt = (d) => {
    const th = Math.acos(clamp(d[2], -1, 1));
    const l = Math.hypot(d[0], d[1]) || 1;
    const r = (0.5 * th) / THMAX;
    const u = clamp(Math.floor((0.5 + (r * d[0]) / l) * METER_N), 0, METER_N - 1);
    const v = clamp(Math.floor((0.5 + (r * d[1]) / l) * METER_N), 0, METER_N - 1);
    return meterLum[v * METER_N + u];
  };

  // A print's electric eye, in log2 luminance. Centre-weighted, but it reads
  // highlights first: the reading is the brighter of the weighted mean and the
  // 80th percentile, so the brightest sky in frame sets the exposure and a
  // dark wall cannot talk it into blowing that sky out.
  const meterPrint = (c, R, D, F, span) => {
    const k = 3;
    const v = [];
    let m = 0;
    let wsum = 0;
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const sx = (i / k) * 0.45 * span;
        const sy = (j / k) * 0.45 * span;
        const d = norm([c[0] * F + R[0] * sx + D[0] * sy, c[1] * F + R[1] * sx + D[1] * sy, c[2] * F + R[2] * sx + D[2] * sy]);
        const l = meterAt(d);
        const w = 1 / (1 + 0.6 * ((i * i + j * j) * 4) / (k * k));
        m += l * w;
        wsum += w;
        v.push(l);
      }
    v.sort((x, y) => x - y);
    return Math.max(m / wsum, v[Math.floor(0.8 * (v.length - 1))]);
  };

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm, mip) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bm.close?.();
    return t;
  };
  const texScene = upload(sceneBm, true);
  const texMask = upload(maskBm, true);
  const texSky = upload(skyBm, true);
  const texCloud = upload(cloudBm, true);
  const texOver = upload(overBm, false);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const view = compile(gl, VERT, VIEW);
  const printP = compile(gl, PRINT_VS, PRINT_FS);
  const gradeP = compile(gl, VERT, GRADE);
  const finP = compile(gl, VERT, FIN);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout ---------------------------------------------------------------
  let W = 1;
  let H = 1;
  let dpr = 1;
  let img = 120; // image side, css px
  let f = 245; // stereographic f, css px
  let cell = 256; // print texture side, device px
  let rawTex = null;
  let rawFbo = null;
  let rawLinear = true;
  let devTex = null; // the film's output, before the sky grade
  let devFbo = null;
  let gradeTex = null; // the graded print, before the finish
  let gradeFbo = null;

  const allocRaw = () => {
    if (rawTex) gl.deleteTexture(rawTex);
    if (rawFbo) gl.deleteFramebuffer(rawFbo);
    rawTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    rawFbo = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, cell, cell, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawTex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawTex, 0);
    }
    rawLinear = ok;
    if (devTex) gl.deleteTexture(devTex);
    if (devFbo) gl.deleteFramebuffer(devFbo);
    devTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, devTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    devFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, devFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, devTex, 0);
    if (gradeTex) gl.deleteTexture(gradeTex);
    if (gradeFbo) gl.deleteFramebuffer(gradeFbo);
    gradeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gradeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gradeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, gradeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gradeTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(cell, cell);
  };

  // --- prints ---------------------------------------------------------------
  const prints = [];
  let serial = 0;
  let zenithMeter = 0;
  const clock0 = performance.now();

  // Everything about a print that is decided when it is taken. Positions are
  // in units of f, so the joiner survives a resize.
  const makePrint = (ix, iy, opts = {}) => {
    const rnd = mulberry((opts.seed ?? seed0 * 7919 + serial * 104729) >>> 0);
    const rot = clamp(gauss(rnd) * 0.075, -0.16, 0.16);
    // the frame centre sits below the image centre the pointer aimed at
    const offY = IMG_OFF * (img / f);
    const cx = ix + Math.sin(rot) * offY;
    const cy = iy - Math.cos(rot) * offY;
    const moment = opts.moment ?? 0;
    const p = {
      id: serial++,
      ix,
      iy,
      cx,
      cy,
      rot,
      roll: gauss(rnd) * 0.018,
      aim: [gauss(rnd) * 0.016, gauss(rnd) * 0.016],
      dev: gauss(rnd) * 0.12,
      warm: gauss(rnd) * 0.1,
      dye: gauss(rnd) * 0.022,
      wind: (moment + gauss(rnd) * 0.22) * GUST,
      shear: [0.006 + rnd() * 0.006, rnd() * 6.283, rnd() * 6.283],
      grain: rnd() * 997,
      tex: null,
      fbo: null,
      // motion
      x: spring(cx),
      y: spring(cy),
      r: spring(rot),
      h: spring(0),
      born: opts.born ?? -1e9,
      alpha: 1,
      develop: 1,
      sweep: null,
    };
    return p;
  };

  const renderPrint = (p) => {
    if (!p.tex) {
      p.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      p.fbo = gl.createFramebuffer();
    }
    if (p.cell !== cell) {
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex, 0);
      p.cell = cell;
    }
    // the camera: aimed at the image centre, its frame turned with the paper
    const e = 1e-3;
    const c0 = dirOf(p.ix, p.iy);
    const a = dirOf(p.ix + e, p.iy);
    const b = dirOf(p.ix - e, p.iy);
    let right = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    let down = norm(cross(c0, right));
    right = norm(cross(down, c0));
    const th = 2 * Math.atan(Math.hypot(p.ix, p.iy) / 2);
    const F = 1 / Math.cos(th / 2) ** 2; // local scale of the map, f units per radian
    const c = norm([
      c0[0] + right[0] * p.aim[0] + down[0] * p.aim[1],
      c0[1] + right[1] * p.aim[0] + down[1] * p.aim[1],
      c0[2] + right[2] * p.aim[0] + down[2] * p.aim[1],
    ]);
    const ang = p.rot + p.roll;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let R = [ca * right[0] + sa * down[0], ca * right[1] + sa * down[1], ca * right[2] + sa * down[2]];
    let D = [-sa * right[0] + ca * down[0], -sa * right[1] + ca * down[1], -sa * right[2] + ca * down[2]];
    D = norm(cross(c, R));
    R = norm(cross(D, c));

    gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
    gl.viewport(0, 0, cell, cell);
    gl.disable(gl.BLEND);
    gl.useProgram(view.p);
    gl.bindVertexArray(vao);
    const u = view.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texScene);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texMask);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texSky);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, texCloud);
    gl.uniform1i(u.uScene, 0);
    gl.uniform1i(u.uMask, 1);
    gl.uniform1i(u.uSky, 2);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, texOver);
    gl.uniform1i(u.uCloud, 3);
    gl.uniform1i(u.uOver, 4);
    gl.uniform3fv(u.uC, c);
    gl.uniform3fv(u.uR, R);
    gl.uniform3fv(u.uD, D);
    gl.uniform1f(u.uF, F);
    gl.uniform1f(u.uHalf, (0.5 * img) / f);
    gl.uniform2f(u.uWind, WIND[0] * p.wind, WIND[1] * p.wind);
    gl.uniform3fv(u.uShear, p.shear);
    gl.uniform1f(u.uGain, rawLinear ? 1 : 2 ** RAW8_EV);
    gl.uniform1f(u.uSrgb, rawLinear ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // the electric eye, against the zenith print: it opens up for a darker
    // frame by a third of the difference but never past a quarter stop, so a
    // print that is mostly wall keeps the cloud in its strip of sky; it closes
    // down harder for a brighter one (the sun side of the street), to a floor
    const m = meterPrint(c, R, D, F, img / f) - zenithMeter;
    const ev = ev0 + clamp(-(m > 0 ? 0.45 : 0.3) * m, -1.25, 0.25) + p.dev;
    film.render(
      rawTex,
      {
        ...film0,
        input: rawLinear ? "linear" : "srgb",
        exposure: rawLinear ? ev : ev - RAW8_EV,
        warmth: film0.warmth + p.warm,
        highlightTint: [film0.highlightTint[0] + p.dye, film0.highlightTint[1], film0.highlightTint[2] - p.dye],
        shadowTint: [film0.shadowTint[0] - p.dye * 0.6, film0.shadowTint[1], film0.shadowTint[2] + p.dye * 0.6],
        grainSize: 1100 / cell,
        grainSeed: p.grain,
      },
      devFbo,
    );

    // the sky grade
    gl.bindFramebuffer(gl.FRAMEBUFFER, gradeFbo);
    gl.viewport(0, 0, cell, cell);
    gl.disable(gl.BLEND);
    gl.useProgram(gradeP.p);
    gl.bindVertexArray(vao);
    const g = gradeP.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, devTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.uniform1i(g.uDev, 0);
    gl.uniform1i(g.uRaw, 1);
    gl.uniform1f(g.uRawSrgb, rawLinear ? 0 : 1);
    gl.uniform3fv(g.uC, c);
    gl.uniform3fv(g.uR, R);
    gl.uniform3fv(g.uD, D);
    gl.uniform1f(g.uF, F);
    gl.uniform1f(g.uHalf, (0.5 * img) / f);
    gl.uniform4f(g.uCloud, grade0.cloudGain, grade0.cloudToe, grade0.splitTone, grade0.keep);
    gl.uniform4f(g.uModel, grade0.detail, grade0.knee, grade0.cloudKeep, grade0.depth);
    gl.uniform2f(g.uEv, ev - ev0, grade0.cloudSlope);
    gl.uniform2f(g.uSky, grade0.skyKeep, grade0.grade);
    gl.uniform3f(g.uDome, grade0.skyDeep, grade0.skySat, grade0.skyFall);
    gl.uniform3fv(g.uSun, sunDir);
    gl.uniform3f(g.uLight, grade0.sunGain, grade0.sunShade, grade0.relief);
    // feather radius, plate pixels to print uv (the print spans 2 uHalf / F radians)
    gl.uniform1f(g.uFeather, (grade0.feather * PLATE_RAD * F) / (img / f));
    gl.uniform4f(g.uDens, grade0.densLo, grade0.densHi, grade0.densLight, grade0.bloom);
    gl.uniform2f(g.uFill, grade0.fillHi, grade0.fillLight);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texSky);
    gl.uniform1i(g.uSkyTex, 2);
    gl.uniform1f(g.uRawGain, rawLinear ? 1 : 2 ** RAW8_EV);
    gl.uniform1f(g.uSeed, p.grain);
    gl.uniform4f(g.uStruct, struct0.structGrade, struct0.structSlope, Math.log2(struct0.structPivot), struct0.structHaze);
    gl.uniform4f(g.uStructKey, struct0.structFloor ** 2.2, struct0.structWarm, struct0.structGlass, struct0.structEdge);
    gl.uniform1f(g.uMute, struct0.mute);
    gl.uniform1f(g.uPlatePx, (PLATE_RAD * F) / (img / f));
    gl.uniform1f(g.uStructEv, struct0.structEv);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // the finish (halation, scan softness, grain), into the print
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
    gl.useProgram(finP.p);
    const fu = finP.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gradeTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.uniform1i(fu.uImg, 0);
    gl.uniform1i(fu.uRaw, 1);
    gl.uniform3f(fu.uHal, fin0.halation, fin0.halationEdge, fin0.halationRadius);
    gl.uniform2f(fu.uMtf, fin0.mtf, fin0.mtfRadius);
    gl.uniform1f(fu.uGrain, fin0.grainAmp);
    gl.uniform1f(fu.uSeed, p.grain);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const freePrint = (p) => {
    if (p.tex) gl.deleteTexture(p.tex);
    if (p.fbo) gl.deleteFramebuffer(p.fbo);
    p.tex = null;
    p.fbo = null;
  };

  // Moment: a slow clock, folded so the deck wanders rather than leaves.
  const momentNow = () => {
    const t = (performance.now() - clock0) / 1000 / 70;
    return 2 * Math.abs(((t + 0.25) % 2) - 1) - 1; // triangle, -1..1
  };

  // A pre-built joiner: a loose Hockney grid, nearest cells to the zenith,
  // shot row by row so each print lies over the white bottom margin of the
  // one above and the side margin of the one before it, and the sky, not the
  // paper, fills the table. The image centres sit a hair above the zenith so
  // the frames, not the images, are centred.
  const layout = (n, seed, centre = [0, IMG_OFF * FIELD]) => {
    const rnd = mulberry(seed * 31 + 5);
    const s = img / f;
    const sx = FW * s * 0.78;
    const sy = FH * s * 0.74;
    const cells = [];
    for (let j = -5; j <= 5; j++)
      for (let i = -7; i <= 7; i++) {
        const x = centre[0] + i * sx + (j % 2 ? sx * 0.18 : 0);
        const y = centre[1] + j * sy;
        // near circular, so the ring stays in the sky and tall facades and
        // never reaches the pavement towards the disk's rim
        const dx = (x - centre[0]) / 1.1;
        const dy = y - centre[1];
        // a print shot mostly off the edge of the table is a print wasted:
        // those cells only fill in once the table itself is covered
        const off = Math.abs(x) > W / 2 / f - 0.05 * s || Math.abs(y) > H / 2 / f - 0.05 * s;
        cells.push({ i, j, x, y, d: Math.hypot(dx, dy) + rnd() * sx * 0.35 + (off ? 100 : 0) });
      }
    cells.sort((a, b) => a.d - b.d);
    const pick = cells.slice(0, n);
    pick.sort((a, b) => a.j - b.j || (a.j % 2 ? b.i - a.i : a.i - b.i));
    return pick.map((c, k) => ({
      ix: c.x + gauss(rnd) * sx * 0.09,
      iy: c.y + gauss(rnd) * sy * 0.07,
      moment: -1 + (2 * k) / Math.max(1, n - 1),
      seed: seed * 1009 + k * 7 + 1,
    }));
  };

  const resize = (w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    img = clamp(Math.min(w, h) * (Math.min(w, h) < 600 ? 0.24 : 0.25), 60, 200);
    f = img / FIELD;
    const nc = Math.min(512, Math.ceil((img * d) / 8) * 8);
    if (nc !== cell || !rawTex) {
      cell = nc;
      allocRaw();
      for (const p of prints) renderPrint(p);
    }
    dirty = true;
  };

  let dirty = true;

  // --- shooting ---------------------------------------------------------------
  const toF = (x, y) => [(x - W / 2) / f, (y - H / 2) / f];
  const shoot = (x, y, vx = 0, vy = 0, t = performance.now()) => {
    const [ix, iy] = toF(x, y);
    const p = makePrint(ix, iy, { moment: momentNow(), born: t });
    renderPrint(p);
    const rnd = mulberry(p.id * 977 + 3);
    // It leaves the hand carrying a little of the drag, a little turned, and
    // falls the last few centimetres on to the pile.
    const carry = 0.07;
    p.x.x = p.cx - (vx * carry) / f;
    p.y.x = p.cy - (vy * carry) / f;
    p.x.v = (vx * 0.35) / f;
    p.y.v = (vy * 0.35) / f;
    p.r.x = p.rot + (rnd() - 0.5) * 0.16 + clamp(vx / 6000, -0.08, 0.08);
    p.h.x = reduced ? 0 : 1;
    p.alpha = 0;
    p.develop = 0.35;
    prints.push(p);
    while (prints.length > MAX_PRINTS) freePrint(prints.shift());
    dirty = true;
    return p;
  };

  const advance = (p, dt) => {
    if (p.sweep) {
      const s = p.sweep;
      s.t += dt;
      const k = Math.max(0, s.t - s.delay);
      const v = s.speed * Math.min(1, k / 0.32) ** 2;
      p.x.x += s.dx * v * dt;
      p.y.x += s.dy * v * dt;
      p.r.x += s.spin * v * dt;
      p.h.x = Math.min(0.1, k * 0.6) * (k > 0 ? 1 : 0);
      return true;
    }
    const age = (performance.now() - p.born) / 1000;
    let moving = false;
    if (p.alpha < 1) {
      p.alpha = Math.min(1, p.alpha + dt / (reduced ? 0.22 : 0.045));
      moving = true;
    }
    if (p.develop < 1) {
      p.develop = Math.min(1, p.develop + dt / 1.4);
      moving = true;
    }
    stepSpring(p.h, 2 * Math.PI * 2.1, 0.6, dt);
    stepSpring(p.x, 2 * Math.PI * 2.4, 0.86, dt);
    stepSpring(p.y, 2 * Math.PI * 2.4, 0.86, dt);
    stepSpring(p.r, 2 * Math.PI * 2.0, 0.8, dt);
    const settled =
      Math.abs(p.h.x) < 2e-4 && Math.abs(p.h.v) < 2e-3 && Math.abs(p.x.x - p.x.to) < 1e-5 && Math.abs(p.y.x - p.y.to) < 1e-5 && Math.abs(p.r.x - p.r.to) < 1e-5 && Math.abs(p.x.v) + Math.abs(p.y.v) + Math.abs(p.r.v) < 1e-4;
    if (settled) {
      p.h.x = 0;
      p.h.v = 0;
      p.x.x = p.x.to;
      p.y.x = p.y.to;
      p.r.x = p.r.to;
    }
    return moving || !settled || age < 0.05;
  };

  // --- drawing --------------------------------------------------------------
  const draw = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(TABLE[0], TABLE[1], TABLE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(printP.p);
    gl.bindVertexArray(vao);
    const u = printP.u;
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uImg, img);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const p of prints) {
      const h = Math.min(1, Math.abs(p.h.x));
      const scale = 1 + 0.06 * h;
      const cx = W / 2 + p.x.x * f;
      const cy = H / 2 + p.y.x * f;
      const ext = 0.5 * Math.hypot(FW, FH) * img * scale + 4 + 3 * (1.4 + 13 * h) + 20 * h;
      if (cx + ext < 0 || cx - ext > W || cy + ext < 0 || cy - ext > H) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform2f(u.uExt, ext, ext);
      gl.uniform2f(u.uCS, Math.cos(p.r.x), Math.sin(p.r.x));
      gl.uniform1f(u.uScale, scale);
      gl.uniform1f(u.uLift, h);
      gl.uniform1f(u.uAlpha, p.alpha);
      gl.uniform1f(u.uDevelop, 1 - (1 - p.develop) ** 2.2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  // --- input ------------------------------------------------------------------
  let last = null;
  let downAt = 0;
  let downXY = [0, 0];
  let travel = 0;
  let pressing = false;
  let swept = false;

  const sweep = (x, y) => {
    swept = true;
    // An arm across the table: everything slides off away from the hand,
    // the nearest first.
    const dir = x < W / 2 ? 1 : -1;
    for (const p of prints) {
      const px = W / 2 + p.x.x * f;
      const py = H / 2 + p.y.x * f;
      const rnd = mulberry(p.id * 131 + 17);
      const dist = Math.hypot(px - x, py - y) / Math.hypot(W, H);
      const ang = Math.atan2(py - y, (px - x) * 0.25 + dir * 60) * 0.35;
      p.sweep = {
        t: 0,
        delay: dist * 0.35 + rnd() * 0.05,
        speed: (Math.hypot(W, H) * 1.6) / f,
        dx: Math.cos(ang) * dir,
        dy: Math.sin(ang) * 0.9 + 0.12,
        spin: (rnd() - 0.5) * 0.5 * f / Math.hypot(W, H),
      };
    }
    dirty = true;
  };

  stage.on("down", (pt) => {
    pressing = true;
    swept = false;
    downAt = performance.now();
    downXY = [pt.x, pt.y];
    travel = 0;
    last = [pt.x, pt.y];
    shoot(pt.x, pt.y, 0, 0);
  });
  stage.on("move", (pt) => {
    if (!pressing || swept) return;
    travel = Math.max(travel, Math.hypot(pt.x - downXY[0], pt.y - downXY[1]));
    const step = FW * img * 0.8;
    const dx = pt.x - last[0];
    const dy = pt.y - last[1];
    const dl = Math.hypot(dx, dy);
    if (dl >= step) {
      // a fast drag still spaces its prints like a careful one
      const n = Math.min(3, Math.floor(dl / step));
      for (let i = 1; i <= n; i++) {
        const x = last[0] + (dx * step * i) / dl;
        const y = last[1] + (dy * step * i) / dl;
        shoot(x, y, pt.vx, pt.vy);
      }
      last = [last[0] + (dx * step * n) / dl, last[1] + (dy * step * n) / dl];
      if (n === 3) last = [pt.x, pt.y];
    }
  });
  stage.on("up", () => {
    pressing = false;
  });

  // --- start ----------------------------------------------------------------
  // Size first so the opening prints are cut for this box.
  await new Promise((r) => stage.onResize((w, h, d) => (resize(w, h, d), r())));
  // calibrate the meter on a print aimed straight up
  zenithMeter = meterPrint([0, 0, 1], [1, 0, 0], [0, 1, 0], 1, FIELD);

  const lay = (n, seed, centre, animate) => {
    const L = layout(n, seed, centre);
    const t0 = performance.now();
    L.forEach((c, k) => {
      const p = makePrint(c.ix, c.iy, { seed: c.seed, moment: c.moment, born: t0 });
      renderPrint(p);
      if (animate && !reduced) {
        p.born = t0 + 380 + k * 170;
        p.h.x = 1;
        p.alpha = 0;
        p.x.x = p.cx - 0.05;
        p.y.x = p.cy + 0.02;
        p.r.x = p.rot - 0.05;
        p.pending = true;
      }
      prints.push(p);
    });
  };

  if (still) {
    lay(clamp(Math.round(+qn), 0, MAX_PRINTS), seed0, undefined, false);
    if (freezeT != null && prints.length) {
      // replay the newest print's fall to t seconds and hold it there
      const p = prints[prints.length - 1];
      p.h.x = 1;
      p.x.x = p.cx - 0.06;
      p.y.x = p.cy - 0.03;
      p.x.v = 0.35;
      p.y.v = 0.15;
      p.r.x = p.rot + 0.07;
      p.alpha = 0;
      p.develop = 0.35;
      p.born = performance.now();
      const dt = 1 / 240;
      for (let t = 0; t < freezeT; t += dt) {
        p.alpha = Math.min(1, p.alpha + dt / 0.045);
        p.develop = Math.min(1, p.develop + dt / 1.4);
        stepSpring(p.h, 2 * Math.PI * 2.1, 0.6, dt);
        stepSpring(p.x, 2 * Math.PI * 2.4, 0.86, dt);
        stepSpring(p.y, 2 * Math.PI * 2.4, 0.86, dt);
        stepSpring(p.r, 2 * Math.PI * 2.0, 0.8, dt);
      }
      p.frozen = true;
    }
    const qs = q.get("sweep");
    if (qs != null && qs !== "" && Number.isFinite(+qs)) {
      // a still of the sweep, s seconds after a long press at the left
      sweep(W * 0.2, H * 0.52);
      const dt = 1 / 120;
      for (let t = 0; t < +qs; t += dt) for (const p of prints) advance(p, dt);
      for (const p of prints) p.frozen = true;
    }
  } else {
    lay(3, seed0, undefined, true);
  }

  stage.onFrame((dt) => {
    const now = performance.now();
    if (pressing && !swept && travel < 8 && now - downAt > 560 && prints.length) {
      sweep(downXY[0], downXY[1]);
    }
    let active = false;
    for (let i = prints.length - 1; i >= 0; i--) {
      const p = prints[i];
      if (p.frozen) continue;
      if (p.pending) {
        if (now < p.born) {
          active = true;
          continue;
        }
        p.pending = false;
      }
      if (advance(p, dt)) active = true;
      if (p.sweep) {
        const px = W / 2 + p.x.x * f;
        const py = H / 2 + p.y.x * f;
        const r = img * 1.2;
        if (px < -r || px > W + r || py < -r || py > H + r) {
          freePrint(p);
          prints.splice(i, 1);
        }
      }
    }
    if (active || dirty) {
      draw();
      dirty = false;
    }
  });

  await new Promise((r) => requestAnimationFrame(() => r()));
  draw();

  return {
    destroy() {
      for (const p of prints) freePrint(p);
      film.destroy();
      gl.deleteTexture(texScene);
      gl.deleteTexture(texMask);
      gl.deleteTexture(texSky);
      if (rawTex) gl.deleteTexture(rawTex);
      if (rawFbo) gl.deleteFramebuffer(rawFbo);
      if (devTex) gl.deleteTexture(devTex);
      if (devFbo) gl.deleteFramebuffer(devFbo);
      if (gradeTex) gl.deleteTexture(gradeTex);
      if (gradeFbo) gl.deleteFramebuffer(gradeFbo);
      gl.deleteProgram(view.p);
      gl.deleteProgram(finP.p);
      gl.deleteProgram(gradeP.p);
      gl.deleteProgram(printP.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
