"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("film-test", () => import("./filmTestEngine").then((m) => m.createFilmTest));
