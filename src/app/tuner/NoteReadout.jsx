"use client";

import { memo } from "react";
import { motion } from "motion/react";

function NoteReadout({ letterMV, accidentalMV, octaveMV }) {
  return (
    <div className="tuner__note">
      <motion.span className="tuner__letter">{letterMV}</motion.span>
      <span className="tuner__note-sup">
        <motion.span className="tuner__sharp">{accidentalMV}</motion.span>
        <motion.span className="tuner__oct">{octaveMV}</motion.span>
      </span>
    </div>
  );
}

export default memo(NoteReadout);
