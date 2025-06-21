import { LenisProvider } from "@/context/LenisContext";
import Navbar from "./ui/Navigation/Navbar";
import StickyFooter from "./ui/StickyFooter";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className=" antialiased tracking-tight">
        <LenisProvider>
          <div className="relative">
            <Navbar
              className="z-20"
              phoneVisible={false}
              ctaVisible={false}
            ></Navbar>
            <div className="z-10 relative">{children}</div>
            <StickyFooter />
          </div>
        </LenisProvider>
      </body>
    </html>
  );
}
