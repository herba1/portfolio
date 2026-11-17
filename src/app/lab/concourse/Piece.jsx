"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("concourse", () => import("./concourseEngine").then((m) => m.createConcourse));
