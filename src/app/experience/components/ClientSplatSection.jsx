"use client";

import dynamic from "next/dynamic";
import SplatErrorBoundary from "./SplatErrorBoundary";

const SplatScrollSection = dynamic(
  () => import("./SplatScrollSection"),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: "100lvh", minHeight: "500px", marginTop: "-10vh" }} />
    ),
  }
);

export default function ClientSplatSection() {
  return (
    <SplatErrorBoundary>
      <SplatScrollSection />
    </SplatErrorBoundary>
  );
}
