import { albumById } from "@/app/lab/_music/catalog";

const abbey = albumById("abbey-road");

export const ALBUM = {
  title: abbey.title,
  artist: abbey.artist,
  meta: "Rock · 1969",
  cover: abbey.cover,
  playing: 6,
  tracks: [
    ["Come Together", "4:20"],
    ["Something", "3:03"],
    ["Maxwell's Silver Hammer", "3:27"],
    ["Oh! Darling", "3:26"],
    ["Octopus's Garden", "2:51"],
    ["I Want You (She's So Heavy)", "7:47"],
    ["Here Comes the Sun", "3:05"],
    ["Because", "2:45"],
    ["You Never Give Me Your Money", "4:02"],
    ["Sun King", "2:26"],
    ["Mean Mr. Mustard", "1:06"],
    ["Polythene Pam", "1:12"],
  ],
};

export const TRACK = {
  title: "Here Comes the Sun",
  by: "The Beatles · Abbey Road",
  length: "3:05",
  credits: [
    ["Written by", "George Harrison"],
    ["Produced by", "George Martin"],
    ["Engineered by", "Geoff Emerick, Phil McDonald"],
    ["Recorded", "EMI Studios, London, 7 July to 19 August 1969"],
  ],
  performers: [
    ["George Harrison", "Lead vocals, acoustic guitar, harmonium, Moog synthesiser"],
    ["Paul McCartney", "Bass, backing vocals"],
    ["Ringo Starr", "Drums"],
    ["George Martin", "Orchestral arrangement, with Harrison"],
    ["Orchestra", "Four violas, four cellos, double bass, two piccolos, two flutes, two alto flutes, two clarinets"],
  ],
  about: [
    "Harrison wrote it in April 1969 in Eric Clapton's garden in Surrey, on a morning he had skipped another Apple business meeting, with a borrowed acoustic guitar and the first warm day of the year.",
    "Lennon was recovering from a car crash in Scotland and does not play on it. The other three laid down the backing track, and Harrison spent the summer adding to it: harmonium, handclaps, a small orchestra, and last of all the Moog, which carries the bridge's uneven bars up into the final chorus.",
  ],
  details: [
    ["Key", "A major"],
    ["Length", "3:05"],
    ["Released", "26 September 1969"],
    ["Position", "Side two, track one"],
  ],
  side: [
    ["Here Comes the Sun", "3:05"],
    ["Because", "2:45"],
    ["You Never Give Me Your Money", "4:02"],
    ["Sun King", "2:26"],
    ["Mean Mr. Mustard", "1:06"],
    ["Polythene Pam", "1:12"],
    ["She Came In Through the Bathroom Window", "1:57"],
    ["Golden Slumbers", "1:31"],
    ["Carry That Weight", "1:36"],
    ["The End", "2:05"],
    ["Her Majesty", "0:23"],
  ],
};
