import ClientExperience from "./components/ClientExperience";

export const metadata = {
  title: "Experience | herb.art",
  description: "Interactive 3D experience",
};

export default function ExperiencePage() {
  return (
    <div className="fixed inset-0 h-dvh w-dvw bg-white">
      <ClientExperience />
    </div>
  );
}
