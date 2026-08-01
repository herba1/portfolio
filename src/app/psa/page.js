import PreloadScans from "./PreloadScans";
import PsaExperience from "./PsaExperience";

export const metadata = {
  title: "PSA",
  description:
    "A collection of graded cards, and the interaction for filling it.",
};

export default function PsaPage() {
  return (
    <>
      <PreloadScans />
      <PsaExperience />
    </>
  );
}
