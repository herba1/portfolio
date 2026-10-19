import beams from "./photo-beams.webp";
import clock from "./photo-clock.webp";
import meadow from "./photo-meadow.webp";
import reading from "./photo-reading.webp";
import valley from "./photo-valley.webp";
import visitor from "./photo-visitor.webp";
import wires from "./photo-wires.webp";

export const SPREAD = [
  { kind: "line", id: "open", text: "how are you, really?", size: "xl" },
  { kind: "photo", id: "beams", src: beams, alt: "Two people and a parked car on a dark hill, lit by searchlight beams in the fog", layout: "wide", ratio: 1.5, focus: [0.42, 0.5] },
  { kind: "line", id: "drove", text: "we drove out past the last streetlight to see if the sky was still there", size: "lg" },
  {
    kind: "pair",
    id: "pair",
    photos: [
      { kind: "photo", id: "wires", src: wires, alt: "A tiny figure sitting on power lines against an orange dusk", ratio: 0.8, focus: [0.62, 0.4] },
      { kind: "photo", id: "clock", src: clock, alt: "Someone sitting on the gilded edge of a huge clock face high above a city", ratio: 0.8, focus: [0.4, 0.4] },
    ],
  },
  { kind: "line", id: "quiet", text: "somebody has to sit up with the quiet", size: "lg", align: "end" },
  { kind: "photo", id: "reading", src: reading, alt: "A man reading a newspaper on a yellow stool in a green field", layout: "right", ratio: 1, focus: [0.5, 0.5] },
  { kind: "line", id: "page", text: "i read the same page all afternoon", size: "lg" },
  { kind: "photo", id: "meadow", src: meadow, alt: "A meadow of red, white and orange wildflowers under trees", layout: "full", ratio: 1.6, focus: [0.5, 0.62] },
  { kind: "line", id: "summer", text: "every summer pretends it will stay", size: "xl" },
  {
    kind: "aside",
    id: "visitor",
    photo: { kind: "photo", id: "visitor", src: visitor, alt: "A white-robed figure in a field of daisies under a hovering silver craft", ratio: 0.8, focus: [0.5, 0.45] },
    line: { kind: "line", id: "dinner", text: "don’t be strange. stay for dinner.", size: "md" },
  },
  { kind: "photo", id: "valley", src: valley, alt: "A green alpine valley with a single tree and mountains beyond", layout: "wide", ratio: 1.5, focus: [0.5, 0.55] },
  { kind: "line", id: "home", text: "call me when you get home", size: "xl", align: "end" },
];
