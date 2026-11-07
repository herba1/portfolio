"use client";

import { makePiece } from "../_kit/makePiece";
import "./motion-brush.css";

export default makePiece("motion-brush", () => import("./brushEngine").then((m) => m.createMotionBrush));
