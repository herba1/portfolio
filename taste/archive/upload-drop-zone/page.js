import UploadDropZoneExperience from "./UploadDropZoneExperience";

export const metadata = {
  title: "Upload drop zone",
  description: "A drag-and-drop uploader with per-file progress rings, thumbnail previews, retry on failure, and a queue summary line. Simulate uploads with realistic timing.",
};

export default function UploadDropZonePage() {
  return <UploadDropZoneExperience />;
}
