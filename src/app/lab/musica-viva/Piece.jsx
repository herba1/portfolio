"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("musica-viva", () => import("./musicaEngine").then((m) => m.createMusicaViva));
