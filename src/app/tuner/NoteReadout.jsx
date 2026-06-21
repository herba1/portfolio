"use client";

// The hero of the poster: the detected note set in big Helvetica — a giant
// letter with the accidental and octave riding off it. No segmented LCD, no
// skeuomorphism; pure type on the grid. Shows an em-dash placeholder when idle.

export default function NoteReadout({ note }) {
  const letter = note ? note.name[0] : "–";
  const isSharp = note ? note.isSharp : false;
  const octave = note ? String(note.octave) : "";

  return (
    <div className="tuner__note">
      <span className="tuner__letter">{letter}</span>
      <span className="tuner__note-sup">
        {isSharp && <span className="tuner__sharp">&#9839;</span>}
        {octave && <span className="tuner__oct">{octave}</span>}
      </span>
    </div>
  );
}
