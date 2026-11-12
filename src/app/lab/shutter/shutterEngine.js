import { createStage } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";
import { createSound } from "@/lib/sound/engine";
import { takes } from "./shutterTakes";

// Shutter. A locked-off time-lapse from the foot of a tower, looking almost
// straight up its glass into summer cumulus. Press and hold and the shutter
// opens on bulb: the frame integrates the recorded light for as long as you
// hold, so the clouds smear into silk along their real wind while the tower,
// which never moved, stays sharp. Let go and the long exposure stays on the
// print until the next press.
//
// The integral is real. Offline (tools/depth/bakes/shutter/bake.py) the
// graded, looped plate is cut into blocks of 8 frames and each block's
// linear-light mean is baked (a time pyramid at block resolution, 960x540,
// lossless, OKLab with a 12-bit lightness: the print stretches the silk's
// lightness several times over, so the blocks must be smooth before it
// does), with the tower filled out of it from its own sky. Any open
// interval [a, a + T] is then a weighted sum of the blocks it covers, with
// partial weights at its ends: a prefix-sum query, done here in one pass at
// block resolution into a half-float target. The opening of an exposure is
// integrated live instead: from the frame the shutter opened on, every frame
// the viewfinder video decodes is added (by the time it covers) to a running
// mean at video resolution, so a short exposure is exactly what you saw,
// smearing frame by frame, and the blocks take over past the first second.
//
// Exposure is normalised by its length: an ND filter that follows the
// shutter, so brightness holds and only time grows, and nothing blows out.
// Normalised, though, minutes of cumulus over cobalt average to a pale
// lavender haze. So the integral is printed in OKLab: its lightness is kept,
// the gaps between the streaks take their chroma and hue back from a baked
// mean of the clear sky alone (sky.webp, tools/depth/bakes/shutter/sky.py;
// it carries the zenith ramp), the gaps fall back to that sky's depth, the
// streaks' crests are printed up toward a cloud's white, and past ~3 s the
// ND eases so a longer hold smooths the silk without flattening it. Every
// cloud, live or smeared, then takes its light back (cloudTone): a warm
// sunlit side toward the sun, a skylight-blue shade turned away.
//
// Sharpness: the moving layers are low resolution (sky is smooth, and smeared
// sky smoother). A still plate at full resolution (the mean of the whole loop)
// carries a stillness matte in alpha. Under the matte the print is the tower:
// for the live part of an exposure the live mean's light with the still's own
// fine detail added back at the matching blur (so the glass still shows its
// passing reflections in the viewfinder), for the blocks' part the still
// itself. Outside it the print is sky alone; the blocks carry no tower, so no
// low-resolution tower light can bleed into the smeared sky as a glow. No
// sharpening anywhere: the edge is the matte's, a pixel or two wide.
//
// Presented full-bleed: the plate covers the box (cropped at its long side),
// as a print would be trimmed to the frame.
//
// Develop: _kit/film.js, summer preset (Pro-Mist bloom, colour bleed, curve,
// 24 fps grain), then the print's top end (FINISH_FS): paper white, sunlit
// cream, and a narrow warm halation ring in place of the film's wide one.

const BASE = "/lab/shutter/";
const TAU = 1; // frames: the opening frame's share of a still (?open); each frame already carries its own interval
const LIVE_CAP = 24; // frames integrated live before the blocks take over
const AT = 96; // the plate frame a ?open still starts on, unless ?at= (seconds)

// Hold seconds -> exposure length in plate frames. Accelerating, like
// turning a shutter dial while you wait: a breath is a few minutes of real
// sky, six seconds is nearly the whole loop (one plate frame is several
// seconds of wind here, the cloud crossing ~1% of the frame per frame).
const framesFor = (h, N) => N * Math.min(1, (60 * h + 20 * h * h) / 1200);

// The print, by exposure length. A single frame carries the whole contrast
// of sunlit cumulus against cobalt and is metered for the cloud tops. An
// average over minutes of sky is flatter, and its colour is put back before
// development (keepSky). On top of that the long exposure is printed down a
// little, as a printer would print one: the meter falls, and the film's blue
// deepening and (a little) saturation rise, so the cobalt between the
// streaks reads as deep as in a short exposure.
// k: 0 for a single frame, ~0.4 at a 2 s hold, and capped at LONG_CAP
// (reached near 3 s): past it the print stops getting longer. Printed further
// down, the film's blue deepening turns the cobalt toward a pale cerulean and
// the frame flattens, so a longer hold smooths the silk (gainFor) on the same
// print instead of marbling it.
const LONG_CAP = 0.6;
const longness = (T, N) => Math.min(LONG_CAP, 1 - Math.exp(-T / (N * 0.3)));
const METER_SHORT = -0.4;
const METER_LONG = -0.75;

// The summer develop, eased for this plate. The bake already deepens the sky
// toward the zenith, so the film's own blue deepening is cut, or the top of
// the frame goes navy. The film's own halation is off: it is wide (1-3% of
// the frame), and over cobalt its red layer rings every white edge (the
// tower's frame, every cloud) in magenta, an electronic fringe. The narrow
// warm ring of FINISH_FS takes its place.
// The clear sky's colour comes back as the exposure grows past the live
// second (keepSky in the compose pass), and past ~3 s the hold keeps
// smoothing the silk without the ND flattening it further: the streaks'
// lightness about its local mean is stretched as the sqrt of the extra time,
// the rate a mean of independent skies loses its spread.
const keepFor = (T, N) => {
  const t = Math.min(1, Math.max(0, (T / N - 0.11) / 0.34));
  return t * t * (3 - 2 * t);
};
const HOLD_CONTRAST = 3; // s
const gainFor = (T, N) => Math.sqrt(Math.max(1, T / framesFor(HOLD_CONTRAST, N)));
const MEAN_FRAC = 1 / 8; // the local mean's scale, a fraction of the plate's width
const DETAIL_FRAC = 1 / 32; // the finer mean's (the crests' striations, keepSky)
const DEEP = 1; // the gaps' fall to the clear sky's depth, at full keep
const CREST = 1; // the crests' rise toward a cloud's white, at full keep
// The cloud's light (cloudTone): toward the sun is up and a little left in
// the frame (the glint on the tower's lit face), one tap is 1.2% of the
// plate's width; sunlit hue and chroma, and the shade's skylight chroma.
const SUN = [-0.5, -0.866];
const SUN_TAP = 0.012;
const TONE = { k: 1, hue: (72 * Math.PI) / 180, warm: 0.03, shade: 0.05, edge: 0.06 };

