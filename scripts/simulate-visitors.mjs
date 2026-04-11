#!/usr/bin/env node

/**
 * Cinematic visitor simulation for recording a demo video.
 *
 * Sequence:
 *   0-3s    — quiet, just you
 *   3s      — first visitor joins, says "hey"
 *   5s      — second joins
 *   7-12s   — they chat back and forth
 *   14s     — third joins, says something
 *   16-20s  — more chatter
 *   22s     — a wave of 8 visitors floods in
 *   24-28s  — the crowd sends messages
 *   30s     — a few leave
 *   34s     — more leave, back to calm
 *   38s     — last ones leave
 *
 * Usage:
 *   node scripts/simulate-visitors.mjs              # local
 *   node scripts/simulate-visitors.mjs --prod       # production
 */

import WebSocket from "ws";

const args = process.argv.slice(2);
const isProd = args.includes("--prod");
const HOST = isProd
  ? "herb-art-presence.herba1.partykit.dev"
  : "localhost:1999";
const ROOM = "hero";
const protocol = HOST.includes("localhost") ? "ws" : "wss";
const url = `${protocol}://${HOST}/party/${ROOM}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      console.log(`  👀 ${label} joined`);
      resolve(ws);
    });
    ws.on("error", (e) => {
      console.log(`  ❌ ${label} error: ${e.message}`);
      reject(e);
    });
  });
}

function typing(ws, label) {
  ws.send(JSON.stringify({ type: "typing" }));
  console.log(`  ✏️  ${label} typing...`);
}

function say(ws, label, msg) {
  ws.send(JSON.stringify({ type: "message", message: msg }));
  console.log(`  💬 ${label}: "${msg}"`);
}

function leave(ws, label) {
  ws.close();
  console.log(`  👋 ${label} left`);
}

async function run() {
  console.log(`\n🎬 Cinematic simulation on ${url}\n`);
  console.log(`── Act 1: The first visitors ──\n`);

  // Act 1: First arrivals
  await sleep(3000);
  const v1 = await connect("Visitor 1");
  await sleep(1500);
  typing(v1, "Visitor 1");
  await sleep(1200);
  say(v1, "Visitor 1", "hey :)");

  await sleep(2000);
  const v2 = await connect("Visitor 2");
  await sleep(2000);
  typing(v2, "Visitor 2");
  await sleep(800);
  say(v2, "Visitor 2", "oh hello!");

  await sleep(2500);
  typing(v1, "Visitor 1");
  await sleep(1000);
  say(v1, "Visitor 1", "nice site");

  await sleep(1500);
  const v3 = await connect("Visitor 3");
  await sleep(1500);
  typing(v3, "Visitor 3");
  await sleep(600);
  say(v3, "Visitor 3", "woah cool");

  await sleep(2000);
  typing(v2, "Visitor 2");
  await sleep(900);
  say(v2, "Visitor 2", "love the eyes");

  console.log(`\n── Act 2: The wave ──\n`);
  await sleep(3000);

  // Act 2: Big wave
  const wave = [];
  for (let i = 0; i < 8; i++) {
    await sleep(300 + Math.random() * 400); // rapid-fire joins
    const v = await connect(`Wave ${i + 1}`);
    wave.push(v);
  }

  console.log(`  🌊 8 visitors joined!`);
  await sleep(2000);

  // Wave messages
  const waveMessages = [
    "wow", "hi!", "so cool", ":D", "love this",
    "amazing", "yo!", "vibes",
  ];
  for (let i = 0; i < wave.length; i++) {
    await sleep(800 + Math.random() * 600);
    typing(wave[i], `Wave ${i + 1}`);
    await sleep(600 + Math.random() * 400);
    say(wave[i], `Wave ${i + 1}`, waveMessages[i]);
  }

  console.log(`\n── Act 3: The departure ──\n`);
  await sleep(3000);

  // Act 3: Gradual departure
  // First few wave visitors leave
  for (let i = 0; i < 4; i++) {
    await sleep(600 + Math.random() * 800);
    leave(wave[i], `Wave ${i + 1}`);
  }

  await sleep(2000);
  typing(v1, "Visitor 1");
  await sleep(1000);
  say(v1, "Visitor 1", "bye everyone");

  await sleep(1500);
  // More leave
  for (let i = 4; i < 8; i++) {
    await sleep(400 + Math.random() * 600);
    leave(wave[i], `Wave ${i + 1}`);
  }

  await sleep(2000);
  typing(v3, "Visitor 3");
  await sleep(800);
  say(v3, "Visitor 3", "later!");

  await sleep(2000);
  leave(v3, "Visitor 3");
  await sleep(1000);
  leave(v2, "Visitor 2");
  await sleep(1500);
  leave(v1, "Visitor 1");

  console.log(`\n✨ Scene complete (~45s)\n`);
  process.exit(0);
}

run().catch((e) => {
  console.error("Script failed:", e.message);
  process.exit(1);
});
