import { ViewTransition } from "react";
import { LenisProvider } from "@/context/LenisContext";
import PostHogProvider from "@/context/PostHogProvider";
import Navbar from "./ui/Navigation/Navbar";

import StickyFooter from "./ui/StickyFooter";
import { geist } from "./fonts";
import Loading from "./ui/Loading";
import { description, title } from "./constants";
import ConsoleSig from "./ui/ConsoleSig";
import FooterClock from "./ui/FooterClock";

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
  authors: [{ name: "Herb" }],
  creator: "Herb",
  openGraph: {
    title: title,
    description: description,
    url: "https://herb.art",
    siteName: "herb.art",
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
      <head>
        <link rel="prefetch" href="/splats/herb-scan-clean.splat" as="fetch" />
      </head>
      <body className="relative overflow-x-hidden overscroll-none bg-slate-100 tracking-tight antialiased">
        <ConsoleSig />
        <PostHogProvider>
          <LenisProvider>
            <Navbar
              className="text-dark z-50 font-medium"
              phoneVisible={false}
              ctaVisible={false}
            />
            <ViewTransition name="page-content">
              {children}
            </ViewTransition>
            {/* <Loading>
              <div className="relative z-0">
                <Navbar
                  className="text-dark sm:text-light z-50 font-medium sm:font-normal sm:mix-blend-difference"
                  phoneVisible={false}
                  ctaVisible={false}
                ></Navbar>
                {children}
              </div>
            </Loading> */}
          </LenisProvider>
        </PostHogProvider>
        <FooterClock />
      </body>
    </html>
  );
}
