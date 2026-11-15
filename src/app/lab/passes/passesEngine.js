import { createStage, clamp } from "../_kit/stage";

// One photograph, relit by a sun you can move. The plate is Jakob Owens'
// worm's-eye frame of Tokyo Tower between two building faces, full bleed.
// The passes a renderer keeps never show: they live only in the shader.
// Everything but the light is baked offline (tools/depth/bakes/passes.py):
// the photo; an albedo with the daylight shading divided out; the Depth
// Anything V2 map as 16 bits across R and G, with depth minus a wide blur in
// B; MoGe-2 normals; and mattes for the sky (R) and the tower (G). B is the
// whole sky: R with the holes in the tower's lattice added, keyed and unmixed
// at the source's full 4000 px (tools/depth/bakes/passes-gaps.py), and the
// albedo there holds the steel alone, the plate's haze taken out of it.
// That key only believed a gap beside clean sky, so the white mid-section,
// where every gap is a mix of haze and cream paint, kept its haze; a finer
// key of the tower's box (tools/depth/bakes/passes/lattice.py) is taken over
// it by max, with the steel in its gaps unmixed from the haze the same way.
//
// The drag is the sun: across is its azimuth around the camera (straight
// ahead, behind the tower, in the middle; behind your shoulder at either
// edge), up and down its elevation. The concrete faces and the tower's
// lattice take a warm key from it, shaded by the MoGe normals and kept out of
// the creases the depth map finds, and a cyan fill from the open sky.
//
// The plate's own sky was flat haze, so inside the sky matte it is replaced by
// a photographed summer cumulus dome (Poly Haven, Rural Asphalt Road, Alexander Scholten, CC0;
// tools/depth/bakes/passes-sky.py): piled cumulus with hard sunlit tops and
// blue-shadowed bases, towering, with clear deep blue over them. Each
// pixel looks it up along its true camera ray, the plate's pitch and lens, so
// the clouds converge on the same vanishing point as the buildings. The dome
// turns with the dragged sun so its tallest bank stands on the sun's side
// of the canyon, filling its lower half behind the tower, and the open
// canyon above stays cobalt. The sun itself is drawn where the light stands.
//
// Plate and dome are then developed as one exposure: a single film pass over
// the matted frame spreads its highlights (a warm Pro-Mist diffusion), throws
// a thin red halation ring onto the dark side of every bright edge, and lays
// one fine luminance grain field, stepping at 24 fps, over sky and concrete
// alike.

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uAlbedo, uDepth, uNormal, uMatte, uLattice, uSteel, uSky, uSkyBlue, uWall, uFacade;
uniform vec2 uRes;        // canvas px
uniform vec4 uMap;        // image uv = frag * uMap.xy + uMap.zw (cover fit)
uniform vec3 uSun;        // unit direction to the sun, camera space (x right, y up, z to the viewer)
uniform vec3 uSunCol;     // key colour times intensity, linear
uniform vec3 uUp;         // world up, camera space
uniform float uDay;       // 0 at the horizon, 1 with the sun high
uniform mat3 uDome;       // camera ray -> (toward the dome's cumulus bank, to its right, up), as columns
out vec4 o;

const vec2 TEX = vec2(2048.0, 1536.0);
const float ASPECT = 2048.0 / 1536.0;
// The lattice key's box in the plate, px: x, y, width, height
// (tools/depth/bakes/passes/lattice.py, BOX).
const vec4 LATTICE = vec4(752.0, 448.0, 512.0, 1088.0);
// Where the deck's underside meets the truss, plate px down: above it the
// tower is the deck and the mast, closed surfaces, and below it open lattice.
const float DECK_FOOT = 850.0;
// The plate's lens, 2 tan(fov_x / 2): 55 degrees across. Its verticals meet
// 0.9 frame heights above the centre; with the camera pitched 55 degrees up
// (PITCH) that is where the zenith stands for this lens, so sky rays through
// it converge with the walls.
const float LENS = 1.034;
// The sky dome: where its tallest cumulus bank stands across the equirect.
const float SKY_U = 0.24;
// The clouds are graded as lit volumes, not shown as the photograph's white:
// their sunlit crowns a warm white just under paper, their bodies a pale
// grey-blue, their bases the open sky's light. All three are given as the
// print would show them (display rgb) and taken back through the tone
// curve, so the range lands exactly there and is not piled into the crown.
// The crowns glow: the film's diffusion and halation take what is over 0.84
// in luma.
const vec3 CLOUD_LIT = vec3(252.0, 248.0, 238.0) / 255.0;
const vec3 CLOUD_BODY = vec3(200.0, 214.0, 230.0) / 255.0;
const vec3 CLOUD_SHADE = vec3(143.0, 180.0, 216.0) / 255.0;
// The open sky as the print shows it, by the ray's elevation: a clear
// cerulean just over the wall tops (the frame's lowest sky, 38 degrees up)
// deepening to cobalt at the top of the frame (72 degrees). The dome's own
// blue layer only modulates it, a few percent either way.
const vec3 SKY_LOW = vec3(79.0, 159.0, 214.0) / 255.0;
const vec3 SKY_HIGH = vec3(16.0, 80.0, 148.0) / 255.0;
// Tone curve: a shoulder that rolls off before white.
const float EXPO = 1.35;
// The walls' albedo is brought up from the shade the plate was shot in by
// twenty times, its contrast spread about WALL_MID. That luminance comes
// denoised from its own bake (tools/depth/bakes/passes/walls.py), already
// gained and stored over WALL_RANGE.
const float WALL_RANGE = 1.5;
const float WALL_MID = 0.6;
// The walls are one pale concrete under two lights that do not agree, and
// the canyon is the split between them. The sun's side prints a warm amber,
// not a white: lit concrete at WALL_LIT, about 200 in luma, well under the
// crowns, so the colour is the sun's and not paper's. The side turned away
// prints the open sky's cyan at WALL_SHADE, close to two stops down. Both
// are given as the print shows them (display rgb) for the reference sun,
// the hero's (low in the east, 10 degrees up: SUN_REF is its colour from
// sunFor, FILL_REF its sky's day factor), and taken back through the tone
// curve to the two lights that land them on concrete of WALL_MID. The sun's
// light on the walls is then its own colour times what the reference took,
// so a higher, whiter, stronger sun pales and lifts the lit face and a
// setting one deepens it to orange: the drag moves their colour, not only
// their level.
const vec3 WALL_LIT = vec3(1.0, 0.86, 0.66) * 0.92;
const vec3 WALL_SHADE = vec3(66.0, 100.0, 138.0) / 255.0;
const vec3 SUN_REF = vec3(1.0, 0.653, 0.424) * 2.42;
const float FILL_REF = 0.7;
// Where a vertical face's sky visibility sits (skyVis with n level).
const float SKY_VERT = 0.55;

vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 tone(vec3 x){ return pow(x * EXPO / (1.0 + x * EXPO), vec3(1.0 / 2.2)); }
// Its inverse: the light that prints as y.
vec3 untone(vec3 y){ vec3 t = pow(y, vec3(2.2)); return t / (1.0 - t) / EXPO; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The dome's layers as stored: x = K s / (1 - s), s = y ^ 2.2.
vec3 skyDecode(vec3 y, float k){ vec3 s = min(pow(y, vec3(2.2)), vec3(0.9975)); return k * s / (1.0 - s); }
// The equirect's coordinate for a direction in the dome's frame.
vec2 domeST(vec3 D){ return vec2(SKY_U + atan(D.y, D.x) / 6.2831853, 1.0 - asin(clamp(D.z, -1.0, 1.0)) / 1.5707963); }
// How much cloud stands along a dome direction, read from a soft mip: the
// clouds' layer is already what they add over the clear sky, so its
// luminance is the cloud alone. A fixed mip, so the seam needs no care.
float density(vec3 D, float lod){ return luma(skyDecode(textureLod(uSky, domeST(D), lod).rgb, 4.0)); }
// D turned toward T by a (radians), along the great circle between them.
vec3 toward(vec3 D, vec3 T, float a){
  vec3 t = T - D * dot(T, D);
  float l = length(t);
  return l < 1e-4 ? D : normalize(D * cos(a) + t / l * sin(a));
}

// The photographed bank is soft, lit from behind, with little inside it, so
// the lobes a cumulus is built of are laid in: a field of round domes on the
// sky, one to a cell, joined by a soft maximum so they crowd and swell into
// each other like cauliflower, with no seam where two meet. Returns the
// slope of that surface, in cells.
vec2 hash2(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec2 billow(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float sw = 1e-4;
  vec2 sg = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(float(x), float(y));
    vec2 h = hash2(i + c);
    vec2 d = f - (c + 0.15 + 0.7 * h);
    float r2 = pow(0.5 + 0.3 * fract(h.x * 7.31 + h.y * 3.17), 2.0);
    float z = exp(-dot(d, d) / r2);
    float w = exp(6.0 * z);
    sw += w;
    sg += w * (-2.0 * d / r2 * z);
  }
  return sg / sw;
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag * uMap.xy + uMap.zw;

  // The whole sky, the lattice's holes in it, a pixel's edge wide; the
  // tower's paint.
  vec3 mt = texture(uMatte, uv).rgb;
  float sky = clamp((mt.b - 0.02) / 0.98, 0.0, 1.0);
  float tower = mt.g;
  // Where the depth map says a building face stands, near the camera, the
  // key is choked to its core: a part-open edge on a wall's sunlit face is
  // the face's own antialiasing against the plate's haze, and let through it
  // laid the dome over the concrete as a see-through rim. Not in the tower's
  // box, where a partial value is a gap a pixel wide and the dome belongs in it.
  vec4 dp = texture(uDepth, uv);
  float dNear = (dp.r * 65280.0 + dp.g * 255.0) / 65535.0;
  float face = smoothstep(0.1, 0.16, dNear);
  // And the plate's haze between the girders, keyed fine at the source's
  // full resolution, read inside the tower's box only: every gap shows the
  // dome, not the haze brought up and lit as a milky fill.
  vec2 lb = (uv * TEX - LATTICE.xy) / LATTICE.zw;
  float inBox = step(0.0, lb.x) * step(lb.x, 1.0) * step(0.0, lb.y) * step(lb.y, 1.0);
  lb = clamp(lb, 0.0, 1.0);
  float gap = texture(uLattice, lb).r * inBox;
  sky *= mix(1.0, smoothstep(0.85, 0.98, mt.b), face * (1.0 - inBox));
  // Where that key is open and the first one was not, the steel comes from
  // the same bake, with the haze's share taken out of each pixel: a gap a
  // pixel wide stays a partial key, and the rest of it is paint, not haze.
  float steelW = smoothstep(0.02, 0.15, gap) * (1.0 - smoothstep(0.0, 0.25, sky - gap));
  // The key is choked before it opens anything: a partial value along the
  // edge of a solid member is the member's antialiasing, not a hole, and let
  // through it laid a cyan outline round every ring of the deck and every
  // white member of the mast. Only a real hole, keyed well past half, shows
  // the dome. Above the truss (the deck, its underside and the mast) the
  // tower is solid painted steel: where its coarse matte says so, neither key
  // opens at all, and the pixels they gave up show the steel unmixed.
  float head = 1.0 - smoothstep(DECK_FOOT - 15.0, DECK_FOOT + 15.0, uv.y * TEX.y);
  // The coarse read only closes what the tower's own sharp matte holds: a
  // mip 2 matte reaches two plate px past the silhouette, and there it
  // closed open sky onto the plate's haze, a grey rim round the deck.
  float solid = head * tower * smoothstep(0.6, 0.9, textureLod(uMatte, uv, 2.0).g);
  float gapK = smoothstep(0.4, 0.8, gap) * (1.0 - solid);
  sky = max(sky * (1.0 - solid), gapK);

  // The camera ray through this pixel, from the plate's lens.
  vec3 V = normalize(vec3((uv.x - 0.5) * LENS, -(uv.y - 0.5) * LENS / ASPECT, -1.0));

  // Sky: the cumulus dome along that ray. Azimuth wraps, so where the
  // equirect's seam passes, the derivative comes from a copy shifted half a
  // turn; otherwise the seam would pick the smallest mip as a hairline.
  vec3 D = V * uDome;
  vec2 st = domeST(D);
  vec2 sx = dFdx(st), sy = dFdy(st);
  float wx = dFdx(fract(st.x + 0.5)), wy = dFdy(fract(st.x + 0.5));
  if (abs(wx) < abs(sx.x)) sx.x = wx;
  if (abs(wy) < abs(sy.x)) sy.x = wy;
  // It comes in two layers, split offline: the open sky's blue (an amount
  // of it) and what the clouds and the haze round the sun add over it.
  // They are graded apart, the way a polariser does it: the blue deepens to
  // cobalt toward the zenith and pales to cerulean lower down, while the
  // clouds keep their light, warmed toward the key. The clouds are read a
  // mip sharp: the derivatives halved, so their sunlit edges stay hard and
  // the cumulus is not a blurred mip pasted over the canyon.
  vec3 cloud = skyDecode(textureGrad(uSky, st, sx * 0.5, sy * 0.5).rgb, 4.0);
  // Low in the dome the frame magnifies it (two pixels to a texel), so no
  // mip is sharp enough: the edges and lobes are given back by an unsharp
  // mask against the same layer spread over a few texels (or a few pixels,
  // where the dome is minified), four taps turned off its grid.
  vec2 r = max(vec2(length(vec2(sx.x, sy.x)), length(vec2(sx.y, sy.y))) * 2.0, 2.5 / vec2(8192.0, 2048.0));
  vec3 cloudB = skyDecode(0.25 * (textureGrad(uSky, st + r * vec2(0.92, 0.38), sx, sy).rgb + textureGrad(uSky, st + r * vec2(-0.38, 0.92), sx, sy).rgb
                                + textureGrad(uSky, st + r * vec2(-0.92, -0.38), sx, sy).rgb + textureGrad(uSky, st + r * vec2(0.38, -0.92), sx, sy).rgb), 4.0);
  cloud = max(cloud + 0.8 * (cloud - cloudB), 0.0);
  float beta = skyDecode(textureGrad(uSkyBlue, st, sx, sy).rrr, 1.0).r;
  // The blue layer's own variation, against its average a few degrees
  // round: kept as a texture inside the gradient, never allowed to flatten
  // it. Only in clear sky. The layer is dark wherever cloud stands, so near
  // the bank any wide average sinks and the clear sky round it read as
  // paler: against a 7th-mip average, clamped, that was a disc of pale sky a
  // quarter of the frame across sitting on the deck, its hard arc where the
  // clamp let go and a dark band past it over the spire. So the reference is
  // a near one, the excursion rolls off softly instead of clipping, and it
  // fades out wherever cloud stands within a few degrees.
  float betaSoft = skyDecode(textureLod(uSkyBlue, st, 4.0).rrr, 1.0).r;
  float mr = log2(max(beta, 1e-4) / max(betaSoft, 1e-3));
  float near = smoothstep(0.01, 0.12, density(D, 5.5));
  float mottle = exp2(mr / (1.0 + abs(mr) / 0.12) * (1.0 - near));
  // Paler only with the ray's own elevation: the sky does not know where the
  // walls stand, and paling it toward them drew a lit band along every edge
  // and filled the gap under the balcony with haze.
  float elev = asin(clamp(dot(V, uUp), -1.0, 1.0));
  // From SKY_LOW at the wall tops (38 degrees up) to SKY_HIGH at the top of
  // the frame (72), eased so the deepening reads across the whole canyon
  // and does not stall in a flat slab at either end.
  float deep = smoothstep(0.66, 1.26, elev);
  vec3 blueP = mix(SKY_LOW, SKY_HIGH, deep * (2.0 - deep) * 0.35 + deep * 0.65);
  // The clouds as lit volumes. The photograph's own white only says how much
  // cloud stands on the ray; how it is lit comes from where that cloud
  // faces. First the mask: the cloud's luminance over the clear sky, thin
  // wisps a partial veil, the body opaque.
  float cl = luma(cloud);
  float mask = sqrt(smoothstep(0.03, 0.9, cl));
  // Then which way each part faces, from the cloud's own density read soft
  // and a few degrees off along the ray: a part with less cloud between it
  // and the sun is the sunlit face; one with clear sky under it and cloud
  // over it is a belly. The sun as the dome sees it is DOME_SUN.
  vec3 DOME_SUN = uSun * uDome;
  const vec3 ZEN = vec3(0.0, 0.0, 1.0);
  float d0 = density(D, 4.5);
  float dSun = 0.6 * density(toward(D, DOME_SUN, 0.035), 4.5) + 0.4 * density(toward(D, DOME_SUN, 0.08), 5.5);
  float dUp = 0.6 * density(toward(D, ZEN, 0.035), 4.5) + 0.4 * density(toward(D, ZEN, 0.08), 5.5);
  float dDown = 0.6 * density(toward(D, -ZEN, 0.035), 4.5) + 0.4 * density(toward(D, -ZEN, 0.08), 5.5);
  // And the same, finer: the lobes inside the body, each bulge with its
  // own lit face and its own shade under it.
  float d1 = density(D, 2.0);
  float fine = clamp((d1 - density(toward(D, DOME_SUN, 0.008), 2.0)) + (density(toward(D, -ZEN, 0.008), 2.0) - density(toward(D, ZEN, 0.008), 2.0)), -2.0, 2.0) / max(d1, 0.6);
  float norm = max(d0, 0.6);
  float sunEdge = clamp((d0 - dSun) / norm, -1.0, 1.0);
  float topEdge = clamp((dDown - dUp) / norm, -1.0, 1.0);
  // The photograph's own modelling, kept as detail inside that: a part
  // brighter than the cloud round it was lit in the photograph too.
  float model = clamp(log2(max(cl, 1e-3) / max(d0, 0.05)), -1.5, 1.5);
  // And the volume as a whole: the side toward the sun (the dot of the ray
  // with DOME_SUN) carries more light, and the cloud thickens toward its
  // base, low in the dome, where the light that gets in is the sky's.
  float facing = dot(D, DOME_SUN);
  float low = 1.0 - smoothstep(0.05, 0.5, D.z);
  float thick = smoothstep(1.5, 6.0, d0);
  // Where in the tower of cloud this part stands: cloud under it and clear
  // sky over it is a crown, cloud piled over it is the bank's shaded base.
  // Read wide (up to 12 degrees each way), so a bank that fills the canyon
  // keeps one gradient from its sunlit tops down to its blue base, not a
  // flat slab with lobes drawn on it.
  float above = 0.45 * density(toward(D, ZEN, 0.05), 5.0) + 0.35 * density(toward(D, ZEN, 0.11), 5.5) + 0.2 * density(toward(D, ZEN, 0.2), 6.0);
  float below = 0.45 * density(toward(D, -ZEN, 0.05), 5.0) + 0.35 * density(toward(D, -ZEN, 0.11), 5.5) + 0.2 * density(toward(D, -ZEN, 0.2), 6.0);
  float height = clamp((below - above) / max(max(below, above), 0.8), -1.0, 1.0);
  // And between those scales, the lobes a bank is built of, each a bulge a
  // degree or two across with its own lit top and its own shade under it.
  float dm = density(D, 3.5);
  float lobe = clamp((dm - density(toward(D, DOME_SUN, 0.02), 3.5)) + (density(toward(D, -ZEN, 0.02), 3.5) - density(toward(D, ZEN, 0.02), 3.5)), -2.0, 2.0) / max(dm, 0.6);
  // The laid-in lobes, two sizes (about 5 and 2 degrees), on the dome's
  // own sky, so they turn with it. Each is lit as a surface: the sun and the
  // open sky over it, in the frame of the ray (right, up, toward the
  // viewer), against what a flat face would take, so they model the bank
  // without changing its level. Only in its body: the edges keep the
  // photograph's own.
  float delev = asin(clamp(D.z, -1.0, 1.0));
  vec2 q = vec2(atan(D.y, D.x) * cos(delev), delev);
  vec2 bg = billow(q / 0.085) + 0.6 * billow(q / 0.034 + 17.0);
  vec3 bE = normalize(vec3(-D.y, D.x, 0.0) + vec3(1e-5, 0.0, 0.0));
  vec3 bN = cross(D, bE);
  vec3 Ls = vec3(dot(DOME_SUN, bE), dot(DOME_SUN, bN), -dot(DOME_SUN, D));
  vec3 nb = normalize(vec3(-bg * 0.6, 1.0));
  float bump = (dot(nb, Ls) - Ls.z) + 0.6 * (dot(nb, vec3(0.0, 0.6, 0.8)) - 0.8);
  float body = smoothstep(0.8, 3.5, d0) * mask;
  // A bank the sun faces (behind or beside the viewer) is lit down its whole
  // face, the lobes modelling it; one the sun stands behind keeps its light
  // in the crowns and the rims, and its body is the sky's.
  float front = smoothstep(-0.6, 0.4, Ls.z);
  float light = 0.36 + 0.12 * front + 0.28 * sunEdge + 0.2 * topEdge + 0.65 * fine + 0.55 * lobe + 0.55 * model + mix(0.32, 0.2, front) * height + 0.12 * facing - 0.1 * low * thick - 0.1 * thick + mix(0.45, 0.7, front) * bump * body;
  // The sun-side tops are lifted: a face that looks toward the sun with
  // little cloud between it and the sun is the crown, and it carries more
  // light than the modelling alone gives it.
  float sunSide = smoothstep(-0.3, 0.5, facing);
  light += (0.22 * max(sunEdge, 0.0) + 0.16 * max(topEdge, 0.0) + 0.12 * max(height, 0.0)) * sunSide;
  // No shoulder that piles the body into the crown: the light runs through
  // the whole range on one soft S, so the bank keeps its blue base, its
  // pale grey-blue middle and only its tops at the warm white.
  float t = smoothstep(-0.15, 1.55, light);
  // The crown warms toward the key when the sun is low; the belly takes the
  // open sky's light. Graded in print values on three stops (base, body,
  // crown), then taken back to light. The low sun dims the shade side; the
  // lit crown keeps its light, warmer.
  vec3 crown = mix(CLOUD_LIT, CLOUD_LIT * vec3(1.0, 0.975, 0.935) + vec3(0.006, 0.0, 0.0), 1.0 - uDay);
  float dusk = mix(0.72, 1.0, uDay);
  vec3 cloudG = mix(mix(CLOUD_SHADE, CLOUD_BODY, t), mix(CLOUD_BODY, crown, t), t);
  vec3 cloudP = tone(untone(min(cloudG, vec3(0.98))) * mix(dusk, 1.0, t * t));
  // The open sky dims less than the clouds' shade with a low sun: it is
  // the zenith's light, not the sun's.
  vec3 skyP = blueP * pow(mottle, 0.45) * mix(0.93, 1.0, uDay);
  // The clouds stand in front of the blue: where they are dense they hide
  // it, where thin they veil it. The veil is laid in print values: in light,
  // a crown's red, high up the shoulder, swamped the blue's green and turned
  // every thin edge lilac.
  vec3 skyL = untone(min(mix(skyP, cloudP, mask), vec3(0.995)));
  // The sun: the dome's own was taken out with its haze offline, so it is
  // drawn here where the key light stands, a half-degree disc and a tight
  // glow, warm, peaking under paper white. It sits in the sky layer, so the
  // tower's matte cuts it and the lattice stands in silhouette against it.
  float th = acos(clamp(dot(V, uSun), -1.0, 1.0));
  vec3 sunHue = mix(vec3(1.0, 0.86, 0.6), uSunCol / max(uSunCol.r, 1e-3), 0.3);
  sunHue /= luma(sunHue);
  skyL += sunHue * (5.0 * smoothstep(0.0058, 0.0042, th) + 1.6 * exp(-th / 0.018) + 0.25 * exp(-th / 0.08)) * mix(0.6, 1.0, uDay);

  // Surfaces. Albedo in linear light, brought up from the shade it was
  // photographed in. The walls take theirs from their own denoised bake, a
  // grey with no chroma (the plate's grade left the concrete olive); this is
  // the tower's paint, and where the matte is soft at its edge, a half-step
  // softer mip on the wall side. The lattice keeps the full mip, its members
  // are a pixel or two wide.
  float bias = mix(0.6, 0.0, tower);
  // Where the choke closed a gap on the deck or the mast, the steel fills it,
  // but only as far as it agrees with the paint round it: unmixed from a gap
  // that was never a hole, a ring's edge comes out as a hot yellow fringe.
  vec3 albP = texture(uAlbedo, uv, bias).rgb;
  vec3 steelP = texture(uSteel, lb, bias).rgb;
  steelW *= 1.0 - solid * smoothstep(0.04, 0.12, length(steelP - albP));
  vec3 alb = toLin(mix(albP, steelP, steelW));
  // The walls clip at a pale concrete, near white, and have no colour of
  // their own: what warmth or cool is on them is the light's. Their texture
  // is spread about its middle as it comes up, since sunlit, high on the
  // curve, the shoulder takes most of it back: the panel joints, the tie
  // holes and the louvre's slats stay drawn. They read the denoised bake,
  // not the albedo: the plate's sensor noise, brought up twenty times, was a
  // charcoal grit that clumped black in every window recess.
  // The tower's paint rolls off instead: brought up four times, its white
  // members and the half-lit steel behind them would all clip to the same
  // flat cream, and the lattice would go to a milky mush with no members in it.
  float wl = pow(texture(uWall, uv).r, 2.2) * WALL_RANGE;
  vec3 wallAlb = vec3(min(WALL_MID * pow(wl / WALL_MID, 1.25), 0.9));
  vec3 towerAlb = 0.86 * (1.0 - exp(-alb * 3.4 / 0.86));
  alb = mix(wallAlb, towerAlb, tower);

  // The lattice has no surface at the scale MoGe sees it: its normals there
  // are soft blobs, and a sun shaded by them laid lit veils across the truss
  // like cobwebs. Over the tower they come from a coarse mip, so the light
  // turns with its faces, and each member, round, wraps the light further.
  // The walls' come from their own bake (tools/depth/bakes/passes/facades.py),
  // each face fitted with one smooth field: MoGe's wander inside a face, a
  // tenth of a radian, is the whole key when the sun stands edge-on to the
  // walls, and it lit the facades in soft blots, cloud shapes that read as
  // the dome seen through the concrete. The folds between faces (a soffit,
  // a reveal, the louvre's corner) are kept. Every wall pixel takes the bake
  // whole: a share of MoGe's own normal kept wherever the depth was not
  // quite flat (most of a facade, at the depth's resolution) carried its
  // wander back into the key. MoGe comes back only inside a real fold.
  float bend = (dp.b - 0.5) * 2.0;
  float plane = 1.0 - smoothstep(0.03, 0.08, abs(bend));
  float fold = smoothstep(0.08, 0.2, abs(bend)) * (1.0 - tower);
  vec3 nM = texture(uNormal, uv).rgb * 2.0 - 1.0;
  vec3 nF = texture(uFacade, uv).rgb * 2.0 - 1.0;
  // Edge-on, what is left of the bake's own wander is still the whole key:
  // as the sun comes within ten degrees of a face, the face's normal is
  // read sixteen times coarser, so the key runs as one smooth gradient
  // across it. Not at a corner or a reveal, where the coarse read and the
  // sharp one part: those keep their step.
  vec3 nF4 = textureLod(uFacade, uv, 4.0).rgb * 2.0 - 1.0;
  float edge = length(nF - nF4);
  float graze = (1.0 - smoothstep(0.1, 0.2, abs(dot(normalize(nF4), uSun)))) * (1.0 - smoothstep(0.015, 0.04, edge));
  nF = mix(nF, nF4, graze);
  // A fold is where the depth steps and the bake turns with it: the depth's
  // bend alone runs wide of a fixture, and kept MoGe in a ring round it.
  fold *= smoothstep(0.03, 0.1, edge);
  vec3 nWall = mix(nF, nM, 0.4 * fold);
  vec3 nTower = mix(nM, textureLod(uNormal, uv, 4.5).rgb * 2.0 - 1.0, 0.9);
  vec3 n = normalize(mix(nWall, nTower, tower));
  float wrap = mix(0.08, 0.4, tower);

  // No cast shadows: the depth map only holds what the camera saw, so a
  // march through it finds noise, not the walls above the frame. What it can
  // give is the creases: where a surface sits behind its surroundings (a
  // recessed window, the wall behind the pole) the sun reaches it less.
  vec3 L = uSun;
  float ndl = dot(n, L);
  float vis = 1.0 - 0.55 * smoothstep(0.04, 0.3, -bend) * (1.0 - 0.7 * tower);
  // The depth map is too coarse to find the window recesses and the panel
  // joints in the walls, but the walls' luminance does: what is dark on a
  // pale facade, or darker than the facade round it, is set back into it,
  // the glass, a reveal, a groove. The raking sun does not reach in there;
  // the sky across the canyon does, so a recess goes to the cool of the
  // shade, not to a warm charcoal.
  // Only on the facades' planes, where the depth map is flat: the pole and
  // the fence stand clear of the walls (their depth jumps), and are dark
  // because they are dark, not because they are set back.
  float wlC = pow(textureLod(uWall, uv, 5.0).r, 2.2) * WALL_RANGE;
  // Read a little soft, so a joint a pixel or two wide is a shallow groove
  // that dims, not a slot drawn in ink.
  float wlS = pow(textureLod(uWall, uv, 1.5).r, 2.2) * WALL_RANGE;
  float recess = max(smoothstep(0.3, 0.06, wlS), smoothstep(0.25, 0.65, 1.0 - wlS / max(wlC, 1e-3))) * plane * (1.0 - tower);
  vis *= 1.0 - 0.92 * recess;
  // Key: the sun, with a touch of wrap so the terminator rolls off. Fill: the
  // open sky, cyan on the tower and the WALL_SHADE cyan on the walls,
  // strongest on faces that look up into it, weaker in the creases behind a
  // silhouette. Bounce: a little of the sun off the walls.
  float key = max((ndl + wrap) / (1.0 + wrap), 0.0) * vis;
  // On the walls even the faces turned down see a share of the sky across
  // the canyon, and what bounces onto them is the sunlit concrete opposite,
  // pale and from every side, not the street's warm light from below: the
  // undersides and the heads of the window reveals go to the same cyan
  // as the wall in shade, not a brown-grey.
  float skyVis = clamp(0.55 + 0.45 * dot(n, uUp), mix(0.35, 0.0, tower), 1.0) * (1.0 - 0.35 * smoothstep(0.0, 0.3, -bend));
  vec3 shadeW = untone(WALL_SHADE) / WALL_MID;
  vec3 fill = mix(shadeW / (SKY_VERT * FILL_REF), vec3(0.11, 0.27, 0.45), tower) * mix(0.6, 1.0, uDay) * skyVis;
  vec3 bounce = uSunCol * mix(0.003, 0.035 * (0.5 - 0.5 * dot(n, uUp)), tower);
  // Only on faces the sun reaches: with the sun behind the tower the half
  // vector turns round and would light the lattice from the front.
  vec3 h = normalize(L - V + vec3(0.0, 0.0, 1e-4));
  float spec = pow(max(dot(n, h), 0.0), 40.0) * vis * mix(0.03, 0.12, tower) * smoothstep(0.0, 0.2, ndl);
  // Its strength only by the square root of the reference's: at noon, a
  // sun half again as strong as the hero's carried the lit faces to paper.
  vec3 sunW = uSunCol * (untone(WALL_LIT) / WALL_MID - shadeW) / SUN_REF * inversesqrt(max(luma(uSunCol) / luma(SUN_REF), 1e-3));
  vec3 keyCol = mix(sunW, uSunCol, tower);
  vec3 lit = alb * (keyCol * key + fill + bounce) + uSunCol * spec;
  // On the walls the two lights are crossed in the print, not summed in the
  // light: the sun's share that lands the amber at full strength is nearly
  // all red once the shoulder is taken off it, so a grazing sun added to the
  // cyan fill came out pink. Developed apart, the face in shade and the face
  // square to the sun, and crossed by how much sun it takes (eased, as the
  // print's gamma would), the terminator runs amber to a neutral to cyan.
  vec3 shadeP = tone(alb * (fill + bounce));
  vec3 sunP = tone(alb * (keyCol + fill + bounce) + uSunCol * spec);
  vec3 litP = mix(mix(shadeP, sunP, pow(min(key, 1.0), 0.6)), tone(lit), tower);

  // The sky goes over the plate after the tone curve, as a print would be
  // matted: the dome runs to a thousand times paper white at the sun, and
  // in linear light even the matte's last 1% inside the tower would carry
  // it through as white blotches. Diffusion, halation and grain come after,
  // in FILM, over the matted frame as one.
  // Alpha carries which pixels are wall, for the film: see PREP.
  o = vec4(mix(litP, tone(skyL), sky), (1.0 - sky) * (1.0 - tower));
}`;

// The film the whole frame shares, plate and dome alike, so they read as one
// exposure. First the light that scatters, at half size: only what is over
// 0.78 in luma, for the diffusion (the open sky never reaches it), and the
// near-white that halates in a.
// Four bilinear taps cover the 4x4 block, so a bright hairline does not
// shimmer in and out of it.
const PREP = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;      // the scene's texel
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// The walls' sunlit plaster prints just under the crowns' white, on the
// threshold, but it is a matte surface, not a highlight: its halation laid a
// red ring in every panel joint and window frame, a sepia line drawing, and
// its warm diffusion a cream veil over the recesses. So it takes no part in
// the halation and only a little in the diffusion (the scene's alpha is 1 on
// the walls); the clouds, the sun and the tower's white paint keep both.
vec4 src(vec2 uv){
  vec4 s = texture(uScene, uv);
  float l = luma(s.rgb);
  vec3 lin = pow(s.rgb, vec3(2.2));
  return vec4(lin * smoothstep(0.78, 0.97, l) * (1.0 - 0.7 * s.a), smoothstep(0.84, 0.97, l) * (1.0 - s.a));
}
void main(){
  vec2 uv = gl_FragCoord.xy * 2.0 * uTexel;
  vec2 t = uTexel;
  o = 0.25 * (src(uv + vec2(-t.x, -t.y)) + src(uv + vec2(t.x, -t.y)) + src(uv + vec2(-t.x, t.y)) + src(uv + t));
}`;

// Then the frame itself: a Pro-Mist diffusion from those highlights (a few
// px at DPR 2, warm, since the filter's scatter is warmer than the light it
// takes), a thin red-orange halation on the dark side of every bright edge
// (the tower and the walls against the cloud), a breath of vignette, a lifted
// toe, and one grain field for the whole frame, stepping at 24 fps.
const FILM = `#version 300 es
precision highp float;
uniform sampler2D uScene, uBright;
uniform vec2 uRes;        // canvas px
uniform vec2 uHalf;       // uBright's texel
uniform float uSeed;
uniform float uDay;
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// The bright layer spread at a mip: four taps a texel of that level apart,
// turned off the pixel grid, so the mips' boxes do not show.
vec4 spread(vec2 uv, float lod){
  vec2 r = uHalf * exp2(lod) * 0.75;
  return 0.25 * (textureLod(uBright, uv + r * vec2(0.92, 0.38), lod) + textureLod(uBright, uv + r * vec2(-0.38, 0.92), lod)
               + textureLod(uBright, uv + r * vec2(-0.92, -0.38), lod) + textureLod(uBright, uv + r * vec2(0.38, -0.92), lod));
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 lin = pow(c, vec3(2.2));
  float l = luma(c);

  // Only the half and quarter size levels: a tight kernel, a few px at
  // DPR 2. Read wider, the bright deck and the bank spread into the open
  // sky round the tower as a pale glow.
  vec4 b0 = textureLod(uBright, uv, 0.0);
  vec4 b1 = spread(uv, 0.0);
  vec4 b2 = spread(uv, 1.0);

  // Diffusion: a share of the highlight leaves its pixel and lands spread
  // round it, so the cloud's white veils softly over the steel and the wall
  // edges in front of it, and the tops lose their paper-cut edge. It only
  // moves light, so a wide cloud keeps its level; what lands outside the
  // highlight is warmer than what left.
  vec3 d = b1.rgb * 0.5 + b2.rgb * 0.5 - b0.rgb;
  lin += 0.4 * (max(d, 0.0) * vec3(1.0, 0.93, 0.82) + min(d, 0.0));

  // Halation: light through the emulsion off the base and back through the
  // red layer. A ring, not a glow: the spread source minus what is already
  // white here, only where the pixel is darker than the source.
  float ring = max(b1.a * 0.4 + b2.a * 0.6 - b0.a * 0.85, 0.0) * (1.0 - smoothstep(0.45, 0.9, l));
  lin += vec3(1.0, 0.3, 0.08) * ring * 0.32 * mix(0.75, 1.0, uDay);

  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  c = mix(vec3(0.018, 0.016, 0.02), vec3(1.0), c);
  vec2 cv = uv - 0.5;
  c *= 1.0 - 0.16 * dot(cv, cv);

  // Grain: soft clumps about a pixel and two across at DPR 2, no per-pixel
  // hash (that read as a sensor's salt and pepper), luminance only, the same
  // step on every channel. Weighted to the midtones, where a negative's
  // grain shows, and thinning to a quarter in the darks and the highlights,
  // so it never clumps in a shadow. One law for sky and concrete.
  vec2 p = gl_FragCoord.xy + uSeed * vec2(37.1, 91.7);
  float g = (vnoise(p / 1.1) - 0.5) + 0.6 * (vnoise(p / 2.3 + 41.7) - 0.5);
  float lc = luma(c);
  float mid = lc * (1.0 - lc) * 4.0;
  c += g * 0.024 * (mid * 0.75 + 0.25);
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 2048 / 1536;
// The camera looks up this far above the horizon.
const PITCH = (55 * Math.PI) / 180;
// Where the sun rests, in drag coordinates (0..1 across and down the frame):
// low in the west behind your left shoulder, so it rakes the right wall
// gold, leaves the left one in the sky's cyan, and catches the tower's left
// legs.
const REST = { x: 0.15, y: 0.55 };

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

// The sun for a point of the drag. Across: azimuth relative to where the
// camera faces, from 165 degrees left through straight ahead to 165 right.
// Down: elevation, from 78 degrees to 3. Returns its direction in camera
// space, its colour and intensity (warmer and weaker near the horizon), how
// high it is, and its azimuth and elevation.
function sunFor(x, y) {
  const az = (x - 0.5) * 2 * ((165 * Math.PI) / 180);
  const el = ((78 - (78 - 3) * clamp(y, 0, 1)) * Math.PI) / 180;
  const sx = Math.cos(el) * Math.sin(az);
  const sh = Math.cos(el) * Math.cos(az);
  const sy = Math.sin(el);
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const dir = [sx, -sp * sh + cp * sy, -(cp * sh + sp * sy)];
  const day = clamp(Math.sin(el) / 0.7, 0, 1);
  const w = Math.sqrt(day);
  const I = 3.1 * (0.55 + 0.45 * w);
  const col = [1.0, 0.52 + 0.26 * w, 0.24 + 0.36 * w].map((c) => c * I);
  return { dir, col, day, az, el };
}

// The dome's cumulus bank follows the sun round, a share of its azimuth
// (DOME_TURN) and never more than DOME_REACH off the camera's heading: so it
// stands on the sun's side, between the sun and the tower, and at either
// edge of the drag it waits at the wall tops instead of swinging out of
// frame or across the canyon.
const DOME_TURN = 0.35;
const DOME_REACH = (18 * Math.PI) / 180;
// And it is sunk only this far, tilted down on its own side, so its tallest
// tops (60 degrees up in the photograph) stand at about 57 behind the tower,
// well over the wall tops: the bank fills the lower half of the canyon and
// the open sky above it stays deep blue. Sunk further, the bank was a row of
// small blobs along the wall tops. The tilt does not follow the sun's
// height: lifting the dome to meet a low sun swung its clouds up across the
// whole canyon, an overcast sheet.
const DOME_SINK = (3 * Math.PI) / 180;

// The dome's orientation for a sun: turned about the zenith to put its bank
// on the sun's side, then tilted down toward the bank. Returned as the three
// columns of uDome: unit vectors, in camera space, toward the bank along the
// ground, to its right, and up.
function domeFor(az) {
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const turn = clamp(az * DOME_TURN, -DOME_REACH, DOME_REACH);
  const sa = Math.sin(turn);
  const ca = Math.cos(turn);
  // Heading (0, -sp, -cp) and right (1, 0, 0) span the ground; up is (0, cp, -sp).
  const toward = [sa, -sp * ca, -cp * ca];
  const right = [ca, sp * sa, cp * sa];
  const up = [0, cp, -sp];
  const c = Math.cos(DOME_SINK);
  const s = Math.sin(DOME_SINK);
  const p = toward.map((t, i) => c * t - s * up[i]);
  const z = toward.map((t, i) => s * t + c * up[i]);
  return [...p, ...right, ...z];
}

export async function createPasses(host) {
  const [albedo, depth, normal, matte, lattice, steel, skyCloud, skyBlue, wall, facade] = await Promise.all(
    ["albedo.webp", "depth.png", "normal.webp", "matte.png", "lattice.png", "lattice-steel.webp", "sky-cloud.avif", "sky-blue.avif", "wall.webp", "facade.webp"].map(
      (f) => loadImage(SRC + f),
    ),
  );

  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const num = (k) => (params.has(k) ? clamp(parseFloat(params.get(k)) || 0, 0, 1) : null);
  const holdX = num("x");
  const holdY = num("y");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const prepProg = program(PREP);
  const filmProg = program(FILM);
  const prog = program(FS);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { res: U("uRes"), map: U("uMap"), sun: U("uSun"), sunCol: U("uSunCol"), up: U("uUp"), day: U("uDay"), dome: U("uDome") };
  const up = { texel: gl.getUniformLocation(prepProg, "uTexel") };
  const uf = {
    res: gl.getUniformLocation(filmProg, "uRes"),
    half: gl.getUniformLocation(filmProg, "uHalf"),
    seed: gl.getUniformLocation(filmProg, "uSeed"),
    day: gl.getUniformLocation(filmProg, "uDay"),
  };

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const params2d = (mips) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const tex = (im, unit, name, mips) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, im);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    params2d(mips);
    gl.uniform1i(U(name), unit);
  };
  tex(depth, 1, "uDepth", false);
  tex(normal, 2, "uNormal", true);
  tex(albedo, 3, "uAlbedo", true);
  tex(matte, 4, "uMatte", true);
  tex(lattice, 5, "uLattice", true);
  tex(steel, 7, "uSteel", true);
  tex(wall, 9, "uWall", true);
  tex(facade, 12, "uFacade", true);

  // The sky dome's two layers: azimuth repeats, and anisotropic filtering
  // where the GPU has it, since the equirect stretches across toward the
  // zenith. A GPU that cannot hold 8192 texels across gets them at half size.
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const dome = (im, unit, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    let src = im;
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < im.width) {
      src = document.createElement("canvas");
      src.width = im.width / 2;
      src.height = im.height / 2;
      src.getContext("2d").drawImage(im, 0, 0, src.width, src.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    params2d(true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    gl.uniform1i(U(name), unit);
  };
  dome(skyCloud, 6, "uSky");
  dome(skyBlue, 8, "uSkyBlue");

  // The film's targets: the matted frame at full size (unit 10), and the
  // light that scatters from it at half size, with mips to spread it (11).
  // Allocated whenever the canvas changes size.
  const scene = { tex: gl.createTexture(), fbo: gl.createFramebuffer() };
  const bright = { tex: gl.createTexture(), fbo: gl.createFramebuffer() };
  let fw = 0;
  let fh = 0;
  const alloc = (t, unit, w, h, mips) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    params2d(mips);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };
  const targets = (W, Hc) => {
    if (W === fw && Hc === fh) return;
    fw = W;
    fh = Hc;
    alloc(scene, 10, W, Hc, false);
    alloc(bright, 11, Math.ceil(W / 2), Math.ceil(Hc / 2), true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  gl.useProgram(prepProg);
  gl.uniform1i(gl.getUniformLocation(prepProg, "uScene"), 10);
  gl.useProgram(filmProg);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uScene"), 10);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uBright"), 11);

  let dirty = true;
  stage.onResize(() => {
    dirty = true;
  });

  // The sun eases toward the hand. With no hand yet it rises from low in the
  // west to its rest, once, a moment after the plate appears.
  const held = holdX != null || holdY != null;
  const rest = { x: holdX ?? REST.x, y: holdY ?? REST.y };
  const sun = held ? { ...rest } : { x: REST.x - 0.04, y: 0.9 };
  const target = { ...rest };
  let rate = held ? 12 : 1.6;

  const toU = (p) => ({ x: clamp(p.x / stage.width, 0, 1), y: clamp(p.y / stage.height, 0, 1) });
  const aim = (p) => {
    const q = toU(p);
    target.x = q.x;
    target.y = q.y;
    rate = 9;
  };
  stage.on("down", aim);
  stage.on("move", (p) => {
    if (p.down) aim(p);
  });

  // The grain steps at 24 fps whether or not the light moves; between steps
  // and while the sun is still, nothing is drawn. A sun held by the query is
  // a still frame, and its grain holds too.
  const still = held || reduce;
  let seed = 0;
  let grainClock = 0;
  let tick = false;

  stage.onFrame((dt) => {
    if (!still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const k = 1 - Math.exp(-dt * rate);
    const dx = target.x - sun.x;
    const dy = target.y - sun.y;
    if (Math.abs(dx) + Math.abs(dy) > 2e-4) {
      sun.x += dx * k;
      sun.y += dy * k;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      draw();
      develop();
    } else if (tick) develop();
    tick = false;
  });

  // The light, into the scene target.
  let day = 1;
  function draw() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    targets(W, Hc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.useProgram(prog);
    gl.viewport(0, 0, W, Hc);
    gl.uniform2f(u.res, W, Hc);
    // Cover fit: the photo fills the frame, cropped evenly on the long side.
    const s = Math.max(W / IMG_ASPECT, Hc);
    const sw = s * IMG_ASPECT;
    gl.uniform4f(u.map, 1 / sw, 1 / s, (sw - W) / 2 / sw, (s - Hc) / 2 / s);
    const S = sunFor(sun.x, sun.y);
    gl.uniform3f(u.sun, S.dir[0], S.dir[1], S.dir[2]);
    gl.uniform3f(u.sunCol, S.col[0], S.col[1], S.col[2]);
    gl.uniform3f(u.up, 0, Math.cos(PITCH), -Math.sin(PITCH));
    gl.uniform1f(u.day, S.day);
    day = S.day;
    gl.uniformMatrix3fv(u.dome, false, domeFor(S.az));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // What scatters, at half size, spread through its mips.
    gl.bindFramebuffer(gl.FRAMEBUFFER, bright.fbo);
    gl.useProgram(prepProg);
    gl.viewport(0, 0, Math.ceil(W / 2), Math.ceil(Hc / 2));
    gl.uniform2f(up.texel, 1 / W, 1 / Hc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE11);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // The film, to the canvas: cheap, so it alone runs for each grain step.
  function develop() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    if (W !== fw || Hc !== fh) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(filmProg);
    gl.viewport(0, 0, W, Hc);
    gl.uniform2f(uf.res, W, Hc);
    gl.uniform2f(uf.half, 1 / Math.ceil(W / 2), 1 / Math.ceil(Hc / 2));
    gl.uniform1f(uf.seed, seed);
    gl.uniform1f(uf.day, day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      [scene, bright].forEach((t) => {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      });
      stage.destroy();
    },
  };
}
