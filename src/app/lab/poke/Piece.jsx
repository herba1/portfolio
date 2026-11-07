"use client";

import { makePiece } from "../_kit/makePiece";
import "./poke.css";

export default makePiece("poke", () => import("./pokeEngine").then((m) => m.createPoke));
