"use client";

import { makePiece } from "../_kit/makePiece";
import "./mizukagami.css";

export default makePiece("mizukagami", () => import("./mizukagamiEngine").then((m) => m.createMizukagami));
