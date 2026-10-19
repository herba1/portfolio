import barn from "./photo-barn.webp";
import door from "./photo-door.webp";
import fence from "./photo-fence.webp";
import house from "./photo-house.webp";
import lake from "./photo-lake.webp";
import mooring from "./photo-mooring.webp";
import shore from "./photo-shore.webp";

export const SPREAD = [
  { kind: "line", id: "open", text: "how are you, really?", size: "xl" },
  { kind: "photo", id: "shore", src: shore, alt: "Two people wading out of shallow water onto an empty beach, carrying flippers", layout: "wide", ratio: 1.5, focus: [0.5, 0.5] },
  { kind: "line", id: "drove", text: "we drove out past the last streetlight to see if the sky was still there", size: "lg" },
  {
    kind: "pair",
    id: "pair",
    photos: [
      { kind: "photo", id: "fence", src: fence, alt: "A white lighthouse behind a picket fence on a grey afternoon", ratio: 0.8, focus: [0.5, 0.5] },
      { kind: "photo", id: "door", src: door, alt: "A latch and a white knob on a weathered red door", ratio: 0.8, focus: [0.36, 0.5] },
    ],
  },
  { kind: "line", id: "quiet", text: "somebody has to sit up with the quiet", size: "lg", align: "end" },
  { kind: "photo", id: "mooring", src: mooring, alt: "A small wooden boat at anchor on still water near a low shore", layout: "right", ratio: 1, focus: [0.46, 0.5] },
  { kind: "line", id: "page", text: "i read the same page all afternoon", size: "lg" },
  { kind: "photo", id: "barn", src: barn, alt: "A red barn and farmhouse reflected in a pond among spring trees", layout: "full", ratio: 1.6, focus: [0.5, 0.5] },
  { kind: "line", id: "summer", text: "every summer pretends it will stay", size: "xl" },
  {
    kind: "aside",
    id: "house",
    photo: { kind: "photo", id: "house", src: house, alt: "The front of an old stone house with red shutters and a red door", ratio: 0.8, focus: [0.36, 0.6] },
    line: { kind: "line", id: "dinner", text: "don’t be strange. stay for dinner.", size: "md" },
  },
  { kind: "photo", id: "lake", src: lake, alt: "A calm sea under summer clouds, with a low island of palms on the horizon", layout: "wide", ratio: 1.5, focus: [0.5, 0.5] },
  { kind: "line", id: "home", text: "call me when you get home", size: "xl", align: "end" },
];
