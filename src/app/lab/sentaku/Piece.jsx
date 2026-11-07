"use client";

import { makePiece } from "../_kit/makePiece";
import "./sentaku.css";

export default makePiece("sentaku", () => import("./sentakuEngine").then((m) => m.createSentaku));
