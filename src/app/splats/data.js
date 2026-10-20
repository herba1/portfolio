// The splats in the carousel, in order. Each entry is one actor on the stage.
//
//   id        slug and actor id: the card, the article hero and the "next"
//             frame all name the same actor, which is what makes it one
//             object that flies between pages.
//   src       a file under /public. .sog or .spz (v1–v3: Spark 2.3 can't read
//             SPZ v4) are a tenth the size of .ply; .splat, .ksplat and .ply
//             also load.
//   rotation  Euler XYZ fix-up so the capture stands upright and faces the
//             camera. Most captures are y-down; [Math.PI, 0, 0] flips them.
//   fit       multiplier on the auto-fit (robust bounds, see stage/fit.js)
//             for captures whose subject is smaller or larger than the frame
//             wants.
//   front     yaw (radians) at which the capture faces the camera; every
//             entrance and flight lands on it. Defaults to 0.
//   crop      optional share of the capture's height to hide from the bottom
//             up: a plinth, a turntable, the floor it stood on. The splats are
//             cut by a per-splat modifier and the framing ignores them.
//   hero      where it rests in the opening composition, before the scroll
//             lines it up in the rail. CSS lengths; `mobile` overrides.
//
// Placeholder captures: seven museum statues, plinths cropped, from PlayCanvas's public
// web-components examples (MIT), one matching set captured the same way, each
// under 2 MB. Swap `src`, `credit` and the copy for Herb's own captures;
// nothing else needs to change.

const FLIP = [Math.PI, 0, 0];
const PLAYCANVAS = {
  name: "PlayCanvas web-components examples",
  url: "https://github.com/playcanvas/web-components",
  license: "MIT",
};

const statue = (entry) => ({ rotation: FLIP, fit: 0.92, credit: PLAYCANVAS, ...entry });

export const SPLATS = [
  statue({
    id: "angel",
    front: -Math.PI / 2,
    crop: 0.36,
    title: "Angel",
    kicker: "Marble, kneeling",
    blurb: "A white marble angel kneeling in prayer on a dark plinth.",
    src: "/splats/carousel/angel.sog",
    hero: { x: "13%", y: "30%", size: "26vmin", mobile: { x: "24%", y: "17%", size: "36vmin" } },
    body: [
      "Placeholder copy. Marble is the classic hard case for capture: a pale, slightly translucent surface where light sinks in a little before it comes back out. Splats keep that softness instead of baking it into a flat texture.",
      "Drag the statue to turn it. The folds of the robe hold their shape from every side because each Gaussian sits where the surface was, not on a billboard facing you.",
    ],
  }),
  statue({
    id: "narcissus",
    front: Math.PI,
    crop: 0.335,
    title: "Narcissus",
    kicker: "Marble, crouching",
    blurb: "Narcissus crouched over his reflection, on a white pedestal.",
    src: "/splats/carousel/narcissus.sog",
    hero: { x: "31%", y: "74%", size: "24vmin", mobile: { x: "76%", y: "15%", size: "32vmin" } },
    body: [
      "Placeholder copy. A crouching figure folds in on itself, which means deep shadowed pockets between the arms and knees that a photogrammetry mesh tends to fill with mush.",
      "Here the gaps stay open: the capture only puts splats where it saw surface.",
    ],
  }),
  statue({
    id: "st-peter",
    front: Math.PI,
    crop: 0.4,
    title: "St Peter",
    kicker: "Bronze, standing",
    blurb: "A bronze-coloured standing St Peter on a grey plinth.",
    src: "/splats/carousel/st-peter.sog",
    hero: { x: "84%", y: "28%", size: "30vmin", mobile: { x: "20%", y: "83%", size: "36vmin" } },
    body: [
      "Placeholder copy. Metal is where splats beat meshes most visibly: the highlight moves as you turn the figure because it was captured from many directions, not painted on.",
      "Each splat keeps its view-dependent colour, so the bronze catches the light the way it did in the gallery.",
    ],
  }),
  statue({
    id: "massa",
    front: Math.PI,
    crop: 0.51,
    title: "Massa",
    kicker: "Marble, bust",
    blurb: "A white marble bust on a dark plinth.",
    src: "/splats/carousel/massa.sog",
    hero: { x: "69%", y: "77%", size: "22vmin", mobile: { x: "80%", y: "85%", size: "30vmin" } },
    body: [
      "Placeholder copy. A bust is mostly face, and faces are where any capture artefact is easiest to see. Turn it slowly and watch the profile hold.",
      "The capture is the smallest in the set, under 60,000 splats, and still reads at full size.",
    ],
  }),
  statue({
    id: "angel-candlestick",
    front: Math.PI,
    crop: 0.38,
    title: "Angel with candlestick",
    kicker: "Terracotta, kneeling",
    blurb: "A terracotta angel holding a candlestick, on a red plinth.",
    src: "/splats/carousel/angel-with-candlestick.sog",
    hero: { x: "89%", y: "57%", size: "20vmin", mobile: { x: "50%", y: "90%", size: "26vmin" } },
    body: [
      "Placeholder copy. Terracotta is matte and warm, the opposite of the marble beside it, and the only colour in the set.",
      "The thin candlestick is the stress test: a narrow object that has to survive as a clean line from the side.",
    ],
  }),
  statue({
    id: "trumpet",
    front: Math.PI,
    crop: 0.41,
    title: "Trumpeter",
    kicker: "Bronze, arms raised",
    blurb: "A dark figure with arms raised, on a grey plinth.",
    src: "/splats/carousel/trumpet.sog",
    hero: { x: "9%", y: "68%", size: "22vmin", mobile: { x: "50%", y: "10%", size: "28vmin" } },
    body: [
      "Placeholder copy. Raised arms put the silhouette far from the body's centre, which is where the robust framing earns its keep: the stage fits the figure, not its stray floaters.",
      "Dark bronze against a light page is the hardest case for the soft edges of a splat. They stay soft.",
    ],
  }),
  statue({
    id: "angel-book",
    front: -Math.PI / 4,
    crop: 0.4,
    title: "Angel with book",
    kicker: "Marble, kneeling",
    blurb: "A kneeling angel holding a book, on a white pedestal.",
    src: "/splats/carousel/angel-kneeling.sog",
    hero: { x: "50%", y: "16%", size: "18vmin", mobile: { x: "84%", y: "64%", size: "22vmin" } },
    body: [
      "Placeholder copy. The second angel in the set, captured the same way as the first, so the two sit together in the rail like a pair in a gallery.",
      "Open the next one to watch this statue leave and the next fly up into its place.",
    ],
  }),
];

export function splatBySlug(slug) {
  return SPLATS.find((item) => item.id === slug) ?? null;
}
