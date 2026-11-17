"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("chrome-lines", () => import("./chromeLinesEngine").then((m) => m.createChromeLines));
