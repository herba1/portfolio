import argparse
import json
import sys
from pathlib import Path

MIN_WORD_MS = 40
LOW_CONFIDENCE = 0.5
GAP_WARN_MS = 2000


def ms(seconds):
    return round(seconds * 1000)


def collect_warnings(lines):
    warnings = []
    for line in lines:
        for w in line["words"]:
            if w["end"] - w["start"] < MIN_WORD_MS:
                warnings.append({"kind": "zero-duration", "line": line["id"], "word": w["text"]})
            if w["confidence"] is not None and w["confidence"] < LOW_CONFIDENCE:
                warnings.append({"kind": "low-confidence", "line": line["id"], "word": w["text"]})
        starts = [w["start"] for w in line["words"]]
        ends = [w["end"] for w in line["words"]]
        for prev_end, next_start in zip(ends, starts[1:]):
            if next_start - prev_end > GAP_WARN_MS:
                warnings.append({"kind": "gap", "line": line["id"], "ms": next_start - prev_end})
    return warnings


def to_record(result, args):
    lines = []
    for i, seg in enumerate(result.segments):
        words = []
        for w in seg.words:
            text = w.word.strip()
            if not text:
                continue
            confidence = getattr(w, "probability", None)
            words.append({
                "text": text,
                "start": ms(w.start),
                "end": ms(w.end),
                "confidence": round(confidence, 3) if confidence is not None else None,
            })
        if not words:
            continue
        lines.append({
            "id": f"L{i + 1}",
            "start": ms(seg.start),
            "end": ms(seg.end),
            "text": seg.text.strip(),
            "words": words,
        })
    return {
        "version": 1,
        "timing": "word",
        "track": {
            "title": args.title,
            "artist": args.artist,
            "audio": Path(args.audio).name,
        },
        "plain": "\n".join(l["text"] for l in lines),
        "lines": lines,
        "meta": {
            "engine": "stable-ts",
            "model": args.model,
            "denoiser": None if args.no_denoise else "demucs",
            "language": args.language,
            "refined": args.refine,
            "warnings": collect_warnings(lines),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Align lyrics text to audio, emit word-timed JSON")
    parser.add_argument("audio")
    parser.add_argument("lyrics")
    parser.add_argument("-o", "--out")
    parser.add_argument("-m", "--model", default="medium")
    parser.add_argument("-l", "--language", default="en")
    parser.add_argument("--device", default=None)
    parser.add_argument("--title", default=None)
    parser.add_argument("--artist", default=None)
    parser.add_argument("--refine", action="store_true")
    parser.add_argument("--no-denoise", action="store_true")
    args = parser.parse_args()

    text = Path(args.lyrics).read_text().strip()
    if not text:
        sys.exit("lyrics file is empty")

    import stable_whisper

    model = stable_whisper.load_model(args.model, device=args.device)
    result = model.align(
        args.audio,
        text,
        language=args.language,
        original_split=True,
        vad=True,
        suppress_silence=True,
        denoiser=None if args.no_denoise else "demucs",
    )
    if args.refine:
        result = model.refine(args.audio, result)

    record = to_record(result, args)
    out = json.dumps(record, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(out + "\n")
        print(f"wrote {args.out}: {len(record['lines'])} lines, "
              f"{sum(len(l['words']) for l in record['lines'])} words, "
              f"{len(record['meta']['warnings'])} warnings")
    else:
        print(out)


if __name__ == "__main__":
    main()
