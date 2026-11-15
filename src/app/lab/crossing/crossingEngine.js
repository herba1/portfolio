import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm } from "../_kit/film";

// Crossing: a summer photograph of a Japanese level crossing, taken from
// below, that comes apart into the planes it was made of, like a paper
// diorama or the 1937 Disney multiplane camera.
//
// The photo looks up past the crossbuck and lamp heads into the sky, the
// wires fanning up to the right. tools/depth/bakes/crossing cut it offline
// into seven planes at its depth discontinuities (sky; far houses; wires;
// barrier boom; the old house on the left; the signal; the camellia). Each is
// a cut-out with a colour-unmixed matte and continues behind the planes in
// front of it with inpainted texture, so a gap shows what was really there;
// the wires run on whole behind the post and lamps, and the sky is one
// opaque back card filled from a dilated matte, with no ghost of a wire.
// The photo's own clouds were faint torn wisps, so the sky card holds the
// clear cobalt gradient alone and an eighth card between it and the far
// houses carries a real cumulus congestus (cumulus.py, from a CC0
// photograph): dense, cauliflower-edged sunlit towers over solid shaded
// flanks in skylight blue-grey, no sky through the mass, and no base in the
// sky: it rises from behind the far roofs and the old house's eave, running
// on far behind both, and climbs past the crossbuck's arms into the top third.
//
// The closed photograph is the stack itself, not a plate laid over it: at
// rest the cards are drawn flat and composite back to the picture, wires,
// cumulus and all, so opening it only separates what was already there.
//
// Every plane k sits at its own distance z_k from the camera and is scaled by
// z_k / f, so from the lens axis the stack projects back onto the photo
// exactly however far apart the planes are. Dragging (or tilting a phone)
// spreads them in z and moves the eye, so the separation becomes visible as
// real perspective: the planes slide past each other behind a window that
// holds still, the sky card stands far back, the signal floats forward, and
// each card throws a soft, skylight-blue shadow on the cards behind it,
// sharp near and wider as the gap grows. The lens focuses on the plane under
// the pointer with a disc-shaped (not Gaussian) circle of confusion per
// plane, CoC = A * |z - z_focus| / z, opening as the stack spreads. Release
// and it springs back flat. The frame then goes through film.js (summer).
//
// It is built as a tunnel book seen through a window: the page's paper, with
// a rectangle cut out of it nearly edge to edge, is the front of the box. The
// window is locked to the screen (same place, same size, same aspect at every
// swing). Yaw moves the eye sideways in front of the cards (an off-axis
// frustum, as a head moves in front of a real window), so it shows up as
// parallax between the cards behind a still frame. Pitch is not a slide: it
// turns the camera about its own optical centre (LENS below). The plate is a
// Ricoh GR II frame (28 mm equivalent, 65.5 degrees across) shot about 24
// degrees up, with its verticals meeting about 3.6 frame heights above it and
// a degree of roll that sent the post and the crossbuck pole both leaning
// left. The lens takes the roll out and turns the camera a further 30 degrees
// up (?pitch=-30, the rest framing), every card going through the same
// rectilinear projection, so the plates are seen obliquely and keystone: the
// eave posts, the crossbuck pole and the signal mast converge on one vanishing
// point on the centre line, a frame height or so above the top edge. A fixed
// shift of the lens (a rising front, as on a view camera) holds the crossbuck
// near the top third at rest; a pitch swing turns the camera from there, so
// the stack tilts and the convergence tightens or eases, it does not slide.
// The window sits at the nearest card's depth and throws a soft shadow in on
// the cards behind it. Every card that meets the frame was overscanned in the
// bake (the town and house a sixth past the left and bottom, the wires carried
// on; the sky is a smooth gradient and runs on without end), and the swing is
// clamped so that no point on the window's edge ever looks past any card's
// overscan: no card edge and no bare paper can show inside it.
//
// Query: ?split=0..1&yaw=deg&pitch=deg&focus=0..6 holds a still. yaw is the
// angle of the eye off the window's axis, seen from the window's centre; pitch
// is the camera's tilt off the plate as shot, negative looking up (-30 at
// rest). Both are clamped to the overscan like a live swing.

