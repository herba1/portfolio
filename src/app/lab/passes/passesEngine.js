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
// the creases the depth map finds, and a fill in the open sky's own colour:
// on the walls, a warm grey concrete in full colour, the sunlit face prints a
// warm neutral stone and the one turned away a cool slate in the sky's light,
// each falling off across the face with the sky it sees, its creases, and the
// light the sunlit wall across the canyon bounces back. Dragging across swaps
// which wall glows.
//
// The plate's own sky was flat haze, so inside the sky matte it is replaced by
// a photographed summer cumulus dome (Poly Haven, Rural Asphalt Road, Alexander Scholten, CC0;
// tools/depth/bakes/passes-sky.py): piled cumulus with hard sunlit tops and
// blue-shadowed bases, towering, with clear deep blue over them. Each
// pixel looks it up along its true camera ray, the plate's pitch and lens, so
// the clouds converge on the same vanishing point as the buildings. The dome
// is fixed to the world, its tallest bank behind the tower and to its left,
// filling the canyon's lower half, and the open canyon above stays cobalt.
// Dragging moves only the light: the clouds stay where they are and are lit
// from the sun's direction, their sunward flanks bright and warm and their
// far sides in the sky's blue. The sun itself is drawn where the light stands.
//
// Plate and dome are then developed as one emulsion: the film over the
// matted frame spreads its highlights through a half-size blur pyramid (a
// warm Pro-Mist diffusion), lays a tight blur of their red layer back as a
// thin orange-red halation on the dark side of every bright edge, prints
// through a toe that lifts the blacks to a cool charcoal and a shoulder that
// rolls the highlights off warm, and lays one luminance grain field, in the
// midtones, stepping at 24 fps, over sky and concrete alike.

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
// The walls are one pale concrete, a warm grey with a colour of its own,
// under two lights of different colour temperature, and the canyon is the
// split between them: the one gesture is moving the sun, so which wall
// glows has to be the loudest thing it does. CONCRETE is that albedo's hue,
// the plate's own warm grey (its grade had pushed it olive). The fill is
// the sky's own colour a third of the way up the canyon, taken at FILL_SAT
// of its saturation (a face sees the open blue, the bank's white and the
// canyon's grey together), and it lands on every face, lit or not: a face
// turned from the sun is that light times the concrete, a cool slate that
// keeps about 0.4 of the lit face's chroma, never a grey. Its level is set as the print should show
// it, SHADE_Y, the luma of a face turned away at the canyon's middle; the
// key is then what a face standing KEY_NDL to the sun (a wall's own share
// at mid elevation) needs over that fill to print STONE, a warm neutral
// stone at hue 35, low in saturation: the tower's orange stays the only
// warm accent in the frame. SUN_HIGH is the luma and SUN_HUE_HIGH the hue of
// sunFor's colour with the sun high: a weaker sun takes the key down by the
// square root of its share, and a setting one ambers it by its own hue's
// shift from the high sun's.
const vec3 CONCRETE = vec3(198.0, 191.0, 184.0) / 255.0;
const vec3 STONE = vec3(209.0, 195.0, 181.0) / 255.0;
const float SHADE_Y = 0.6;
const float FILL_SAT = 0.38;
const float KEY_NDL = 0.6;
const float SUN_HIGH = 2.52;
const vec3 SUN_HUE_HIGH = vec3(1.0, 0.78, 0.6);
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
  // own sky, so they stay with it. Each is lit as a surface: the sun and the
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
  float light = 0.36 + 0.12 * front + 0.28 * sunEdge + 0.12 * topEdge + 0.65 * fine + 0.55 * lobe + 0.4 * model + mix(0.2, 0.12, front) * height + 0.12 * facing - 0.1 * low * thick - 0.1 * thick + mix(0.45, 0.7, front) * bump * body;
  // The sun-side tops are lifted: a face that looks toward the sun with
  // little cloud between it and the sun is the crown, and it carries more
  // light than the modelling alone gives it.
  float sunSide = smoothstep(-0.3, 0.5, facing);
  light += (0.22 * max(sunEdge, 0.0) + 0.16 * max(topEdge, 0.0) + 0.12 * max(height, 0.0)) * sunSide;
  // The dome stays put and the sun goes round it, so which flank of each
  // cloud is lit has to come from the sun alone. Read across the bank (3 to
  // 15 degrees each way) along the great circle through the sun: clear sky
  // toward the sun and cloud away from it is the flank that faces it, the
  // reverse is the far side. Scaled by how far off the ray the sun stands:
  // with the sun straight behind the viewer every face is lit alike.
  float sNear = 0.4 * density(toward(D, DOME_SUN, 0.05), 5.0) + 0.35 * density(toward(D, DOME_SUN, 0.12), 5.5) + 0.25 * density(toward(D, DOME_SUN, 0.26), 6.5);
  float sFar = 0.4 * density(toward(D, -DOME_SUN, 0.05), 5.0) + 0.35 * density(toward(D, -DOME_SUN, 0.12), 5.5) + 0.25 * density(toward(D, -DOME_SUN, 0.26), 6.5);
  float across = sqrt(max(1.0 - facing * facing, 0.0));
  float flank = clamp((sFar - sNear) / max(max(sFar, sNear), 0.8) * 2.2, -1.0, 1.0) * across;
  // And the same a lobe wide, so each bulge on the lit flank has its own lit
  // shoulder and the shade falls on the side away from the sun.
  float lNear = density(toward(D, DOME_SUN, 0.018), 3.5);
  float lFar = density(toward(D, -DOME_SUN, 0.018), 3.5);
  float lflank = clamp((lFar - lNear) / max(max(lFar, lNear), 0.6) * 1.8, -1.0, 1.0) * across;
  float sunward = clamp(0.7 * flank + 0.3 * lflank, -1.0, 1.0);
  light += 0.75 * sunward * body + 0.6 * sunward * (1.0 - body);
  // Close to the sun (within some 40 degrees) the cloud is lit from behind:
  // its thin parts glow, warm, the forward scatter round the disc.
  float aureole = smoothstep(0.75, 0.95, facing);
  light += 0.25 * aureole * (1.0 - body);
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
  // The sun-facing flank's crowns take the key's warmth; the far side
  // keeps only the open sky's light, its blue.
  crown = mix(crown, crown * vec3(1.0, 0.96, 0.89), max(smoothstep(0.0, 0.6, sunward), 0.8 * aureole));
  vec3 cloudG = mix(mix(CLOUD_SHADE, CLOUD_BODY, t), mix(CLOUD_BODY, crown, t), t);
  cloudG = mix(cloudG, mix(CLOUD_SHADE, CLOUD_BODY, 0.35), 0.8 * smoothstep(0.05, 0.6, -sunward) * (1.0 - 0.3 * t));
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
  // The walls clip at a pale concrete, near white, in CONCRETE's warm grey:
  // the light colours it, but it keeps its own hue under both. Their texture
  // is spread about its middle as it comes up, since sunlit, high on the
  // curve, the shoulder takes most of it back: the panel joints, the tie
  // holes and the louvre's slats stay drawn. They read the denoised bake,
  // not the albedo: the plate's sensor noise, brought up twenty times, was a
  // charcoal grit that clumped black in every window recess.
  // The tower's paint rolls off instead: brought up four times, its white
  // members and the half-lit steel behind them would all clip to the same
  // flat cream, and the lattice would go to a milky mush with no members in it.
  float wl = pow(texture(uWall, uv).r, 2.2) * WALL_RANGE;
  vec3 concrete = toLin(CONCRETE) / luma(toLin(CONCRETE));
  vec3 wallAlb = min(WALL_MID * pow(wl / WALL_MID, 1.25), 0.9) * concrete;
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
  // Key: the sun, with a touch of wrap on the tower so the terminator rolls
  // off round its members. Fill: the open sky, strongest on faces that look
  // up into it, weaker in the creases behind a silhouette. Bounce: a little
  // of the sun off the walls.
  float key = max((ndl + wrap) / (1.0 + wrap), 0.0) * vis;
  // On the walls even the faces turned down see a share of the sky across
  // the canyon, and what bounces onto them is the sunlit concrete opposite,
  // pale and from every side, not the street's warm light from below: the
  // undersides and the heads of the window reveals go to the same cool grey
  // as the wall in shade, not a brown-grey.
  float skyVis = clamp(0.55 + 0.45 * dot(n, uUp), mix(0.35, 0.0, tower), 1.0) * (1.0 - 0.35 * smoothstep(0.0, 0.3, -bend));
  vec3 bounce = uSunCol * mix(0.003, 0.035 * (0.5 - 0.5 * dot(n, uUp)), tower);
  // Only on faces the sun reaches: with the sun behind the tower the half
  // vector turns round and would light the lattice from the front.
  vec3 h = normalize(L - V + vec3(0.0, 0.0, 1e-4));
  float spec = pow(max(dot(n, h), 0.0), 40.0) * vis * mix(0.03, 0.12, tower) * smoothstep(0.0, 0.2, ndl);
  // The tower: its paint under the sun's own colour and the sky's cyan.
  vec3 towerL = alb * (uSunCol * key + vec3(0.11, 0.27, 0.45) * mix(0.6, 1.0, uDay) * skyVis + bounce) + uSunCol * spec;

  // The walls, as light over that albedo. Each term is a light, not a tint,
  // and each falls off across a face.
  //
  // Occlusion, the depth map's creases read wide as well as sharp: a face
  // set back behind its surroundings (under the balcony, the inside corner
  // of a reveal, the wall behind the pole) sees less of both lights.
  float bendW = (textureLod(uDepth, uv, 4.0).b - 0.5) * 2.0;
  // (The sharp crease is already in vis and skyVis.)
  float ao = 1.0 - 0.35 * smoothstep(0.02, 0.18, -bendW);
  // How open the sky is round a pixel: the share of sky in a wide patch of
  // the frame. Looking up a canyon, a wall's top stands against the sky and
  // its foot, nearer the frame's edge, sees mostly the wall opposite, so the
  // sky's light falls off down each face and the bounce takes over.
  float open = smoothstep(0.0, 0.35, (textureLod(uMatte, uv, 5.5).b + textureLod(uMatte, uv, 6.5).b + textureLod(uMatte, uv, 7.5).b) / 3.0);
  // Sky: the sky's own colour a third of the way up the canyon (from
  // SKY_LOW toward SKY_HIGH), at FILL_SAT of its saturation, and
  // whiter where the bank stands over the face (read very soft along the
  // face's own upward view). Scaled so a face turned from the sun at the
  // canyon's middle prints SHADE_Y.
  vec3 Dn = normalize(n + uUp) * uDome;
  float bank = smoothstep(0.2, 3.0, density(Dn, 7.5));
  vec3 skyHue = toLin(mix(SKY_LOW, SKY_HIGH, 0.35));
  skyHue /= luma(skyHue);
  skyHue = mix(vec3(1.0), skyHue, FILL_SAT * (1.0 - 0.45 * bank));
  float fillY = untone(vec3(SHADE_Y)).r / (WALL_MID * luma(concrete * skyHue));
  vec3 skyFill = skyHue * fillY * mix(0.6, 1.0, uDay) * skyVis / SKY_VERT * mix(0.55, 1.3, open) * ao;
  // A recess the sun does not get into still sees the sky, a little less.
  skyFill *= 1.0 - 0.3 * recess;
  // MoGe's own normal, read soft, still holds how each face turns across the
  // frame (the walls are not quite planes, and the lens bends them), where
  // the facade bake is one smooth field to a face and alone lights it
  // evenly. Its tilt toward the sky, against the bake's at the same
  // softness, is laid over the fill as a gentle gradient.
  vec3 nMs = normalize(textureLod(uNormal, uv, 5.0).rgb * 2.0 - 1.0);
  vec3 nFs = normalize(nF4);
  skyFill *= clamp(1.0 + 1.5 * (dot(nMs, uUp) - dot(nFs, uUp)), 0.75, 1.25);
  // The key, scaled by how square the face stands to the sun, no wrap: a
  // plane takes none past edge-on. It is what a face at KEY_NDL needs over
  // the fill (at the canyon's middle) to print STONE: so the stone is the
  // sum, and the sky's blue on a sunlit face is in it. Unclamped past
  // KEY_NDL, a low sun square to a face carries it up the shoulder, toward a
  // pale gold, not to paper.
  vec3 fillMid = skyHue * fillY;
  // A setting sun ambers it, but only by half its own shift: the walls
  // stay stone, and the warmth in the frame stays the tower's.
  vec3 keyTint = mix(vec3(1.0), uSunCol / max(uSunCol.r, 1e-3) / SUN_HUE_HIGH, 0.5);
  vec3 sunKey = max(untone(STONE) / (WALL_MID * concrete) - fillMid, vec3(0.0)) / KEY_NDL;
  sunKey *= keyTint * luma(sunKey) / max(luma(sunKey * keyTint), 1e-4);
  sunKey *= sqrt(max(luma(uSunCol), 1e-3) / SUN_HIGH);
  // The same over the key: MoGe's N.L against the bake's, as a ratio, so
  // where the bake puts the sun edge-on the gradient goes with it and
  // MoGe's wander never becomes the whole key.
  float ndlS = dot(nFs, L);
  float grad = clamp(1.0 + 1.6 * (dot(nMs, L) - ndlS) / max(abs(ndlS), 0.25), 0.7, 1.3);
  float keyW = max(ndl, 0.0) * mix(grad, 1.0, tower) * vis * ao;
  // Bounce: the wall across the canyon, where the sun is on it, lights this
  // one with its own stone colour, most at the foot of the face, where it
  // fills the view, and almost none at the top.
  vec3 nH = normalize(n - uUp * dot(n, uUp) + vec3(1e-4, 0.0, 0.0));
  float opposite = max(dot(-nH, L), 0.0);
  vec3 bounceW = 0.08 * opposite * (1.0 - 0.85 * open) * WALL_MID * concrete * sunKey * KEY_NDL * ao;
  vec3 wallL = alb * (sunKey * keyW + skyFill + bounceW) + sunKey * spec;
  vec3 litP = mix(tone(wallL), tone(towerL), tower);

  // The sky goes over the plate after the tone curve, as a print would be
  // matted: the dome runs to a thousand times paper white at the sun, and
  // in linear light even the matte's last 1% inside the tower would carry
  // it through as white blotches. Diffusion, halation and grain come after,
  // in FILM, over the matted frame as one.
  // Alpha carries which pixels are wall, for the film: see PREP.
  o = vec4(mix(litP, tone(skyL), sky), (1.0 - sky) * (1.0 - tower));
}`;

// The film the whole frame shares, plate and dome alike, so they read as one
// emulsion. It runs in four steps after the light: the bright pass, a blur
// pyramid built from it (the diffusion), a tight blur of its red layer (the
// halation), and the print itself.
//
// First what scatters, at half size: the light over about 0.7 in luma, eased
// in on a soft knee so no edge of it shows. The walls' sunlit plaster sits
// right on that threshold. It is a matte surface, not a highlight, so it
// gives a little less, and the film keeps its halation out of the walls'
// own joints (the scene's alpha is 1 on the walls): there, a red ring in
// every panel joint and window frame read as a sepia line drawing. Where
// the lit facade meets the open sky the fringe still lands, on the sky.
// Four bilinear taps cover the 4x4 block, so a bright hairline does not
// shimmer in and out of it.
const PREP = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel;      // the scene's texel
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// rgb is the diffusion's source; a is the halation's, the red layer alone.
vec4 src(vec2 uv){
  vec4 s = texture(uScene, uv);
  vec3 lin = pow(s.rgb, vec3(2.2)) * smoothstep(0.6, 0.9, luma(s.rgb));
  return vec4(lin * (1.0 - 0.35 * s.a), lin.r * (1.0 - 0.15 * s.a));
}
void main(){
  vec2 uv = gl_FragCoord.xy * 2.0 * uTexel;
  vec2 t = uTexel;
  o = 0.25 * (src(uv + vec2(-t.x, -t.y)) + src(uv + vec2(t.x, -t.y)) + src(uv + vec2(-t.x, t.y)) + src(uv + t));
}`;

