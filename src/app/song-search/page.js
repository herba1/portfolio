import SongSearch from "./SongSearch";

export const metadata = {
  title: "Song search",
  description:
    "A search dock that resolves songs, covers and previews from Apple's catalogue — shown on both a light and a dark ground.",
};

export default function SongSearchPage() {
  return <SongSearch />;
}
