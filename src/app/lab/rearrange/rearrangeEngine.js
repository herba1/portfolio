import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Rearrange: a summer photograph taken straight up a catenary mast at Ine,
// whose loose things come away from it. Pick up the maintenance platform,
// the far pole or an insulator and slide it across the sky, or run the
// lamp up and down its mast; let go and it settles. Double-tap and
// everything goes home. The photograph fills the view.
//
// tools/depth/bakes/rearrange cut the photo offline: every loose object has
// its own matte (solved against the sky colour at its edge, so the railing's
// thin bars and the sky between the floor's slats survive and no blue fringe
// travels with it; where a cable crossed it, it is completed underneath),
// and the clean plate behind them was filled with LaMa, tile by tile at
// close to native resolution, the cables drawn back through each hole along
// their own lines. The plate is split into a front layer (mast, girder,
// cables, with their disparity) and the sky behind.
//
// What ties an object to the things that stay moves with it. Every cable
// span that meets one (the far pole's strain chains and clamps, its spool
// insulators, the pull-off's steady wire) was lifted out of the plate with
// its fixed end (an insulator, a junction, a fitting) and where it is
// fastened on the object; here it is drawn live, as a cable of its own
// length hung between the two: pulled straight when its object goes
// away, sagging into a catenary when it comes closer. The platform's strut,
// brace and beams stay between their clamps on the mast and the deck, but
// as steel: the clamps slide along the mast so the frame rides with the
// deck at its own angles, growing with it as it nears the lens (collar).
//
// The lamp is a fitting, not a loose thing: its shade hangs from an
// angle-iron bracket clamped round the mast, and the two were cut out
// together (lamp.py). It only slides along its own mast (meta "slide":
// the held point keeps to the vertical line through it, the line toward
// the poles' vanishing point), so it can never be left in open sky; its
// feed cable, run up the mast's conduit into the bracket, is a live cable
// like the rest and pays out behind it.
//
// The far pole carries the girder's tip: the girder's last bay is clamped
// round it, so the two are one assembly (pole.py). The pole slides only
// along the girder's own axis (meta "track", the line toward its chords'
// vanishing point), and the bay, lifted out of the plate as a layer of its
// own (meta "spans"), is drawn between the last cross member, where it
// stays, and the clamp on the pole: each of its points is found on the
// bay's plane and its distance along the axis stretched or taken in
// between the two ends, so the chords are drawn out to the moved clamp as
// a cable is between its fittings. Its travel keeps the clamp on the bay,
// so the pole can never leave the truss's tip in the sky or stand in its
// span.
//
// Physics, in camera space (OpenCV axes, f from the lens, the up direction
// from the poles' vertical vanishing point, high above the frame: the lens
// looks up ~33 degrees):
//  - A moved object keeps its height above the ground. The point you hold
//    slides on that horizontal plane, so its distance, and the object's
//    size, follow from where it is on screen: it grows as it comes overhead
//    and shrinks as it slides down toward the horizon far below the frame,
//    exactly as the two poles converge. Each object is a vertical card
//    facing the camera, so the move is one homography
//    H = K (I + t n^T / d) K^-1, which also leans it toward the vertical
//    vanishing point wherever it goes.
//  - Occlusion is per pixel by disparity: the card's own depth against the
//    front layer's. Slide the far pole left and it passes behind the girder
//    and the cables; bring the platform across and it comes in front of
//    them.
//  - Shadows are cast, not drawn: from each lit surface a ray to the sun
//    (fitted from the shading of the two poles) is intersected with each
//    card and the card's matte looked up there, blurred by the distance
//    (the penumbra), plus a contact shadow where a card nearly touches a
//    surface. Only the change from the photo is applied, so at rest the
//    frame is the photograph exactly.
// The sky is regraded on its own (gradeSky): a dense cyan-cobalt that
// deepens toward the top of the frame, cloud warm-neutral with skylight-blue
// undersides, its density held back in the midtones. Then the whole
// composited frame, moved objects and live cables included, is developed
// as one print: local contrast taken out of the surfaces (the photo was a
// sharpened digital file), a thin red-leaning halation ring wherever bright
// sky meets dark steel, film.js (summer: Pro-Mist diffusion, dye-cloud
// softness, a soft shoulder that rolls cloud off warm-neutral), a lifted
// teal black, and grain at 24 fps whose clumps are filtered by the
// emulsion's MTF.
//
// Query: ?move=k,dx,dy holds object k (0 platform, 1 lamp, 2 far pole,
// 3 pull-off insulator, 4 insulator pair) lifted mid-move, dx/dy in photo
// widths/heights from where it was (the lamp takes the nearest point of
// its mast, the far pole the nearest point of its girder's axis); several
// are joined with ";".
// &lift=0 shows them set down. ?ev holds the opening's demo at its
// height (the platform at its highest, nearest the lens; ?ev=0.5 halfway
// there). ?at=s stops the opening's clock at s seconds (0.2: the white-blue
// overexposure; 3.4: the demo held up). &sunAz / &sunEl (deg) override the sun.
// &grade=0 shows the plate's own sky. &flatten, &halation, &grain override
// the print's (PRINT); 0 turns each off.

const ASSET = "/lab/rearrange/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const MAXK = 12; // objects, then the pinned members, then the spans
const LIFT = 0.045; // held: the card comes this share of its distance toward the lens
// The opening, once the print has developed out of its white-blue: the
// engine takes the platform itself, with the hand's own springs, high off
// its mast and toward the lens (du/dv in photo widths/heights from where it
// stood, lift as LIFT), so it grows and the sky and cumulus it stood in
// front of are there; it holds, then is let go and springs home.
const OPEN = { stops: 3.6, hold: 0.2, develop: 2.2 };
const DEMO = { at: 2.6, du: -0.02, dv: -0.24, lift: 0.08, hold: 1.2 };
// where a cropped view (a phone held upright) centres: on the near mast,
// so the platform, the lamp and the girder's root stay in it
const FOCUS = [0.3, 0.5];
const S_MIN = 0.42; // smallest and largest size relative to where it was
const S_MAX = 1.75;
const SKYLIGHT = [0.4, 0.46, 0.6]; // what is left in a shadow on a clear day: the blue sky
const SEG = 40; // points along a live cable
// A live cable goes behind a card or the front layer only where that is
// clearly nearer than the cable (the platform, the lamp, the mast): its
// own object, the girder it runs past and the pole it is clamped to are
// all at about its depth, and it lies over them as in the photo.
const WIRE_MARGIN = 0.15;

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255);
const lin = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
// The sky grade (see gradeSky): herb's cyan-cobalt, dense at the zenith and
// paler toward the horizon far below the frame; cloud warm-neutral, its
// shadowed undersides skylight blue.
const SKY = {
  // the film's curve lifts and spreads these a little: aimed so the print
  // lands near #1F62A8 at the top edge and #5A9BD0 at the bottom
  top: hex("#0E5AA2"),
  low: hex("#5A9BD0"),
  curve: 1.0,
  cloud: [0.26, 0.6],
  // #F2F0EA, warmed against the film's cool highlight tint (.95, 1, 1.05)
  warm: lin(hex("#F2F0EA")).map((v, i) => v * [1.06, 1, 0.93][i]),
  under: lin(hex("#A4C4E2")),
  underRange: [0.5, 0.8, 0.9],
  // The density of the graded sky, as an exponent on its linear light in
  // the midtones (1 is the ramp as aimed, 0.84 takes ~16% of the density
  // back): a negative's blue, not a phone's. Hue stays within a degree.
  density: 0.84,
};

// The print: what happens to the whole composited frame (plate, moved
// objects, live cables alike) before and after film.js, so an edit sits
// inside the photograph rather than on top of it. See DEVELOP_FS.
const PRINT = {
  // local contrast taken out of the plate: detail inside a surface (the
  // grime on the mast, the platform's paint) is pulled this share toward an
  // edge-aware local mean; steel against sky is an edge and keeps its line
  flatten: 0.42,
  flattenRange: 1.1, // stops: what counts as the same surface
  // halation: red-leaning light round wherever bright sky meets dark steel
  halation: 0.45,
  halationColor: [1, 0.2, 0.12],
  halationRadius: 0.0035, // of the frame height: a thin ring
  // the scan's black: steel lands near L* 12-15, a little teal, not crushed
  lift: [0.1, 0.12, 0.135],
  // grain, after everything (see FINAL_FS)
  grain: 0.17,
  grainSize: 1.15, // x 1/1100 of the frame height
};

const FILM = {
  ...FILM_PRESETS.summer,
  headroom: 2.6,
  // the ring is the print's own (above); film.js's would tint the clear sky
  halation: 0,
  // Pro-Mist diffusion: cloud light veils into the steel and rolls off
  bloom: 0.27,
  softness: 0.75,
  contrast: 1.14,
  shoulder: 0.9,
  whitePoint: 1.35,
  toe: 0,
  // colour density comes from the sky grade, not from a global push
  saturation: 1.0,
  blueDepth: 0,
  grain: 0,
  vignette: 0.16,
};

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

