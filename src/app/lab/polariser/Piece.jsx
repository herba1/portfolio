"use client";

import { makePiece } from "../_kit/makePiece";
import "./polariser.css";

export default makePiece("polariser", () => import("./polariserEngine").then((m) => m.createPolariser));
