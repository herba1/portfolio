"use client";

import { makePiece } from "../_kit/makePiece";
import "./nyudogumo.css";

export default makePiece("nyudogumo", () => import("./nyudogumoEngine").then((m) => m.createNyudogumo));
