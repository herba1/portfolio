// // src/app/layout.jsx
// "use client";
// import { gsap } from "gsap";
// import { Observer } from "gsap/Observer";
// import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
// import { ScrollTrigger } from "gsap/ScrollTrigger";
// import { ScrollSmoother } from "gsap/ScrollSmoother";
// import { SplitText } from "gsap/SplitText";
import { LenisProvider } from "@/context/LenisContext";

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
      <body className=" antialiased text-base tracking-tight font-medium">
        <LenisProvider>
          {children}
        </LenisProvider>
      </body>
    </html>
  );
}