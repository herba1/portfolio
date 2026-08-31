import TasteProbe from "./TasteProbe";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function LabLayout({ children }) {
  return (
    <>
      {children}
      <TasteProbe />
    </>
  );
}
