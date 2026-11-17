"use client";

import { makePiece } from "../_kit/makePiece";
import "./curve-mirror.css";

export default makePiece("curve-mirror", () => import("./curveMirrorEngine").then((m) => m.createCurveMirror));
