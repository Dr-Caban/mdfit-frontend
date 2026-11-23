#!/usr/bin/env python3
"""Transcribe a video or audio clip, in this container, so nothing leaves the sandbox.

    pip install faster-whisper            # once per session
    python3 -I scripts/video-stt.py clip.mp4 [more.mp4 ...]
    python3 -I scripts/video-stt.py --model medium.en clip.mp4

Why this exists: Dr. Jared says the name of the movement in the first seconds of each clip, so a
camera file called 20261111_132836.mp4 can be identified from its own audio instead of guessed from
a thumbnail. A frame shows the setup; the words say what it is. Guessing from frames got
"tandem stance balance drill" out of a clip that was actually running-form coaching.

Nothing is uploaded. Sending clips, or links to them, to an outside transcription service hands a
third party access to private Drive files, and the sandbox refuses it. Keep it that way.

Two notes that cost an hour the first time:
  - faster-whisper's own file reader breaks against the PyAV in this image
    ("open() got an unexpected keyword argument 'metadata_errors'"), so the audio is decoded here
    with ffmpeg and passed in as a numpy array.
  - run it with `python3 -I`: these files are downloaded, untrusted input, and -I keeps the
    interpreter from importing anything out of their directory.
"""
import argparse
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000


def decode(path):
    """Whole file to mono 16 kHz float32, via ffmpeg. Works on .mp4 as well as .mp3/.wav."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path,
         "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
        capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="video or audio files")
    ap.add_argument("--model", default="small.en",
                    help="faster-whisper model (default small.en; medium.en is better on anatomy "
                         "terms and roughly three times slower on CPU)")
    ap.add_argument("--head", type=float, default=0,
                    help="only transcribe the first N seconds — the name is usually said in the "
                         "first 10, and this makes a pass over a long clip quick")
    args = ap.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    for path in args.paths:
        try:
            audio = decode(path)
        except subprocess.CalledProcessError as e:
            print(f"=== {path} ===\n  could not decode: {e.stderr.decode(errors='replace').strip()[:200]}")
            continue
        if args.head:
            audio = audio[: int(args.head * SAMPLE_RATE)]
        segments, _ = model.transcribe(audio, beam_size=5, vad_filter=True)
        print(f"=== {path} ===")
        said = False
        for seg in segments:
            text = seg.text.strip()
            if text:
                said = True
                print(f"  [{seg.start:6.1f}s] {text}")
        if not said:
            print("  (no speech found — a silent clip names nothing, so it still needs the owner)")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
