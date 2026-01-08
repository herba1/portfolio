import { Inter } from "next/font/google";
import HeroSection from "./ui/Hero/HeroSection";
import Portoflio from "./ui/Porotflio/Portoflio";
import Image from "next/image";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <main id="content" className={`bg-light ${inter.className} relative`}>
      <div className="hero__container bg-light">
        <HeroSection></HeroSection>
      </div>
      <div className="bg-light mx-4 min-h-lvh py-20 lg:mx-6">
        <Portoflio></Portoflio>
      </div>
      <div className="h-[50svh] flex flex-col items-center pb-5 justify-end w-full">
        <p className="font-semibold">Working on something great...</p>
      </div>
    </main>
  );
}
