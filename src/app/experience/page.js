import ClientExperience from "./components/ClientExperience";

export const metadata = {
  title: "Experience",
  description: "Interactive 3D gaussian splat experience by Herb.",
};

export default function ExperiencePage() {
  return (
    <div className="fixed inset-0 h-dvh w-dvw bg-white">
      <ClientExperience />
    </div>
  );
}
