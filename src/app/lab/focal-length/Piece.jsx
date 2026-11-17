"use client";

import { makePiece } from "../_kit/makePiece";
import "./focal-length.css";

export default makePiece("focal-length", () => import("./focalLengthEngine").then((m) => m.createFocalLength));
