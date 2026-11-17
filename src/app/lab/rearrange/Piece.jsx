"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("rearrange", () => import("./rearrangeEngine").then((m) => m.createRearrange));
