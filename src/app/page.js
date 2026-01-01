import { Inter } from "next/font/google";
import HeroSection from "./ui/Hero/HeroSection";
import Portoflio from "./ui/Porotflio/Portoflio";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

export default function Home() {

  return (
    <main id="content" className={`bg-light relative`}>
      <div className="hero__container bg-light">
        <HeroSection></HeroSection>
      </div>
      <div className="bg-light mx-4 my-20 min-h-[90svh] md:min-h-[600px] lg:mx-6">
        <Portoflio></Portoflio>
      </div>
      <div className="hero__container bg-light">
        <HeroSection></HeroSection>
      </div>
    </main>
  );
}
