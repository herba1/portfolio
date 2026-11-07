"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("octilinear", () => import("./octilinearEngine").then((m) => m.createOctilinear));
