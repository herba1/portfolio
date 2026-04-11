import { geist } from "./fonts";
import TempPage from "./ui/Hero/TempPage";
import ClientSplatSection from "./experience/components/ClientSplatSection";

export const metadata = {
  title: "herb.art",
  description: "and remember to have a nice day",
};

export default function Home() {
  return (
    <main
      id="content"
      className={`bg-slate-100 ${geist.className} relative`}
    >
      {/* Hero — full viewport */}
      <div className="h-dvh">
        <TempPage />
      </div>
      {/* Splat — scrolls in below hero */}
      <ClientSplatSection />
    </main>
  );
}
