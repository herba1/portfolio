const cover = (id) => `/tierlist/images/image-${id}.webp`;

export const ALBUMS = [
  { id: "please-please-me", title: "Please Please Me", artist: "The Beatles", year: 1963, cover: cover("mqobp3e9"), size: 300, tracks: ["I Saw Her Standing There", "Misery", "Anna (Go to Him)", "Please Please Me", "Love Me Do", "Twist and Shout"] },
  { id: "with-the-beatles", title: "With the Beatles", artist: "The Beatles", year: 1963, cover: cover("mqobph1p"), size: 225, tracks: ["It Won't Be Long", "All I've Got to Do", "All My Loving", "Roll Over Beethoven", "Money (That's What I Want)"] },
  { id: "a-hard-days-night", title: "A Hard Day's Night", artist: "The Beatles", year: 1964, cover: cover("mqobq3h6"), size: 480, tracks: ["A Hard Day's Night", "I Should Have Known Better", "If I Fell", "And I Love Her", "Can't Buy Me Love", "Things We Said Today"] },
  { id: "beatles-for-sale", title: "Beatles for Sale", artist: "The Beatles", year: 1964, cover: cover("mqobq8nt"), size: 480, tracks: ["No Reply", "I'm a Loser", "Baby's in Black", "Eight Days a Week", "I'll Follow the Sun"] },
  { id: "help", title: "Help!", artist: "The Beatles", year: 1965, cover: cover("mqobqcj7"), size: 480, tracks: ["Help!", "The Night Before", "You've Got to Hide Your Love Away", "Ticket to Ride", "Yesterday"] },
  { id: "rubber-soul", title: "Rubber Soul", artist: "The Beatles", year: 1965, cover: cover("mqobqjlb"), size: 480, tracks: ["Drive My Car", "Norwegian Wood", "Nowhere Man", "Michelle", "Girl", "In My Life"] },
  { id: "revolver", title: "Revolver", artist: "The Beatles", year: 1966, cover: cover("mqobqo2d"), size: 480, tracks: ["Taxman", "Eleanor Rigby", "I'm Only Sleeping", "Here, There and Everywhere", "Yellow Submarine", "Got to Get You into My Life", "Tomorrow Never Knows"] },
  { id: "sgt-pepper", title: "Sgt. Pepper's Lonely Hearts Club Band", artist: "The Beatles", year: 1967, cover: cover("mqobqsi0"), size: 480, tracks: ["Sgt. Pepper's Lonely Hearts Club Band", "With a Little Help from My Friends", "Lucy in the Sky with Diamonds", "Getting Better", "She's Leaving Home", "A Day in the Life"] },
  { id: "magical-mystery-tour", title: "Magical Mystery Tour", artist: "The Beatles", year: 1967, cover: cover("mqobqy63"), size: 480, tracks: ["Magical Mystery Tour", "The Fool on the Hill", "I Am the Walrus", "Hello, Goodbye", "Strawberry Fields Forever", "Penny Lane"] },
  { id: "white-album", title: "The Beatles", artist: "The Beatles", year: 1968, cover: cover("mqobr1f7"), size: 480, tracks: ["Back in the U.S.S.R.", "Dear Prudence", "While My Guitar Gently Weeps", "Blackbird", "Julia", "Helter Skelter"] },
  { id: "abbey-road", title: "Abbey Road", artist: "The Beatles", year: 1969, cover: cover("mqobr6yd"), size: 480, tracks: ["Come Together", "Something", "Here Comes the Sun", "Because", "You Never Give Me Your Money", "The End"] },
  { id: "let-it-be", title: "Let It Be", artist: "The Beatles", year: 1970, cover: cover("mqobrb2l"), size: 480, tracks: ["Two of Us", "Across the Universe", "I Me Mine", "Let It Be", "The Long and Winding Road", "Get Back"] },
];

export const FEATURED = ["abbey-road", "revolver", "rubber-soul", "sgt-pepper", "let-it-be", "magical-mystery-tour", "help", "a-hard-days-night"].map((id) => ALBUMS.find((a) => a.id === id));

export const albumById = (id) => ALBUMS.find((a) => a.id === id);

export const FALLBACK_TRACKS = FEATURED.flatMap((album) =>
  album.tracks.slice(0, 2).map((title, i) => ({
    id: `${album.id}-${i}`,
    title,
    artist: album.artist,
    album: album.title,
    year: album.year,
    image: album.cover,
    imageLarge: album.cover,
    previewUrl: null,
  })),
);
