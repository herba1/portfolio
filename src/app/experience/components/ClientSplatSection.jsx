"use client";

import dynamic from "next/dynamic";
import SplatErrorBoundary from "./SplatErrorBoundary";

const SplatScrollSection = dynamic(
  () => import("./SplatScrollSection"),
  { ssr: false }
);

export default function ClientSplatSection() {
  return (
    <SplatErrorBoundary>
      <SplatScrollSection />
    </SplatErrorBoundary>
  );
}
