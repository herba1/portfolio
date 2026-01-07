"use client";

import { dataset } from "@/sanity/env";
import { Album, PauseIcon, PlayIcon } from "lucide-react";
import { Geist, Play } from "next/font/google";
import { act, useMemo, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  MotionConfig,
  stagger,
} from "framer-motion";
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
  const [activeTrack, setActiveTrack] = useState(null);

  // const audioContext = useMemo(() => new AudioContext(), []);

  return (
    <div className={`${geist.className}`}>
      <motion.div
        layout
        animate={{ height: bounds.height }}
        transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
        className="card__wrapper overflow-clip rounded-xl border-1 border-black/5 bg-white shadow-sm inset-shadow-sm"
      >
        <motion.div
          ref={ref}
          className="card__container relative flex w-sm flex-col gap-3 p-3"
        >
          <header
            onClick={() => {
              setIsActive(!isActive);
            }}
            className="card__header relative z-10 flex h-18 w-full gap-3"
          >
            <div className="card__img relative aspect-square h-full w-fit overflow-clip rounded-sm shadow-xs">
              <img
                src={"/chiquito.jpg"}
                className="z-0 h-full w-full object-contain"
                alt="Cuco"
              ></img>
              <div className="soundwaves absolute inset-0 z-10 h-full w-full">
                <AnimatePresence initial={false} mode="popLayout">
                  {isPlaying && (
                    <motion.div
                      key={"playFeedback"}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="flex h-full w-full items-center justify-center gap-1"
                    >
                      <MotionConfig>
                        <motion.div
                          animate={{ height: ["16px", "28px", "16px"] }}
                          transition={{
                            ease: "circInOut",
                            duration: 1.5,
                            repeat: Infinity,
                            delay: 0,
                          }}
                          className="h-6 w-2 rounded-full bg-white/70 shadow-2xs backdrop-blur-xs"
                        ></motion.div>
                        <motion.div
                          transition={{
                            ease: "circInOut",
                            duration: 1.5,
                            repeat: Infinity,
                            delay: -0.2,
                          }}
                          animate={{ height: ["16px", "32px", "16px"] }}
                          className="h-6 w-2 rounded-full bg-white/70 shadow-2xs backdrop-blur-xs"
                        ></motion.div>
                        <motion.div
                          transition={{
                            ease: "circInOut",
                            duration: 1.5,
                            repeat: Infinity,
                            delay: -0.4,
                          }}
                          animate={{ height: ["16px", "28px", "16px"] }}
                          className="h-6 w-2 rounded-full bg-white/70 shadow-2xs backdrop-blur-xs"
                        ></motion.div>
                      </MotionConfig>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
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
                <AnimatePresence mode="popLayout">
                  {(!isActive || (isActive && !activeTrack)) && (
                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!activeTrack) {
                          setIsPlaying(true);
                          setActiveTrack(ALBUM.trackList[0]);
                        }
                        setIsPlaying(!isPlaying);
                      }}
                      key={"ppBtn"}
                      className="card__play__pause grid aspect-square w-11 place-items-center rounded-md will-change-transform"
                      layout
                      layoutId="playPauseButton"
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.96 }}
                      transition={{ type: "spring", duration: 0.4, bounce: 0 }}
                    >
                      <MotionConfig
                        transition={{
                          duration: 0.3,
                          type: "spring",
                          bounce: 0,
                        }}
                      >
                        <AnimatePresence mode="popLayout">
                          {isPlaying ? (
                            <motion.div
                              key={isPlaying}
                              initial={{
                                opacity: 0,
                                filter: "blur(2px)",
                                scale: 0.8,
                              }}
                              animate={{
                                opacity: 1,
                                filter: "blur(0px)",
                                scale: 1,
                              }}
                              exit={{
                                opacity: 0,
                                filter: "blur(2px)",
                                scale: 0.8,
                              }}
                            >
                              <PauseIcon fill="black"></PauseIcon>
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
                              exit={{
                                opacity: 0,
                                filter: "blur(4px)",
                                scale: 0.8,
                              }}
                            >
                              <PlayIcon fill="black"></PlayIcon>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </MotionConfig>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>
          <AnimatePresence mode="popLayout">
            {isActive && (
              <motion.div
                key={"card__content "}
                className="card__content relative z-0"
              >
                <ul>
                  {ALBUM.trackList.map((track, index) => {
                    return (
                      <motion.li
                        initial={
                          track != activeTrack && {
                            opacity: 0,
                            scale: 0.9,
                            y: "-10%",
                          }
                        }
                        animate={
                          track != activeTrack && {
                            opacity: 1,
                            scale: 1,
                            y: "0%",

                            transition: {
                              delay: index * 0.03,
                              type: "spring",
                              bounce: 0,
                              duration: 0.3,
                            },
                          }
                        }
                        exit={
                          track != activeTrack && {
                            opacity: 0,
                            scale: 0.9,
                            y: "-10%",
                            transition: {
                              delay: (ALBUM.trackList.length - index) * 0.01,
                              type: "spring",
                              bounce: 0,
                              duration: 0.15,
                            },
                          }
                        }
                        layout
                        key={track.name}
                        className="rounded-lg p-2 hover:bg-black/5"
                        onClick={() => {
                          if (isPlaying && track === activeTrack) {
                            setIsPlaying(false);
                            return;
                          }
                          setActiveTrack(track);
                          setIsPlaying(true);
                        }}
                      >
                        <div className="flex w-full justify-between">
                          <span className="flex flex-col">
                            <p className="font-medium">{track.name}</p>
                            <p className="text-sm text-neutral-500">
                              {track.artist}
                              {track.featuredArtist.map(
                                (artist) => ", " + artist,
                              )}
                            </p>
                          </span>
                          <div className="flex items-center gap-0">
                            <motion.p
                              layout
                              className="text-sm text-neutral-500"
                            >
                              {track.trackLength}
                            </motion.p>
                            <AnimatePresence mode="popLayout">
                              {track === activeTrack && (
                                <motion.button
                                  // onClick={(e) => {
                                  //   e.stopPropagation();
                                  //   setIsPlaying(!isPlaying);
                                  // }}
                                  className="card__play__pause grid aspect-square w-11 place-items-center rounded-md will-change-transform"
                                  key={`${track.name}-ppBtn`}
                                  layout
                                  layoutId="playPauseButton"
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{
                                    type: "spring",
                                    duration: 0.4,
                                    bounce: 0,
                                  }}
                                >
                                  <MotionConfig
                                    transition={{
                                      duration: 0.3,
                                      type: "spring",
                                      bounce: 0,
                                    }}
                                  >
                                    <AnimatePresence mode="popLayout">
                                      {isPlaying ? (
                                        <motion.div
                                          key={isPlaying}
                                          initial={{
                                            opacity: 0,
                                            filter: "blur(2px)",
                                            scale: 0.8,
                                          }}
                                          animate={{
                                            opacity: 1,
                                            filter: "blur(0px)",
                                            scale: 1,
                                          }}
                                          exit={{
                                            opacity: 0,
                                            filter: "blur(2px)",
                                            scale: 0.8,
                                          }}
                                        >
                                          <PauseIcon fill="black"></PauseIcon>
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
                                          exit={{
                                            opacity: 0,
                                            filter: "blur(4px)",
                                            scale: 0.8,
                                          }}
                                        >
                                          <PlayIcon fill="black"></PlayIcon>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </MotionConfig>
                                </motion.button>
                              )}
                            </AnimatePresence>
                          </div>
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
  exit: { opacity: 0, scale: 0.8, y: "-10%" },
};
