import { piece } from "./_piece.mjs";
// A lyric block where each line sits at its own distance: tap a line and focus
// racks to it. No dial; the pointer does it. The inline album art is swapped
// for film photographs (assets/photos) so the clip isn't wall-to-wall covers.
const photo = (id, file) => ({ url: `**/tierlist/images/image-${id}.webp*`, file: `tools/showreel/assets/photos/${file}.jpg` });
export default piece({
  url: "/lab/focus-pull", ready: "canvas",
  hide: [".focus-pull-ring"],
  swap: [photo("mqobqjlb", "picnic"), photo("mqobr6yd", "yellow-car"), photo("mqobrb2l", "mt-hood")],
  beats: [
    { click: [0.5, 0.31], duration: 600, settle: 120, pause: 1300 },
    { click: [0.45, 0.78], duration: 650, settle: 120, pause: 1300 },
    { click: [0.5, 0.55], duration: 550, settle: 120, pause: 1500 },
  ],
});
