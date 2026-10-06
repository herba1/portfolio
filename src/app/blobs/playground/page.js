import BlobsExperience from "../BlobsExperience";

export const metadata = {
  title: "Blobs playground",
  description: "The flower wall, with every control.",
  robots: { index: false, follow: false },
};

export default function BlobsPlaygroundPage() {
  return <BlobsExperience />;
}
