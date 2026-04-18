import BookExperience from "./BookExperience";
import "./book.css";

export const metadata = {
  title: "Book",
  description: "A small interactive book. Click a page to turn it.",
};

export default function BookPage() {
  return (
    <main className="book-root">
      <BookExperience />
      <div className="book-hint">
        <span>press and drag · or use ← →</span>
      </div>
    </main>
  );
}
