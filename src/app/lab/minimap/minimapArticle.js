export const ARTICLE = {
  kicker: "Session notes · EMI Studios, Abbey Road",
  title: "Ten hours in Studio Two",
  dek: "How The Beatles recorded ten songs of _Please Please Me_ in a single day, and saved the loudest one for last.",
  meta: "11 February 1963 · 8 min read",
  sections: [
    {
      title: "Ten in the morning",
      paragraphs: [
        "The booking sheet for Monday, 11 February 1963 lists three sessions in Studio Two at EMI’s studios on Abbey Road: ten until one, half past two until half past five, half past seven until a quarter to eleven. Parlophone had a hit single on its hands and wanted an album behind it while the record was still climbing.",
        "George Martin’s plan was simple and slightly reckless. Rather than build a record in the studio, he would capture the band’s stage set as close to live as the equipment allowed. Four of the fourteen songs already existed as single sides. The other ten had to be finished by the end of the night.",
        "John Lennon arrived with a heavy cold.",
        "Norman Smith sat at the desk with a twin-track machine. Vocals went to one track and the band to the other, which left almost nothing to fix later. If a take was wrong, it was played again from the top.",
      ],
    },
    {
      title: "Seventeen",
      paragraphs: [
        "The morning opened with _There’s a Place_, a song Lennon would later describe as his try at a Motown record. Most of the early takes broke down inside the first verse before the harmony settled.",
        "Then came a number the band still called _Seventeen_ on the setlist. By the time it reached the sleeve it had become _I Saw Her Standing There_, and the count-in shouted over the top of the intro stayed on the record because nobody could think of a better way to start an album.",
        "Handclaps were overdubbed afterwards.",
        "Martin, listening back, asked them to keep the room rather than dampen it. Studio Two has a high ceiling and a hard floor, and the bass drum carries.",
      ],
    },
    {
      title: "The lunch they skipped",
      paragraphs: [
        "At one o’clock the engineers went to the canteen. The band stayed behind, ran through the afternoon songs again, and drank milk. Paul McCartney remembered it as the only rehearsal they had that day.",
        "Lennon worked through a packet of Zubes throat sweets. Every pass through a song cost him a little more of his voice, and everyone in the room knew it.",
        "Nobody suggested stopping.",
      ],
    },
    {
      title: "Half past two",
      paragraphs: [
        "The afternoon belonged to the covers the band had played for years in Hamburg and Liverpool: _Anna_, _Boys_, _Chains_. They needed few takes because the arrangements had been settled hundreds of nights before.",
        "_Boys_ went down in one. Ringo Starr sang it the way he sang it at the Cavern, drumming and shouting at the same time, and the first take was the master.",
        "_Misery_ was slower going. Written for Helen Shapiro, whose producer turned it down, it was still missing the piano part Martin would add himself nine days later.",
        "_Hold Me Tight_ was attempted again and again and finally abandoned. It came back months later on the next album.",
        "By half past five they had seven songs.",
      ],
    },
    {
      title: "Evening",
      paragraphs: [
        "The last session started at half past seven, and the list was still long. _Baby It’s You_ came quickly. _Do You Want to Know a Secret_ went to George Harrison, who had never sung a lead on record and asked for it to be kept simple.",
        "_A Taste of Honey_ was McCartney’s, a show tune he loved and the rest of the band tolerated. Martin had him sing it twice over itself, the one real piece of studio trickery on the record.",
        "By ten o’clock the schedule said they were finished. The engineers began to pack away the microphones.",
        "Martin wanted one more.",
      ],
    },
    {
      title: "Twist and Shout",
      paragraphs: [
        "Everyone in the room agreed on what it should be. _Twist and Shout_ closed their live shows, it was the song that wrecked a voice, and Lennon’s was nearly gone. If it went on the record it had to be done once, and done last.",
        "He took off his shirt, gargled milk, and stood at the microphone. The band counted it in.",
        "Two and a half minutes later the take was complete. A second attempt was made and Lennon’s voice did not survive it. The first was the one that went on the record.",
        "People who were in the control room describe a long silence after the last chord, then the engineers clapping. Lennon said his throat felt like sandpaper for a week.",
      ],
    },
    {
      title: "Five hundred and eighty-five minutes",
      paragraphs: [
        "The day ran to nine hours and forty-five minutes of studio time. The total cost to EMI was about four hundred pounds.",
        "Over the following fortnight Martin dropped the piano onto _Misery_ and settled the running order. The sleeve was shot looking down the stairwell at EMI House in Manchester Square, and the record went to the shops on 22 March 1963.",
        "It reached the top of the album chart in May and stayed there for thirty weeks, until it was replaced by the band’s own second album.",
        "Listen to it today and you can hear the day in it. The voices are fresh at the start of side one and raw by the end of side two, in the order the songs were played.",
        "Nobody made a record that way again. Within a year a single song could take them a week.",
      ],
    },
  ],
};

function toRuns(text) {
  return text.split("_").map((value, index) => ({ value, em: index % 2 === 1 }));
}

function buildBlocks() {
  const blocks = [];
  let paragraphNumber = 0;
  ARTICLE.sections.forEach((section, sectionIndex) => {
    blocks.push({ kind: "heading", text: section.title, runs: toRuns(section.title), section: sectionIndex, sectionTitle: section.title, length: 0 });
    section.paragraphs.forEach((text) => {
      paragraphNumber += 1;
      blocks.push({ kind: "paragraph", runs: toRuns(text), section: sectionIndex, sectionTitle: section.title, number: paragraphNumber, length: text.length });
    });
  });
  const longest = Math.max(...blocks.map((b) => b.length));
  return blocks.map((block) => ({
    ...block,
    width: block.kind === "heading" ? 1 : 0.22 + 0.62 * Math.sqrt(block.length / longest),
  }));
}

export const BLOCKS = buildBlocks();
export const DEK_RUNS = toRuns(ARTICLE.dek);
