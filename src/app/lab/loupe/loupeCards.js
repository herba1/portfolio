import faceImg from "./print-face-paint.jpg";
import hibiscusImg from "./print-hibiscus.jpg";
import lighthouseImg from "./print-lighthouse.jpg";
import macawsImg from "./print-macaws.jpg";

const print = (key, img, name, full, tilt, focus, wear) => ({
  key,
  src: img.src,
  name,
  full,
  year: "1991",
  widthMm: 148,
  aspect: 768 / 512,
  tilt,
  focus,
  wear,
});

export const CARDS = [
  print("macaws", macawsImg, "Macaws", "Two macaws, a Kodak Photo CD film scan", -0.03, [0.64, 0.345], [2.2, 30.0, 0.0, 0.31]),
  print("face", faceImg, "Face paint", "A girl in yellow face paint, a Kodak Photo CD film scan", 0.028, [0.54, 0.4], [-0.5, -40.0, 0.0, 0.72]),
  print("hibiscus", hibiscusImg, "Hibiscus", "Hibiscus at a shuttered window, a Kodak Photo CD film scan", -0.022, [0.47, 0.5], [0.3, 44.0, 0.0, 0.53]),
  print("lighthouse", lighthouseImg, "Lighthouse", "A lighthouse on a rocky coast, a Kodak Photo CD film scan", 0.032, [0.44, 0.33], [1.35, 20.0, 0.0, 0.9]),
];

export const ZOOM_MIN = 1.5;
export const ZOOM_MAX = 4;
export const ZOOM_REST = 2.8;
