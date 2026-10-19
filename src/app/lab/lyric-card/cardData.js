import beach from "./beach.jpg";
import beams from "./beams.jpg";
import sea from "./sea.jpg";
import timesSquare from "./times-square.jpg";
import wires from "./wires.jpg";

export const SONG = { title: "friday", artist: "herb", note: "Written over herb’s friday beat" };

export const LYRICS = [
  "we can stay out till the streetlights go soft",
  "nobody’s waiting up for us tonight",
  "i keep your voice on the walk home",
  "the city hums like it knows our names",
  "you don’t have to be anyone tonight",
  "it will take a while to feel like this again",
  "so leave the window open",
  "let the cold come in",
  "nothing good comes easy",
  "but it comes",
  "the whole point is not knowing",
  "and going anyway",
  "still here?",
  "still here.",
  "how are you, really",
  "we’ll be fine by morning",
];

export const PHOTOS = [
  { id: "times-square", label: "Times Square at night", src: timesSquare.src, focus: [0.46, 0.56], night: true, textY: 0.2 },
  { id: "beams", label: "Light beams through fog", src: beams.src, focus: [0.42, 0.5], night: true, textY: 0.34 },
  { id: "wires", label: "Power lines at dusk", src: wires.src, focus: [0.5, 0.5], night: true, textY: 0.5 },
  { id: "sea", label: "The sea from the wall", src: sea.src, focus: [0.62, 0.5], night: false, textY: 0.3 },
  { id: "beach", label: "On the beach with a fish", src: beach.src, focus: [0.5, 0.42], night: false, textY: 0.62 },
];

export const LAYOUTS = [
  { id: "block", label: "Block" },
  { id: "caption", label: "Caption" },
  { id: "build", label: "Build" },
  { id: "big", label: "Big" },
];

export const MAX_LINES = 4;
