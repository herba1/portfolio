"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("letraset", () => import("./letrasetEngine").then((m) => m.createLetraset));
