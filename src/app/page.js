import { Inter } from "next/font/google";
import TempPage from "./ui/Hero/TempPage";
// import HeroSection from "./ui/Hero/HeroSection";
// import Portoflio from "./ui/Porotflio/Portoflio";
// import Image from "next/image";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  return (
    <main
      id="content"
      className={`h-dvh max-h-none bg-slate-100 ${inter.className} relative`}
    >
      <TempPage></TempPage>

      {/* <div className="hero__container bg-light">
        <HeroSection></HeroSection>
      </div>
      <div className="bg-light mx-4 min-h-lvh py-20 lg:mx-6">
        <Portoflio></Portoflio>
      </div>
      <div className="flex h-[50svh] w-full flex-col items-center justify-end pb-5">
        <p className="font-semibold">Working on something great...</p>
      </div> */}
    </main>
  );
}
