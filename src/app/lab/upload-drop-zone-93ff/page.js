import UploadDropZone93ffExperience from "./UploadDropZone93ffExperience";
import { notFound } from "next/navigation";

import { isProdView } from "@/lib/viewMode";

import manifest from "./experiment.json";

export const metadata = {
  title: "Upload drop zone",
  description: "A drag-and-drop uploader with per-file progress rings, thumbnail previews, retry on failure, and a queue summary line. Simulate uploads with realistic timing.",
};

export default function UploadDropZone93ffPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  return <UploadDropZone93ffExperience />;
}