const ASSET = "/lab/crossing/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
// What the film sees round the window. The page's paper is bright enough to
// fire the film's halation, and its red-orange halo laid over the blue sky
// at the card's edges read as a magenta fringe in the corners. The film gets
// a neutral grey there instead, below the soft knee's foot (0.6 sRGB is 0.32
// linear, the knee starts at FILM.halationThreshold / 2 = 0.36), so it fires
// neither the halation nor the bloom and brings no hue into the edges; the
// page itself still shows the real paper (FINAL_FS).
const SURROUND = [0.6, 0.6, 0.6];
const PHOTO = [2048, 1356];
const MATTE = [512, 339];
// From layers.json (bake.py): each plane's crop rect in photo uv. Cards
// that meet the frame are overscanned past it, so their rects run past 0..1.
const PLANES = [
  // the sky: a smooth gradient, so past its overscan the edge texel runs on
  // (deep cobalt toward the zenith) and the turned lens never runs out of it
  { file: "p0", rect: [-0.25, -0.25, 1.25, 1.25], o: 0.66, open: true }, // sky
  // The cumulus (cumulus.py): a photographed congestus, its own card
  // between the sky and the town so a swing slides it against the roofs.
  // It stands far off over the town, run on far below the roofline (to v
  // 1.3) and left behind the old house, so a swing never uncovers a base
  // hanging in the sky or a strip of clear sky under it; it sits back near the
  // sky card, so it barely slides against the sky and the street slides
  // across it. A cut-out on a wide transparent margin, feathered to 0 well
  // inside every edge, so it need not cover the window; it throws no shadow
  // on the sky behind it (a cloud is not paper). Almost at infinity, it
  // takes only a share of the lens's defocus (dof), of the air's haze and of
  // the shadows the cards in front throw (shade), so focused on the near
  // planes it stays a lit, glowing form, not a smear.
  { file: "clouds", rect: [-0.28613, 0.11062, 0.79785, 1.32301], o: 0.6, ends: [true, true, true, true], cast: false, dof: 0.2, haze: 0.15, shade: 0 },
  // The town's travel is held (travel, below): looking up, the turned lens
  // would carry the far roofs down out of the window until only a defocused
  // sliver of roof was left streaking along its bottom edge.
  { file: "p1", rect: [-0.1499, 0.18805, 1.1499, 1.14971], o: 0.38, travel: { anchor: [0.56, 0.76], drop: 0.04 } }, // far houses, trees
  // the wires' overscan runs on along each wire's own slope, so past the
  // photo their matte (for shadows) does not hold its edge: it would draw
  // each wire on as a horizontal shadow band with a hard lower edge.
  // Each wire is one whole catenary (wires.py, catenary.py): a heavy black
  // feeder, medium cables, bare steel and a hairline messenger, each hanging
  // in its own sag and thinning and taking the sky's colour as it runs off
  // under the eave. On the left and below it runs on under the old house far
  // past the frame and ends there, behind the house's own overscan, so those
  // sides are ends, not margin to keep covered (they would only narrow the
  // swing). They are in the closed photograph too: it is this stack.
  { file: "p2", rect: [-0.2998, 0.03466, 1.22021, 1.19027], o: 0.2, hold: false, ends: [true, false, false, true] }, // wires
  // the spire and mechanism box past the mast are cut off along the mast's
  // edge (corner.py): its right side is a cut-out end, not overscan to keep
  // covered.
  // Its orange and red band were regraded to a muted ochre and a dull brick
  // (boomgrade.py) and it is a little soft (cocFor): one warm accent, the
  // crossbuck.
  { file: "p3", rect: [0.85742, 0.15708, 1.01025, 1.14971], o: 0.08, ends: [false, false, true, false], soft: 3 }, // barrier boom, mast
  // the house's margin is its edge column carried straight on (bake.py), which
  // holds as the beams running on for a short way and then reads as streaks
  { file: "p4", rect: [-0.1499, 0.44248, 0.50928, 1.14971], o: -0.06, clean: [-0.03, null, null, null] }, // the old house
  { file: "p5", rect: [0.50732, 0.15192, 0.83545, 1.14971], o: -0.24 }, // the signal
  { file: "p6", rect: [0.01416, 0.8326, 0.37988, 1.10029], o: -0.42 }, // camellia
];
const N = PLANES.length;
// The window is the image plane, at the nearest plane's depth: the eye moves
// in front of it, the window holds still and the street slides behind it.
const MAT_K = N - 1;
const PIVOT_O = PLANES[MAT_K].o;
// Where each card must keep covering the window: the sides that meet the
// frame were overscanned by the bake (their rects run past 0..1), and the
// window may not look past them, nor past the part of a margin that holds up
// (clean). Sides that end inside the photo are cut-out silhouettes and may
// show.
const SAFE = PLANES.map(({ rect: r, ends = [], clean = [], open }) =>
  open
    ? [-Infinity, -Infinity, Infinity, Infinity]
    : [
    r[0] < 0.002 && !ends[0] ? r[0] : -Infinity,
    r[1] < 0.002 && !ends[1] ? r[1] : -Infinity,
    r[2] > 0.998 && !ends[2] ? r[2] : Infinity,
    r[3] > 0.998 && !ends[3] ? r[3] : Infinity,
  ].map((v, i) => clean[i] ?? v),
);
const SPREAD = 1.0; // plane offsets are o * SPREAD * print width at split 1
// Past SPLIT_KNEE the split eases into SPLIT_MAX, however far the hand pulls.
// Further apart, the cable bunch under the eave (cut from the photo where it
// crossed the far roofs, and kept as cut) slides off the roofs it was cut
// against and breaks into dashes hanging in the sky, and the near cards'
// defocus swallows the signal.
const SPLIT_KNEE = 0.55;
const SPLIT_MAX = 0.78;
const easeSplit = (x) =>
  x <= SPLIT_KNEE ? x : SPLIT_KNEE + (SPLIT_MAX - SPLIT_KNEE) * Math.tanh((x - SPLIT_KNEE) / (SPLIT_MAX - SPLIT_KNEE));
const FOVY = 30; // degrees: how deep the box is (the cards' spacing), not the lens
const MAX_YAW = 21;
const MAX_PITCH = 14; // the swing's turn either side of the rest tilt
// The lens. The plate's own field (the GR II's 28 mm) fixes how far off its
// axis each photo pixel lies; the camera then rolls the plate level (ROLL:
// the verticals' vanishing point sat left of centre) and turns up by -pitch.
// LENS_ZOOM is the camera's focal length over the plate's: below 1 it is the
// wider lens, about 75 degrees across the window, as wide as the overscan
// allows (wider and the house's left edge comes into the bottom corner). The
// rising front puts the crossbuck (FRAME_ANCHOR, photo uv) FRAME_AT of the way
// down the window at rest.
const LENS = {
  plateHfov: 65.5,
  roll: -1.2,
  restPitch: -30,
  zoom: 0.8,
  anchor: [0.617, 0.351],
  at: 0.33,
};
// The window: nearly full bleed, inset by an even paper margin. Its aspect
// follows the screen's, held within these bounds of the photo's (a phone held
// upright gets a shorter window rather than a sliver of the photo); the photo
// covers it, so the window's own edges always fall inside every card.
const MARGIN = [0.03, 12, 28]; // share of the shorter side, min and max css px
const ASPECT_RANGE = [1 / 1.2, 1.3];
// The print is a little larger than the window, so the eye has real photo to
// look into on every side before any card has to lean on its overscan.
const ZOOM = 1.05;
const APERTURE = 15; // CoC in css px for a plane at |z - zf| / z = 1, at split 1
// A card's circle of confusion in css px: the lens's, opening with the split,
// and for a card with its own softness (soft, css px) that much again
// wherever the lens is not on it. The boom is soft: its ochre and brick sit
// just out of focus beside the crossbuck and the lamp heads, which stay the
// one sharp warm anchor. Flat it is the photograph, so it fades in with the
// split; focus on the boom and it comes sharp.
const SOFT_OFF = 0.03; // |z - zf| / z at which a soft card is fully soft
const cocFor = (P, z, s, focusZ) => {
  const off = Math.abs(z - focusZ) / z;
  const lensCoc = APERTURE * s * off * (P.dof ?? 1);
  const own = (P.soft ?? 0) * Math.min(1, s / 0.05) * Math.min(1, off / SOFT_OFF);
  return Math.hypot(lensCoc, own);
};
const LIGHT = normalize([0.18, 0.28, 1]); // toward the sun: up, right (the eave's shadow on the wall), toward us
const HAZE = [0.86, 0.93, 0.95];

