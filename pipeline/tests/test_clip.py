"""Tests for clip.py using synthetic tones (no network / TTS needed).

The test signal is 0.5 s silence, 0.5 s tone, 1.0 s silence, mimicking a TTS
clip with a lead-in and a long silent tail.

Each MP3 encode adds ~0.05 s of encoder padding at the start, and our test clip
is encoded twice (generation + processing). Rather than widen tolerances, the
tests measure that padding with a no-op re-encode and add it to the expectation.
"""

import subprocess

import pytest

from greek_tts.clip import (
    LEAD_IN_SECONDS,
    OUTPUT_ARGS,
    TAIL_SECONDS,
    _run_ffmpeg,
    duration,
    measure_loudness,
    process_clip,
)

TOL = 0.03
TONE_CLIP_SECONDS = 2.0


def make_mp3(expr: str, seconds: float) -> bytes:
    return subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"aevalsrc='{expr}':d={seconds}:s=24000",
            "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1",
        ],
        capture_output=True,
        check=True,
    ).stdout


@pytest.fixture(scope="module")
def tone_clip() -> bytes:
    return make_mp3("if(between(t,0.5,1.0),0.3*sin(2*PI*440*t),0)", TONE_CLIP_SECONDS)


@pytest.fixture(scope="module")
def codec_padding(tone_clip) -> float:
    """Extra seconds that generating + re-encoding the tone clip adds (~0.1 s)."""
    reencoded = _run_ffmpeg(["-i", "pipe:0", "-af", "anull", *OUTPUT_ARGS, "pipe:1"], tone_clip).stdout
    padding = duration(reencoded) - TONE_CLIP_SECONDS
    assert 0 <= padding < 0.2
    return padding


def test_trailing_silence_trimmed_leading_kept(tone_clip, codec_padding):
    out = process_clip(tone_clip)
    # 0.5 lead-in + 0.5 tone + kept tail
    assert duration(out) == pytest.approx(0.5 + 0.5 + TAIL_SECONDS + codec_padding, abs=TOL)


def test_cut_keeps_lead_in(tone_clip, codec_padding):
    # The cut also removes the first encode's padding (it's before the cut point),
    # so only the output encode's padding remains: about half of codec_padding.
    out = process_clip(tone_clip, start=0.5 + codec_padding / 2)
    expected = LEAD_IN_SECONDS + 0.5 + TAIL_SECONDS + codec_padding / 2
    assert duration(out) == pytest.approx(expected, abs=TOL)


def test_quiet_and_loud_clips_end_up_at_same_loudness():
    quiet = make_mp3("if(between(t,0.1,1.0),0.05*sin(2*PI*440*t),0)", 1.5)
    loud = make_mp3("if(between(t,0.1,1.0),0.4*sin(2*PI*440*t),0)", 1.5)
    levels = [float(measure_loudness(process_clip(c))["input_i"]) for c in (quiet, loud)]
    assert abs(levels[0] - levels[1]) < 1.0


def test_silent_clip_is_not_normalised_and_does_not_crash():
    silent = make_mp3("0", 1.0)
    assert measure_loudness(silent) is None
    assert len(process_clip(silent)) > 0
