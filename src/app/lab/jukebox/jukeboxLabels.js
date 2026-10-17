const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = '"Helvetica Neue", Arial, sans-serif';

function seeded(seed) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function arcText(ctx, text, cx, cy, radius, centerAngle, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let angle = centerAngle - total / radius / 2;
  for (let i = 0; i < chars.length; i += 1) {
    const w = widths[i] - spacing;
    const a = angle + w / 2 / radius;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    angle += widths[i] / radius;
  }
}

function fitFont(ctx, text, weight, family, size, maxWidth) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 10) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

export function drawLabel(song, size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  const R = size / 2;
  const rand = seeded(song.index + 3);
  const { paper, ink, rim, style } = song.label;

  ctx.fillStyle = "#0b0a0a";
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, size, size);

  const shade = ctx.createRadialGradient(c * 0.86, c * 0.8, R * 0.1, c, c, R);
  shade.addColorStop(0, "rgba(255,248,230,0.10)");
  shade.addColorStop(0.55, "rgba(255,248,230,0.02)");
  shade.addColorStop(0.85, "rgba(0,0,0,0.06)");
  shade.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.9;
  if (style === "rays") {
    ctx.lineWidth = size * 0.004;
    for (let i = 0; i < 46; i += 1) {
      const a = Math.PI + (i / 45) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R * 0.5, c + Math.sin(a) * R * 0.5);
      ctx.lineTo(c + Math.cos(a) * R * 0.86, c + Math.sin(a) * R * 0.86);
      ctx.stroke();
    }
  } else if (style === "rings") {
    for (const [r, w] of [
      [0.9, 0.012],
      [0.86, 0.004],
      [0.5, 0.004],
    ]) {
      ctx.lineWidth = size * w;
      ctx.beginPath();
      ctx.arc(c, c, R * r, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = size * 0.005;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i - 2) * 0.24;
      const x = c + Math.cos(a) * R * 0.56;
      const y = c + Math.sin(a) * R * 0.56;
      ctx.beginPath();
      for (let k = 0; k < 10; k += 1) {
        const rr = (k % 2 ? 0.4 : 1) * size * 0.022;
        const aa = -Math.PI / 2 + (k * Math.PI) / 5;
        ctx.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = rim;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.985, 0, Math.PI * 2);
  ctx.arc(c, c, R * 0.95, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 600 ${Math.round(size * 0.1)}px ${SERIF}`;
  arcText(ctx, song.label.name, c, c, R * 0.7, -Math.PI / 2, size * 0.004);

  ctx.font = `600 ${Math.round(size * 0.034)}px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillText("45 RPM", c - R * 0.66, c - R * 0.04);
  ctx.fillText(song.catalog, c + R * 0.66, c - R * 0.04);

  ctx.font = `700 ${Math.round(size * 0.046)}px ${SANS}`;
  ctx.fillText(song.code, c, c + R * 0.08 - R * 0.52);

  ctx.textBaseline = "alphabetic";
  const titleSize = fitFont(ctx, song.title, "700", SERIF, Math.round(size * 0.074), R * 1.3);
  ctx.font = `700 ${titleSize}px ${SERIF}`;
  ctx.fillText(song.title, c, c + R * 0.5);
  const artistSize = fitFont(ctx, song.artist, "500", SANS, Math.round(size * 0.044), R * 1.12);
  ctx.font = `500 ${artistSize}px ${SANS}`;
  ctx.fillText(song.artist, c, c + R * 0.66);
  ctx.font = `400 ${Math.round(size * 0.026)}px ${SANS}`;
  ctx.fillText("Vocal with orchestra", c, c + R * 0.37);

  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  ctx.putImageData(image, 0, 0);

  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = "rgba(60,40,30,0.18)";
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.arc(c, c, R * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
  return canvas;
}

export function drawGrooves(size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = seeded(17);
  const img = ctx.createImageData(4, size);
  for (let y = 0; y < size; y += 1) {
    const v = y / (size - 1);
    let rough = 0.5;
    let shade = 0;
    if (v < 0.54) {
      rough = 0.2;
    } else if (v < 0.57) {
      rough = 0.28;
      shade = 0.04;
    } else if (v < 0.94) {
      rough = 0.42 + 0.12 * Math.sin(v * 1900) * Math.sin(v * 63) + (rand() - 0.5) * 0.18;
      const band = Math.sin(v * 1600 + Math.sin(v * 90) * 4);
      rough += band * 0.05;
      if (Math.abs(v - 0.74) < 0.003 || Math.abs(v - 0.83) < 0.003) {
        rough = 0.2;
        shade = 0.05;
      }
    } else if (v < 0.96) {
      rough = 0.24;
      shade = 0.03;
    } else {
      rough = 0.5;
    }
    const r = Math.max(0, Math.min(255, Math.round(rough * 255)));
    const g = Math.max(0, Math.min(255, Math.round(shade * 255)));
    for (let x = 0; x < 4; x += 1) {
      const i = (y * 4 + x) * 4;
      img.data[i] = g;
      img.data[i + 1] = r;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function drawBackdrop(width = 512, height = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#1a0d0a");
  base.addColorStop(0.45, "#2a120c");
  base.addColorStop(0.8, "#160a08");
  base.addColorStop(1, "#0b0606");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  const tubes = [
    [0.12, "255,120,60"],
    [0.3, "255,180,90"],
    [0.5, "255,210,140"],
    [0.7, "255,170,80"],
    [0.88, "230,90,70"],
  ];
  ctx.globalCompositeOperation = "lighter";
  for (const [x, rgb] of tubes) {
    const cx = x * width;
    const g = ctx.createLinearGradient(cx - width * 0.06, 0, cx + width * 0.06, 0);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(0.3, `rgba(${rgb},0.12)`);
    g.addColorStop(0.5, `rgba(${rgb},0.5)`);
    g.addColorStop(0.7, `rgba(${rgb},0.12)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - width * 0.06, height * 0.04, width * 0.12, height * 0.9);
  }
  for (let i = 0; i < 48; i += 1) {
    const x = (i / 48) * width;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x, 0, width / 96, height);
  }
  ctx.globalCompositeOperation = "source-over";
  return canvas;
}
