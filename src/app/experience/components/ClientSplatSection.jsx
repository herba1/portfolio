"use client";

import dynamic from "next/dynamic";

const SplatScrollSection = dynamic(
  () => import("./SplatScrollSection"),
  { ssr: false }
);

export default function ClientSplatSection() {
  return <SplatScrollSection />;
}