// The pyramid, down: each level half the last, five taps (the centre and
// four diagonals a source texel out), so it spreads as it shrinks with no
// box in it.
const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;      // the source's texel
uniform vec2 uOut;        // this level's size
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uOut;
  vec2 t = uTexel;
  o = (4.0 * texture(uSrc, uv) + texture(uSrc, uv + vec2(-t.x, -t.y)) + texture(uSrc, uv + vec2(t.x, -t.y))
       + texture(uSrc, uv + vec2(-t.x, t.y)) + texture(uSrc, uv + t)) / 8.0;
}`;

// And up: the coarser level spread on a tent of eight taps and laid over
// this level's own, weighted, so the sum is a tight core with a long soft
// tail, the way a Pro-Mist's scatter falls off.
const UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uBase;
uniform vec2 uTexel;      // the coarser level's texel
uniform vec2 uOut;
uniform float uW;         // this level's own share
uniform float uS;         // the coarser level's (its own, at the coarsest)
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uOut;
  vec2 t = uTexel;
  vec4 s = texture(uSrc, uv + vec2(-2.0 * t.x, 0.0)) + texture(uSrc, uv + vec2(2.0 * t.x, 0.0))
         + texture(uSrc, uv + vec2(0.0, -2.0 * t.y)) + texture(uSrc, uv + vec2(0.0, 2.0 * t.y))
         + 2.0 * (texture(uSrc, uv + vec2(-t.x, -t.y)) + texture(uSrc, uv + vec2(t.x, -t.y))
                + texture(uSrc, uv + vec2(-t.x, t.y)) + texture(uSrc, uv + t));
  o = uS * s / 12.0 + uW * texture(uBase, uv);
}`;

