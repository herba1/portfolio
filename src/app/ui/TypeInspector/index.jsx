"use client";

import dynamic from "next/dynamic";

const DEV = process.env.NODE_ENV !== "production";

const Panel = dynamic(() => import("./TypeInspector"), { ssr: false });

export default function TypeInspector() {
  if (!DEV) return null;
  return <Panel />;
}
