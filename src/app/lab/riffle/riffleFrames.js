export const FRAMES = 48;
export const STRIDE = 12;
export const PAGE_ASPECT = 4 / 3;

const INK = "#17161c";
const PAGE = "#fbf9f4";

const BAND = [
  { name: "John", suit: "#f4f2ec", shade: "#d9d5ca", hair: "#6b4a2e", long: true, shoes: "#f4f2ec" },
  { name: "Ringo", suit: "#26252b", shade: "#121116", hair: "#2a1d14", long: false, shoes: "#121116" },
  { name: "Paul", suit: "#4b4f57", shade: "#363a41", hair: "#3a2a1c", long: false, shoes: null },
  { name: "George", suit: "#3d5f93", shade: "#2c4670", hair: "#2d2017", long: true, shoes: "#3a2a1c" },
];

function limb(ctx, x, y, a1, l1, a2, l2, width, color) {
  const kx = x + Math.sin(a1) * l1;
  const ky = y + Math.cos(a1) * l1;
  const ex = kx + Math.sin(a1 - a2) * l2;
  const ey = ky + Math.cos(a1 - a2) * l2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(kx, ky);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  return [ex, ey, a1 - a2];
}

function foot(ctx, x, y, angle, len, color) {
  if (!color) return;
  const fx = x + Math.cos(angle * 0.4) * len;
  const fy = y + Math.sin(angle * 0.4) * len * 0.2;
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = len * 0.62 + 3;
  ctx.beginPath();
  ctx.moveTo(x - len * 0.15, y);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = len * 0.62;
  ctx.stroke();
}

function legPose(phase) {
  const thigh = 0.46 * Math.sin(phase);
  const swing = Math.cos(phase);
  const knee = 0.08 + 0.75 * Math.max(0, swing) * Math.max(0, Math.sin(phase + 0.9));
  return [thigh, knee];
}

function figure(ctx, m, x, ground, H, phase) {
  const bob = Math.abs(Math.cos(phase)) * H * 0.018;
  const hipY = ground - H * 0.5 - bob;
  const shoulderY = ground - H * 0.8 - bob;
  const lw = H * 0.085;
  const thighL = H * 0.25;
  const shinL = H * 0.25;
  const [tb, kb] = legPose(phase + Math.PI);
  const [tf, kf] = legPose(phase);
  const back = limb(ctx, x, hipY, tb, thighL, -kb, shinL, lw, m.shade);
  foot(ctx, back[0], back[1], back[2], H * 0.075, m.shoes ? m.shade : null);
  limb(ctx, x, shoulderY + H * 0.02, 0.32 * Math.sin(phase), H * 0.16, -0.25 - 0.15 * Math.max(0, Math.sin(phase)), H * 0.15, lw * 0.82, m.shade);
  ctx.lineJoin = "round";
  ctx.fillStyle = m.suit;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x - H * 0.075, shoulderY - H * 0.01, H * 0.15, hipY - shoulderY + H * 0.05, H * 0.05);
  ctx.fill();
  ctx.stroke();
  const front = limb(ctx, x, hipY, tf, thighL, -kf, shinL, lw, m.suit);
  foot(ctx, front[0], front[1], front[2], H * 0.075, m.shoes);
  limb(ctx, x, shoulderY + H * 0.02, -0.32 * Math.sin(phase), H * 0.16, -0.25 - 0.15 * Math.max(0, -Math.sin(phase)), H * 0.15, lw * 0.82, m.suit);
  const hx = x + H * 0.012;
  const hy = shoulderY - H * 0.085;
  const hr = H * 0.068;
  ctx.fillStyle = m.hair;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  if (m.long) {
    ctx.beginPath();
    ctx.ellipse(hx - hr * 0.35, hy + hr * 0.25, hr * 1.05, hr * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#e9c9a8";
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = m.hair;
  ctx.beginPath();
  ctx.arc(hx - hr * 0.1, hy - hr * 0.1, hr * 1.02, Math.PI * 0.95, Math.PI * 2.05);
  ctx.closePath();
  ctx.fill();
}

export function drawFrame(ctx, frame, w, h, fonts) {
  const f = ((frame % FRAMES) + FRAMES) % FRAMES;
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, w, h);
  const ground = h * 0.74;
  const H = h * 0.5;
  ctx.fillStyle = "#e8e4da";
  ctx.fillRect(0, ground, w, h - ground);
  const bar = w / 14;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgb(23 22 28 / 0.18)";
  ctx.lineWidth = 1;
  for (let i = -2; i < 18; i += 2) {
    const x = i * bar;
    ctx.beginPath();
    ctx.moveTo(x + bar * 0.3, ground + 2);
    ctx.lineTo(x + bar * 1.1, ground + 2);
    ctx.lineTo(x + bar * 0.95, h * 0.9);
    ctx.lineTo(x + bar * 0.05, h * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, ground);
  ctx.lineTo(w, ground);
  ctx.stroke();
  const spacing = w * 0.2;
  const period = w * 1.2;
  const shift = (f / FRAMES) * period;
  for (let i = BAND.length - 1; i >= 0; i -= 1) {
    const x = ((((w * 0.84 - i * spacing + shift) % period) + period) % period) - w * 0.1;
    const phase = (f / STRIDE) * Math.PI * 2 + i * 0.9;
    figure(ctx, BAND[i], x, ground + H * 0.02, H, phase);
  }
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  const fs = Math.max(10, Math.round(h * 0.045));
  ctx.font = `560 ${fs}px ${fonts.sans}`;
  ctx.textAlign = "left";
  ctx.fillText("Abbey Road, 8 August 1969", w * 0.05, h * 0.955);
  ctx.font = `500 ${fs}px ${fonts.mono}`;
  ctx.textAlign = "right";
  ctx.fillText(String(f + 1).padStart(2, "0"), w * 0.95, h * 0.955);
}
