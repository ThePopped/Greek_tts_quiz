"""TTS backends: turn Greek text into MP3 audio plus per-word timings.

The pipeline only depends on the ``TTSBackend`` protocol, so edge-tts can be
swapped for the official Azure Speech SDK later without touching the callers.

Run as a script to synthesise one phrase and print its word timings:

    uv run python -m greek_tts.tts "Το σπίτι." --voice athina --out sample.mp3
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException

# Short names used throughout the pipeline (CSV overrides, bake-off labels).
VOICES: dict[str, str] = {
    "athina": "el-GR-AthinaNeural",  # female
    "nestoras": "el-GR-NestorasNeural",  # male
}

# Azure / edge-tts report boundary offsets and durations in 100-ns ticks.
# Verified against a real clip: "Η λέξη είναι: Το σπίτι." is 2.52 s long and
# its last word ends at 16_625_000 ticks = 1.66 s (the rest is trailing silence).
TICKS_PER_SECOND = 10_000_000


@dataclass(frozen=True)
class WordBoundary:
    """One spoken word and where it sits in the audio, in seconds."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Synthesis:
    """Result of one TTS call: MP3 bytes plus the timing of each word."""

    text: str
    voice: str
    audio: bytes  # MP3, 24 kHz mono, 48 kbit/s for edge-tts
    words: list[WordBoundary]


class TTSBackend(Protocol):
    async def synthesize(self, text: str, voice: str) -> Synthesis:
        """Synthesise ``text`` with ``voice`` (a key of ``VOICES``)."""
        ...


class EdgeTTSBackend:
    """Uses the Microsoft Edge read-aloud service via the ``edge-tts`` package.

    Unofficial but free and keyless; it serves the same neural voices as Azure.
    Transient network/service errors are retried with exponential backoff.
    """

    def __init__(self, retries: int = 3, backoff_seconds: float = 1.0) -> None:
        self.retries = retries
        self.backoff_seconds = backoff_seconds

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        voice_name = resolve_voice(voice)
        for attempt in range(self.retries + 1):
            try:
                return await self._synthesize_once(text, voice_name)
            except (EdgeTTSException, aiohttp.ClientError, asyncio.TimeoutError):
                if attempt == self.retries:
                    raise
                await asyncio.sleep(self.backoff_seconds * 2**attempt)
        raise AssertionError("unreachable")

    async def _synthesize_once(self, text: str, voice_name: str) -> Synthesis:
        communicate = edge_tts.Communicate(text, voice_name, boundary="WordBoundary")
        audio = bytearray()
        words: list[WordBoundary] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                words.append(
                    WordBoundary(
                        text=chunk["text"],
                        start=start,
                        end=start + chunk["duration"] / TICKS_PER_SECOND,
                    )
                )
        return Synthesis(text=text, voice=voice_name, audio=bytes(audio), words=words)


def resolve_voice(voice: str) -> str:
    """Accept a short name ("athina") or a full Azure voice name."""
    if voice in VOICES:
        return VOICES[voice]
    if voice in VOICES.values():
        return voice
    raise ValueError(f"Unknown voice {voice!r}; expected one of {sorted(VOICES)}")


def main() -> None:
    # Windows consoles default to cp1252, which can't print Greek.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Synthesise Greek text and show word timings.")
    parser.add_argument("text")
    parser.add_argument("--voice", default="athina", help=f"one of {sorted(VOICES)}")
    parser.add_argument("--out", type=Path, help="write the MP3 here")
    args = parser.parse_args()

    result = asyncio.run(EdgeTTSBackend().synthesize(args.text, args.voice))
    print(f"{result.voice}: {len(result.audio):,} bytes")
    for word in result.words:
        print(f"  {word.start:6.3f}–{word.end:6.3f}s  {word.text}")
    if args.out:
        args.out.write_bytes(result.audio)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
