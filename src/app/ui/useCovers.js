"use client";

import { useEffect, useState } from "react";

const SAMPLE_SIZE = 12;
const EDGE_BANDS = 5;
const PATTERN_GRID = 8;

function averageColour(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    const max = Math.max(data[index], data[index + 1], data[index + 2]);
    const min = Math.min(data[index], data[index + 1], data[index + 2]);
    const weight = 0.15 + (max - min) / 255;
    red += data[index] * weight;
    green += data[index + 1] * weight;
    blue += data[index + 2] * weight;
    total += weight;
  }
  return { red: red / total, green: green / total, blue: blue / total };
}

function edgeGradient(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = EDGE_BANDS;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, 1, EDGE_BANDS);
  const { data } = context.getImageData(0, 0, 1, EDGE_BANDS);
  const stops = [];
  const palette = [];
  for (let band = 0; band < EDGE_BANDS; band += 1) {
    const at = (((band + 0.5) / EDGE_BANDS) * 100).toFixed(1);
    const colour = `rgb(${data[band * 4]} ${data[band * 4 + 1]} ${data[band * 4 + 2]})`;
    palette.push(colour);
    stops.push(`${colour} ${at}%`);
  }
  return { edge: `linear-gradient(${stops.join(", ")})`, palette };
}

function patternGrid(image) {
  const canvas = document.createElement("canvas");
  canvas.width = PATTERN_GRID;
  canvas.height = PATTERN_GRID;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, PATTERN_GRID, PATTERN_GRID);
  const { data } = context.getImageData(0, 0, PATTERN_GRID, PATTERN_GRID);
  const cells = [];
  for (let index = 0; index < PATTERN_GRID * PATTERN_GRID; index += 1) {
    const at = index * 4;
    cells.push({
      colour: `rgb(${data[at]} ${data[at + 1]} ${data[at + 2]})`,
      light: (0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2]) / 255,
    });
  }
  return cells;
}

function hueOf({ red, green, blue }) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (!delta) return 0;
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (sector * 60 + 360) % 360;
}

function loadCover(cover) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      let colour = { red: 128, green: 128, blue: 128 };
      let edge = "";
      let palette = [];
      let pattern = [];
      try {
        colour = averageColour(image);
        ({ edge, palette } = edgeGradient(image));
        pattern = patternGrid(image);
      } catch {
        colour = { red: 128, green: 128, blue: 128 };
      }
      resolve({
        ...cover,
        image: cover.image,
        element: image,
        edge,
        palette,
        pattern,
        ...colour,
        hue: hueOf(colour),
        light: 0.2126 * colour.red + 0.7152 * colour.green + 0.0722 * colour.blue,
      });
    };
    image.onerror = () => resolve(null);
    image.src = cover.image;
  });
}

export default function useCovers(covers) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all(covers.map(loadCover)).then((list) => {
      if (alive) setItems(list.filter(Boolean));
    });
    return () => {
      alive = false;
    };
  }, [covers]);

  return items;
}
