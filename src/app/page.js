"use client";
import { LenisProvider } from "@/context/LenisContext";
import { useEffect } from "react";
import StickyFooter from "./ui/StickyFooter";


export default function Home() {
  return (
    <div id="content">
      <article className="main-content bg-white flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          who is this crazed man
        </h1>
      </article>
      <StickyFooter></StickyFooter>
    </div>
  );
}
