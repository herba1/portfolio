"use client";

import { dataset } from "@/sanity/env";
import { Album, PauseIcon, PlayIcon } from "lucide-react";
import { Geist } from "next/font/google";
import { useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { track } from "@vercel/analytics/react";
import useMeasure from "react-use-measure";

const geist = Geist({
  weight: "variable",
  subsets: ["latin"],
});

const ALBUM = {
  name: "Chiquito",
  artist: "Cuco",
  projectType: "EP",
  genre: "Indie",
  trackList: [
    {
      name: "Lucy",
      featuredArtist: ["Kwe$t"],
      artist: "Cuco",
      plays: 7761064,
      trackLength: "4:47",
    },
    {
      name: "Dontmakemefallinlove",
      featuredArtist: [],
      artist: "Cuco",
      plays: 153580863,
      trackLength: "3:27",
    },
    {
      name: "Sunnyside",
      featuredArtist: [],
      artist: "Cuco",
      plays: 12800346,
      trackLength: "4:13",
    },
    {
      name: "Summer Time High Time",
      featuredArtist: ["Kwe$t"],
      artist: "Cuco",
      plays: 99186087,
      trackLength: "3:28",
    },
    {
      name: "Mi Infinita",
      featuredArtist: [],
      artist: "Cuco",
      plays: 16903402,
      trackLength: "4:32",
    },
    {
      name: "CR-V",
      featuredArtist: [],
      artist: "Cuco",
      plays: 26163937,
      trackLength: "2:27",
    },
  ],
};

export default function AlbumCard() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [ref, bounds] = useMeasure();
  return (
    <div className={`${geist.className}`}>
      <motion.div
        layout
        animate={{ height: bounds.height }}
        transition={{type:'spring', duration:0.5, bounce:0}}
        className="rounded-xl card__wrapper border-1 border-black/10 shadow-sm inset-shadow-sm"
      >
        <motion.div
          ref={ref}
          className="card__container flex h-24 min-h-fit w-sm flex-col gap-3 p-3"
        >
          <header
            onClick={() => {
              setIsActive(!isActive);
            }}
            className="card__header flex h-full w-full gap-3"
          >
            <div className="card__img aspect-square h-full w-fit overflow-clip rounded-sm shadow-xs">
              <img
                src={"/chiquito.jpg"}
                className="h-full w-full object-contain"
                alt="Cuco"
              ></img>
            </div>
            <div className="card__info flex h-full w-full justify-between">
              <div className="card__info__left flex flex-col justify-center leading-none">
                <span className="flex items-center gap-1">
                  <p className="text-xs text-neutral-500">
                    {ALBUM.projectType}
                  </p>
                  <span className="inline-block aspect-square w-1 overflow-clip rounded-full bg-neutral-400"></span>
                  <p className="text-xs text-neutral-500">{ALBUM.genre}</p>
                </span>
                <h1 className="text-lg font-bold">{ALBUM.name}</h1>
                <p className="text-md text-neutral-500">{ALBUM.artist}</p>
              </div>
              <div className="card__info__right flex flex-col items-end justify-center leading-none">
                <motion.button
                  onClick={() => {
                    setIsPlaying(!isPlaying);
                  }}
                  className="grid aspect-square w-11 place-items-center rounded-md will-change-transform"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", duration: 0.35 }}
                >
                  <MotionConfig
                    transition={{ duration: 0.3, type: "spring", bounce: 0 }}
                  >
                    <AnimatePresence mode="popLayout">
                      {isPlaying ? (
                        <motion.div
                          key={isPlaying}
                          initial={{
                            opacity: 0,
                            filter: "blur(4px)",
                            scale: 0.8,
                          }}
                          animate={{
                            opacity: 1,
                            filter: "blur(0px)",
                            scale: 1,
                          }}
                          exit={{ opacity: 0, filter: "blur(4px)", scale: 0.8 }}
                        >
                          <PlayIcon fill="black"></PlayIcon>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={isPlaying}
                          initial={{
                            opacity: 0,
                            filter: "blur(4px)",
                            scale: 0.8,
                          }}
                          animate={{
                            opacity: 1,
                            filter: "blur(0px)",
                            scale: 1,
                          }}
                          exit={{ opacity: 0, filter: "blur(4px)", scale: 0.8 }}
                        >
                          <PauseIcon fill="black"></PauseIcon>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </MotionConfig>
                </motion.button>
              </div>
            </div>
          </header>
          <AnimatePresence mode="popLayout">
            {isActive && (
              <motion.div key={"card__content"} className="card__content">
                <ul>
                  {ALBUM.trackList.map((track, index) => {
                    return (
                      <motion.li
                        variants={trackVariants}
                        initial="enter"
                        animate="idle"
                        exit="exit"
                        key={index}
                        className="flex justify-between py-1"
                        transition={{
                          type: "spring",
                          bounce: 0,
                          duration: 0.2,
                          delay: index * 0.025,
                        }}
                      >
                        <div>
                          <p className="">{track.name}</p>
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}

const trackVariants = {
  enter: { opacity: 0, scale: 0.8, y: "-10%" },
  idle: { opacity: 1, scale: 1, y: "0%" },
  exit: { opacity: 0, scale: 0.8, y: "-10%", transition: {delay:0} },
};
