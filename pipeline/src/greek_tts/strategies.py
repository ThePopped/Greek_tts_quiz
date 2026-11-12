"""Strategies: how a vocab item's text is sent to the TTS engine.

TTS voices are trained on sentences, so a bare word can come out rushed or with
odd intonation. Three ways to send it, compared in the bake-off:

- ``plain``: the text exactly as written (``το σπίτι``).
- ``punctuated``: with a full stop added, so it is read as a complete
  utterance with falling intonation (``το σπίτι.``).
- ``carrier``: inside a short carrier sentence (``Η λέξη είναι: το σπίτι.``).
  The audio is cut at the target's first word using the engine's own word
  timings. The colon gives a ~0.2 s pause before the target, so the cut lands in
  silence.

Every strategy then goes through ``clip.process_clip`` (trim + normalise).

Run as a script to render one item:

    uv run python -m greek_tts.strategies "το σπίτι" --strategy carrier --out sample.mp3
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, get_args

from greek_tts.clip import process_clip
from greek_tts.tts import VOICES, EdgeTTSBackend, TTSBackend, WordBoundary

Strategy = Literal["plain", "punctuated", "carrier"]
STRATEGIES: tuple[Strategy, ...] = get_args(Strategy)

CARRIER_PREFIX = "Η λέξη είναι: "  # "The word is: "
# Full stop, exclamation mark, ellipsis, and both forms of the Greek question
# mark (";" as typed on keyboards and the dedicated U+037E).
SENTENCE_END = (".", "!", "…", ";", ";")


class CarrierCutError(RuntimeError):
    """The target word couldn't be found in the carrier sentence's word timings."""


@dataclass(frozen=True)
class RenderedClip:
    text: str  # the vocab item as given
    tts_text: str  # what was actually sent to the engine
    strategy: Strategy
    voice: str
    audio: bytes  # processed MP3
    cut_at: float | None  # seconds into the raw audio (carrier only)


def punctuate(text: str) -> str:
    """Add a full stop unless the text already ends a sentence."""
    text = text.strip()
    return text if text.endswith(SENTENCE_END) else f"{text}."


def build_tts_text(text: str, strategy: Strategy) -> str:
    """The exact string sent to the TTS engine for ``text`` under ``strategy``."""
    if strategy == "plain":
        return text.strip()
    if strategy == "punctuated":
        return punctuate(text)
    if strategy == "carrier":
        return CARRIER_PREFIX + punctuate(text)
    raise ValueError(f"Unknown strategy {strategy!r}; expected one of {STRATEGIES}")


def find_carrier_cut(words: list[WordBoundary], text: str) -> float:
    """Start time (seconds) of the target's first word in a carrier synthesis.

    Skips the prefix's words, then checks the next word really is the target's
    first word, so a misaligned timing list raises instead of cutting mid-word.
    """
    prefix_count = len(_words(CARRIER_PREFIX))
    target_first = _words(text)[0] if _words(text) else ""
    for word in words[prefix_count:]:
        if _normalize(word.text) == target_first:
            return word.start
    spoken = " ".join(w.text for w in words)
    raise CarrierCutError(f"Couldn't find {target_first!r} after the carrier prefix in: {spoken}")


async def render(
    backend: TTSBackend, text: str, voice: str, strategy: Strategy
) -> RenderedClip:
    """Synthesise ``text`` with ``strategy`` and return the processed clip."""
    tts_text = build_tts_text(text, strategy)
    synthesis = await backend.synthesize(tts_text, voice)
    cut_at = find_carrier_cut(synthesis.words, text) if strategy == "carrier" else None
    # ffmpeg runs in a thread so several renders can be awaited concurrently.
    audio = await asyncio.to_thread(process_clip, synthesis.audio, cut_at)
    return RenderedClip(
        text=text,
        tts_text=tts_text,
        strategy=strategy,
        voice=voice,
        audio=audio,
        cut_at=cut_at,
    )


def _normalize(word: str) -> str:
    """Lowercase, drop accents and punctuation, so timing text matches the input."""
    decomposed = unicodedata.normalize("NFD", word.casefold())
    return "".join(c for c in decomposed if c.isalnum())


def _words(text: str) -> list[str]:
    return [w for w in (_normalize(t) for t in text.split()) if w]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Render one vocab item with a strategy.")
    parser.add_argument("text")
    parser.add_argument("--strategy", default="carrier", choices=STRATEGIES)
    parser.add_argument("--voice", default="athina", choices=sorted(VOICES))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    clip = asyncio.run(render(EdgeTTSBackend(), args.text, args.voice, args.strategy))
    args.out.write_bytes(clip.audio)
    cut = f", cut at {clip.cut_at:.3f}s" if clip.cut_at is not None else ""
    print(f"sent {clip.tts_text!r}{cut}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
