"use client";
import { LenisProvider } from "@/context/LenisContext";


export default function Home() {


  return (
    <div id="content">
      <article className="main-content bg-white    flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          who is this crazed man
        </h1>
      </article>
      {/* <article className="main-content bg-pink-50    flex justify-center items-center h-svh  ">
        <h1 className="text-center text-4xl font-serif">
          its not me is it?
        </h1>
      </article> */}
      {/* main footer container should have any height wanted */}
      <footer className="h-svh flex flex-col justify-end relative -z-10 bg-black">
        {/* spacing should be calculation of footer? + some height in our case full height */}
        <div className="h-[200vh] relative shrink-0 ">
          {/* actual container conent goes in side this div */}
          <div className="h-svh w-full fixed bg-blue-600 flex justify-center items-center">
            <h1 className="font-serif text-2xl text-white">
              lord have mercy. 
            </h1>
          </div>
        </div>
      </footer>
    </div>
  );
}