// The film (../_kit/film, summer). Its tone curve is the highlight ceiling:
// whitePoint is the scene value it lands on paper white, so at the kit's 1.3
// the brightest a card can be (1.0) developed to about 0.92, a lit crown at
// #f4f1ea to 229, and the light just stopped there. At 1.05 the curve's own
// soft shoulder (Lottes, contrast 1.16) starts to bend at about 0.8 and rolls
// on smoothly: the crown develops to about 242, a card's pure white to 250,
// and nothing that is not pushed past it by the bloom reaches 255. headroom
// is the extra energy the near-whites carry into the scattered light only
// (bloom, halation), so the crown glows a little past what it shows.
// Halation and bloom key off one soft knee at 0.72 linear (a quadratic knee
// from 0.36 to 1.08, the kit's), well under the crown, so the cloud and the
// pale sky over the roofs bleed into everything round them. The kit's own
// halation is the wide (1-3% of the frame) red glow; the thin ring at the
// dark edges is RING below.
const FILM = {
  exposure: 0,
  headroom: 0.97,
  whitePoint: 1.05,
  shoulder: 0.95,
  halation: 0.08,
  halationThreshold: 0.72,
  halationLocal: 1,
  bloom: 0.34,
  bloomThreshold: 0.72,
  // The kit's cool highlight tint (blue x1.05) pushed the lit crown blue-grey
  // and the pale low sky's blue into 255 once the ceiling came up; nearly
  // neutral, the crown rolls off warm-white and the sky keeps its hue.
  highlightTint: [0.99, 1, 1.01],
  softness: 0.45,
  contrast: 1.16,
  saturation: 1.12,
  blueDepth: 0.25, // the bake paints the cobalt into the sky card; more here turns it cyan
  grain: 0.3,
  vignette: 0,
};
// The thin halation ring: in an emulsion without an anti-halation layer, the
// light that went through to the base and bounced back exposes the red layer
// a hair round every bright thing, so a dark edge cut against the sky (the
// crossbuck, the pole, the eave, the wires, the lamp hoods) takes a thin warm
// line, 2-4 css px, instead of meeting the blue clean. Real halation is linear
// in the light, so every bright pixel sends some (floor), and the light past
// FILM.halationThreshold's soft knee sends all of it: the cloud and the pale
// low sky ring hard, the deep cobalt only a little. Only covered pixels send
// (the cards, never the surround), so the window's own cut never rings. It is
// added in linear light before the film, which then softens and develops it
// with everything else.
const RING = {
  radius: 3.2, // css px
  floor: 0.6, // the share of all the light that halates, below the knee
  amount: 4,
  // The ring's ceiling (linear): a dark edge saturates toward it, so a wire
  // over the lit crown takes a warm line, not an orange one, and an edge on
  // the deep cobalt still rings nearly as clearly.
  max: 0.14,
  color: [1, 0.42, 0.14], // linear: red-orange, the red layer with some green, never pink on the blue
};
// Query overrides for the ring, as for the film: ?ringAmount=, ?ringRadius=,
// ?ringFloor=, ?ringMax=.
const RING_Q = { ringAmount: "amount", ringRadius: "radius", ringFloor: "floor", ringMax: "max" };

const PLANE_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect;     // quad extent in photo uv (x0, y0, x1, y1), y down
uniform vec3 uPlane;    // half width, half height (world px), distance
uniform vec2 uEye;      // the eye's offset from the window's axis (world px)
uniform float uWinZ;    // the window's distance
uniform float uF;       // the box's depth scale: plate px at distance uF are print px
uniform float uFP;      // the plate's own focal length, print px
uniform mat3 uLens;     // plate ray -> screen (css px from centre, y up), homogeneous
uniform vec2 uHalfView; // half the viewport, css px
uniform float uLift;    // the card's lift (photo v): its travel held (liftsFor)
uniform int uMat;       // 1: the paper round the window, drawn in screen space
out vec2 vUv;
void main() {
  if (uMat == 1) {
    vUv = aPos;
    gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
    return;
  }
  vec2 uv = mix(uRect.xy, uRect.zw, aPos);
  vec2 p = vec2((uv.x - 0.5) * 2.0 * uPlane.x, (0.5 - uv.y + uLift) * 2.0 * uPlane.y);
  // Off-axis projection from the eye onto the plate's image plane (a point
  // on the window's plane lands in the same place wherever the eye is), then
  // that ray through the turned camera: (A * uF / z, uFP) is the ray in the
  // plate's frame, scaled by z so the whole map stays projective and the
  // texture is interpolated in true perspective.
  float z = uPlane.z;
  vec2 a = (p + uEye * (z / uWinZ - 1.0)) * uF;
  vec3 h = uLens * vec3(a, uFP * z);
  gl_Position = vec4(h.xy / uHalfView, 0.0, h.z);
  vUv = uv;
}`;

const PLANE_FS = `#version 300 es
precision highp float;
precision highp int;
precision mediump sampler2DArray;
in vec2 vUv;
uniform sampler2D uTex;          // this plane, premultiplied, cropped
uniform vec4 uCrop;              // its crop rect in photo uv
uniform vec2 uTexSize;
uniform float uCoc;              // disc radius, device px
uniform float uOpacity;
uniform int uK;
uniform sampler2DArray uMattes;  // every plane's alpha, 512 wide
uniform float uZ[${N}];
uniform vec2 uHalf[${N}];
uniform float uCast[${N}];       // 0: this plane throws no shadow
uniform float uHold[${N}];       // 0: its matte ends at the photo's edge
uniform float uLifts[${N}];      // each card's lift (photo v), as uLift
uniform vec3 uLight;
uniform float uShadow;
uniform float uPrintW;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform int uMat;                // 1: the front mat, paper with the window cut out
uniform vec4 uWin;               // the window in device px (x0, y0, x1, y1), GL origin
uniform vec3 uPaper;
uniform float uMatZ;
uniform float uF;
uniform float uFP;
uniform mat3 uLens;
uniform vec2 uWinHalf;           // the window's half extent, css px
uniform float uLensMag;          // print px per screen px near the centre
uniform int uOpen;               // 1: the card runs on past its crop (the sky)
out vec4 o;

vec4 tap(vec2 uv, float lod) {
  vec2 t = (uv - uCrop.xy) / (uCrop.zw - uCrop.xy);
  vec2 inside = uOpen == 1 ? vec2(1.0) : step(vec2(0.0), t) * step(t, vec2(1.0));
  return textureLod(uTex, t, lod) * inside.x * inside.y;
}

