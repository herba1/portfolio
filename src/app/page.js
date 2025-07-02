import { Inter } from "next/font/google";
import HeroSection from "./ui/Hero/HeroSection";
import Portoflio from "./ui/Porotflio/Portoflio";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

export default function Home() {

  return (
    <main id="content" className={`relative`}>
      <div className="hero__container">
        <HeroSection></HeroSection>
      </div>
      <div className="bg-light mx-4 my-10 lg:mx-6 min-h-[90svh] md:min-h-[600px]">
        <Portoflio></Portoflio>
      </div>
      <div className="hero__container">
        <HeroSection></HeroSection>
      </div>
    </main>
  );
}
