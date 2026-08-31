import { NextResponse } from "next/server";

import { isProdView } from "@/lib/viewMode";
import { SLUG_RE, STATUSES, setStatus } from "@/lib/taste/store";

export async function POST(request) {
  if (isProdView()) return NextResponse.json({ error: "Not available" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const slug = String(body?.slug || "");
  if (!SLUG_RE.test(slug) || !STATUSES.includes(body?.status)) {
    return NextResponse.json({ error: "Invalid status change" }, { status: 400 });
  }
  const manifest = await setStatus(slug, body.status);
  if (!manifest) return NextResponse.json({ error: "Unknown experiment" }, { status: 404 });
  return NextResponse.json({ ok: true, manifest });
}
