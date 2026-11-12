from typing import get_args

from greek_tts.config import DEFAULT_STRATEGY, DEFAULT_VOICE
from greek_tts.strategies import Strategy
from greek_tts.tts import VOICES


def test_defaults_are_valid_names():
    assert DEFAULT_VOICE in VOICES
    assert DEFAULT_STRATEGY in get_args(Strategy)
