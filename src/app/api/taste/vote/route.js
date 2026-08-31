import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import {
  IDEAS_FILE,
  VOTES_FILE,
  appendJsonl,
  newId,
  now,
  readManifest,
  readVotes,
  rewriteJsonl,
  sanitizePoint,
  sanitizeVerdict,
  setStatus,
} from "@/lib/taste/store";

const STATUS_FOR_VERDICT = { like: "liked", dislike: "rejected", continue: "liked" };

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body?.kind === "point" ? sanitizePoint(body) : sanitizeVerdict(body);
  if (!record) return NextResponse.json({ error: "Invalid vote" }, { status: 400 });

  const manifest = await readManifest(record.slug);
  if (!manifest) return NextResponse.json({ error: "Unknown experiment" }, { status: 404 });

  record.previousStatus = manifest.status;
  if (record.kind === "verdict") record.iteration = manifest.iteration || 0;
  await appendJsonl(VOTES_FILE, record);

  if (record.kind === "verdict" && !record.recheck) {
    const status = STATUS_FOR_VERDICT[record.verdict];
    if (status && manifest.status !== "shipped") await setStatus(record.slug, status);
    if (record.verdict === "continue") {
      await appendJsonl(IDEAS_FILE, {
        id: newId(),
        ts: now(),
        kind: "evolve",
        parentSlug: record.slug,
        title: `Evolve ${manifest.title}`,
        summary: manifest.description,
        tags: manifest.tags,
        reasons: record.reasons,
        source: "taste",
        usedAt: null,
      });
    }
  }

  return NextResponse.json({ ok: true, record });
}

export async function DELETE(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const votes = await readVotes();
  const target = votes.find((v) => v.id === id);
  if (!target) return NextResponse.json({ error: "Unknown vote" }, { status: 404 });
  await rewriteJsonl(
    VOTES_FILE,
    votes.map((v) => (v.id === id ? { ...v, undone: true } : v)),
  );
  if (target.kind === "verdict" && !target.recheck && target.previousStatus) {
    await setStatus(target.slug, target.previousStatus);
  }
  return NextResponse.json({ ok: true });
}
