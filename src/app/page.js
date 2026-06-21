import { geist } from "./fonts";
import TempPage from "./ui/Hero/TempPage";
import ClientSplatSection from "./experience/components/ClientSplatSection";
import { description } from "./constants";

export const metadata = {
  description,
};

export default function Home() {
  return (
    <main
      id="content"
      className={`bg-slate-100 ${geist.className} relative`}
    >
      {/* Hero — full viewport */}
      <div className="h-svh">
        <TempPage />
      </div>
      {/* Splat — scrolls in below hero */}
      <ClientSplatSection />
    </main>
  );
}
