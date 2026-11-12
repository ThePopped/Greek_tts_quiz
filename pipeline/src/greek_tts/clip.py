"""Audio post-processing with ffmpeg: cut, trim trailing silence, normalise loudness.

Everything works on in-memory MP3 bytes, piped through ffmpeg (which must be on PATH).

``process_clip`` is the one-stop function the pipeline uses:

1. **Cut** (optional): drop everything before ``start`` seconds, keeping a short
   lead-in so the first consonant isn't clipped, with a tiny fade-in so the cut
   never clicks. Used by the carrier-sentence strategy.
2. **Trim trailing silence**: edge-tts leaves ~0.8 s of silence after the last
   word. We keep a short tail so the final vowel decays naturally. Leading
   silence is left alone (edge-tts adds ~0.1 s, which is a comfortable lead-in).
3. **Loudness-normalise** (two-pass EBU R128 ``loudnorm``, linear mode) so every
   clip plays at the same volume regardless of voice or strategy.

Run as a script to process one file:

    uv run python -m greek_tts.clip in.mp3 out.mp3 --start 1.1
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
from pathlib import Path

LEAD_IN_SECONDS = 0.04  # kept before the cut point; consonant onsets start slightly before the reported boundary
FADE_IN_SECONDS = 0.01  # sits inside the lead-in silence, so it only removes the click
TAIL_SECONDS = 0.15  # silence kept after the last sound
SILENCE_THRESHOLD_DB = -50  # quiet enough not to eat soft endings like a trailing "σ"
# -16 LUFS is the usual web/podcast target, but TTS speech is peaky: reaching -16
# would push true peaks past TRUE_PEAK_DB, so loudnorm caps the gain and clips end
# up at different levels. -18 leaves enough headroom for linear gain on every clip,
# so all clips match; the phone's volume control covers the 2 dB difference.
TARGET_LUFS = -18.0
TRUE_PEAK_DB = -1.5

OUTPUT_ARGS = ["-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3"]


class FFmpegError(RuntimeError):
    pass


def process_clip(audio: bytes, start: float | None = None, *, normalize: bool = True) -> bytes:
    """Cut (optional), trim trailing silence, and loudness-normalise an MP3."""
    filters = []
    if start is not None:
        cut_at = max(0.0, start - LEAD_IN_SECONDS)
        filters += [
            f"atrim=start={cut_at:.3f}",
            "asetpts=PTS-STARTPTS",
            f"afade=t=in:d={FADE_IN_SECONDS}",
        ]
    # Trim trailing silence by reversing, stripping leading silence, reversing back.
    filters += [
        "areverse",
        f"silenceremove=start_periods=1:start_threshold={SILENCE_THRESHOLD_DB}dB"
        f":start_silence={TAIL_SECONDS}",
        "areverse",
    ]
    chain = ",".join(filters)

    if normalize:
        stats = measure_loudness(audio, chain)
        if stats is not None:
            chain += (
                f",loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DB}:LRA=11"
                f":measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
                f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}"
                f":offset={stats['target_offset']}:linear=true"
            )

    return _run_ffmpeg(["-i", "pipe:0", "-af", chain, *OUTPUT_ARGS, "pipe:1"], audio).stdout


def measure_loudness(audio: bytes, chain: str = "anull") -> dict[str, str] | None:
    """First loudnorm pass: measure the clip after ``chain``. None if it is silent."""
    result = _run_ffmpeg(
        [
            "-i", "pipe:0",
            "-af", f"{chain},loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK_DB}:LRA=11:print_format=json",
            "-f", "null", "-",
        ],
        audio,
    )
    stderr = result.stderr.decode("utf-8", errors="replace")
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr)
    if not match:
        raise FFmpegError(f"loudnorm produced no measurement:\n{stderr[-2000:]}")
    stats = json.loads(match.group(0))
    if not math.isfinite(float(stats["input_i"])):  # "-inf" for pure silence
        return None
    return stats


def duration(audio: bytes) -> float:
    """Length of an MP3 in seconds (decodes it fully, so it is exact)."""
    result = _run_ffmpeg(["-i", "pipe:0", "-f", "null", "-"], audio)
    stderr = result.stderr.decode("utf-8", errors="replace")
    times = re.findall(r"time=(\d+):(\d+):(\d+\.\d+)", stderr)
    if not times:
        raise FFmpegError(f"could not read duration:\n{stderr[-2000:]}")
    h, m, s = times[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def _run_ffmpeg(args: list[str], audio: bytes) -> subprocess.CompletedProcess[bytes]:
    if shutil.which("ffmpeg") is None:
        raise FFmpegError("ffmpeg not found on PATH")
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "info", *args],
        input=audio,
        capture_output=True,
    )
    if result.returncode != 0:
        raise FFmpegError(result.stderr.decode("utf-8", errors="replace")[-2000:])
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut, trim and normalise one MP3.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=float, help="cut everything before this many seconds")
    parser.add_argument("--no-normalize", action="store_true")
    args = parser.parse_args()

    audio = args.input.read_bytes()
    out = process_clip(audio, args.start, normalize=not args.no_normalize)
    args.output.write_bytes(out)
    before = measure_loudness(audio)
    after = measure_loudness(out)
    print(f"duration  {duration(audio):.3f}s -> {duration(out):.3f}s")
    if before and after:
        print(f"loudness  {float(before['input_i']):.1f} -> {float(after['input_i']):.1f} LUFS")
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