void main() {
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  if (uMat == 1) {
    // Paper everywhere but the window, the cut edge antialiased.
    vec2 fc = gl_FragCoord.xy;
    vec2 d = min(fc - uWin.xy, uWin.zw - fc);
    float a = 1.0 - clamp(min(d.x, d.y) + 0.5, 0.0, 1.0);
    o = vec4(uPaper * a, a);
    return;
  }
  vec4 c;
  if (uCoc < 0.6) {
    vec2 t = (vUv - uCrop.xy) / (uCrop.zw - uCrop.xy);
    vec2 inside = uOpen == 1 ? vec2(1.0) : step(vec2(0.0), t) * step(t, vec2(1.0));
    c = texture(uTex, t) * inside.x * inside.y;
  } else {
    // A lens makes discs: gather over a uniform disc (golden-angle spiral),
    // bright points weighted up so they open into round bokeh. The mip only
    // fills the gaps between taps.
    vec2 texPerPx = vec2(length(dx), length(dy)) * uTexSize / (uCrop.zw - uCrop.xy);
    float lod = log2(max(1.0, uCoc * max(texPerPx.x, texPerPx.y) * 0.42));
    // nothing on this plane within the disc: skip the gather
    float cover = textureLod(uTex, (vUv - uCrop.xy) / (uCrop.zw - uCrop.xy), lod + 2.5).a;
    if (cover < 0.002) discard;
    const int TAPS = 20;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float r = sqrt((float(i) + 0.5) / float(TAPS)) * uCoc;
      float a = float(i) * 2.39996323;
      vec2 off = r * vec2(cos(a), sin(a));
      vec4 s = tap(vUv + dx * off.x + dy * off.y, lod);
      float l = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = 1.0 + 2.5 * smoothstep(0.82, 0.98, l);
      acc += s * w;
      wsum += w;
    }
    c = acc / wsum;
  }
  // Cards in front throw soft shadows on this one: walk toward the sun from
  // this point to each nearer plane and read its matte there, blurred by the
  // gap (a larger penumbra the further the shadow falls).
  if (uShadow > 0.0 && c.a > 0.0) {
    vec2 h = uHalf[uK];
    vec2 p = vec2((vUv.x - 0.5) * 2.0 * h.x, (0.5 - vUv.y + uLifts[uK]) * 2.0 * h.y);
    float lit = 1.0;
    for (int j = 0; j < ${N}; j++) {
      if (j <= uK || uCast[j] < 0.5) continue;
      float gap = uZ[uK] - uZ[j];
      if (gap < 1.0) continue;
      vec2 q = p + uLight.xy * gap / uLight.z;
      vec2 hj = uHalf[j];
      vec2 uvj = vec2(q.x / (2.0 * hj.x) + 0.5, 0.5 - q.y / (2.0 * hj.y) + uLifts[j]);
      // penumbra grows with the gap; the shadow also sits on this plane, so
      // it shares the plane's defocus
      float pen = gap * 0.045 * ${MATTE[0]}.0 / (2.0 * hj.x);
      float cocM = uCoc * length(dx) * ${MATTE[0]}.0;
      float w = max(1.0, max(pen, cocM));
      float lod = log2(w);
      float a = textureLod(uMattes, vec3(uvj, float(j)), lod + 0.5).r;
      vec2 past = max(-uvj, uvj - 1.0);
      if (uHold[j] < 0.5) a *= 1.0 - smoothstep(0.0, 0.004, max(past.x, past.y));
      // thin things (wires) blur away instead of veiling the card; past the
      // photo the matte holds its edge, as the overscanned cards run on
      a = smoothstep(0.18, 0.7, a);
      float g = gap / uPrintW; // gaps in print widths, so a phone matches a desktop
      lit *= 1.0 - a * smoothstep(0.0, 0.05, g) * exp(-g / 0.3);
    }
    // Sunlight blocked leaves skylight: shadows go blue, not black.
    vec3 shade = mix(vec3(0.64, 0.72, 0.84), vec3(1.0), lit);
    // The front mat throws its own shadow in through the window: a soft band
    // inside the edges that face the sun, wider the further back the card.
    // Paper-white sheets bounce light into it, so it is greyer and lighter.
    // The window is a rectangle on the screen, so in the mat's plane it is
    // whatever the turned lens makes of it: take the shadow point to the
    // screen and measure there, back in the plane's px.
    float mgap = uZ[uK] - uMatZ;
    if (mgap > 1.0) {
      vec2 q = p + uLight.xy * mgap / uLight.z;
      vec3 hq = uLens * vec3(q * uF / uMatZ, uFP);
      vec2 in2 = hq.z > 0.0 ? uWinHalf - abs(hq.xy / hq.z) : vec2(-1e4);
      float din = min(in2.x, in2.y) * uLensMag * uMatZ / uF;
      float pen = max(1.5, mgap * 0.06);
      float g = mgap / uPrintW;
      float m = (1.0 - smoothstep(-pen, pen, din)) * smoothstep(0.0, 0.04, g) * (0.4 + 0.35 * exp(-g / 0.4));
      shade *= mix(vec3(1.0), vec3(0.74, 0.76, 0.79), m);
    }
    c.rgb *= mix(vec3(1.0), shade, uShadow);
  }
  // The air between the cards: farther planes take a little sky haze.
  c.rgb = mix(c.rgb, uHazeColor * c.a, uHaze);
  o = c * uOpacity;
}`;

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

// The thin halation ring (RING), in linear light, written back as sRGB for
// the film with the coverage carried through.
const RING_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uTexel;   // one device px in uv
uniform float uR;      // the ring's reach, device px
uniform float uThr;    // the soft knee's centre (linear luma)
uniform float uFloor;
uniform float uAmt;
uniform float uMax;
uniform vec3 uColor;
out vec4 o;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 dec(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 enc(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// The light a pixel sends into the base: all of it past the knee, a floor's
// share below.
float send(vec3 s) {
  float l = dot(dec(s), LUMA);
  float k = uThr * 0.5;
  float x = clamp(l - uThr + k, 0.0, 2.0 * k);
  float past = max(x * x / (4.0 * k + 1e-5), l - uThr);
  float share = mix(uFloor, 1.0, clamp(past / max(l, 1e-4), 0.0, 1.0));
  return l * share;
}
void main() {
  vec4 c = texture(uScene, vUv);
  // A pixel's own light counts whole even on the window's soft cut, so the
  // cut never rings; its neighbours count by coverage, so the surround sends
  // nothing.
  float self = send(c.rgb);
  // Three rings of taps, turned against each other, falling off outward: a
  // short, soft spread with no visible tap pattern under the grain.
  float sum = 0.0;
  float wsum = 0.0;
  for (int r = 1; r <= 3; r++) {
    float rr = float(r) / 3.0;
    float w = 1.0 - 0.55 * rr;
    for (int i = 0; i < 8; i++) {
      float a = (float(i) + 0.5 * float(r)) * 0.78539816;
      vec2 d = vec2(cos(a), sin(a)) * rr * uR * uTexel;
      vec4 n = texture(uScene, vUv + d);
      sum += send(n.rgb) * n.a * w;
      wsum += w;
    }
  }
  // What reaches this pixel from round it, past what it sends itself: the
  // bright side of an edge keeps its own colour, the dark side takes the ring.
  float halo = max(sum / wsum - self, 0.0) * uAmt;
  halo /= 1.0 + halo / uMax;
  vec3 lin = dec(c.rgb);
  float y = dot(lin, LUMA);
  halo *= 1.0 - 0.6 * smoothstep(0.15, 0.7, y);
  o = vec4(enc(lin + uColor * halo), c.a);
}`;

