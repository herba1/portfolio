"use client";

import { makePiece } from "../_kit/makePiece";
import "./glint.css";

export default makePiece("glint", () => import("./glintEngine").then((m) => m.createGlint));
