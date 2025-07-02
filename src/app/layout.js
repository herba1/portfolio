import { LenisProvider } from "@/context/LenisContext";
import Navbar from "./ui/Navigation/Navbar";
import StickyFooter from "./ui/StickyFooter";
import { inter } from "./fonts";
import Loading from "./ui/Loading";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className=" antialiased tracking-tight">
        <LenisProvider>
          <div className="relative overflow-hidden">
            <Navbar
              className="z-20 text-dark font-medium sm:mix-blend-difference sm:font-normal sm:text-light"
              phoneVisible={false}
              ctaVisible={false}
            ></Navbar>
            <Loading>
              {children}
            </Loading>
            {/* <StickyFooter /> */}
          </div>
        </LenisProvider>
      </body>
    </html>
  );
}
