import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import { NOTES_FILE, appendJsonl, readNotes, readVotes, sanitizeNote } from "@/lib/taste/store";

export async function GET(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  const slug = new URL(request.url).searchParams.get("slug");
  const [notes, votes] = await Promise.all([readNotes(), readVotes()]);
  const filtered = slug ? notes.filter((n) => n.slug === slug) : notes;
  const feedback = slug ? votes.filter((v) => v.slug === slug && !v.undone).slice(-30).reverse() : [];
  return NextResponse.json({ notes: filtered.slice(-50).reverse(), feedback });
}

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const note = sanitizeNote(body);
  if (!note) return NextResponse.json({ error: "Empty note" }, { status: 400 });
  await appendJsonl(NOTES_FILE, note);
  return NextResponse.json({ ok: true, note });
}
