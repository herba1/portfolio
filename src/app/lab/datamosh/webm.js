// A minimal WebM (Matroska) reader: enough to pull the video track's codec,
// size and every frame (SimpleBlock or BlockGroup/Block, no lacing) with its
// timestamp in milliseconds, for WebCodecs. Sizes may be unknown (live
// muxers); such an element runs to the end of its parent.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
};
const CONTAINERS = new Set([ID.Segment, ID.Tracks, ID.TrackEntry, ID.Video, ID.Cluster, ID.BlockGroup, ID.Info]);

function vint(u8, pos, keepMarker) {
  const first = u8[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8) throw new Error("webm: bad vint");
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + u8[pos + i];
    if (u8[pos + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function uint(u8, pos, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + u8[pos + i];
  return v;
}

export function readWebm(buffer) {
  const u8 = new Uint8Array(buffer);
  const out = { codec: null, width: 0, height: 0, track: 1, scale: 1e6, frames: [], description: null };
  const tracks = [];
  let track = null;
  let clusterTime = 0;

  const walk = (start, end) => {
    let pos = start;
    while (pos < end) {
      const id = vint(u8, pos, true);
      const size = vint(u8, pos + id.len, false);
      const head = id.len + size.len;
      const body = pos + head;
      const stop = size.unknown ? end : Math.min(end, body + size.value);
      const n = stop - body;
      switch (id.value) {
        case ID.TrackEntry:
          track = { number: 0, type: 0, codec: "", width: 0, height: 0, priv: null };
          walk(body, stop);
          tracks.push(track);
          break;
        case ID.TrackNumber:
          track.number = uint(u8, body, n);
          break;
        case ID.TrackType:
          track.type = uint(u8, body, n);
          break;
        case ID.CodecID:
          track.codec = new TextDecoder().decode(u8.subarray(body, stop));
          break;
        case ID.CodecPrivate:
          track.priv = u8.slice(body, stop);
          break;
        case ID.PixelWidth:
          track.width = uint(u8, body, n);
          break;
        case ID.PixelHeight:
          track.height = uint(u8, body, n);
          break;
        case ID.TimecodeScale:
          out.scale = uint(u8, body, n);
          break;
        case ID.Timecode:
          clusterTime = uint(u8, body, n);
          break;
        case ID.SimpleBlock:
        case ID.Block: {
          const tn = vint(u8, body, false);
          let p = body + tn.len;
          let rel = (u8[p] << 8) | u8[p + 1];
          if (rel & 0x8000) rel -= 0x10000;
          const flags = u8[p + 2];
          p += 3;
          out.frames.push({
            track: tn.value,
            time: ((clusterTime + rel) * out.scale) / 1e6,
            key: id.value === ID.SimpleBlock ? (flags & 0x80) !== 0 : null,
            data: u8.subarray(p, stop),
          });
          break;
        }
        default:
          if (CONTAINERS.has(id.value)) walk(body, stop);
      }
      pos = stop;
    }
  };
  walk(0, u8.length);

  const video = tracks.find((t) => t.type === 1) || tracks[0];
  if (!video) throw new Error("webm: no track");
  out.codec = video.codec;
  out.width = video.width;
  out.height = video.height;
  out.track = video.number;
  out.description = video.priv;
  out.frames = out.frames.filter((f) => f.track === video.number);
  // BlockGroup blocks carry no key flag: the first is key, the rest are not.
  out.frames.forEach((f, i) => {
    if (f.key == null) f.key = i === 0;
  });
  return out;
}
