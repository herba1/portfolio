"use client";

import ClientOnly from "@/app/ui/ClientOnly";
import SplatErrorBoundary from "./SplatErrorBoundary";

export default function ClientSplatSection() {
  return (
    <SplatErrorBoundary>
      {/* ClientOnly, not next/dynamic — a lazy chunk arriving through Suspense
          inside the page-content ViewTransition replays the page entrance.
          The fallback holds the section's height so nothing shifts. */}
      <ClientOnly
        load={() => import("./SplatScrollSection")}
        fallback={
          <div style={{ height: "100lvh", minHeight: "500px", marginTop: "-10vh" }} />
        }
      />
    </SplatErrorBoundary>
  );
}
