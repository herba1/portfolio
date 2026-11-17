"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("accordion", () => import("./accordionEngine").then((m) => m.createAccordion));
