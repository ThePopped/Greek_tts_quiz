"""Tests for strategies.py. A fake backend stands in for edge-tts (no network)."""

import asyncio

import pytest

from greek_tts.clip import duration
from greek_tts.strategies import (
    CarrierCutError,
    build_tts_text,
    find_carrier_cut,
    punctuate,
    render,
)
from greek_tts.tts import Synthesis, WordBoundary


def wb(text: str, start: float) -> WordBoundary:
    return WordBoundary(text=text, start=start, end=start + 0.2)


CARRIER_WORDS = [wb("Η", 0.1), wb("λέξη", 0.2), wb("είναι", 0.55), wb("Το", 1.1), wb("σπίτι", 1.2)]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("το σπίτι", "το σπίτι."),
        ("  καλημέρα ", "καλημέρα."),
        ("τι κάνεις;", "τι κάνεις;"),  # Greek question mark typed as ";"
        ("τι κάνεις;", "τι κάνεις;"),  # dedicated Greek question mark
        ("γεια!", "γεια!"),
        ("ευχαριστώ.", "ευχαριστώ."),
    ],
)
def test_punctuate(text, expected):
    assert punctuate(text) == expected


def test_build_tts_text():
    assert build_tts_text(" το σπίτι ", "plain") == "το σπίτι"
    assert build_tts_text("το σπίτι", "punctuated") == "το σπίτι."
    assert build_tts_text("το σπίτι", "carrier") == "Η λέξη είναι: το σπίτι."
    with pytest.raises(ValueError):
        build_tts_text("το σπίτι", "shout")  # type: ignore[arg-type]


def test_carrier_cut_at_target_start():
    assert find_carrier_cut(CARRIER_WORDS, "το σπίτι") == 1.1


def test_carrier_cut_ignores_case_accents_and_punctuation():
    words = [wb("Η", 0.1), wb("λέξη", 0.2), wb("είναι", 0.55), wb("Τί", 1.1), wb("κάνεις", 1.3)]
    assert find_carrier_cut(words, "τι κάνεις;") == 1.1


def test_carrier_cut_skips_prefix_word_that_matches_target():
    # The target "η μητέρα" starts with the same word as the prefix "Η λέξη...".
    words = [wb("Η", 0.1), wb("λέξη", 0.2), wb("είναι", 0.55), wb("η", 1.1), wb("μητέρα", 1.16)]
    assert find_carrier_cut(words, "η μητέρα") == 1.1


def test_carrier_cut_raises_when_target_missing():
    with pytest.raises(CarrierCutError):
        find_carrier_cut(CARRIER_WORDS[:3], "το σπίτι")


class FakeBackend:
    """Returns a tone (0.5–1.0 s, then silence) with the carrier word timings."""

    def __init__(self, audio: bytes) -> None:
        self.audio = audio
        self.sent: list[str] = []

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        self.sent.append(text)
        words = [wb("Η", 0.0), wb("λέξη", 0.1), wb("είναι", 0.2), wb("Το", 0.5), wb("σπίτι", 0.7)]
        return Synthesis(text=text, voice=voice, audio=self.audio, words=words)


@pytest.fixture(scope="module")
def fake_backend(make_mp3) -> FakeBackend:
    return FakeBackend(make_mp3("if(between(t,0.5,1.0),0.3*sin(2*PI*440*t),0)", 2.0))


def test_render_carrier_cuts_before_target(fake_backend):
    clip = asyncio.run(render(fake_backend, "Το σπίτι", "athina", "carrier"))
    assert fake_backend.sent[-1] == "Η λέξη είναι: Το σπίτι."
    assert clip.tts_text == "Η λέξη είναι: Το σπίτι."
    assert clip.cut_at == 0.5
    # Cut drops ~0.5 s of lead-in, trim drops ~0.85 s of trailing silence.
    assert duration(clip.audio) < 0.85


def test_render_punctuated_keeps_lead_in(fake_backend):
    clip = asyncio.run(render(fake_backend, "Το σπίτι", "nestoras", "punctuated"))
    assert clip.tts_text == "Το σπίτι."
    assert clip.cut_at is None
    assert duration(clip.audio) > 1.0  # 0.5 s lead-in + 0.5 s tone + tail
