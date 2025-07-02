import { LenisProvider } from "@/context/LenisContext";
import Navbar from "./ui/Navigation/Navbar";
import StickyFooter from "./ui/StickyFooter";
import { inter } from "./fonts";
import Loading from "./ui/Loading";
import { description, title } from "./constants";

export const metadata = {
  title: title,
  description: description,
  keywords: ['portfolio', 'web developer', 'frontend', 'fullstack', 'javascript', 'react', 'nextjs'],
  authors: [{ name: 'herbart.dev' }],
  creator: 'herbart.dev',
  openGraph: {
    title: title,
    description: description,
    url: 'https://herbart.dev',
    siteName: 'herbart.dev',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: title,
    description: description,
  },
  robots: {
    index: true,
    follow: true,
  },
  viewport: 'width=device-width, initial-scale=1',
}

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
