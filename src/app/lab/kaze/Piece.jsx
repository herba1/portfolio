"use client";

import { makePiece } from "../_kit/makePiece";
import "./kaze.css";

export default makePiece("kaze", () => import("./kazeEngine").then((m) => m.createKaze));
