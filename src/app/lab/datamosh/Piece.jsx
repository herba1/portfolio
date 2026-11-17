"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("datamosh", () => import("./datamoshEngine").then((m) => m.createDatamosh));
