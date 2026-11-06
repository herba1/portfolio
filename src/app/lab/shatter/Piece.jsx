"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("shatter", () => import("./shatterEngine").then((m) => m.createShatter));