// Paper where there is no card; the developed card where there is.
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFilm;
uniform sampler2D uScene;
uniform vec3 uPaper;
out vec4 o;
void main() {
  float cov = texture(uScene, vUv).a;
  vec3 f = texture(uFilm, vUv).rgb;
  o = vec4(mix(uPaper, f, cov), 1.0);
}`;

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

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
// Past the end the hand meets resistance, like a held rubber band.
function rubber(v, lim, k = 0.35) {
  const a = Math.abs(v);
  return a <= lim ? v : Math.sign(v) * (lim + (a - lim) * k);
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

async function loadBitmap(src, premultiply) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: premultiply ? "premultiply" : "none" });
}

// The eye for a swing: yaw is its angle off the window's axis, seen from the
// window's centre at distance D. Positive yaw moves it left (the far cards
// slide left). Pitch does not move the eye; it turns the lens (lensFor).
function eyeFor(D, yawDeg) {
  return [-D * Math.tan((yawDeg * Math.PI) / 180), 0];
}

// The lens for a print of printW x printH css px and a camera tilt of
// pitchDeg off the plate (negative up): a 3x3 map from a ray in the plate's
// frame, (x, y, fP) with x, y in print px from its centre, y up, to the screen
// in css px from the window's centre, homogeneous. It is a pure rotation about
// the optical centre (roll, then tilt) between two pinhole cameras, the plate's
// (fP) and the wider one that looks at it (fR), and a fixed rising front (shY)
// that is set once from the rest tilt, so a swing turns the camera and does
// not slide it. Row-major m[r][c]; inv is the inverse, for casting rays back.
function lensFor(printW, printH, winH, pitchDeg) {
  const rad = Math.PI / 180;
  const fP = printW / 2 / Math.tan((LENS.plateHfov / 2) * rad);
  const fR = fP * LENS.zoom;
  const rot = (pd) => {
    const t = -pd * rad;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const cr = Math.cos(LENS.roll * rad);
    const sr = Math.sin(LENS.roll * rad);
    // Rx(t) * Rz(roll)
    return [
      [cr, -sr, 0],
      [c * sr, c * cr, -s],
      [s * sr, s * cr, c],
    ];
  };
  const apply = (R, sh, x, y) => {
    const X = R[0][0] * x + R[0][1] * y + R[0][2] * fP;
    const Y = R[1][0] * x + R[1][1] * y + R[1][2] * fP;
    const Z = R[2][0] * x + R[2][1] * y + R[2][2] * fP;
    return [(fR * X) / Z, (fR * Y) / Z + sh];
  };
  const a = apply(rot(LENS.restPitch), 0, (LENS.anchor[0] - 0.5) * printW, (0.5 - LENS.anchor[1]) * printH);
  const shY = winH / 2 - winH * LENS.at - a[1];
  const R = rot(pitchDeg);
  const m = [
    [fR * R[0][0], fR * R[0][1], fR * R[0][2]],
    [fR * R[1][0] + shY * R[2][0], fR * R[1][1] + shY * R[2][1], fR * R[1][2] + shY * R[2][2]],
    [R[2][0], R[2][1], R[2][2]],
  ];
  // screen (sx, sy) -> plate print px, or null behind the camera
  const inv = (sx, sy) => {
    const X = sx / fR;
    const Y = (sy - shY) / fR;
    // R^T (X, Y, 1)
    const x = R[0][0] * X + R[1][0] * Y + R[2][0];
    const y = R[0][1] * X + R[1][1] * Y + R[2][1];
    const z = R[0][2] * X + R[1][2] * Y + R[2][2];
    if (z <= 1e-6) return null;
    return [(x * fP) / z, (y * fP) / z];
  };
  // column-major, for uniformMatrix3fv
  const gl = new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
  return { fP, fR, shY, m, gl, inv };
}

export async function createCrossing(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const qSplit = num("split");
  const held = qSplit != null;
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) if (num(key) != null) film0[key] = num(key);
  const ring0 = { ...RING };
  for (const [key, to] of Object.entries(RING_Q)) if (num(key) != null) ring0[to] = num(key);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  stage.canvas.style.cursor = "grab";

  const [matteBm, ...planeBms] = await Promise.all([
    loadBitmap(`${ASSET}mattes.png`, false),
    ...PLANES.map((P) => loadBitmap(`${ASSET}${P.file}.webp`, true)),
  ]);

  // Matte pixels for picking the plane under the pointer.
  const mc = document.createElement("canvas");
  mc.width = matteBm.width;
  mc.height = matteBm.height;
  const mctx = mc.getContext("2d", { willReadFrequently: true });
  mctx.drawImage(matteBm, 0, 0);
  const mattePx = mctx.getImageData(0, 0, mc.width, mc.height).data;

  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    const size = [bm.width, bm.height];
    bm.close?.();
    return { t, size };
  };
  // Where along each side a card has anything at its edge (from its own
  // alpha, in photo uv across that side): a side only has to keep covering
  // the window there. The town's left and right edges, say, hold only beside
  // its roofs and trees, not up in the empty top of its rect.
  const reach = planeBms.map((bm, k) => edgeReach(bm, PLANES[k].rect));
  const planeTex = planeBms.map(upload);

  const mattes = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, mattes);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, MATTE[0], MATTE[1], N, 0, gl.RED, gl.UNSIGNED_BYTE, toR8(mattePx, MATTE[0], MATTE[1] * N));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  matteBm.close?.();

  const plane = compile(gl, PLANE_VS, PLANE_FS);
  const fin = compile(gl, QUAD_VS, FINAL_FS);
  const ringP = compile(gl, QUAD_VS, RING_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const target = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
  let ringT = null;
  let filmT = null;
  let dirty = true;
  const build = () => {
    for (const t of [sceneT, ringT, filmT]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    sceneT = target();
    ringT = target();
    filmT = target();
    film.resize(stage.canvas.width, stage.canvas.height);
    dirty = true;
  };
  stage.onResize(build);

  // ---- layout: the window, the print that covers it, and the lens
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const A = PHOTO[0] / PHOTO[1];
    const dpr = stage.dpr;
    const margin = Math.round(clamp(Math.min(W, H) * MARGIN[0], MARGIN[1], MARGIN[2]));
    let winW = W - 2 * margin;
    let winH = H - 2 * margin;
    if (winW / winH > A * ASPECT_RANGE[1]) winW = winH * A * ASPECT_RANGE[1];
    if (winW / winH < A * ASPECT_RANGE[0]) winH = winW / (A * ASPECT_RANGE[0]);
    // whole device pixels, the same margin on both sides
    winW = (2 * Math.round((winW * dpr) / 2)) / dpr;
    winH = (2 * Math.round((winH * dpr) / 2)) / dpr;
    const printW = Math.max(winW, winH * A) * ZOOM;
    const printH = printW / A;
    const f = H / 2 / Math.tan(((FOVY / 2) * Math.PI) / 180);
    return { W, H, winW, winH, printW, printH, f };
  };

  // ---- state
  const split = spring(held ? clamp(qSplit, 0, 1) : 0);
  const yaw = spring(held ? num("yaw") ?? 0 : 0);
  // pitch is kept as the swing's turn off the rest tilt
  const pitch = spring(held ? (num("pitch") ?? LENS.restPitch) - LENS.restPitch : 0);
  // ?focus counts the photograph's own seven planes (0 sky ... 5 signal, 6
  // camellia), as it did before the cumulus card went in between 0 and 1.
  const focusDefault = 6; // the signal
  const fq = num("focus");
  const focusQ = fq == null ? null : fq < 1 ? Math.max(0, fq) * 2 : fq + 1;
  const focusK = { x: focusQ ?? focusDefault, to: focusQ ?? focusDefault };
  const hover = { x: 0, y: 0 };
  let grab = null;
  let touched = held;
  let born = performance.now();
  let lastKey = "";
  let lastGrain = -1;
  let breathe = 0;
  const swing = { yaw: 0, pitch: 0 }; // what is drawn, after the overscan clamp

  const geometry = (s) => {
    const L = layout();
    const zs = PLANES.map((p) => L.f + s * SPREAD * p.o * L.printW);
    const pivot = L.f + s * SPREAD * PIVOT_O * L.printW;
    return { ...L, zs, pivot, s };
  };

  const lens = (G, pitchOff) => lensFor(G.printW, G.printH, G.winH, LENS.restPitch + pitchOff);

  // Where the ray from the eye through screen point (sx, sy) (css px from the
  // centre, y up) meets plane k, in that plane's photo uv: back through the
  // lens to the plate's image plane, then from the eye to the card. null when
  // the ray points behind the plate.
  const castUv = (G, Ln, E, sx, sy, k, lifts) => {
    const s = Ln.inv(sx, sy);
    if (!s) return null;
    const zk = G.zs[k];
    const t = zk / G.pivot;
    const x = E[0] + ((s[0] * G.pivot) / G.f - E[0]) * t;
    const y = E[1] + ((s[1] * G.pivot) / G.f - E[1]) * t;
    const sc = zk / G.f;
    return [x / (G.printW * sc) + 0.5, 0.5 - y / (G.printH * sc) + (lifts ? lifts[k] : 0)];
  };

  // Where photo point (u, v) of plane k lands on the screen (css px from
  // the centre, y up), unlifted: PLANE_VS in JS.
  const project = (G, Ln, E, k, u, v) => {
    const z = G.zs[k];
    const px = (u - 0.5) * G.printW * (z / G.f) + E[0] * (z / G.pivot - 1);
    const py = (0.5 - v) * G.printH * (z / G.f) + E[1] * (z / G.pivot - 1);
    const a = [px * G.f, py * G.f, Ln.fP * z];
    const r = (i) => Ln.m[i][0] * a[0] + Ln.m[i][1] * a[1] + Ln.m[i][2] * a[2];
    return [r(0) / r(2), r(1) / r(2)];
  };

  // The town's travel. The lens turns about its own centre, so a swing up
  // carries every card down the window alike; the town, low in the frame
  // already, would leave it but for a sliver of defocused roof streaking
  // along the bottom edge, and the stack would read as cut-outs over a bare
  // gradient. A card with travel may drop no more than drop (a share of the
  // window's height) below where its anchor sits at rest: past that it is
  // lifted, as a tunnel book's card is slid up its slot, by the photo v that
  // keeps the anchor there. Flat it is the photograph, so the lift opens in
  // with the split.
  const liftsFor = (G, Ln, E) => {
    const lifts = new Float32Array(N);
    const open = clamp(G.s / 0.3, 0, 1);
    if (open <= 0) return lifts;
    const rest = lens(G, 0);
    PLANES.forEach((P, k) => {
      if (!P.travel) return;
      const [u, v] = P.travel.anchor;
      const floor = project(G, rest, [0, 0], k, u, v)[1] - P.travel.drop * G.winH;
      const now = project(G, Ln, E, k, u, v)[1];
      if (now >= floor) return;
      const dy = (project(G, Ln, E, k, u, v - 0.01)[1] - now) / 0.01;
      if (dy > 0) lifts[k] = ((floor - now) / dy) * open * open * (3 - 2 * open);
    });
    return lifts;
  };

  // Which plane is under the pointer (nearest first), by casting the ray from
  // the eye through the window into each plane's matte.
  const pick = (px, py) => {
    const G = geometry(easeSplit(clamp(split.x, 0, 1.08)));
    const E = eyeFor(G.pivot, swing.yaw);
    const Ln = lens(G, swing.pitch);
    const lifts = liftsFor(G, Ln, E);
    for (let k = N - 1; k >= 1; k--) {
      const c = castUv(G, Ln, E, px - G.W / 2, -(py - G.H / 2), k, lifts);
      if (!c) continue;
      const [u, v] = c;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const mx = Math.min(MATTE[0] - 1, Math.floor(u * MATTE[0]));
      const my = Math.min(MATTE[1] - 1, Math.floor(v * MATTE[1]));
      if (mattePx[((k * MATTE[1] + my) * MATTE[0] + mx) * 4] > 128) return k;
    }
    return 0;
  };

  // The largest share t of a swing (yaw, pitch) for which every point on the
  // window's edge, seen from the moved eye through the turned lens, still
  // looks onto every card's safe extent. The lens maps the window's straight
  // edges to straight lines on each card, so points along them decide it; a
  // side of a card only has to hold where that card has anything, across the
  // other axis (the wires end at the right only below their top; the house's
  // left edge only matters beside the house). The share is found by
  // bisection. A defocused card's edge is soft over its circle of confusion,
  // so the margin keeps that clear too. The nearest card lies in the window's
  // plane and moves only with the lens.
  const EDGE = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 - 0.5;
    EDGE.push([t, -0.5], [t, 0.5], [-0.5, t], [0.5, t]);
  }
  // The turn is held first, with the eye on the axis, then the eye's yaw
  // within that turn: a hand pulling diagonally past where the lens can turn
  // still swings the eye sideways, rather than the whole swing locking up.
  const swingLimit = (G, yawDeg, pitchDeg, cocs, onlyPitch) => {
    const fits = (t) => {
      const E = eyeFor(G.pivot, onlyPitch ? 0 : yawDeg * t);
      const Ln = lens(G, onlyPitch ? pitchDeg * t : pitchDeg);
      const lifts = liftsFor(G, Ln, E);
      for (let k = 0; k < MAT_K; k++) {
        const S = SAFE[k];
        if (S.every((v) => !Number.isFinite(v))) continue;
        const inset = 0.008 + cocs[k] / (stage.dpr * G.printW);
        for (const [ex, ey] of EDGE) {
          const c = castUv(G, Ln, E, ex * G.winW, ey * G.winH, k, lifts);
          if (!c) return false;
          const [u, v] = c;
          const [rl, rt, rr, rb] = reach[k];
          const near = (x, span) => x >= span[0] - 0.04 && x <= span[1] + 0.04;
          const acrossV = u < 0.5 ? near(v, rl) : near(v, rr);
          const acrossU = v < 0.5 ? near(u, rt) : near(u, rb);
          if (acrossV && (u < S[0] + inset || u > S[2] - inset)) return false;
          if (acrossU && (v < S[1] + inset || v > S[3] - inset)) return false;
        }
      }
      return true;
    };
    if (fits(1)) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      if (fits(m)) lo = m;
      else hi = m;
    }
    return lo;
  };

  const degPerPx = () => (2 * MAX_YAW) / Math.max(320, stage.width * 0.7);
  stage.on("down", (p) => {
    touched = true;
    grab = { x: p.x, y: p.y, s0: split.x, y0: yaw.x, p0: pitch.x };
    stage.canvas.style.cursor = "grabbing";
    requestOrientation();
  });
  stage.on("up", (p) => {
    if (!grab) return;
    grab = null;
    stage.canvas.style.cursor = "grab";
    // Let go and it closes back into one flat photograph, carrying a little
    // of the hand's speed into the swing.
    split.to = 0;
    yaw.v += p.vx * degPerPx() * 0.25;
    pitch.v -= p.vy * degPerPx() * 0.25;
    yaw.to = 0;
    pitch.to = 0;
  });

  // Phones: tilt the device and the stack opens with the tilt.
  const orient = { b: null, g: null, x: 0, y: 0, on: false };
  const onOrient = (e) => {
    if (e.beta == null) return;
    if (orient.b == null) {
      orient.b = e.beta;
      orient.g = e.gamma;
    }
    orient.x = damp(orient.x, clamp((e.gamma - orient.g) / 18, -1, 1), 8, 1 / 60);
    orient.y = damp(orient.y, clamp((e.beta - orient.b) / 18, -1, 1), 8, 1 / 60);
  };
  function requestOrientation() {
    if (orient.on || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orient.on = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  const drawScene = (s, yawDeg, pitchDeg, focusZ) => {
    const G = geometry(s);
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    const dpr = stage.dpr;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(SURROUND[0], SURROUND[1], SURROUND[2], 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(plane.p);
    gl.bindVertexArray(vao);
    const U = plane.u;
    const E = eyeFor(G.pivot, yawDeg);
    const Ln = lens(G, pitchDeg);
    const lifts = liftsFor(G, Ln, E);
    gl.uniform2f(U.uEye, E[0], E[1]);
    gl.uniform1fv(U.uLifts, lifts);
    gl.uniform1f(U.uWinZ, G.pivot);
    gl.uniform1f(U.uF, G.f);
    gl.uniform1f(U.uFP, Ln.fP);
    gl.uniformMatrix3fv(U.uLens, false, Ln.gl);
    gl.uniform2f(U.uHalfView, G.W / 2, G.H / 2);
    gl.uniform2f(U.uWinHalf, G.winW / 2, G.winH / 2);
    gl.uniform1f(U.uLensMag, Ln.fP / Ln.fR);
    const wx = Math.round(((G.W - G.winW) / 2) * dpr);
    const wy = Math.round(((G.H - G.winH) / 2) * dpr);
    gl.uniform4f(U.uWin, wx, wy, w - wx, h - wy);
    gl.uniform1fv(U.uZ, new Float32Array(G.zs));
    const halves = new Float32Array(N * 2);
    G.zs.forEach((z, k) => {
      halves[k * 2] = (G.printW / 2) * (z / G.f);
      halves[k * 2 + 1] = (G.printH / 2) * (z / G.f);
    });
    gl.uniform2fv(U.uHalf, halves);
    gl.uniform1fv(U.uCast, new Float32Array(PLANES.map((P) => (P.cast === false ? 0 : 1))));
    gl.uniform1fv(U.uHold, new Float32Array(PLANES.map((P) => (P.hold === false ? 0 : 1))));
    gl.uniform3f(U.uLight, LIGHT[0], LIGHT[1], LIGHT[2]);
    gl.uniform1f(U.uPrintW, G.printW);
    gl.uniform3f(U.uHazeColor, HAZE[0], HAZE[1], HAZE[2]);
    gl.uniform1i(U.uMat, 0);
    gl.uniform3f(U.uPaper, SURROUND[0], SURROUND[1], SURROUND[2]);
    gl.uniform1f(U.uMatZ, G.zs[MAT_K]);
    gl.uniform1i(U.uTex, 0);
    gl.uniform1i(U.uMattes, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, mattes);
    gl.activeTexture(gl.TEXTURE0);
    const shadow = (num("shadow") ?? 1.0) * Math.min(1, s * 1.6);
    const frontZ = G.zs[N - 1];
    // Flat, the stack is the photograph: every card at the window's depth,
    // no defocus, no shadow, no haze, so from the lens axis the cards
    // composite back to exactly the plate, wires and all. Opening only
    // separates what was already there. The turned lens looks past the
    // photo's top and its upper corners onto the sky that runs on and the
    // overscanned cards.
    for (let k = 0; k < N; k++) {
      const P = PLANES[k];
      const z = G.zs[k];
      const coc = cocFor(P, z, s, focusZ) * dpr;
      // the quad grows by the blur so a defocused edge is not cut
      const m = coc / dpr / G.printW;
      const r = P.rect;
      if (P.open) gl.uniform4f(U.uRect, r[0] - 3, r[1] - 6, r[2] + 3, r[3] + m * 1.5);
      else gl.uniform4f(U.uRect, r[0] - m, r[1] - m * 1.5, r[2] + m, r[3] + m * 1.5);
      gl.uniform1i(U.uOpen, P.open ? 1 : 0);
      gl.uniform4f(U.uCrop, r[0], r[1], r[2], r[3]);
      gl.uniform2f(U.uTexSize, planeTex[k].size[0], planeTex[k].size[1]);
      gl.uniform3f(U.uPlane, halves[k * 2], halves[k * 2 + 1], z);
      gl.uniform1f(U.uLift, lifts[k]);
      gl.uniform1f(U.uCoc, coc);
      gl.uniform1i(U.uK, k);
      gl.uniform1f(U.uShadow, shadow * (P.shade ?? 1));
      gl.uniform1f(U.uHaze, clamp(((z - frontZ) / G.printW) * 0.09 * s, 0, 0.14) * (P.haze ?? 1));
      gl.uniform1f(U.uOpacity, 1);
      gl.bindTexture(gl.TEXTURE_2D, planeTex[k].t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.uniform1i(U.uOpen, 0);
    // The front mat: the page's own paper with the window cut out of it,
    // locked to the screen (the window is the image plane). It only takes
    // coverage away, so the page shows through it untouched (FINAL_FS). The
    // colour round the window is left as the overscanned cards drew it, so
    // the film's bloom and halation see the sky carry on past the cut, as a
    // lens would: no paper or grey veil creeping in to desaturate the edges.
    gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(U.uMat, 1);
    gl.uniform1f(U.uOpacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1i(U.uMat, 0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  // The thin halation ring, once per drawn scene (not per grain tick).
  const drawRing = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, ringT.fbo);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(ringP.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    const u = ringP.u;
    gl.uniform1i(u.uScene, 0);
    gl.uniform2f(u.uTexel, 1 / stage.canvas.width, 1 / stage.canvas.height);
    gl.uniform1f(u.uR, ring0.radius * stage.dpr);
    gl.uniform1f(u.uThr, film0.halationThreshold);
    gl.uniform1f(u.uFloor, ring0.floor);
    gl.uniform1f(u.uAmt, ring0.amount);
    gl.uniform1f(u.uMax, ring0.max);
    gl.uniform3f(u.uColor, ring0.color[0], ring0.color[1], ring0.color[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };

  const present = () => {
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
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  const frame = (dt, t) => {
    if (!sceneT) return;
    const now = performance.now();
    const p = stage.pointer;
    const age = (now - born) / 1000;
    const L = layout();

    // Intro: the print develops out of an overexposed white-blue, then
    // parts a little and closes, to show it can.
    if (!touched && !reduced && !held) {
      const hint = age > 1.5 && age < 2.7;
      split.to = hint ? 0.34 : 0;
      yaw.to = hint ? 9 : 0;
      pitch.to = hint ? -3 : 0;
      if (age > 3.5) touched = true;
    }
    const expT = reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.0, 0, 1));
    const exposure = film0.exposure + (held ? 0 : 2.4 * (1 - expT));

    if (grab) {
      const dx = p.x - grab.x;
      const dy = p.y - grab.y;
      const dist = Math.hypot(dx, dy);
      split.to = clamp(grab.s0 + (1 - grab.s0) * (1 - Math.exp(-dist / (L.printW * 0.32))), 0, 1);
      yaw.to = rubber(grab.y0 + dx * degPerPx(), MAX_YAW);
      pitch.to = rubber(grab.p0 - dy * degPerPx(), MAX_PITCH);
      stepSpring(split, 26, 1, dt);
      stepSpring(yaw, 26, 1, dt);
      stepSpring(pitch, 26, 1, dt);
    } else if (!held) {
      if (orient.on && orient.b != null) {
        const m = Math.hypot(orient.x, orient.y);
        split.to = clamp(m * 1.2, 0, 1);
        yaw.to = orient.x * MAX_YAW;
        pitch.to = -orient.y * MAX_PITCH;
      }
      stepSpring(split, 9, 0.86, dt);
      stepSpring(yaw, 9, 0.86, dt);
      stepSpring(pitch, 9, 0.86, dt);
      split.x = Math.max(0, split.x);
    }

    // Hover: the eye drifts a little with the pointer (parallax once open).
    const live = !grab && p.inside && !reduced && !held;
    hover.x = damp(hover.x, live ? (p.x / L.W - 0.5) * 3 : 0, 1 / 0.35, dt);
    hover.y = damp(hover.y, live ? -(p.y / L.H - 0.5) * 2 : 0, 1 / 0.35, dt);
    const idle = !grab && stage.idleFor() > 1500 && touched && !held && !reduced;
    breathe = damp(breathe, idle ? 1 : 0, 0.8, dt);
    const by = breathe * 0.4 * Math.sin((t * 2 * Math.PI) / 12.1);
    const bp = breathe * 0.3 * Math.sin((t * 2 * Math.PI) / 9.7 + 1.1);

    // Focus follows the plane under the pointer (or the signal).
    if (!held && (grab || p.inside) && split.x > 0.04) focusK.to = pick(p.x, p.y);
    else if (!held && split.x < 0.02) focusK.to = focusDefault;
    focusK.x = damp(focusK.x, focusK.to, 1 / 0.28, dt);
    const s = easeSplit(clamp(split.x, 0, 1.08));
    const G = geometry(s);
    const fk = focusK.x;
    const k0 = Math.floor(clamp(fk, 0, N - 1));
    const k1 = Math.min(N - 1, k0 + 1);
    const focusZ = G.zs[k0] + (G.zs[k1] - G.zs[k0]) * (fk - k0);

    let yawDeg = yaw.x + hover.x + by;
    let pitchDeg = pitch.x + hover.y + bp;
    // The window: the eye stops where a card's overscan runs out, so no
    // card edge ever comes into it. A hand that pushes further is held at
    // the edge, as by the mat itself.
    const cocs = G.zs.map((z, k) => cocFor(PLANES[k], z, s, focusZ) * stage.dpr);
    const limP = swingLimit(G, 0, pitchDeg, cocs, true);
    pitchDeg *= limP;
    const limY = swingLimit(G, yawDeg, pitchDeg, cocs, false);
    yawDeg *= limY;
    if (limP < 1 || limY < 1) {
      if (!held) {
        yaw.x = yawDeg - hover.x - by;
        pitch.x = pitchDeg - hover.y - bp;
        yaw.v = 0;
        pitch.v = 0;
      }
    }
    swing.yaw = yawDeg;
    swing.pitch = pitchDeg;
    const key = `${s.toFixed(5)}|${yawDeg.toFixed(4)}|${pitchDeg.toFixed(4)}|${focusZ.toFixed(2)}`;
    if (key !== lastKey || dirty) {
      drawScene(s, yawDeg, pitchDeg, focusZ);
      drawRing();
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // Film at 24 fps: the grain moves at the rate film did.
    const tick = reduced || held ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || exposure > 1e-3) {
      film.render(ringT.tex, { ...film0, exposure, grainSeed: tick * 7.31 }, filmT.fbo);
      present();
      lastGrain = tick;
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
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      for (const t of [sceneT, ringT, filmT]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const t of planeTex) gl.deleteTexture(t.t);
      gl.deleteTexture(mattes);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(plane.p);
      gl.deleteProgram(fin.p);
      gl.deleteProgram(ringP.p);
      stage.destroy();
    },
  };
}

// For a card's bitmap spanning rect (photo uv), the span across each side
// (left, top, right, bottom) over which its outermost px have any alpha, in
// photo uv; [Infinity, -Infinity] where that side is empty.
function edgeReach(bm, rect) {
  const w = 256;
  const h = Math.max(2, Math.round((w * bm.height) / bm.width));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bm, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const a = (x, y) => px[(y * w + x) * 4 + 3];
  const span = (n, hit, lo, hi) => {
    let a0 = Infinity;
    let a1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!hit(i)) continue;
      const t = lo + ((hi - lo) * (i + 0.5)) / n;
      a0 = Math.min(a0, t);
      a1 = Math.max(a1, t);
    }
    return [a0, a1];
  };
  const T = 12;
  const col = (x0) => (y) => a(x0, y) > T || a(x0 + (x0 ? -1 : 1), y) > T;
  const row = (y0) => (x) => a(x, y0) > T || a(x, y0 + (y0 ? -1 : 1)) > T;
  return [
    span(h, col(0), rect[1], rect[3]),
    span(w, row(0), rect[0], rect[2]),
    span(h, col(w - 1), rect[1], rect[3]),
    span(w, row(h - 1), rect[0], rect[2]),
  ];
}

function toR8(rgba, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = rgba[i * 4];
  return out;
}