const LOOK = { ...FILM_DEFAULTS, ...FILM_PRESETS.summer, blueDepth: 0.4, halation: 0 };
// The top end (FINISH_FS): the highlights above the knee are printed back up
// by the stops the meter fell, so the tower lands on the same paper white at
// every hold.
const KNEE = 0.78;
const PAPER = 0.966;
const LIFT = 0.1; // stops over the meter-down
const STREAK_LIFT = 0.45; // the streaks' share of those stops
const GLINT_DETAIL = 0.5;
const CREAM_HUE = (80 * Math.PI) / 180;
const CREAM_C = 0.013;
const RING_PX = 3; // at DPR 2
const RING_C = 0.05;
const RING_HUE = (48 * Math.PI) / 180;
const develop = (T, N) => {
  const k = longness(T, N);
  return {
    ...LOOK,
    exposure: METER_SHORT + (METER_LONG - METER_SHORT) * k,
    saturation: LOOK.saturation + 0.2 * k,
    blueDepth: LOOK.blueDepth + 0.5 * k,
  };
};

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `
vec3 lin(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 enc(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 toLab(vec3 c){
  vec3 m = vec3(dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
                dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
                dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  m = pow(max(m, 0.0), vec3(1.0 / 3.0));
  return vec3(dot(m, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
              dot(m, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
              dot(m, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
}
vec3 fromLab(vec3 c){
  vec3 m = vec3(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z,
                c.x - 0.1055613458 * c.y - 0.0638541728 * c.z,
                c.x - 0.0894841775 * c.y - 1.2914855480 * c.z);
  m = m * m * m;
  return vec3(4.0767416621 * m.x - 3.3077115913 * m.y + 0.2309699292 * m.z,
              -1.2684380046 * m.x + 2.6097574011 * m.y - 0.3413193965 * m.z,
              -0.0041960863 * m.x - 0.7034186147 * m.y + 1.7076147010 * m.z);
}
`;

// The open interval as a weighted sum of baked block means (linear light).
// Each block texel is OKLab, losslessly stored: L at 12 bits over two bytes
// (G its top 8, A its low 4 in the high nibble), a and b in R and B. The
// bytes are read exactly (texelFetch: a filtered high byte would carry a
// wrong low byte with it), decoded to linear light and summed, at block
// resolution, one texel per texel.
const EXPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uA2;
uniform vec4 uBlk[64];   // atlas, column, row, weight
uniform int uCount;
uniform ivec2 uSize;     // block size in px
uniform float uAB;       // a, b range: byte 128 +- 127 is +- uAB
out vec4 o;
${COMMON}
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  p.y = uSize.y - 1 - p.y; // atlases are uploaded top row first
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 b = uBlk[i];
    ivec2 t = ivec2(b.yz) * uSize + p;
    vec4 c = b.x < 0.5 ? texelFetch(uA0, t, 0) : (b.x < 1.5 ? texelFetch(uA1, t, 0) : texelFetch(uA2, t, 0));
    vec4 q = floor(c * 255.0 + 0.5);
    float L = (q.g * 16.0 + floor(q.a / 16.0)) / 4095.0;
    vec2 ab = (q.rb - 128.0) / 127.0 * uAB;
    acc += max(fromLab(vec3(L, ab)), 0.0) * b.w;
  }
  o = vec4(acc, 1.0);
}`;

// The live part of an exposure: a running mean of decoded viewfinder frames,
// stored top row first like the images.
const ACC_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uVideo;
uniform vec2 uSize;
uniform float uK;          // new frame's share of the mean
out vec4 o;
${COMMON}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 v = lin(texture(uVideo, uv).rgb);
  o = vec4(mix(texture(uPrev, uv).rgb, v, uK), 1.0);
}`;

