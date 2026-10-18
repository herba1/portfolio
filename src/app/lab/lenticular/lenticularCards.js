import { albumById } from "@/app/lab/_music/catalog";

export const FRAME_COUNT = 7;
export const REST_FRAME = 3;
export const SPLIT = 4;

const pair = (key, a, b, move) => {
  const front = albumById(a);
  const back = albumById(b);
  return {
    key,
    front,
    back,
    src: front.cover,
    name: `${front.title.replace(/'s Lonely.*$/, "")}`,
    move,
    full: `${front.title} (${front.year}) and ${back.title} (${back.year})`,
    aspect: 1,
    dir: 1,
  };
};

export const CARDS = [
  pair("soul", "rubber-soul", "revolver", "to Revolver"),
  pair("road", "abbey-road", "let-it-be", "to Let It Be"),
  pair("help", "help", "a-hard-days-night", "to A Hard Day's Night"),
  pair("pepper", "sgt-pepper", "magical-mystery-tour", "to Magical Mystery Tour"),
];
