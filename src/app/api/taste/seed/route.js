import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import { readSeed, writeSeed } from "@/lib/taste/store";

const cleanEntry = (entry) => {
  const url = typeof entry?.url === "string" ? entry.url.trim().slice(0, 500) : "";
  if (!/^(https?:\/\/|\/)/.test(url)) return null;
  return { url, note: typeof entry?.note === "string" ? entry.note.trim().slice(0, 500) : "" };
};

export async function GET() {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  return NextResponse.json(await readSeed());
}

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const seed = await readSeed();
  const bucket = body?.bucket === "hated" ? "hated" : "loved";
  const entry = cleanEntry(body);
  if (!entry) return NextResponse.json({ error: "Needs an http(s) url" }, { status: 400 });
  const other = bucket === "loved" ? "hated" : "loved";
  seed[other] = seed[other].filter((e) => e.url !== entry.url);
  seed[bucket] = [...seed[bucket].filter((e) => e.url !== entry.url), entry];
  await writeSeed(seed);
  return NextResponse.json({ ok: true, seed });
}

export async function DELETE(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  const url = new URL(request.url).searchParams.get("url");
  const seed = await readSeed();
  seed.loved = seed.loved.filter((e) => e.url !== url);
  seed.hated = seed.hated.filter((e) => e.url !== url);
  await writeSeed(seed);
  return NextResponse.json({ ok: true, seed });
}