// The print before development: live part + blocks, with the still world's
// detail restored.
const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uStill;  // sRGB mean of the still plate, stillness matte in a
uniform sampler2D uFrame;  // the live mean (linear), or the viewfinder (sRGB)
uniform float uFrameLin;
uniform sampler2D uExp;    // linear block integral (GL orientation)
uniform vec2 uSize;
uniform vec4 uCover;       // plate uv = uv * xy + zw (full-bleed crop)
uniform float uWB;         // blocks' share of the exposure
uniform vec2 uLod;         // still lod at display, at frame res
uniform sampler2D uSky;    // sRGB time-mean of the clear sky alone
uniform float uKeep;       // how much of the clear sky's colour comes back
uniform float uGain;       // the eased ND: streak contrast held past ~3 s
uniform vec2 uLodM;        // local-mean lods: live mean, blocks
uniform vec3 uLodD;        // finer-mean lods (the crests' striations): live mean, blocks, still
uniform vec4 uDim;         // live mean, blocks: width, height in px
uniform float uDeep;       // how far the gaps between the streaks fall to the clear sky
uniform float uCrest;      // how far the streaks' crests are printed up toward white
uniform vec2 uSun;         // one tap toward the sun, in plate uv (y down)
uniform vec2 uLodT;        // the tone's lightness lods: live mean, blocks
uniform vec4 uTone;        // strength, sunlit hue (rad), sunlit chroma, shade chroma
uniform float uEdge;       // the lightness step across the taps that reads as a whole edge
out vec4 o;
${COMMON}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CREST_PUSH = 0.6;  // the crests' spread stretch about the local mean
const float CREST_LIFT = 0.55; // the shoulder's rise toward white at a full crest
const float CREST_ROLL = 0.88; // where the dodged crests start rolling into white
const float CREST_DETAIL = 4.0; // the striations' stretch about the finer mean
// The long exposure's colour. The integral averages cloud into sky, and
// normalised by its length that is a pale lavender haze with no zenith ramp.
// But between the streaks the sky was the same cobalt at every instant, so
// the print keeps the integral's lightness and, where it is not cloud, takes
// its chroma from the clear sky alone (the larger of the two), while the
// streaks keep their own pale chroma. The hue is the clear sky's throughout:
// blue and white averaged in linear light drift violet in OKLab, which a
// scan reads as a lavender cast on the silk.
vec3 keepSky(vec3 sl, vec3 ml, vec3 md, vec2 iuv){
  vec3 p = toLab(sl);
  vec3 m = toLab(ml);
  vec3 s = toLab(lin(texture(uSky, iuv).rgb));
  // The eased ND: past ~3 s the hold keeps smoothing the silk, but the
  // print holds its tone. More time takes in more of the slow cloud masses
  // and the mean pales toward them, so the mean's lift over the clear sky is
  // printed back down, and the streaks' spread about it is stretched back.
  float Lm = s.x + max(m.x - s.x, 0.0) * inversesqrt(uGain);
  float L = clamp(Lm + (p.x - m.x) * uGain, 0.0, 1.0);
  // Cloud weight, from lightness: 0 on clear sky, 1 on a cloud's white,
  // pushed apart about the local mean so the gaps between the streaks
  // read as gaps, not as a thinner haze.
  float span = max(0.94 - s.x, 0.1);
  float c = clamp((L - s.x) / span, 0.0, 1.0);
  float cm = clamp((Lm - s.x) / span, 0.0, 1.0);
  float w = clamp(c + (c - cm) * 1.75, 0.0, 1.0);
  // The streaks' crests, where the cloud kept passing, are printed up
  // toward a cloud's white (a dodge, as the gaps below are a burn), so the
  // silk still reads as cumulus dragged along the wind, not as a blue veil.
  // The dodge is a shoulder, not a mix to white: the crest's spread about
  // its local mean is stretched first, as the eased ND stretches it, and the
  // shoulder then keeps (1 - CREST_LIFT) of it, so a persistently cloudy
  // region still carries its striations along the wind instead of printing
  // as one flat cream value. Under a crest that persisted the whole hold the
  // broad mean is the cloud itself, so the striations are also stretched
  // about a finer mean (md, a few % of the plate): the wisps the cloud's
  // passage drew along the wind. The ramp is wide, so few pixels reach a
  // full crest.
  float crest = smoothstep(0.3, 1.0, w) * uCrest;
  // The finer mean straddles the tower wherever it is near: no striations
  // are read off its edge.
  float clear = 1.0 - smoothstep(0.02, 0.2, textureLod(uStill, iuv, uLodD.z).a);
  L = Lm + (L - Lm) * (1.0 + CREST_PUSH * crest) + (p.x - toLab(md).x) * uGain * CREST_DETAIL * crest * clear;
  L = 1.0 - (1.0 - L) * (1.0 - CREST_LIFT * crest);
  L = max(L, 0.0);
  // Whatever the push carries past the roll is rolled into white, never
  // clamped: a clamp is a plateau.
  float over = max(L - CREST_ROLL, 0.0);
  L = min(L, CREST_ROLL) + (1.0 - CREST_ROLL) * (1.0 - exp(-over / (1.0 - CREST_ROLL)));
  // Between the streaks the sky was the same clear cobalt whenever the
  // cloud was elsewhere, so the gaps keep its depth, not the mean's lift.
  L = mix(L, min(L, s.x), (1.0 - w) * uDeep);
  float Ci = length(p.yz);
  float Cs = length(s.yz);
  // A dodged crest keeps a floor of the clear sky's chroma (its hue is the
  // sky's below), so it stays a cool skylit white that cloudTone can still
  // warm on its sun side, not a colourless cream lozenge.
  float C = mix(mix(max(Ci, Cs), Ci * 0.85, w), max(0.25 * Cs, 0.02), 0.6 * crest);
  vec2 ab = s.yz / max(Cs, 1e-4) * C;
  return max(fromLab(vec3(L, mix(p.yz, ab, uKeep))), 0.0);
}
// The cloud's light. A normalised integral averages each cloud into a pale
// neutral streak, and the viewfinder's soft plate is not much better: grey
// white with no side to it. Cumulus at noon is lit from above: the side that
// faces the sun is a warm, sunlit white and the side turned away is lit only
// by the blue sky round it, a skylight blue a little darker. A streak is a
// cloud dragged along the wind, so its two edges are still those two sides.
// Which side a pixel sits on is read from the light itself: three taps
// toward the sun and three away, on a blurred level; where the sunward taps
// are darker (sky) and the far ones lighter (cloud), the pixel is a sunlit
// edge, and the reverse is the shade. The tower's own light is kept out of
// the taps by the stillness matte.
float srcL(vec2 iuv){
  vec3 f = textureLod(uFrame, iuv, uLodT.x).rgb;
  if (uFrameLin < 0.5) f = lin(f);
  vec3 e = textureLod(uExp, vec2(iuv.x, 1.0 - iuv.y), uLodT.y).rgb;
  return pow(max(dot(mix(f, e, uWB), LUMA), 0.0), 1.0 / 3.0);
}
vec3 cloudTone(vec3 sl, vec2 iuv){
  vec3 p = toLab(sl);
  vec3 s = toLab(lin(texture(uSky, iuv).rgb));
  float c = clamp((p.x - s.x) / max(0.94 - s.x, 0.1), 0.0, 1.0);
  if (c <= 0.0) return sl;
  float g = 0.0;
  float ws = 0.0;
  for (int i = 1; i <= 3; i++) {
    vec2 d = uSun * float(i);
    float w = (1.0 - textureLod(uStill, iuv - d, 4.0).a) * (1.0 - textureLod(uStill, iuv + d, 4.0).a);
    g += w * (srcL(iuv - d) - srcL(iuv + d));
    ws += w;
  }
  g /= max(ws, 1e-3);
  float top = smoothstep(0.0, uEdge, g);
  float under = smoothstep(0.0, uEdge, -g);
  // Sunlit is the cloud's bright body, most of all its sun-facing edge;
  // warmth goes only into light that is already near neutral, so a blue
  // streak never passes through green on its way to cream, and a mid-grey
  // never turns khaki. The rest of the cloud, its flanks and the side turned
  // away, is the shade: skylight blue, a little darker.
  float bright = smoothstep(0.6, 0.92, c);
  float Cp = length(p.yz);
  float sun = bright * clamp(0.4 + 0.6 * top - 0.4 * under, 0.0, 1.0) * (1.0 - smoothstep(0.03, 0.07, Cp));
  float shade = smoothstep(0.06, 0.4, c) * (1.0 - bright) * (0.45 + 0.55 * under);
  vec2 sky = s.yz / max(length(s.yz), 1e-4);
  vec2 ab = mix(p.yz, vec2(cos(uTone.y), sin(uTone.y)) * uTone.z, sun * uTone.x);
  ab = mix(ab, sky * max(Cp, uTone.w), shade * uTone.x);
  float L = p.x + (0.025 * sun - 0.04 * shade) * uTone.x;
  return max(fromLab(vec3(L, ab)), 0.0);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uSize * uCover.xy + uCover.zw;
  vec2 iuv = vec2(uv.x, 1.0 - uv.y);
  vec3 f = texture(uFrame, iuv).rgb;
  if (uFrameLin < 0.5) f = lin(f);
  vec3 e = texture(uExp, uv).rgb;
  vec3 sl = mix(f, e, uWB);
  if (uKeep > 0.0) {
    vec3 ml = mix(textureLod(uFrame, iuv, uLodM.x).rgb, textureLod(uExp, uv, uLodM.y).rgb, uWB);
    // The finer mean: four taps half a cell apart, so the mip's cells
    // never print as a grid.
    vec3 md = vec3(0.0);
    vec2 hf = exp2(uLodD.x) * 0.5 / uDim.xy;
    vec2 he = exp2(uLodD.y) * 0.5 / uDim.zw;
    for (int i = 0; i < 4; i++) {
      vec2 d = vec2(i == 0 || i == 3 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0);
      vec3 fd = textureLod(uFrame, iuv + d * hf, uLodD.x).rgb;
      vec3 ed = textureLod(uExp, uv + d * he, uLodD.y).rgb;
      md += mix(fd, ed, uWB) * 0.25;
    }
    sl = keepSky(sl, ml, md, iuv);
  }
  if (uTone.x > 0.0) sl = cloudTone(sl, iuv);
  vec3 sky = enc(sl);
  vec4 s = textureLod(uStill, iuv, uLod.x);
  vec3 dF = s.rgb - textureLod(uStill, iuv, uLod.y).rgb;
  vec3 tower = mix(clamp(enc(f) + dF, 0.0, 1.0), s.rgb, uWB);
  o = vec4(mix(sky, tower, s.a), 1.0);
}`;

// The print's top end, after development, in OKLab. The long exposure is
// metered down (so minutes of cloud do not pale the sky), and a meter that
// falls takes the white tower and the cloud tops down with it into a
// blue-grey card. A printer would hold the paper white: above L ~0.78 the
// neutral highlights are printed back up in linear light by the stops the
// meter fell and rolled into it on a shoulder (a gain, so the glass's
// texture inside a highlight keeps its steps), and the near-whites turn from the
// film's cool to sunlit cream (hue ~80 deg, a hair of chroma). Coloured light
// (the cobalt, the cyan, the glass) is gated out by its chroma and never
// moves; the silk's pale streaks take only part of the lift, so the sky's
// tone holds.
// Halation, here, is the narrow kind: a 2-4 device-px warm ring on the
// bright side of the tower's sunlit edge against the sky and round the sun's
// glint on the glass, where the red layer has taken extra light. It sits on
// the white, never on the cobalt, so it cannot read as a magenta fringe. The
// glint's blown centre goes to a hot paper white; its edge keeps the mullions.
const FINISH_FS = `#version 300 es
precision highp float;
uniform sampler2D uDev;    // developed print (sRGB, GL orientation)
uniform sampler2D uStill;  // sRGB still plate, stillness matte in a
uniform vec2 uSize;
uniform vec4 uCover;
uniform float uLodS;       // still lod at display
uniform vec2 uLift;        // highlight gain (linear); the streaks' share of its stops
uniform vec2 uKnee;        // lightness where the shoulder starts, paper white
uniform float uDetail;     // the glint's mullions put back
uniform vec3 uCream;       // cream: hue (rad), chroma, strength
uniform vec3 uRing;        // ring: radius (device px), chroma, hue (rad)
out vec4 o;
${COMMON}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec4 stillAt(vec2 iuv){ return textureLod(uStill, iuv, uLodS); }
float lumaOf(vec3 s){ return dot(lin(s), LUMA); }
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec3 c = max(lin(texture(uDev, fc / uSize).rgb), 0.0);
  vec3 p = toLab(c);
  vec2 uv = fc / uSize * uCover.xy + uCover.zw;
  vec2 iuv = vec2(uv.x, 1.0 - uv.y);
  vec4 s = stillAt(iuv);
  float m = s.a;
  float C = length(p.yz);
  float neutral = 1.0 - smoothstep(0.03, 0.07, C);

  // The shoulder. In linear light the neutral highlights are printed
  // back up by the stops the meter fell (uLift.x), the silk's streaks by a
  // share of them, then rolled into paper white: ratios hold, so the
  // glass's steps inside a highlight survive the lift.
  // On the tower the weight is judged on the still (grain-free, sharp), so
  // the shoulder follows the cladding and the glass, not the grain.
  float Y = p.x * p.x * p.x;
  float Ys = lumaOf(s.rgb);
  float wl = mix(smoothstep(uKnee.x - 0.04, uKnee.x + 0.04, p.x) * neutral, smoothstep(0.45, 0.88, Ys), m);
  float g = pow(uLift.x, mix(uLift.y, 1.0, m));
  float Yl = Y * mix(1.0, g, wl);
  float Yp = uKnee.y * uKnee.y * uKnee.y;
  Yl = Yl / pow(1.0 + pow(Yl / Yp, 8.0), 0.125);
  float L = mix(p.x, pow(Yl, 1.0 / 3.0), wl);

  // Sunlit cream on the near-whites.
  float wc = smoothstep(uKnee.x + 0.04, uKnee.y - 0.03, L) * neutral * mix(0.6, 1.0, m) * uCream.z;
  // A cloud's sunlit top already carries its own warmth (cloudTone): the
  // cream never thins it.
  vec2 cd = vec2(cos(uCream.x), sin(uCream.x));
  vec2 ab = mix(p.yz, cd * max(uCream.y, dot(p.yz, cd)), wc);

  // Where the still is a sunlit white (cladding, the glint), and how much of
  // it the ring sees: the tower's edge against the sky, and the edge of the
  // glint's blown core.
  float lit = smoothstep(0.72, 0.9, Ys) * m;
  // The glint is the one white wider than the cladding's bands: at 1/32 of
  // the plate it alone stays near white.
  float core = smoothstep(0.8, 0.9, lumaOf(textureLod(uStill, iuv, uLodS + 5.0).rgb)) * m;
  vec2 st = uRing.x / uSize * uCover.xy * vec2(1.0, -1.0);
  float mA = 0.0;
  float yA = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    vec4 t = stillAt(iuv + vec2(cos(a), sin(a)) * st);
    mA += t.a;
    yA += smoothstep(0.82, 0.97, lumaOf(t.rgb)) * t.a;
  }
  mA /= 8.0;
  yA /= 8.0;
  float edge = clamp((m - mA) * 2.5, 0.0, 1.0);
  float hot = smoothstep(0.82, 0.97, Ys) * m;
  float rim = clamp((hot - yA) * 2.0, 0.0, 1.0) * core;
  // Kept inside the matte, where the pixel is all white: on a pixel the
  // sky shares, orange over cobalt would be the magenta fringe again.
  float ring = lit * max(edge, rim) * smoothstep(0.6, 0.95, m);

  // The glint: its blown centre a hot white, and round it the mullions the
  // develop's glare washed out, put back from the still's own fine detail
  // (only here, and only in the highlight).
  float blown = smoothstep(0.9, 0.95, Ys) * core;
  float d = Ys - lumaOf(textureLod(uStill, iuv, uLodS + 1.5).rgb);
  L += uDetail * d * core * smoothstep(uKnee.x, uKnee.y, L) * (1.0 - blown);
  L = mix(L, max(L, uKnee.y + 0.022), blown);
  ab *= 1.0 - 0.7 * blown;

  ab = mix(ab, vec2(cos(uRing.z), sin(uRing.z)) * uRing.y, ring);
  L -= 0.025 * ring;
  o = vec4(enc(max(fromLab(vec3(L, ab)), 0.0)), 1.0);
}`;

// Print onto the page: the developed frame, and the last one fading out
// under it when a new exposure starts.
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uMix;        // 1 = all current
uniform vec4 uRect;
uniform float uZoom;       // the print giving under the finger, < 1 zooms in
out vec4 o;
void main(){
  vec2 uv = 0.5 + ((gl_FragCoord.xy - uRect.xy) / uRect.zw - 0.5) * uZoom;
  vec3 c = texture(uCur, uv).rgb;
  if (uMix < 1.0) c = mix(texture(uPrev, uv).rgb, c, uMix);
  o = vec4(c, 1.0);
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

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function texture(gl, src, { mips = false } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return null;
  }
  return { tex, fbo, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function makeVideo() {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "");
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  for (const [src, type] of [
    [`${BASE}plate.webm`, 'video/webm; codecs="vp9"'],
    [`${BASE}plate.mp4`, 'video/mp4; codecs="avc1.640028"'],
  ]) {
    if (v.canPlayType(type)) {
      v.src = src;
      break;
    }
  }
  if (!v.src) v.src = `${BASE}plate.mp4`;
  return v;
}

const once = (el, ev) => new Promise((res) => el.addEventListener(ev, res, { once: true }));

function createShutterSound() {
  const sound = createSound({ level: -4, room: 0.1, on: true });
  if (!sound.ctx) return null;
  const open = sound.bank(takes.open.render, takes.open);
  const close = sound.bank(takes.close.render, takes.close);
  return {
    open() {
      sound.unlock();
      if (sound.live) sound.play(open, { gain: -7 + (Math.random() * 2 - 1), rate: 0.98 + Math.random() * 0.04 });
    },
    close(seconds) {
      if (!sound.live) return;
      // A longer exposure lets the curtain spring wind a touch further.
      sound.play(close, { gain: -6 + Math.min(1.5, seconds * 0.3) + (Math.random() * 2 - 1), rate: 0.98 + Math.random() * 0.04 });
    },
    destroy() {
      sound.destroy();
    },
  };
}

export async function createShutter(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixedOpen = params.has("open") ? Math.max(0, parseFloat(params.get("open")) || 0) : null;
  const still = fixedOpen != null || params.has("still");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const meta = await (await fetch(`${BASE}bake.json`)).json();
  const N = meta.frames;
  const B = meta.block;
  const NB = meta.blocks;
  const FPS = meta.fps;
  const [GX, GY] = meta.atlas;
  const [BW, BH] = meta.blockSize;
  const [, , SW, SH] = meta.crop;
  const [VW] = meta.video;
  const atStart = params.has("at") ? (((parseFloat(params.get("at")) || 0) * FPS) % N + N) % N : AT;

  const video = makeVideo();
  const [stillImg, skyImg, ...atlasImgs] = await Promise.all([bitmap(`${BASE}still.webp`), bitmap(`${BASE}sky.webp`), ...meta.atlases.map((a) => bitmap(BASE + a))]);
  if (video.readyState < 2) await Promise.race([once(video, "loadeddata"), once(video, "error")]);

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "button");
  canvas.setAttribute("aria-label", "Shutter, press and hold to expose");
  canvas.setAttribute("aria-pressed", "false");
  canvas.style.outline = "none";
  const half = !!gl.getExtension("EXT_color_buffer_float");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    expose: compile(gl, VS, EXPOSE_FS),
    acc: compile(gl, VS, ACC_FS),
    compose: compile(gl, VS, COMPOSE_FS),
    finish: compile(gl, VS, FINISH_FS),
    blit: compile(gl, VS, BLIT_FS),
  };
  const stillTex = texture(gl, stillImg, { mips: true });
  const atlasTex = atlasImgs.map((img) => texture(gl, img));
  const skyTex = texture(gl, skyImg);
  stillImg.close?.();
  skyImg.close?.();
  atlasImgs.forEach((i) => i.close?.());
  const liveTex = texture(gl, null);
  const pressTex = texture(gl, null);
  let liveReady = false;
  const exp = target(gl, BW, BH, half) || target(gl, BW, BH, false);
  const VH = meta.video[1];
  let acc = [0, 1].map(() => target(gl, VW, VH, half) || target(gl, VW, VH, false));
  // The live mean and the block integral carry mips: their coarse levels
  // are the local mean the long exposure's colour is judged against. The
  // levels are allocated now (a mip-filtered texture without them is
  // incomplete and samples black) and refreshed whenever they are read.
  for (const t of [exp, ...acc]) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  let accMips = false;

  const uploadVideo = (tex) => {
    if (video.readyState < 2) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    return true;
  };

  // The print: full-bleed. The plate covers the box, cropped at its long side.
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  const cover = [1, 1, 0, 0];
  let film = null;
  let comp = null;
  let raw = null; // the developed frame before its top end is printed
  let dev = [null, null]; // developed frames: current, previous
  const layout = (w, h, dpr) => {
    rect.w = Math.max(1, Math.round(w));
    rect.h = Math.max(1, Math.round(h));
    rect.x = 0;
    rect.y = 0;
    const box = rect.w / rect.h;
    const plate = SW / SH;
    cover[0] = box < plate ? box / plate : 1;
    cover[1] = box < plate ? 1 : plate / box;
    cover[2] = (1 - cover[0]) / 2;
    cover[3] = (1 - cover[1]) / 2;
    const dw = Math.round(rect.w * dpr);
    const dh = Math.round(rect.h * dpr);
    freeTarget(gl, comp);
    freeTarget(gl, raw);
    raw = target(gl, dw, dh, false);
    dev.forEach((d) => freeTarget(gl, d));
    comp = target(gl, dw, dh, false);
    dev = [target(gl, dw, dh, false), target(gl, dw, dh, false)];
    if (!film) film = createFilm(gl, { width: dw, height: dh });
    else film.resize(dw, dh);
  };

  // Exposure state, in plate frames.
  const shot = { a: atStart, T: 0, hold: 0, t0: 0, open: false, any: fixedOpen != null, L: 0, last: 0, live: false };
  let fade = 1; // 0..1 cross-fade from the previous print
  let press = { s: 1, v: 0, target: 1 };
  let dirty = true;
  let expDirty = true;
  let seed = 3;
  let grainT = 0;
  let reveal = still || reduced ? null : { t: 0, dur: 2.0, from: 2.5 };
  let exposureEV = reveal ? reveal.from : 0;

  // Blocks covering [p, q] (frames, may run past the loop end), merged by
  // index, weights normalised to the blocks' share.
  const blockList = new Float32Array(64 * 4);
  let blockCount = 0;
  const computeBlocks = (p, q) => {
    const w = new Float32Array(NB);
    const len = Math.max(1e-6, q - p);
    for (let j = Math.floor(p / B); j * B < q; j++) {
      const lo = Math.max(p, j * B);
      const hi = Math.min(q, (j + 1) * B);
      if (hi > lo) w[((j % NB) + NB) % NB] += (hi - lo) / len;
    }
    blockCount = 0;
    const per = GX * GY;
    for (let k = 0; k < NB && blockCount < 64; k++) {
      if (w[k] <= 0) continue;
      const a = Math.floor(k / per);
      const r = k % per;
      blockList.set([a, r % GX, Math.floor(r / GX), w[k]], blockCount * 4);
      blockCount++;
    }
  };

  const draw = () => {
    if (!comp || !film) return;
    const dpr = stage.dpr;
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);

    // 1. The block integral, only when the interval changed.
    const T = shot.T;
    const L = shot.L;
    const wB = T > L ? (T - L) / T : 0;
    if (expDirty && wB > 0) {
      computeBlocks(shot.a + L, shot.a + T);
      const u = P.expose.u;
      gl.useProgram(P.expose.p);
      atlasTex.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform1i(u.uA0, 0);
      gl.uniform1i(u.uA1, Math.min(1, atlasTex.length - 1));
      gl.uniform1i(u.uA2, Math.min(2, atlasTex.length - 1));
      gl.uniform4fv(u.uBlk, blockList);
      gl.uniform1i(u.uCount, blockCount);
      gl.uniform2i(u.uSize, BW, BH);
      gl.uniform1f(u.uAB, meta.ab);
      gl.bindFramebuffer(gl.FRAMEBUFFER, exp.fbo);
      gl.viewport(0, 0, BW, BH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, exp.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      expDirty = false;
    }
    const keep = shot.any && wB > 0 ? keepFor(T, N) : 0;
    if (shot.any && !accMips) {
      gl.bindTexture(gl.TEXTURE_2D, acc[0].tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      accMips = true;
    }

    // 2. Compose the latent image.
    const u = P.compose.u;
    gl.useProgram(P.compose.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stillTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shot.any ? acc[0].tex : liveTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, exp.tex);
    gl.uniform1i(u.uStill, 0);
    gl.uniform1i(u.uFrame, 1);
    gl.uniform1i(u.uExp, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.uniform1i(u.uSky, 3);
    gl.uniform1f(u.uKeep, keep);
    gl.uniform1f(u.uGain, keep > 0 ? gainFor(T, N) : 1);
    gl.uniform2f(u.uLodM, Math.log2(VW * MEAN_FRAC), Math.log2(BW * MEAN_FRAC));
    gl.uniform3f(u.uLodD, Math.log2(VW * DETAIL_FRAC), Math.log2(BW * DETAIL_FRAC), Math.log2(SW * DETAIL_FRAC));
    gl.uniform4f(u.uDim, VW, VH, BW, BH);
    gl.uniform1f(u.uDeep, DEEP * keep);
    gl.uniform1f(u.uCrest, CREST * keep);
    gl.uniform2f(u.uSun, SUN[0] * SUN_TAP, SUN[1] * SUN_TAP * (SW / SH));
    gl.uniform2f(u.uLodT, 3, 3 + Math.log2(BW / VW)); // both ~160 px across
    gl.uniform4f(u.uTone, TONE.k, TONE.hue, TONE.warm, TONE.shade);
    // The integral's edges are softer the longer it runs; the crests and
    // gaps are printed apart (keepSky), so its edges are read finer.
    gl.uniform1f(u.uEdge, TONE.edge * (1 - 0.7 * keep));
    gl.uniform2f(u.uSize, comp.w, comp.h);
    gl.uniform4fv(u.uCover, cover);
    gl.uniform1f(u.uWB, wB);
    gl.uniform1f(u.uFrameLin, shot.any ? 1 : 0);
    const lodD = Math.max(0, Math.log2((SW * cover[0]) / comp.w));
    gl.uniform2f(u.uLod, lodD, Math.max(lodD, Math.log2(SW / VW)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, comp.fbo);
    gl.viewport(0, 0, comp.w, comp.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Develop.
    const look = develop(T, N);
    film.render(comp.tex, { ...look, exposure: exposureEV + look.exposure, grainSeed: seed }, raw.fbo);

    // 4. The top end: paper white, cream, the narrow halation ring.
    gl.bindVertexArray(vao);
    const fu = P.finish.u;
    gl.useProgram(P.finish.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, raw.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, stillTex);
    gl.uniform1i(fu.uDev, 0);
    gl.uniform1i(fu.uStill, 1);
    gl.uniform2f(fu.uSize, raw.w, raw.h);
    gl.uniform4fv(fu.uCover, cover);
    gl.uniform1f(fu.uLodS, lodD);
    gl.uniform2f(fu.uLift, 2 ** (LIFT - look.exposure), STREAK_LIFT);
    gl.uniform1f(fu.uDetail, GLINT_DETAIL);
    gl.uniform2f(fu.uKnee, KNEE, PAPER);
    gl.uniform3f(fu.uCream, CREAM_HUE, CREAM_C, 1);
    gl.uniform3f(fu.uRing, RING_PX * (dpr / 2), RING_C, RING_HUE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dev[0].fbo);
    gl.viewport(0, 0, dev[0].w, dev[0].h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5. Print onto the paper.
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const cw = canvas.width;
    const ch = canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pw = Math.round(rect.w * dpr);
    const ph = Math.round(rect.h * dpr);
    const px = Math.round(rect.x * dpr);
    const py = ch - Math.round(rect.y * dpr) - ph;
    gl.viewport(px, py, pw, ph);
    const b = P.blit.u;
    gl.useProgram(P.blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dev[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dev[1].tex);
    gl.uniform1i(b.uCur, 0);
    gl.uniform1i(b.uPrev, 1);
    gl.uniform1f(b.uMix, fade);
    gl.uniform4f(b.uRect, px, py, pw, ph);
    gl.uniform1f(b.uZoom, press.s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Keep the last developed print to fade out under a new exposure.
  const keepPrint = () => {
    dev = [dev[1], dev[0]];
    fade = 0;
  };

  // Add the frame in `src` to the live mean with weight w (frames).
  const accumulate = (src, w) => {
    const k = w / (shot.L + w);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.useProgram(P.acc.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, acc[0].tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(P.acc.u.uPrev, 0);
    gl.uniform1i(P.acc.u.uVideo, 1);
    gl.uniform2f(P.acc.u.uSize, VW, VH);
    gl.uniform1f(P.acc.u.uK, k);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc[1].fbo);
    gl.viewport(0, 0, VW, VH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    acc = [acc[1], acc[0]];
    accMips = false;
    shot.L += w;
  };

  const inside = (p, slop = 12) => p.x > rect.x - slop && p.x < rect.x + rect.w + slop && p.y > rect.y - slop && p.y < rect.y + rect.h + slop;

  let sound = null;
  const openShutter = () => {
    if (shot.open || still) return;
    if (!sound) sound = createShutterSound();
    sound?.open();
    reveal = null;
    exposureEV = 0;
    if (shot.any) keepPrint();
    uploadVideo(pressTex);
    shot.a = ((video.currentTime * FPS) % N + N) % N;
    shot.last = video.currentTime;
    shot.T = 0;
    shot.hold = 0;
    shot.t0 = performance.now();
    shot.L = 0;
    shot.live = true;
    accumulate(pressTex, 1);
    shot.open = true;
    shot.any = true;
    expDirty = true;
    press.target = 0.994;
    canvas.setAttribute("aria-pressed", "true");
    dirty = true;
  };
  const closeShutter = () => {
    if (!shot.open) return;
    shot.open = false;
    sound?.close(shot.hold);
    press.target = 1;
    canvas.setAttribute("aria-pressed", "false");
    dirty = true;
  };

  stage.on("down", (p) => {
    if (inside(p)) openShutter();
  });
  stage.on("up", () => closeShutter());
  const onKeyDown = (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      openShutter();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      closeShutter();
    }
  };
  const onBlur = () => closeShutter();
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", onBlur);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  stage.onResize((w, h, dpr) => {
    layout(w, h, dpr);
    dirty = true;
  });

  // Video frames: upload each new one while the viewfinder shows it.
  let lastVideoTime = -1;
  const pumpVideo = () => {
    if (video.readyState < 2) return;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      if (!shot.any) {
        uploadVideo(liveTex);
        liveReady = true;
        dirty = true;
      } else if (shot.open && shot.live) {
        // The frames the video has moved on since the last one, wrapping at
        // the loop; a dropped frame just carries more weight. A long stall
        // (a slow device, a background tab) ends the live part there, and
        // the blocks take the rest of the interval from that point.
        let w = (video.currentTime - shot.last) * FPS;
        if (w < 0) w += N;
        shot.last = video.currentTime;
        if (w > 6) shot.live = false;
        else if (w > 0.25) {
          uploadVideo(liveTex);
          accumulate(liveTex, Math.min(w, LIVE_CAP - shot.L));
          if (shot.L >= LIVE_CAP) shot.live = false;
          expDirty = true;
          dirty = true;
        }
      }
    }
  };

  if (still) {
    // A held exposure (or the viewfinder) at a fixed moment: seek, capture,
    // render once.
    video.pause();
    video.currentTime = atStart / FPS;
    await Promise.race([once(video, "seeked"), new Promise((r) => setTimeout(r, 4000))]);
    uploadVideo(pressTex);
    uploadVideo(liveTex);
    liveReady = true;
    shot.L = 0;
    accumulate(pressTex, TAU);
    shot.a = atStart;
    shot.T = fixedOpen != null ? framesFor(fixedOpen, N) : 0;
    shot.hold = fixedOpen ?? 0;
    expDirty = true;
  } else {
    if (!reduced) video.play().catch(() => {});
    else {
      video.currentTime = atStart / FPS;
      await Promise.race([once(video, "seeked"), new Promise((r) => setTimeout(r, 3000))]);
    }
  }

  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

  stage.onFrame((dt) => {
    if (!still) pumpVideo();
    if (shot.open) {
      // Wall-clock time, not frame time: a slow frame must not shorten the
      // exposure the finger asked for.
      shot.hold = (performance.now() - shot.t0) / 1000;
      const T = framesFor(shot.hold, N);
      if (T !== shot.T) {
        shot.T = T;
        expDirty = true;
        dirty = true;
      }
    }
    if (reveal) {
      // Opens overexposed, a white-blue field, and the sky deepens into
      // cobalt as the eye adjusts.
      reveal.t += dt;
      const k = easeOutExpo(Math.min(1, reveal.t / reveal.dur));
      exposureEV = reveal.from * (1 - k);
      if (reveal.t >= reveal.dur) {
        reveal = null;
        exposureEV = 0;
      }
      dirty = true;
    }
    if (fade < 1) {
      fade = Math.min(1, fade + dt / 0.22);
      dirty = true;
    }
    // The print gives under the finger: a stiff spring, damping 0.85.
    if (press.s !== press.target || press.v !== 0) {
      const w = 38;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -2 * z * w * press.v - w * w * (press.s - press.target);
        press.v += a * h;
        press.s += press.v * h;
      }
      if (Math.abs(press.s - press.target) < 1e-5 && Math.abs(press.v) < 1e-4) {
        press.s = press.target;
        press.v = 0;
      }
      dirty = true;
    }
    // Grain at 24 fps, like a projected strip.
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty && (liveReady || shot.any)) {
      dirty = false;
      draw();
    }
  });
  void embedded;

  return {
    destroy() {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
      video.pause();
      video.removeAttribute("src");
      video.load();
      sound?.destroy();
      film?.destroy();
      freeTarget(gl, comp);
      freeTarget(gl, raw);
      dev.forEach((d) => freeTarget(gl, d));
      freeTarget(gl, exp);
      acc.forEach((t) => freeTarget(gl, t));
      [stillTex, skyTex, liveTex, pressTex, ...atlasTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}