// The halation's source: the bright pass's red layer alone, blurred tight,
// a Gaussian of about two half-size texels (4 px at DPR 2, a ring 3 to 6 px
// wide at 1x), one axis at a time.
const HALO = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;       // one texel along the axis
uniform int uCh;          // which channel holds it: the bright pass's a, then r
uniform vec2 uOut;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uOut;
  float s = 0.0, w = 0.0;
  for (int i = -6; i <= 6; i++) {
    float k = exp(-float(i * i) / 8.0);
    s += k * texture(uSrc, uv + uStep * float(i))[uCh];
    w += k;
  }
  o = vec4(s / w, 0.0, 0.0, 1.0);
}`;

// Then the print. Diffusion: about a tenth of the pyramid laid back, warmer
// than the light it took, a share of each highlight's own light taken out
// where it left so a wide cloud keeps its level, and the cloud's crowns and
// the sunlit wall glow softly out into the cobalt. Halation: the blurred
// red laid back warm orange-red wherever it lands on something darker than
// what threw it, so a thin warm fringe stands where the cloud, the lit
// facade and the white bands of the spire meet the deep blue. Then the
// curve: a toe that lifts the blacks off zero to a cool charcoal (a window
// recess prints about #2a2f36, not a hole), and a shoulder that rolls the
// highlights off warm, the blue layer first, rather than flattening them.
// A breath of vignette, and one grain field for the whole frame, luminance
// only, strongest in the midtones, stepping at 24 fps.
const FILM = `#version 300 es
precision highp float;
uniform sampler2D uScene, uDiffuse, uHalo;
uniform vec2 uRes;        // canvas px
uniform float uNorm;      // the pyramid's total weight
uniform float uSeed;
uniform float uDay;
out vec4 o;
const vec3 TOE = vec3(34.0, 38.0, 44.0) / 255.0;
const vec3 WHITE = vec3(0.995, 0.98, 0.95);
const float HALO_GAIN = 1.0;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// The shoulder, per layer: linear to the knee, then an exponential roll to
// that layer's white, so nothing reaches 255 and the top of the range
// keeps its modelling instead of piling into one flat value.
vec3 shoulder(vec3 c){
  const float K = 0.8, END = 1.05;
  vec3 a = ((END - K) - (WHITE - K)) / ((END - K) * (END - K));
  vec3 x = clamp(c, K, END) - K;
  return mix(c, K + x - a * x * x, step(K, c));
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 sc = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0);
  vec3 lin = pow(sc.rgb, vec3(2.2));
  float l = luma(sc.rgb);
  float wall = sc.a;

  // Diffusion.
  vec3 own = lin * smoothstep(0.6, 0.9, l);
  vec3 diff = texture(uDiffuse, uv).rgb / uNorm;
  lin += 0.12 * (diff * vec3(1.0, 0.95, 0.86) - 0.5 * own * (1.0 - 0.35 * wall));

  // Halation, on the dark side of the edge only, and not inside the walls.
  float hal = texture(uHalo, uv).r;
  float land = (1.0 - smoothstep(0.45, 0.88, l)) * (1.0 - 0.85 * wall);
  // The red layer it exposes sits over the blue one, so where it lands on
  // the cobalt it also holds back a little of the blue: the fringe reads
  // warm, not lilac.
  float h = max(hal - 0.7 * own.r, 0.0) * land * HALO_GAIN * mix(0.8, 1.0, uDay);
  lin = lin * (1.0 - min(h, 0.5) * vec3(0.0, 0.15, 0.5)) + vec3(1.0, 0.42, 0.1) * h;

  vec3 c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  // Toe, then shoulder.
  c += TOE * pow(max(1.0 - luma(c) / 0.55, 0.0), 2.4);
  c = shoulder(c);
  vec2 cv = uv - 0.5;
  c *= 1.0 - 0.14 * dot(cv, cv);

  // Grain: soft clumps a pixel or two across at DPR 2 (a per-pixel hash
  // reads as a sensor's salt and pepper), the same step on every channel.
  // Weighted to the midtones, where a negative's grain shows, and thinning
  // in the darks and the highlights. One law for sky and concrete.
  vec2 p = gl_FragCoord.xy + uSeed * vec2(37.1, 91.7);
  float g = (vnoise(p / 1.25) - 0.5) + 0.7 * (vnoise(p / 2.6 + 41.7) - 0.5) + 0.35 * (vnoise(p / 5.0 + 9.3) - 0.5);
  float lc = luma(c);
  float mid = smoothstep(0.0, 0.35, lc) * (1.0 - smoothstep(0.7, 1.0, lc));
  c += g * 0.05 * (mid * 0.8 + 0.2);
  o = vec4(c, 1.0);
}`;

const SRC = "/lab/passes/";
const IMG_ASPECT = 2048 / 1536;
// The camera looks up this far above the horizon.
const PITCH = (55 * Math.PI) / 180;
// Where the sun rests, in drag coordinates (0..1 across and down the frame):
// low in the west behind your left shoulder, so it rakes the right wall
// warm, leaves the left one a cool grey, and catches the tower's left legs.
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

// The dome is the world's, not the sun's: it is laid once and never turns.
// Its cumulus bank stands behind the tower and to its left (DOME_HEADING,
// turned from the camera's heading), over the left wall's tops and filling
// the lower canyon. Dragging moves only the light: the same clouds stay in
// the same places, and their lit sides swing round with the warm wall.
const DOME_HEADING = (-18 * Math.PI) / 180;
// And it is sunk only this far, tilted down on its own side, so its tallest
// tops (60 degrees up in the photograph) stand at about 57 behind the tower,
// well over the wall tops: the bank fills the lower half of the canyon and
// the open sky above it stays deep blue. Sunk further, the bank was a row of
// small blobs along the wall tops.
const DOME_SINK = (3 * Math.PI) / 180;

// The dome's orientation: turned about the zenith to DOME_HEADING, then
// tilted down toward the bank. Returned as the three columns of uDome: unit
// vectors, in camera space, toward the bank along the ground, to its right,
// and up.
function domeFrame() {
  const sp = Math.sin(PITCH);
  const cp = Math.cos(PITCH);
  const sa = Math.sin(DOME_HEADING);
  const ca = Math.cos(DOME_HEADING);
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
  const downProg = program(DOWN);
  const upProg = program(UP);
  const haloProg = program(HALO);
  const filmProg = program(FILM);
  const prog = program(FS);
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const u = { res: U("uRes"), map: U("uMap"), sun: U("uSun"), sunCol: U("uSunCol"), up: U("uUp"), day: U("uDay"), dome: U("uDome") };
  const loc = (p, ...names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  const up = loc(prepProg, "uTexel");
  const ud = loc(downProg, "uTexel", "uOut", "uSrc");
  const uu = loc(upProg, "uTexel", "uOut", "uW", "uS", "uSrc", "uBase");
  const uh = loc(haloProg, "uStep", "uOut", "uSrc", "uCh");
  const uf = loc(filmProg, "uRes", "uNorm", "uSeed", "uDay");
  // The dome is fixed to the world: set once, never per frame.
  gl.uniformMatrix3fv(u.dome, false, domeFrame());

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

  // The film's targets: the matted frame at full size; the bright pass at
  // half; the pyramid's levels down to a thirty-second, with one level per
  // step on the way back up; and the halation's two axes at half size. Half
  // floats where the GPU can render to them, so the spread light keeps its
  // darks without banding. Allocated whenever the canvas changes size.
  const half = gl.getExtension("EXT_color_buffer_float");
  const fmt = half ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
  const LEVELS = 5;
  // Each level's own share on the way up, finest first: a tight core and a
  // long tail.
  const LEVEL_W = [1.0, 0.9, 0.8, 0.7, 0.55];
  const NORM = LEVEL_W.reduce((a, b) => a + b, 0);
  const rt = () => ({ tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 });
  const scene = rt();
  const down = Array.from({ length: LEVELS }, rt);
  const ups = Array.from({ length: LEVELS - 1 }, rt);
  const haloA = rt();
  const haloB = rt();
  const all = [scene, ...down, ...ups, haloA, haloB];
  let fw = 0;
  let fh = 0;
  const alloc = (t, w, h, f) => {
    t.w = w;
    t.h = h;
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, f[0], w, h, 0, gl.RGBA, f[1], null);
    params2d(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };
  const targets = (W, Hc) => {
    if (W === fw && Hc === fh) return;
    fw = W;
    fh = Hc;
    alloc(scene, W, Hc, [gl.RGBA8, gl.UNSIGNED_BYTE]);
    for (let i = 0; i < LEVELS; i++) {
      const d = 2 ** (i + 1);
      alloc(down[i], Math.max(1, Math.ceil(W / d)), Math.max(1, Math.ceil(Hc / d)), fmt);
      if (i < LEVELS - 1) alloc(ups[i], down[i].w, down[i].h, fmt);
    }
    alloc(haloA, down[0].w, down[0].h, fmt);
    alloc(haloB, down[0].w, down[0].h, fmt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  // A post step: into one target, reading others on units 13 and up.
  const into = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  };
  const bind = (unit, t) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
  };
  // The scene stays on unit 10 for the bright pass and the film.
  gl.useProgram(prepProg);
  gl.uniform1i(gl.getUniformLocation(prepProg, "uScene"), 10);
  gl.useProgram(downProg);
  gl.uniform1i(ud.uSrc, 13);
  gl.useProgram(upProg);
  gl.uniform1i(uu.uSrc, 13);
  gl.uniform1i(uu.uBase, 14);
  gl.useProgram(haloProg);
  gl.uniform1i(uh.uSrc, 13);
  gl.useProgram(filmProg);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uScene"), 10);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uDiffuse"), 13);
  gl.uniform1i(gl.getUniformLocation(filmProg, "uHalo"), 14);

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
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // What scatters, at half size, then its pyramid down and back up, and
    // its red layer blurred for the halation.
    bind(10, scene);
    into(down[0]);
    gl.useProgram(prepProg);
    gl.uniform2f(up.uTexel, 1 / W, 1 / Hc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(downProg);
    for (let i = 1; i < LEVELS; i++) {
      bind(13, down[i - 1]);
      into(down[i]);
      gl.uniform2f(ud.uTexel, 1 / down[i - 1].w, 1 / down[i - 1].h);
      gl.uniform2f(ud.uOut, down[i].w, down[i].h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(upProg);
    for (let i = LEVELS - 2; i >= 0; i--) {
          // The coarsest level enters at its own share.
      const src = i === LEVELS - 2 ? down[LEVELS - 1] : ups[i + 1];
      bind(13, src);
      bind(14, down[i]);
      into(ups[i]);
      gl.uniform2f(uu.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform2f(uu.uOut, ups[i].w, ups[i].h);
      gl.uniform1f(uu.uW, LEVEL_W[i]);
      gl.uniform1f(uu.uS, i === LEVELS - 2 ? LEVEL_W[LEVELS - 1] : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(haloProg);
    gl.uniform2f(uh.uOut, down[0].w, down[0].h);
    bind(13, down[0]);
    into(haloA);
    gl.uniform1i(uh.uCh, 3);
    gl.uniform2f(uh.uStep, 1 / down[0].w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bind(13, haloA);
    into(haloB);
    gl.uniform1i(uh.uCh, 0);
    gl.uniform2f(uh.uStep, 0, 1 / down[0].h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The film, to the canvas: cheap, so it alone runs for each grain step.
  function develop() {
    const W = stage.canvas.width;
    const Hc = stage.canvas.height;
    if (W !== fw || Hc !== fh) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(filmProg);
    bind(10, scene);
    bind(13, ups[0]);
    bind(14, haloB);
    gl.viewport(0, 0, W, Hc);
    gl.uniform2f(uf.uRes, W, Hc);
    gl.uniform1f(uf.uNorm, NORM);
    gl.uniform1f(uf.uSeed, seed);
    gl.uniform1f(uf.uDay, day);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    destroy() {
      all.forEach((t) => {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      });
      stage.destroy();
    },
  };
}
