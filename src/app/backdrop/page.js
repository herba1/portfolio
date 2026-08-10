import BackdropExperience from "./BackdropExperience";

export const metadata = {
  title: "Backdrop",
  description:
    "A rebuild of Apple Music's dynamic now-playing backdrop — four rotating copies of the artwork, twisted, blurred and pushed through a saturation lift.",
};

export default function BackdropPage() {
  return <BackdropExperience />;
}
