"use client";

import { useEffect } from "react";

import { installTileGate } from "@/lib/sound/tileGate";

// Every piece's sound follows its tile on screen while the index is open: it
// eases out as the tile scrolls away and back in when it returns.
export default function AudioGate() {
  useEffect(() => installTileGate(), []);
  return null;
}
