import { LenisProvider } from "@/context/LenisContext";
import Navbar from "./ui/Navigation/Navbar";
import StickyFooter from "./ui/StickyFooter";
import { inter } from "./fonts";
import Loading from "./ui/Loading";
import { description, title } from "./constants";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata = {
  title: title,
  description: description,
  keywords: [
    "portfolio",
    "web developer",
    "frontend",
    "fullstack",
    "javascript",
    "react",
    "nextjs",
  ],
  authors: [{ name: "herbart.dev" }],
  creator: "herbart.dev",
  openGraph: {
    title: title,
    description: description,
    url: "https://herbart.dev",
    siteName: "herbart.dev",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: title,
    description: description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/*  */}
      <body className="overscroll-none overflow-y-hidden  relative tracking-tight overflow-x-hidden antialiased ">
        <LenisProvider>
          <Loading>
            <div className="relative z-0 ">
              <Navbar
                className="text-dark sm:text-light z-50 font-medium sm:font-normal sm:mix-blend-difference"
                phoneVisible={false}
                ctaVisible={false}
              ></Navbar>
              {children}
            </div>
          </Loading>
        </LenisProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