// The print, drawn over the whole canvas: uv over the photo with y down,
// running past 0..1 outside the print, where the photo's edge is extended
// (and the coverage is 0) so the film's diffusion sees more of the photo at
// the print's edge rather than the paper, which would veil it white.
const PRINT_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uPrint;   // x, y, w, h in device px, y down
uniform vec2 uView;
out vec2 vUv;
void main() {
  vec2 px = vec2(aPos.x, 1.0 - aPos.y) * uView;
  vUv = (px - uPrint.xy) / uPrint.zw;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
uniform sampler2D uPlate;     // clean plate (sRGB texture: reads linear)
uniform sampler2D uFront;     // r coverage, g disparity, b shadow receiver
uniform sampler2D uSky;       // sky behind the front layer (sRGB)
uniform sampler2DArray uObj;  // the loose objects, straight alpha (sRGB)
uniform vec2 uSize;           // photo px
uniform float uF;
uniform vec2 uC;
uniform vec3 uN;              // card normal (horizontal, toward the lens)
uniform vec3 uSun;            // toward the sun
uniform float uSkyD;
uniform int uCount;
uniform int uOrder[${MAXK}];
uniform mat3 uHinv[${MAXK}];  // moved photo px -> original photo px
uniform float uDn[${MAXK}];   // card plane n.X = d, now
uniform float uDn0[${MAXK}];  // and at rest
uniform vec3 uT[${MAXK}];     // translation, camera space
uniform float uBias[${MAXK}];
uniform float uActive[${MAXK}];
uniform vec4 uRect[${MAXK}];  // crop rect in photo px
uniform vec2 uLayer;          // array layer size, px
uniform float uShadow;
uniform vec3 uSkylight;
uniform float uSeed;
uniform vec3 uSkyTop;         // sRGB, clear sky at the top edge
uniform vec3 uSkyLow;         // and at the bottom edge (toward the horizon)
uniform float uSkyCurve;
uniform sampler2D uClear;     // the plate's clear-sky luminance x2 (coarse)
uniform vec2 uCloudY;         // cloud starts this far above the clear sky; unmix contrast
uniform vec3 uWarmCloud;      // linear, relative
uniform vec3 uUnderBlue;      // linear, relative
uniform vec3 uUnder;          // luminance range of the underside tint, amount
uniform float uGrade;
uniform float uDensity;      // exponent on the graded sky's midtones
uniform sampler2D uWire;      // the live cables: a coverage, r disparity x coverage
uniform vec3 uCable;          // their colour, linear
uniform vec4 uPinA[${MAXK}];  // pinned member: mast end at rest (photo px), its axis at rest
uniform vec4 uPinB[${MAXK}];  // its axis now, length at rest, length now (0: not a pin)
uniform vec3 uPinC[${MAXK}];  // its mast end now (the clamp, slid along the mast); its scale now
uniform float uPinEnd[${MAXK}];
uniform int uSpanK;           // the span's layer (-1: none)
uniform vec4 uSpanN;          // its plane: n.X = d
uniform vec3 uSpanO;          // origin on it (the pole's edge), camera space
uniform vec3 uSpanG;          // the girder's axis
uniform vec3 uSpanUp;         // the vertical
uniform vec4 uSpanCut;        // fixed end s = x + y h; z the pole's travel along the axis; w G.UP
out vec4 o;

vec4 objLod(int k, vec2 q, float lod) {
  vec2 t = (q - uRect[k].xy) / uLayer;
  vec2 hi = (uRect[k].zw - uRect[k].xy) / uLayer;
  float inside = step(0.0, t.x) * step(0.0, t.y) * step(t.x, hi.x) * step(t.y, hi.y);
  return textureLod(uObj, vec3(t, float(k)), lod) * inside;
}

// Matte of card k where the ray from P toward the sun crosses it, blurred
// by how far it travelled (the sun is a disc, not a point).
float castBy(int k, vec3 P, float dn, vec3 t) {
  float sd = dot(uN, uSun);
  if (abs(sd) < 1e-3) return 0.0;
  float s = (dn - dot(uN, P)) / sd;
  if (s <= 0.0) return 0.0;
  vec3 Q0 = P + s * uSun - t;
  if (Q0.z < 0.05) return 0.0;
  vec2 q = uF * Q0.xy / Q0.z + uC;
  float rpx = s * 0.022 * uF / Q0.z + 1.5;
  return objLod(k, q, log2(rpx)).a;
}

// Contact: a card close in front of a surface darkens it softly round its
// silhouette, fading with the gap.
float contactBy(int k, vec3 P, vec2 p, float dn, mat3 Hinv) {
  float gap = dn - dot(uN, P);   // > 0: the surface is behind the card
  if (gap <= 0.0) return 0.0;
  float z = P.z;
  float g = gap / (0.14 * z);
  vec3 h = Hinv * vec3(p, 1.0);
  // tight and dark where it nearly touches, wider and fainter further off
  float a = objLod(k, h.xy / h.z, 2.5 + 3.0 * clamp(g, 0.0, 1.0)).a;
  return a * exp(-g * 1.6);
}

vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// The sky's own density, in place of a global saturation push: wherever the
// plate is sky (the front layer's matte, the clean plate where it is empty),
// the clear blue is rebuilt as a dense cobalt that deepens with height in the
// frame, and the cloud keeps its luminance but goes warm-neutral, its
// undersides lit by that blue. Steel, cable and the loose objects never pass
// through here.
vec3 gradeSky(vec3 c, vec2 uv) {
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // How much of the pixel is cloud: a linear unmix on luminance between the
  // plate's own clear blue here and the dimmest cloud. (Luminance, not
  // chroma: the plate's colour is coarser than its drawing, and a chroma key
  // blotches.) A little contrast on it, so thin haze stays sky.
  float ySky = 0.5 * texture(uClear, uv).r;
  float yCl = ySky + uCloudY.x;
  float w = clamp((Y - ySky) / (yCl - ySky), 0.0, 1.0);
  w = mix(w, w * w * (3.0 - 2.0 * w), uCloudY.y);
  // clear sky: the ramp, deepest at the top, keeping a little of the plate's
  // own modulation
  vec3 tgt = toLin(mix(uSkyTop, uSkyLow, pow(uv.y, uSkyCurve)));
  vec3 S = tgt * clamp(pow(Y / ySky, 0.6), 0.75, 1.0);
  // cloud at its own luminance (within the unmix range it is the dimmest
  // cloud), warm-neutral where lit, skylight blue in its shadowed undersides
  float yc = max(Y, yCl);
  float under = (1.0 - smoothstep(uUnder.x, uUnder.y, yc)) * uUnder.z;
  vec3 tint = mix(uWarmCloud, uUnderBlue, under);
  vec3 C = yc * tint / dot(tint, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = mix(S, C, w);
  // density held back in the midtones (the clear blue and the cloud's
  // shadowed undersides), the brightest cloud left where it is
  float yg = dot(g, vec3(0.2126, 0.7152, 0.0722));
  float mid = smoothstep(0.01, 0.06, yg) * (1.0 - smoothstep(0.45, 0.8, yg));
  return pow(max(g, 0.0), vec3(mix(1.0, uDensity, mid)));
}

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423) + uSeed);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = clamp(vUv, 0.0, 1.0);
  float cover = step(0.0, vUv.x) * step(0.0, vUv.y) * step(vUv.x, 1.0) * step(vUv.y, 1.0);
  vec2 p = uv * uSize;
  vec3 ray = vec3((p - uC) / uF, 1.0);
  vec4 fr = texture(uFront, uv);
  float aF = fr.r;
  float dF = fr.g;
  float recv = fr.b;
  vec3 plate = texture(uPlate, uv).rgb;
  vec3 skyc = texture(uSky, uv).rgb;
  bool thin = aF < 0.02;
  vec3 B = thin ? plate : skyc;
  B = mix(B, gradeSky(B, uv), uGrade);
  vec3 Fpm = thin ? vec3(0.0) : plate - (1.0 - aF) * skyc;

  // shadows that the moved objects now throw on the street (only what
  // changed from the photo: at rest this is zero)
  float zF = 1.0 / max(dF - uSkyD, 0.02);
  vec3 PF = ray * zF;
  float shF = 0.0;
  if (recv > 0.01) {
    for (int k = 0; k < ${MAXK}; k++) {
      if (k >= uCount) break;
      if (uActive[k] < 0.5) continue;
      float now = max(castBy(k, PF, uDn[k], uT[k]), 0.8 * contactBy(k, PF, p, uDn[k], uHinv[k]));
      float rest = max(castBy(k, PF, uDn0[k], vec3(0.0)), 0.8 * contactBy(k, PF, p, uDn0[k], mat3(1.0)));
      shF = 1.0 - (1.0 - shF) * (1.0 - max(now - rest, 0.0));
    }
  }
  // a surface already in shade has little sun left to lose
  float lumP = dot(plate, vec3(0.2126, 0.7152, 0.0722));
  float sunlit = smoothstep(0.03, 0.22, lumP);
  Fpm *= mix(vec3(1.0), uSkylight, clamp(shF * recv * sunlit * uShadow, 0.0, 1.0));

  // the live cables, and where they sit between the front layer and the
  // cards (see WIRE_MARGIN)
  vec4 wv = texelFetch(uWire, ivec2(gl_FragCoord.xy), 0);
  float aW = clamp(wv.a, 0.0, 1.0);
  float dW = aW > 1e-4 ? wv.r / wv.a + ${WIRE_MARGIN.toFixed(3)} : 0.0;
  bool frontFirst = dF <= dW;
  float dA = min(dF, dW);
  float dB = max(dF, dW);
  vec3 col = B;
  float n1 = 0.0;
  float n2 = 0.0;
  for (int i = 0; i < ${MAXK}; i++) {
    if (i >= uCount) break;
    int k = uOrder[i];
    vec2 q;
    if (k == uSpanK) {
      // the girder's last bay: found on its own plane, then its distance
      // along the axis stretched between the fixed end (the cut, s_in) and
      // the pole's edge (s = 0 at rest, the travel now), where the clamp
      // carries it on rigidly
      vec3 X = ray * (uSpanN.w / dot(uSpanN.xyz, ray));
      vec3 Y = X - uSpanO;
      float ga = dot(Y, uSpanG);
      float ub = dot(Y, uSpanUp);
      float gu = uSpanCut.w;
      float det = 1.0 - gu * gu;
      float s1 = (ga - gu * ub) / det;
      float hh = (ub - gu * ga) / det;
      float si = uSpanCut.x + uSpanCut.y * hh;
      float dl = uSpanCut.z;
      float s0 = s1 < si ? s1 : (s1 >= dl ? s1 - dl : si - (s1 - si) * si / max(dl - si, 1e-4));
      vec3 X0 = X - (s1 - s0) * uSpanG;
      q = uF * X0.xy / X0.z + uC;
    } else if (uPinB[k].z > 0.0) {
      // a pinned member: from its clamp along its axis now, back to where
      // that lies on it at rest. Scaled as a whole (w: section, fittings
      // and length alike) while its length now is w times its own; only
      // past that does the bar between the fittings take up a difference
      vec2 a = uPinA[k].xy;
      vec2 e0 = uPinA[k].zw;
      vec2 e1 = uPinB[k].xy;
      float L0 = uPinB[k].z;
      float L1 = uPinB[k].w;
      float w = uPinC[k].z;
      vec2 d = p - uPinC[k].xy;
      float s1 = dot(d, e1);
      float r = dot(d, vec2(-e1.y, e1.x)) / w;
      float e = min(uPinEnd[k] * w, 0.5 * L1);
      float s0 = s1 < e ? s1 / w : (s1 > L1 - e ? L0 - (L1 - s1) / w : e / w + (s1 - e) * (L0 - 2.0 * e / w) / max(L1 - 2.0 * e, 1e-3));
      q = a + e0 * s0 + vec2(-e0.y, e0.x) * r;
    } else {
      vec3 h = uHinv[k] * vec3(p, 1.0);
      q = h.xy / h.z;
    }
    vec2 t = (q - uRect[k].xy) / uLayer;
    vec2 hi = (uRect[k].zw - uRect[k].xy) / uLayer;
    vec4 ob = textureGrad(uObj, vec3(t, float(k)), dFdx(t), dFdy(t));
    ob.a *= step(0.0, t.x) * step(0.0, t.y) * step(t.x, hi.x) * step(t.y, hi.y);
    // the card's own depth here
    float zk = uDn[k] / dot(uN, ray);
    float Dk = uSkyD + 1.0 / zk + uBias[k];
    if (n1 < 0.5 && Dk > dA) {
      col = frontFirst ? Fpm + (1.0 - aF) * col : mix(col, uCable, aW);
      n1 = 1.0;
    }
    if (n2 < 0.5 && Dk > dB) {
      col = frontFirst ? mix(col, uCable, aW) : Fpm + (1.0 - aF) * col;
      n2 = 1.0;
    }
    if (ob.a < 0.002) continue;
    // shadows the other cards throw on this one (change from the photo)
    float sh = 0.0;
    vec3 Pk = ray * zk;
    vec3 Pk0 = Pk - uT[k];
    for (int j = 0; j < ${MAXK}; j++) {
      if (j >= uCount) break;
      if (j == k || (uActive[j] < 0.5 && uActive[k] < 0.5)) continue;
      float now = castBy(j, Pk, uDn[j], uT[j]);
      float rest = castBy(j, Pk0, uDn0[j], vec3(0.0));
      sh = 1.0 - (1.0 - sh) * (1.0 - max(now - rest, 0.0));
    }
    float lo = dot(ob.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = ob.rgb * mix(vec3(1.0), uSkylight, clamp(sh * smoothstep(0.03, 0.22, lo) * uShadow, 0.0, 1.0));
    col = c * ob.a + (1.0 - ob.a) * col;
  }
  if (n1 < 0.5) col = frontFirst ? Fpm + (1.0 - aF) * col : mix(col, uCable, aW);
  if (n2 < 0.5) col = frontFirst ? mix(col, uCable, aW) : Fpm + (1.0 - aF) * col;
  vec3 s = toSrgb(col);
  s += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 7.3) - 1.0) / 255.0;
  o = vec4(s, cover);
}`;

// The development, between the composite and film.js, on the whole frame:
// whatever is in it (plate, a moved card, a live cable) goes through the
// same optics, so nothing pasted keeps a digital edge the plate lacks.
//  1. Local contrast out. The source is a sharpened digital file, and its
//     surfaces (the mast's grime, the platform's paint) carry a crunch film
//     never had. Each pixel's log luminance is pulled toward an edge-aware
//     local mean (two rings at ~6 and ~14 px, weighted by how near they are
//     in stops), so texture inside a surface flattens while steel against
//     sky, several stops apart, keeps its line and grows no halo.
//  2. Halation: light from the bright sky and cloud round a pixel, at a thin
//     ring's radius, comes back through the red layer; it shows only where
//     the pixel itself is dark, so it rims the steel and leaves the sky's
//     hue alone.
const DEVELOP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;   // the composited frame: sRGB in RGBA8, mipmapped
uniform vec2 uTexel;
uniform float uPx;          // device px per px of a 1600 px tall frame
uniform float uFlatten;
uniform float uRange;
uniform float uHal;
uniform vec3 uHalColor;
uniform float uHalR;        // ring radius, device px
out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 at(vec2 off, float lod) {
  return toLin(textureLod(uScene, vUv + off * uTexel, lod).rgb);
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 s = textureLod(uScene, vUv, 0.0);
  vec3 c = toLin(s.rgb);
  float y = dot(c, LUMA);
  float ly = log2(y + 0.003);

  float acc = ly;
  float wsum = 1.0;
  float lodF = log2(max(uPx * 3.0, 1.0));
  for (int i = 0; i < 16; i++) {
    float outer = i >= 8 ? 1.0 : 0.0;
    float a = float(i) * 0.7853982 + outer * 0.3926991;
    vec2 off = vec2(cos(a), sin(a)) * mix(6.0, 14.0, outer) * uPx;
    float ln = log2(dot(at(off, lodF), LUMA) + 0.003);
    float d = (ln - ly) / uRange;
    float w = exp(-d * d);
    acc += w * ln;
    wsum += w;
  }
  c *= exp2((acc / wsum - ly) * uFlatten);
  y = dot(c, LUMA);

  // How much of the ring is bright decides where it lands: half (the
  // steel's edge against the sky) takes the full ring; all of it (a cable,
  // a hairline wholly inside the sky) keeps its own dark blue-grey and
  // only a trace of red, as herb's wires do; none (deep in the mast) nothing.
  float yr = 0.0;
  float lit = 0.0;
  float lodH = log2(max(uHalR * 0.6, 1.0));
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    float r = uHalR * (i % 2 == 0 ? 1.0 : 1.8);
    float yi = dot(at(vec2(cos(a), sin(a)) * r, lodH), LUMA);
    yr += yi;
    lit += smoothstep(0.04, 0.1, yi);
  }
  yr /= 12.0;
  lit /= 12.0;
  float edge = mix(0.04, 1.0, 1.0 - smoothstep(0.3, 0.72, lit)) * smoothstep(0.0, 0.15, lit);
  float src = smoothstep(0.03, 0.2, yr) * yr;
  float dark = 1.0 - smoothstep(0.02, 0.12, y);
  c += uHalColor * src * dark * edge * uHal;

  vec3 e = toSrgb(c) + (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 5.1) - 1.0) / 255.0;
  o = vec4(e, s.a);
}`;

