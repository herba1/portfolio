"use client";

import { makePiece } from "../_kit/makePiece";
import "./zigzag.css";

export default makePiece("zigzag", () => import("./zigzagEngine").then((m) => m.createZigzag));
