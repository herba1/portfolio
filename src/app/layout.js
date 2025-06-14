// // src/app/layout.jsx
// "use client";
// import { gsap } from "gsap";
// import { Observer } from "gsap/Observer";
// import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
// import { ScrollTrigger } from "gsap/ScrollTrigger";
// import { ScrollSmoother } from "gsap/ScrollSmoother";
// import { SplitText } from "gsap/SplitText";
import { LenisProvider } from "@/context/LenisContext";
import Navbar from "./ui/Navigation/Navbar";

// // Register all GSAP plugins centrally
// gsap.registerPlugin(
//   Observer,
//   ScrambleTextPlugin,
//   ScrollTrigger, 
//   ScrollSmoother,
//   SplitText
// );

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className=" antialiased tracking-tight">
        <LenisProvider>
      <Navbar className="mix-blend-difference" navTriggerElement={null} phoneVisible={false} ctaVisible={false}></Navbar>
          {children}
        </LenisProvider>
      </body>
    </html>
  );
}