"use client";

import BlobField from "./BlobField";
import { useBlobConfig } from "./blobConfig";

export default function BlobPlaygroundField() {
  const config = useBlobConfig();
  return <BlobField config={config} />;
}