// After film.js: the scan's lifted black, then grain, the last thing to
// touch the print, so it lies over the moved objects and the plate alike.
// The grain is clumps of silver at about 1/1100 of the frame height, three
// octaves of value noise weighted by the emulsion's MTF (a Lorentzian,
// 1 / (1 + (f / f50)^2), f50 at the clump size): the coarse clumps pass,
// the finest roll off, so no single device pixel sparkles the way a
// digital noise does. Strongest in the mids, thinner in the highlights,
// mostly monochrome with a little dye. It is redrawn at 24 fps.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFilm;
uniform sampler2D uScene;
uniform vec3 uPaper;
uniform vec3 uLift;
uniform float uGrain;
uniform float uGrainPx;
uniform float uSeed;
uniform float uOpen;   // the opening's overexposure still to come off (1 at first)
out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y) - 0.5;
}
void main() {
  float cov = texture(uScene, vUv).a;
  vec3 f = texture(uFilm, vUv).rgb;
  // a toe, not a veil: the black comes up, the sky's midtones barely move
  float yf = clamp(dot(f, LUMA), 0.0, 1.0);
  f += uLift * pow(1.0 - yf, 6.0);
  // the opening: a print blown past its shoulder has little colour left
  // in it, only a white-blue cast (the sky's), and the steel comes up
  // grey out of it before the blue does
  float yo = dot(f, LUMA);
  f = mix(f, vec3(yo), 0.85 * uOpen);
  f = mix(f, vec3(0.9, 0.945, 1.0), 0.5 * uOpen * uOpen);

  vec2 gp = gl_FragCoord.xy / uGrainPx + uSeed * vec2(17.13, 31.71);
  // octaves at 0.5x, 1x, 2x the clump frequency; MTF weights 0.8, 0.5, 0.2
  float g = (0.8 * vnoise(gp * 0.5 + 3.1) + 0.5 * vnoise(gp) + 0.2 * vnoise(gp * 2.0 + 7.7)) / 0.97;
  vec3 gc = vec3(vnoise(gp * 0.7 + 41.0), vnoise(gp * 0.7 + 83.0), vnoise(gp * 0.7 + 127.0));
  float ly = dot(f, LUMA);
  float amp = uGrain * 0.22 * (0.3 + 0.7 * smoothstep(0.05, 0.3, ly) * (1.0 - 0.6 * smoothstep(0.5, 0.95, ly)));
  f += (vec3(g) + gc * 0.35) * amp;
  f += (hash(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  o = vec4(mix(uPaper, clamp(f, 0.0, 1.0), cov), 1.0);
}`;

// The live cables, drawn as strips in device px into their own target:
// coverage in a (a box of the cable's width, antialiased over a px, faded
// in over 6 px from the fixed end where the plate's cable hands over) and
// disparity x coverage in r, so overlapping cables keep the nearer's depth
// roughly and their coverage adds like film.
const WIRE_VS = `#version 300 es
layout(location=0) in vec2 aPos;    // device px, y down
layout(location=1) in vec4 aWire;   // across (device px), half width, from a, from b (photo px)
layout(location=2) in vec2 aCov;    // coverage, disparity
uniform vec2 uView;
out vec4 vWire;
out vec2 vCov;
void main() {
  vWire = aWire;
  vCov = aCov;
  gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0);
}`;

const WIRE_FS = `#version 300 es
precision highp float;
in vec4 vWire;
in vec2 vCov;
out vec4 o;
void main() {
  float d = abs(vWire.x);
  float hw = vWire.y;
  float wd = max(2.0 * hw, 1.0);
  float cov = vCov.x * (2.0 * hw / wd) * clamp(0.5 * wd + 0.5 - d, 0.0, 1.0);
  cov *= smoothstep(-3.0, 3.0, vWire.z) * smoothstep(-3.0, 3.0, vWire.w);
  o = vec4(cov * vCov.y, 0.0, 0.0, cov);
}`;

// ---------------------------------------------------------------- small math
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
// Past a limit the hand meets resistance, like a held rubber band.
function rubber(v, lo, hi, k = 0.32) {
  if (v < lo) return lo - (lo - v) * k;
  if (v > hi) return hi + (v - hi) * k;
  return v;
}

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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function pixels(bm) {
  const c = document.createElement("canvas");
  c.width = bm.width;
  c.height = bm.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(bm, 0, 0);
  return x.getImageData(0, 0, bm.width, bm.height).data;
}

// The plate's clear-sky luminance, as a coarse field: per cell the dim end of
// the sky's luminance (the blue between the clouds), spread from cells that
// are all cloud by a min, then smoothed. Linear luminance x2, in a byte.
function clearSky(px, w, h) {
  const C = 25;
  const gw = Math.ceil(w / C);
  const gh = Math.ceil(h / C);
  const L = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  let g = new Float32Array(gw * gh);
  const vals = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      vals.length = 0;
      for (let y = gy * C; y < Math.min(h, gy * C + C); y += 2) {
        for (let x = gx * C; x < Math.min(w, gx * C + C); x += 2) {
          const i = (y * w + x) * 4;
          vals.push(0.2126 * L[px[i]] + 0.7152 * L[px[i + 1]] + 0.0722 * L[px[i + 2]]);
        }
      }
      vals.sort((a, b) => a - b);
      g[gy * gw + gx] = vals[Math.floor(vals.length * 0.1)];
    }
  }
  const pass = (f) => {
    const o = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const n = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) n.push(g[clamp(y + dy, 0, gh - 1) * gw + clamp(x + dx, 0, gw - 1)]);
        }
        o[y * gw + x] = f(n);
      }
    }
    g = o;
  };
  pass((n) => Math.min(...n));
  for (let i = 0; i < 3; i++) pass((n) => n.reduce((a, b) => a + b, 0) / n.length);
  const data = new Uint8Array(gw * gh);
  for (let i = 0; i < data.length; i++) data[i] = clamp(Math.round(g[i] * 2 * 255), 0, 255);
  return { data, w: gw, h: gh };
}

export async function createRearrange(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const meta = await (await fetch(`${ASSET}meta.json`)).json();
  const OBJ = meta.objects.slice(0, MAXK);
  const K = OBJ.length;
  const PINS = (meta.pins ?? []).slice(0, MAXK - K);
  const WIRES = meta.wires ?? [];
  const SPANS = (meta.spans ?? []).slice(0, Math.max(0, Math.min(1, MAXK - K - PINS.length)));
  const SPAN0 = K + PINS.length; // the span's layer
  const NL = SPAN0 + SPANS.length; // layers: the objects, the pins, the span
  const [PW, PH] = meta.size;
  const F = meta.f;
  const [CX, CY] = meta.c;
  const UP = meta.up;
  const N = meta.toward;
  let SUN = meta.sun;
  if (num("sunAz") != null || num("sunEl") != null) {
    // rebuild from azimuth (from the lens, toward the right) and elevation
    const fwd = N.map((v) => -v);
    const right = [fwd[1] * UP[2] - fwd[2] * UP[1], fwd[2] * UP[0] - fwd[0] * UP[2], fwd[0] * UP[1] - fwd[1] * UP[0]];
    const rl = Math.hypot(...right);
    const r = right.map((v) => -v / rl);
    const az = ((num("sunAz") ?? -60) * Math.PI) / 180;
    const el = ((num("sunEl") ?? 58) * Math.PI) / 180;
    SUN = [0, 1, 2].map((i) => Math.cos(el) * (Math.cos(az) * N[i] + Math.sin(az) * r[i]) + Math.sin(el) * UP[i]);
  }
  const SKYD = meta.skyD;

  const [plateBm, frontBm, skyBm, ...objBms] = await Promise.all([
    loadBitmap(`${ASSET}plate.webp`),
    loadBitmap(`${ASSET}front.webp`),
    loadBitmap(`${ASSET}sky.webp`),
    ...OBJ.map((_, k) => loadBitmap(`${ASSET}o${k}.webp`)),
    ...PINS.map((_, i) => loadBitmap(`${ASSET}o${K + i}.webp`)),
    ...SPANS.map((_, i) => loadBitmap(`${ASSET}o${SPAN0 + i}.webp`)),
  ]);
  // CPU copies for picking: each object's matte, and the front layer
  const objA = [...objBms.slice(0, K), ...objBms.slice(SPAN0)].map((bm) => {
    const px = pixels(bm);
    const a = new Uint8Array(bm.width * bm.height);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
    return { a, w: bm.width, h: bm.height };
  });
  const frontPx = pixels(frontBm);
  const clear = clearSky(pixels(skyBm), skyBm.width, skyBm.height);

  // ---- textures
  const tex2d = (bm, internal, mips) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const plateTex = tex2d(plateBm, gl.SRGB8_ALPHA8, true);
  const frontTex = tex2d(frontBm, gl.RGBA8, false);
  const skyTex = tex2d(skyBm, gl.SRGB8_ALPHA8, false);
  const clearTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, clearTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, clear.w, clear.h, 0, gl.RED, gl.UNSIGNED_BYTE, clear.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const LW = Math.max(...objBms.map((b) => b.width));
  const LH = Math.max(...objBms.map((b) => b.height));
  const objTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, objTex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, LW, LH, NL, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  objBms.forEach((bm, k) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, bm.width, bm.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, bm));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  for (const bm of [plateBm, frontBm, skyBm, ...objBms]) bm.close?.();

  const scene = compile(gl, PRINT_VS, SCENE_FS);
  const dev = compile(gl, QUAD_VS, DEVELOP_FS);
  const fin = compile(gl, QUAD_VS, FINAL_FS);
  const wireP = compile(gl, WIRE_VS, WIRE_FS);
  // their colour: the cables' own, measured where each one is solid
  const cableCol = lin([0, 1, 2].map((i) => {
    const v = WIRES.map((w) => w.col[i]).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 0.1;
  }));
  // vertex buffer for the cable strips: 8 floats a vertex, 2 a point
  const WSTRIDE = 8;
  const wireData = new Float32Array(Math.max(1, WIRES.length) * SEG * 2 * WSTRIDE);
  const wireBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wireData.byteLength, gl.DYNAMIC_DRAW);
  const wireVao = gl.createVertexArray();
  gl.bindVertexArray(wireVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, WSTRIDE * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, WSTRIDE * 4, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, WSTRIDE * 4, 24);
  gl.bindVertexArray(null);
  // half-float target where it can be rendered to (the disparity needs more
  // than 8 bits at a cable's antialiased edge)
  const floatTarget = !!gl.getExtension("EXT_color_buffer_float");
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const target = (half = false) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };
  let sceneT = null;
  let devT = null;
  let filmT = null;
  let wireT = null;
  let dirty = true;
  const build = () => {
    for (const t of [sceneT, devT, filmT, wireT]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    sceneT = target();
    // the development reads the composite through its mip chain
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    devT = target();
    filmT = target();
    wireT = target(floatTarget);
    film.resize(stage.canvas.width, stage.canvas.height);
    dirty = true;
  };
  stage.onResize(build);

  // ---- layout: the photograph fills the view (cover), the sky to every
  // edge. Where the view is narrower than the frame it is cropped round
  // the masts (FOCUS), never past the photo's own edge.
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const dpr = stage.dpr;
    const sc = Math.max(W / PW, H / PH);
    const wd = Math.round(PW * sc * dpr);
    const hd = Math.round(PH * sc * dpr);
    const xd = Math.round(clamp(W * dpr * 0.5 - FOCUS[0] * wd, W * dpr - wd, 0));
    const yd = Math.round(clamp(H * dpr * 0.5 - FOCUS[1] * hd, H * dpr - hd, 0));
    return { x: xd / dpr, y: yd / dpr, w: wd / dpr, h: hd / dpr, dev: [xd, yd, wd, hd], s: wd / dpr / PW };
  };

  // ---- camera
  const kinv = (u, v) => [(u - CX) / F, (v - CY) / F, 1];
  const proj = (X) => [(F * X[0]) / X[2] + CX, (F * X[1]) / X[2] + CY];
  const gOf = (u, v) => dot3(UP, kinv(u, v)); // > 0 above the horizon
  const gradG = [UP[0] / F, UP[1] / F];

  // per object: rest card plane, and the live state
  const objs = OBJ.map((o) => {
    const zA = 1 / Math.max(o.D - SKYD, 0.02);
    const XA = kinv(...o.anchor).map((v) => v * zA);
    return {
      meta: o,
      dn0: dot3(N, XA),
      t: [0, 0, 0],
      lift: spring(0),
      pos: { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
      ref: null, // the held point: its 3D position, height, t when grabbed
      travel: null, // a fitting on its mast, a pole on its girder: how far it may slide (s along axis)
      axis: UP, // the line it slides on, if it does
      held: false,
      moving: false,
    };
  });

  // ---- live cables: the fixed end and the fastening in camera space, and
  // the length between them (the photo's cables hang taut: the length is
  // the rest chord). A span leaves its object roughly across the view, so
  // its fixed end is taken on the object's card at rest (the depth map has
  // no say on a 2 px line): a sideways move then lengthens or slackens it
  // as it would a real cable.
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
  const onCard = (o, u, v) => {
    const r = kinv(u, v);
    const zc = o.dn0 / dot3(N, r);
    return r.map((c) => c * zc);
  };
  const wires = WIRES.map((w) => {
    const o = w.k >= 0 && w.k < K ? objs[w.k] : null;
    if (!o) return { ...w, o };
    const A3 = onCard(o, ...w.a);
    const B30 = onCard(o, ...w.b);
    return { ...w, o, A3, B30, L0: len3(sub3(B30, A3)), dA: SKYD + 1 / A3[2] + o.meta.bias };
  });
  // a cable's points (photo px) and disparity at each, as its object is now
  const sagPts = new Float32Array(SEG * 3);
  const cablePoints = (w) => {
    if (!w.o) {
      for (let i = 0; i < SEG; i++) {
        const s = i / (SEG - 1);
        sagPts[i * 3] = w.a[0] + (w.b[0] - w.a[0]) * s;
        sagPts[i * 3 + 1] = w.a[1] + (w.b[1] - w.a[1]) * s;
        sagPts[i * 3 + 2] = w.aD;
      }
      return;
    }
    const t = w.o.t;
    const B3 = [w.B30[0] + t[0], w.B30[1] + t[1], w.B30[2] + t[2]];
    const C = sub3(B3, w.A3);
    const at = (s, h) => {
      const g = 4 * h * s * (1 - s);
      return [w.A3[0] + C[0] * s - UP[0] * g, w.A3[1] + C[1] * s - UP[1] * g, w.A3[2] + C[2] * s - UP[2] * g];
    };
    // brought closer than its length, it sags (straight down, a parabola
    // is a catenary at these spans) until its arc is that length again;
    // taken further, it pulls straight
    let h = 0;
    if (len3(C) < w.L0 * 0.9999) {
      const arc = (hh) => {
        let L = 0;
        let prev = w.A3;
        for (let i = 1; i <= 24; i++) {
          const P = at(i / 24, hh);
          L += len3(sub3(P, prev));
          prev = P;
        }
        return L;
      };
      let lo = 0;
      let hi = w.L0;
      for (let it = 0; it < 32; it++) {
        const mid = (lo + hi) / 2;
        if (arc(mid) < w.L0) lo = mid;
        else hi = mid;
      }
      h = lo;
    }
    const dB = cardD(w.o, ...mapPoint(w.o, t, w.b));
    for (let i = 0; i < SEG; i++) {
      const s = i / (SEG - 1);
      const P = proj(at(s, h));
      sagPts[i * 3] = P[0];
      sagPts[i * 3 + 1] = P[1];
      sagPts[i * 3 + 2] = w.dA + (dB - w.dA) * s;
    }
  };

  // the point of card k under photo point (u, v), and how it is held
  const refAt = (o, u, v) => {
    const r = kinv(u, v);
    const dn = o.dn0 + dot3(N, o.t);
    const z = dn / dot3(N, r);
    const X = r.map((c) => c * z);
    const X0 = [X[0] - o.t[0], X[1] - o.t[1], X[2] - o.t[2]];
    return { X, h: dot3(UP, X), t0: o.t.slice(), home: proj(X0), g0: gOf(...proj(X0)) };
  };

  // Keep the held point inside the print and its size within reason (both
  // with rubber), and the barrier's cut end below the frame.
  const constrain = (o, u, v) => {
    if (o.travel) return slideTo(o, u, v);
    const g0 = o.ref.g0;
    const g = gOf(u, v);
    const sRel = g / g0;
    const sC = rubber(sRel, S_MIN, S_MAX);
    if (sC !== sRel) {
      const dg = sC * g0 - g;
      const gl2 = gradG[0] * gradG[0] + gradG[1] * gradG[1];
      u += (dg * gradG[0]) / gl2;
      v += (dg * gradG[1]) / gl2;
    }
    u = rubber(u, 6, PW - 6);
    v = rubber(v, 6, PH - 6);
    const cut = o.meta.cut;
    if (cut) {
      // its cut end (at the frame's bottom edge in the photo) must stay out
      // of the frame: walk the held point up until it does
      for (let i = 0; i < 6; i++) {
        const t = translation(o, u, v, 0);
        const e = mapPoint(o, t, cut);
        if (e[1] >= PH + 1) break;
        v -= (PH + 2 - e[1]) * 0.9;
      }
    }
    return [u, v];
  };

  // A fitting clamped to its mast (meta "slide") only slides along it: the
  // held point moves on the vertical line through it, which in the photo
  // is the line toward the poles' vanishing point. The far pole (meta
  // "track") only slides along the girder clamped to it: the line toward
  // the chords' vanishing point. s is how far along that axis D. From an
  // image point on the line: the two projective equations
  // (p - c) (X + s D).z = f (X + s D).xy, least squares in s.
  const slideS = (X, [pu, pv], D) => {
    const a1 = F * X[0] - (pu - CX) * X[2];
    const b1 = (pu - CX) * D[2] - F * D[0];
    const a2 = F * X[1] - (pv - CY) * X[2];
    const b2 = (pv - CY) * D[2] - F * D[1];
    return (a1 * b1 + a2 * b2) / (b1 * b1 + b2 * b2);
  };
  const along = (X, s, D) => [X[0] + D[0] * s, X[1] + D[1] * s, X[2] + D[2] * s];
  // the point of the slide line nearest (u, v), kept within the travel
  // (rubber past it); travel is in s from rest
  const slideTo = (o, u, v) => {
    const X = o.ref.X;
    const D = o.axis;
    const p0 = proj(X);
    const p1 = proj(along(X, 0.05 * X[2], D));
    const dl = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const dx = (p1[0] - p0[0]) / dl;
    const dy = (p1[1] - p0[1]) / dl;
    const k = (u - p0[0]) * dx + (v - p0[1]) * dy;
    const s = slideS(X, [p0[0] + dx * k, p0[1] + dy * k], D);
    const s0 = dot3(D, o.ref.t0);
    // a clamp on a pole, a pole on its girder: past its travel it gives
    // only a little
    const sC = rubber(s0 + s, o.travel[0], o.travel[1], 0.12);
    return proj(along(X, sC - s0, D));
  };
  const liftOf = (o) => (o.travel ? 0 : LIFT);
  // its travel, given in the manifest as photo px its anchor may go up
  // (negative) and down from rest, as s along UP
  objs.forEach((o) => {
    const sl = o.meta.slide;
    if (!sl) return;
    const Xa = onCard(o, ...o.meta.anchor);
    const sOf = (dv) => {
      const pv = o.meta.anchor[1] + dv - CY;
      return (F * Xa[1] - pv * Xa[2]) / (pv * UP[2] - F * UP[1]);
    };
    const a = sOf(sl[0]);
    const b = sOf(sl[1]);
    o.travel = [Math.min(a, b), Math.max(a, b)];
  });

  const translation = (o, u, v, lift) => {
    if (o.travel) {
      const s = slideS(o.ref.X, [u, v], o.axis);
      return [0, 1, 2].map((i) => o.ref.t0[i] + o.axis[i] * s);
    }
    const r = kinv(u, v);
    const g = dot3(UP, r);
    const X = r.map((c) => (c * o.ref.h) / Math.max(g, 1e-3) * (1 - lift));
    return [0, 1, 2].map((i) => o.ref.t0[i] + X[i] - o.ref.X[i]);
  };
  // where the original photo point (u, v) of card o lands under translation t
  const mapPoint = (o, t, [u, v]) => {
    const r = kinv(u, v);
    const z = o.dn0 / dot3(N, r);
    return proj([r[0] * z + t[0], r[1] * z + t[1], r[2] * z + t[2]]);
  };
  // The platform's strut, brace and beams are steel: they keep their
  // angles and are never bent or swung into each other. Each is bolted to
  // a band clamp round the mast, and when the deck goes the clamp slides
  // along the mast (the line toward the poles' vertical vanishing point)
  // to where the member, at its own angle, still meets the deck's fitting,
  // so the frame rides up or down the mast with the deck. Brought nearer
  // the lens the deck grows, and the members grow with it as a whole
  // (section and fittings too, by the deck's own scale at the fitting);
  // only the part of a move that takes the deck further out from the mast
  // than that draws the bar between the fittings out. Rest mast end a,
  // deck end b at rest and b1 now: the clamp now and the member's length.
  const VPU = [(F * UP[0]) / UP[2] + CX, (F * UP[1]) / UP[2] + CY];
  const collar = (a, b, b1) => {
    let mx = VPU[0] - a[0];
    let my = VPU[1] - a[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    // how far out from the mast the deck's fitting stands, at rest and now
    const h0 = (b[0] - a[0]) * my - (b[1] - a[1]) * mx;
    const h1 = (b1[0] - a[0]) * my - (b1[1] - a[1]) * mx;
    // a deck pushed in onto the mast stops taking its frame in
    const k = Math.max(h1 / h0, 0.3);
    const c = [b1[0] - (b[0] - a[0]) * k, b1[1] - (b[1] - a[1]) * k];
    // kept on the mast's line
    const off = (c[0] - a[0]) * my - (c[1] - a[1]) * mx;
    c[0] -= off * my;
    c[1] += off * mx;
    return [c, Math.max(Math.hypot(b1[0] - c[0], b1[1] - c[1]), 1e-3)];
  };
  // how much nearer (larger) the card's point (u, v) is under translation t
  const scaleAt = (o, t, [u, v]) => {
    const r = kinv(u, v);
    const z = o.dn0 / dot3(N, r);
    return z / Math.max(z + t[2], 1e-3);
  };
  // H^-1 = K (I - t n^T / (d + n.t)) K^-1, column-major for GLSL
  const hinv = (o) => {
    const t = o.t;
    const d = o.dn0 + dot3(N, t);
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - (t[i] * N[j]) / d));
    const Kc = [
      [F, 0, CX],
      [0, F, CY],
      [0, 0, 1],
    ];
    const Ki = [
      [1 / F, 0, -CX / F],
      [0, 1 / F, -CY / F],
      [0, 0, 1],
    ];
    const mul = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
    const R = mul(mul(Kc, M), Ki);
    return [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
  };
  const applyH = (m, u, v) => {
    const x = m[0] * u + m[3] * v + m[6];
    const y = m[1] * u + m[4] * v + m[7];
    const w = m[2] * u + m[5] * v + m[8];
    return [x / w, y / w];
  };
  const cardD = (o, u, v) => SKYD + dot3(N, kinv(u, v)) / (o.dn0 + dot3(N, o.t)) + o.meta.bias;

  // The far pole and the girder's tip are one assembly: the pole slides
  // only along the girder's axis (meta "track": its chords' vanishing point,
  // and the travel along it, in camera units, that keeps the clamp on the
  // girder's last bay), and never so far in that its cut end, at the
  // frame's bottom edge, comes into view.
  objs.forEach((o) => {
    const tr = o.meta.track;
    if (!tr) return;
    const D = kinv(...tr.vp);
    const dl = Math.hypot(...D);
    o.axis = D.map((v) => v / dl);
    let lo = tr.range[0];
    const cut = o.meta.cut;
    if (cut) {
      const low = (s) => mapPoint(o, o.axis.map((v) => v * s), cut)[1] >= PH + 1;
      if (!low(lo)) {
        let a = lo;
        let b = 0;
        for (let i = 0; i < 30; i++) {
          const m = (a + b) / 2;
          if (low(m)) b = m;
          else a = m;
        }
        lo = b;
      }
    }
    o.travel = [lo, tr.range[1]];
  });

  // The girder's last bay (meta "spans"): drawn between its fixed end and
  // the pole it is clamped to (see the shader). Its depth is the pole's,
  // set back (to D at rest) behind the cables that cross it, which in the
  // photo run in front of the steel.
  const spans = SPANS.map((sp, i) => {
    const o = objs[sp.k];
    return { ...sp, o, layer: SPAN0 + i, A: objA[K + i], gu: dot3(sp.axis, UP), back: sp.D - o.meta.D };
  });
  const travelOf = (sp) => dot3(sp.axis, sp.o.t);
  // where photo point (u, v) of the bay, as it is drawn now, was in the photo
  const spanQ = (sp, u, v) => {
    const r = kinv(u, v);
    const n = sp.plane;
    const z = n[3] / (n[0] * r[0] + n[1] * r[1] + n[2] * r[2]);
    const X = r.map((c) => c * z);
    const Y = sub3(X, sp.origin);
    const ga = dot3(Y, sp.axis);
    const ub = dot3(Y, UP);
    const det = 1 - sp.gu * sp.gu;
    const s1 = (ga - sp.gu * ub) / det;
    const hh = (ub - sp.gu * ga) / det;
    const si = sp.cut[0] + sp.cut[1] * hh;
    const dl = travelOf(sp);
    const s0 = s1 < si ? s1 : s1 >= dl ? s1 - dl : si - ((s1 - si) * si) / Math.max(dl - si, 1e-4);
    return proj(X.map((c, i) => c - (s1 - s0) * sp.axis[i]));
  };

  // The nearest object whose matte is under photo point (u, v) and that is
  // not hidden there by something in front of it.
  const pick = (u, v) => {
    const iu = clamp(Math.round(u), 0, PW - 1);
    const iv = clamp(Math.round(v), 0, PH - 1);
    const fi = (iv * PW + iu) * 4;
    const aF = frontPx[fi] / 255;
    const dF = frontPx[fi + 1] / 255;
    let best = -1;
    let bestD = -1;
    objs.forEach((o, k) => {
      const [qx, qy] = applyH(hinv(o), u, v);
      const r = o.meta.rect;
      const x = Math.round(qx - r[0]);
      const y = Math.round(qy - r[1]);
      const A = objA[k];
      if (x < 0 || y < 0 || x >= A.w || y >= A.h) return;
      if (A.a[y * A.w + x] < 110) return;
      const D = cardD(o, u, v);
      if (aF > 0.6 && dF > D) return;
      if (D > bestD) {
        bestD = D;
        best = k;
      }
    });
    // the girder's bay is part of the pole that carries it
    for (const sp of spans) {
      const [qx, qy] = spanQ(sp, u, v);
      const x = Math.round(qx - sp.rect[0]);
      const y = Math.round(qy - sp.rect[1]);
      if (x < 0 || y < 0 || x >= sp.A.w || y >= sp.A.h || sp.A.a[y * sp.A.w + x] < 110) continue;
      const D = cardD(sp.o, u, v) + sp.back;
      if (aF > 0.6 && dF > D) continue;
      if (D > bestD) {
        bestD = D;
        best = sp.k;
      }
    }
    return best;
  };

  const toPhoto = (p) => {
    const L = layout();
    return [(p.x - L.x) / L.s, (p.y - L.y) / L.s];
  };

  // ---- still: ?move=k,dx,dy[;k,dx,dy]
  const held = q.get("move");
  const liftQ = num("lift");
  const setMove = (o, du, dv, liftTo) => {
    o.ref = refAt(o, ...o.meta.anchor);
    const [u, v] = constrain(o, o.meta.anchor[0] + du, o.meta.anchor[1] + dv);
    Object.assign(o.pos, { x: u, y: v, vx: 0, vy: 0, tx: u, ty: v });
    o.lift.x = o.lift.to = liftTo;
    o.t = translation(o, u, v, o.lift.x);
    o.moving = true;
  };
  if (held) {
    for (const part of held.split(/[;|_]/)) {
      const [k, dx, dy] = part.split(",").map(Number);
      if (!objs[k] || !Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      setMove(objs[k], dx * PW, dy * PH, liftQ ?? liftOf(objs[k]));
    }
  }
  // ?ev: the demo at its height, the same pose the springs carry it to
  const evQ = q.get("ev");
  const evS = evQ == null ? null : evQ === "" || !Number.isFinite(+evQ) ? 1 : clamp(+evQ, 0, 1);
  if (evS != null) setMove(objs[0], DEMO.du * PW * evS, DEMO.dv * PH * evS, liftQ ?? DEMO.lift * evS);
  // a still: no opening, no demo, no grain crawl
  const fixed = !!held || evS != null;
  const atQ = num("at");

  // ---- input
  let grab = null;
  let lastDown = { t: -1e9, x: 0, y: 0 };
  let touched = fixed;
  let born = performance.now();
  // the opening's demo: 0 waiting, 1 lifted, 2 done (or never: a still,
  // reduced motion, or a hand that came first)
  let hint = fixed || reduced ? 2 : 0;
  let liftedAt = 0;
  let upAt = 0;
  let shownUp = false;
  const sendHome = (o) => {
    o.pos.tx = o.ref.home[0];
    o.pos.ty = o.ref.home[1];
    o.lift.to = 0;
    o.moving = true;
  };

  const goHome = () => {
    for (const o of objs) {
      if (!o.ref) continue;
      o.held = false;
      sendHome(o);
    }
  };

  stage.on("down", (p, e) => {
    touched = true;
    // the first touch ends the demo: the platform is let go where it is
    // (or taken in hand, below)
    if (hint === 1) sendHome(objs[0]);
    hint = 2;
    // the event's own time: a busy frame must not stretch a double-tap
    const now = e?.timeStamp ?? performance.now();
    const dbl = now - lastDown.t < 320 && Math.hypot(p.x - lastDown.x, p.y - lastDown.y) < 28;
    lastDown = { t: now, x: p.x, y: p.y };
    if (dbl) {
      if (grab) objs[grab.k].held = false;
      grab = null;
      goHome();
      stage.canvas.style.cursor = "";
      return;
    }
    const [u, v] = toPhoto(p);
    const k = pick(u, v);
    if (k < 0) return;
    const o = objs[k];
    o.ref = refAt(o, u, v);
    Object.assign(o.pos, { x: u, y: v, vx: 0, vy: 0, tx: u, ty: v });
    o.held = true;
    o.moving = true;
    o.lift.to = liftOf(o);
    grab = { k, du: 0, dv: 0 };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("up", (p) => {
    if (!grab) return;
    const o = objs[grab.k];
    grab = null;
    o.held = false;
    // carry a little of the hand's speed, then settle (friction ~0.2 s)
    const L = layout();
    const [tu, tv] = constrain(o, o.pos.x + (p.vx / L.s) * 0.2, o.pos.y + (p.vy / L.s) * 0.2);
    o.pos.tx = tu;
    o.pos.ty = tv;
    o.pos.vx = p.vx / L.s;
    o.pos.vy = p.vy / L.s;
    o.lift.to = 0;
    stage.canvas.style.cursor = "grab";
  });
  stage.on("move", (p) => {
    if (grab) return;
    const [u, v] = toPhoto(p);
    const k = u >= 0 && v >= 0 && u < PW && v < PH ? pick(u, v) : -1;
    stage.canvas.style.cursor = k >= 0 ? "grab" : "";
  });

  // ---- draw
  const order = new Int32Array(MAXK);
  const drawWires = (L, w, h) => {
    const sx = L.dev[2] / PW;
    let n = 0;
    for (const wi of wires) {
      cablePoints(wi);
      const hw = (wi.w / 2) * sx;
      const ext = hw + 1.5;
      let along = 0;
      const total = (() => {
        let T = 0;
        for (let i = 1; i < SEG; i++) T += Math.hypot(sagPts[i * 3] - sagPts[i * 3 - 3], sagPts[i * 3 + 1] - sagPts[i * 3 - 2]);
        return T;
      })();
      for (let i = 0; i < SEG; i++) {
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(SEG - 1, i + 1);
        let tx = sagPts[i1 * 3] - sagPts[i0 * 3];
        let ty = sagPts[i1 * 3 + 1] - sagPts[i0 * 3 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        if (i > 0) along += Math.hypot(sagPts[i * 3] - sagPts[i * 3 - 3], sagPts[i * 3 + 1] - sagPts[i * 3 - 2]);
        const x = L.dev[0] + sagPts[i * 3] * sx;
        const y = L.dev[1] + sagPts[i * 3 + 1] * sx;
        // fade in from the fixed end; a cable fixed at both ends fades at both
        const fromB = wi.o ? 1e4 : total - along;
        for (const sgn of [-1, 1]) {
          wireData.set([x - ty * ext * sgn, y + tx * ext * sgn, ext * sgn, hw, along, fromB, wi.c, sagPts[i * 3 + 2]], n);
          n += WSTRIDE;
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, wireT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!wires.length) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(wireP.p);
    gl.uniform2f(wireP.u.uView, w, h);
    gl.bindVertexArray(wireVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, wireData, 0, n);
    for (let i = 0; i < wires.length; i++) gl.drawArrays(gl.TRIANGLE_STRIP, i * SEG * 2, SEG * 2);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  };
  const drawScene = () => {
    const L = layout();
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    drawWires(L, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(scene.p);
    gl.bindVertexArray(vao);
    const U = scene.u;
    gl.uniform4f(U.uPrint, ...L.dev);
    gl.uniform2f(U.uView, w, h);
    gl.uniform2f(U.uSize, PW, PH);
    gl.uniform1f(U.uF, F);
    gl.uniform2f(U.uC, CX, CY);
    gl.uniform3fv(U.uN, N);
    gl.uniform3fv(U.uSun, SUN);
    gl.uniform1f(U.uSkyD, SKYD);
    gl.uniform1i(U.uCount, NL);
    // far to near, by the card's disparity at its anchor; a pinned member
    // just behind the deck it holds up
    const ds = objs.map((o, k) => [k, cardD(o, ...applyHInvPoint(o, o.meta.anchor))]);
    PINS.forEach((pn, i) => ds.push([K + i, ds[pn.k][1] - 1e-4]));
    // the girder's bay just behind the pole that carries it (the pole's
    // face covers the chords' ends where they run onto it)
    spans.forEach((sp) => ds.push([sp.layer, ds[sp.k][1] - 1e-4]));
    ds.sort((a, b) => a[1] - b[1]);
    ds.forEach(([k], i) => (order[i] = k));
    gl.uniform1iv(U.uOrder, order);
    const H = new Float32Array(9 * MAXK);
    const dn = new Float32Array(MAXK);
    const dn0 = new Float32Array(MAXK);
    const T = new Float32Array(3 * MAXK);
    const bias = new Float32Array(MAXK);
    const act = new Float32Array(MAXK);
    const rect = new Float32Array(4 * MAXK);
    objs.forEach((o, k) => {
      H.set(hinv(o), k * 9);
      dn[k] = o.dn0 + dot3(N, o.t);
      dn0[k] = o.dn0;
      T.set(o.t, k * 3);
      bias[k] = o.meta.bias;
      act[k] = Math.hypot(...o.t) > 1e-5 ? 1 : 0;
      rect.set(o.meta.rect, k * 4);
    });
    const pinA = new Float32Array(4 * MAXK);
    const pinB = new Float32Array(4 * MAXK);
    const pinC = new Float32Array(3 * MAXK);
    const pinE = new Float32Array(MAXK);
    PINS.forEach((pn, i) => {
      const k = K + i;
      const o = objs[pn.k];
      const [ax, ay] = pn.a;
      const b1 = mapPoint(o, o.t, pn.b);
      const L0 = Math.hypot(pn.b[0] - ax, pn.b[1] - ay);
      const sc = scaleAt(o, o.t, pn.b);
      const [c, L1] = collar(pn.a, pn.b, b1);
      pinA.set([ax, ay, (pn.b[0] - ax) / L0, (pn.b[1] - ay) / L0], k * 4);
      pinB.set([(b1[0] - c[0]) / L1, (b1[1] - c[1]) / L1, L0, L1], k * 4);
      pinC.set([...c, sc], k * 3);
      pinE[k] = pn.end;
      H.set([1, 0, 0, 0, 1, 0, 0, 0, 1], k * 9);
      dn[k] = o.dn0 + dot3(N, o.t);
      dn0[k] = o.dn0;
      bias[k] = o.meta.bias;
      rect.set(pn.rect, k * 4);
    });
    let spanK = -1;
    spans.forEach((sp) => {
      const k = sp.layer;
      const o = sp.o;
      spanK = k;
      H.set([1, 0, 0, 0, 1, 0, 0, 0, 1], k * 9);
      dn[k] = o.dn0 + dot3(N, o.t);
      dn0[k] = o.dn0;
      bias[k] = o.meta.bias + sp.back;
      rect.set(sp.rect, k * 4);
      gl.uniform4f(U.uSpanN, ...sp.plane);
      gl.uniform3fv(U.uSpanO, sp.origin);
      gl.uniform3fv(U.uSpanG, sp.axis);
      gl.uniform3fv(U.uSpanUp, UP);
      gl.uniform4f(U.uSpanCut, sp.cut[0], sp.cut[1], travelOf(sp), sp.gu);
    });
    gl.uniform1i(U.uSpanK, spanK);
    gl.uniform4fv(U.uPinA, pinA);
    gl.uniform4fv(U.uPinB, pinB);
    gl.uniform3fv(U.uPinC, pinC);
    gl.uniform1fv(U.uPinEnd, pinE);
    gl.uniform3fv(U.uCable, cableCol);
    gl.uniformMatrix3fv(U.uHinv, false, H);
    gl.uniform1fv(U.uDn, dn);
    gl.uniform1fv(U.uDn0, dn0);
    gl.uniform3fv(U.uT, T);
    gl.uniform1fv(U.uBias, bias);
    gl.uniform1fv(U.uActive, act);
    gl.uniform4fv(U.uRect, rect);
    gl.uniform2f(U.uLayer, LW, LH);
    gl.uniform1f(U.uShadow, num("shadow") ?? 1);
    gl.uniform3fv(U.uSkylight, SKYLIGHT);
    gl.uniform1f(U.uSeed, 0.37);
    gl.uniform3fv(U.uSkyTop, SKY.top);
    gl.uniform3fv(U.uSkyLow, SKY.low);
    gl.uniform1f(U.uSkyCurve, SKY.curve);
    gl.uniform2fv(U.uCloudY, SKY.cloud);
    gl.uniform3fv(U.uWarmCloud, SKY.warm);
    gl.uniform3fv(U.uUnderBlue, SKY.under);
    gl.uniform3fv(U.uUnder, SKY.underRange);
    gl.uniform1f(U.uGrade, num("grade") ?? 1);
    gl.uniform1f(U.uDensity, SKY.density);
    const texs = [
      [gl.TEXTURE_2D, plateTex, U.uPlate],
      [gl.TEXTURE_2D, frontTex, U.uFront],
      [gl.TEXTURE_2D, skyTex, U.uSky],
      [gl.TEXTURE_2D, clearTex, U.uClear],
      [gl.TEXTURE_2D_ARRAY, objTex, U.uObj],
      [gl.TEXTURE_2D, wireT.tex, U.uWire],
    ];
    texs.forEach(([type, t, loc], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(type, t);
      gl.uniform1i(loc, i);
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };
  // the moved position of an object's anchor (for depth sorting)
  function applyHInvPoint(o, a) {
    return mapPoint(o, o.t, a);
  }

  // the composite -> the development (see DEVELOP_FS), ready for film.js
  const develop = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, devT.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(dev.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(dev.u.uScene, 0);
    gl.uniform2f(dev.u.uTexel, 1 / w, 1 / h);
    gl.uniform1f(dev.u.uPx, h / 1600);
    gl.uniform1f(dev.u.uFlatten, num("flatten") ?? PRINT.flatten);
    gl.uniform1f(dev.u.uRange, PRINT.flattenRange);
    gl.uniform1f(dev.u.uHal, num("halation") ?? PRINT.halation);
    gl.uniform3fv(dev.u.uHalColor, PRINT.halationColor);
    gl.uniform1f(dev.u.uHalR, Math.max(1.5, PRINT.halationRadius * h));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };

  const present = (seed, open) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(fin.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(fin.u.uFilm, 0);
    gl.uniform1i(fin.u.uScene, 1);
    gl.uniform3f(fin.u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform3fv(fin.u.uLift, PRINT.lift);
    gl.uniform1f(fin.u.uGrain, num("grain") ?? PRINT.grain);
    gl.uniform1f(fin.u.uGrainPx, Math.max(0.75, (stage.canvas.height / 1100) * PRINT.grainSize));
    gl.uniform1f(fin.u.uSeed, seed % 997);
    gl.uniform1f(fin.u.uOpen, open);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  let lastKey = "";
  let lastGrain = -1;
  let lastExp = -1;
  // A frame's GL work is fenced; while the GPU is still on the last one,
  // the next is not queued on top of it (the clock and the springs still
  // run). A machine that cannot keep up (software GL, a starved tab) then
  // drops frames instead of piling up seconds of them, and once it has
  // been behind for a while it stops the grain's 24 fps crawl: the print
  // redraws only when something moves.
  let fence = null;
  let behindSince = 0;
  let slow = 0;
  let still = false;
  let lastWall = 0;
  // The opening plays only on a machine that can show it. The first frame
  // is the developed print (drawn before the canvas fades in, so it is not
  // seen there); if the GPU has finished it within 0.6 s, the
  // clock restarts and the print comes up out of its white-blue. If not,
  // a machine that takes seconds a frame would hold the white-blue for
  // all of them: it keeps the photograph and skips the demo too.
  let opening = fixed ? "off" : atQ != null ? "on" : "pending";
  let firstAt = 0;
  const gpuBehind = () => {
    if (!fence) return false;
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return true;
    gl.deleteSync(fence);
    fence = null;
    return false;
  };
  const frame = (dt, t) => {
    // the stage caps dt, so the wall clock says how slow frames really are
    const wall = performance.now();
    const wallDt = lastWall ? (wall - lastWall) / 1000 : dt;
    slow = lastWall && wallDt > 0.2 ? slow + 1 : 0;
    lastWall = wall;
    if (slow >= 2) still = true;
    if (!sceneT) return;
    const behind = gpuBehind();
    if (opening === "pending" && firstAt) {
      if (!behind && wall - firstAt < 600) {
        opening = "on";
        born = wall;
      } else if (wall - firstAt >= 600) {
        opening = "off";
        if (hint === 0) hint = 2;
      }
    }
    const age = atQ ?? (wall - born) / 1000;
    const p = stage.pointer;
    // on a slow machine the springs run on the wall clock, so the demo
    // takes its own time however few frames show it
    const sdt = still ? Math.min(wallDt, 2) : dt;

    // The opening: the print develops out of an overexposed white-blue;
    // then the platform is lifted high off its mast toward the lens, held,
    // and let go, to show that the things in the photograph are loose.
    if (hint === 0 && opening === "on" && age > DEMO.at) {
      const o = objs[0];
      o.ref = refAt(o, ...o.meta.anchor);
      Object.assign(o.pos, { x: o.meta.anchor[0], y: o.meta.anchor[1], vx: 0, vy: 0 });
      const [tu, tv] = constrain(o, o.meta.anchor[0] + DEMO.du * PW, o.meta.anchor[1] + DEMO.dv * PH);
      o.pos.tx = tu;
      o.pos.ty = tv;
      o.lift.to = DEMO.lift;
      o.moving = true;
      liftedAt = age;
      hint = 1;
    } else if (hint === 1 && atQ == null) {
      // it holds once it is up (and has been seen up, however slow the
      // frames), then goes home
      const o = objs[0];
      const up = Math.hypot(o.pos.x - o.pos.tx, o.pos.y - o.pos.ty) < 3 && Math.abs(o.lift.x - o.lift.to) < 0.01;
      if (up && !upAt) upAt = age;
      if (upAt && shownUp && age > Math.max(upAt + DEMO.hold, liftedAt + 1.6)) {
        sendHome(o);
        hint = 2;
      }
    }
    // the print comes up out of a white-blue field: held there a moment,
    // then the steel and the cloud's shading come in, the sky last
    const expT = opening !== "on" ? 1 : reduced ? clamp(age / 0.3, 0, 1) : smoother(clamp((age - OPEN.hold) / OPEN.develop, 0, 1));
    const exposure = (FILM.exposure ?? 0) + OPEN.stops * (1 - expT);

    for (const o of objs) {
      if (!o.moving || !o.ref) continue;
      if (o.held && grab) {
        // 1:1 under the hand
        const [u, v] = constrain(o, ...toPhoto(p));
        o.pos.vx = (u - o.pos.x) / Math.max(dt, 1e-3);
        o.pos.vy = (v - o.pos.y) / Math.max(dt, 1e-3);
        o.pos.x = u;
        o.pos.y = v;
        stepSpring(o.lift, 22, 0.9, dt);
      } else if (!held) {
        const sx = { x: o.pos.x, v: o.pos.vx, to: o.pos.tx };
        const sy = { x: o.pos.y, v: o.pos.vy, to: o.pos.ty };
        stepSpring(sx, 15, 0.86, sdt);
        stepSpring(sy, 15, 0.86, sdt);
        o.pos.x = sx.x;
        o.pos.vx = sx.v;
        o.pos.y = sy.x;
        o.pos.vy = sy.v;
        // set down: a soft landing, slightly under-damped
        stepSpring(o.lift, 16, 0.78, sdt);
        const rest = Math.hypot(o.pos.x - o.pos.tx, o.pos.y - o.pos.ty) < 0.05 && Math.hypot(o.pos.vx, o.pos.vy) < 0.5 && Math.abs(o.lift.x - o.lift.to) < 1e-5 && Math.abs(o.lift.v) < 1e-4;
        if (rest) {
          o.pos.x = o.pos.tx;
          o.pos.y = o.pos.ty;
          o.lift.x = o.lift.to;
          o.moving = false;
        }
      }
      o.t = translation(o, o.pos.x, o.pos.y, o.lift.x);
      // back home exactly: drop the residue so the frame is the photograph
      if (!o.moving && Math.hypot(o.pos.x - o.ref.home[0], o.pos.y - o.ref.home[1]) < 0.05 && o.lift.x === 0) o.t = [0, 0, 0];
    }

    if (behind) {
      if (!behindSince) behindSince = wall;
      else if (wall - behindSince > 400) still = true;
      return;
    }
    behindSince = 0;
    let drew = false;
    const key = `${objs.map((o) => o.t.map((v) => v.toFixed(6)).join(",")).join("|")}|${stage.canvas.width}`;
    let developed = false;
    if (key !== lastKey || dirty) {
      drawScene();
      develop();
      lastKey = key;
      dirty = false;
      developed = true;
      drew = true;
    }
    // the print is developed only when the scene changes (or while the
    // opening's exposure runs); the grain over it moves at 24 fps, the
    // rate film did
    if (developed || Math.abs(exposure - lastExp) > 1e-4) {
      film.render(devT.tex, { ...FILM, exposure }, filmT.fbo);
      lastExp = exposure;
      lastGrain = -1;
      drew = true;
    }
    const tick = reduced || fixed || still ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain) {
      present(tick * 7.31, 1 - expT);
      lastGrain = tick;
      drew = true;
    }
    if (drew) {
      if (hint === 1 && upAt) shownUp = true;
      if (!firstAt) firstAt = wall;
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!sceneT) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      if (fence) gl.deleteSync(fence);
      film.destroy();
      for (const t of [sceneT, devT, filmT, wireT]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const t of [plateTex, frontTex, skyTex, clearTex, objTex]) gl.deleteTexture(t);
      gl.deleteBuffer(quad);
      gl.deleteBuffer(wireBuf);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(wireVao);
      gl.deleteProgram(wireP.p);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(fin.p);
      gl.deleteProgram(dev.p);
      stage.destroy();
    },
  };
}
