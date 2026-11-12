"""Bake-off run + page, with a fake backend (no network)."""

import asyncio

from greek_tts.bakeoff import Item, build_page, run_bakeoff
from greek_tts.strategies import STRATEGIES
from greek_tts.tts import Synthesis, WordBoundary


class EchoBackend:
    """Returns a tone and one evenly spaced timing per word of the sent text.

    Text containing "fail" raises, to check one bad cell doesn't sink the run.
    """

    def __init__(self, audio: bytes) -> None:
        self.audio = audio

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        if "fail" in text:
            raise RuntimeError("service unavailable")
        words = [WordBoundary(w, 0.2 * n, 0.2 * n + 0.15) for n, w in enumerate(text.split())]
        return Synthesis(text=text, voice=voice, audio=self.audio, words=words)


def test_run_bakeoff_writes_clips_and_page(tmp_path, make_mp3):
    backend = EchoBackend(make_mp3("if(between(t,0.1,1.0),0.3*sin(2*PI*440*t),0)", 1.5))
    items = [Item("το <σπίτι>", "the house", "html escaping"), Item("fail", "-", "error cell")]
    voices = ["athina", "nestoras"]

    cells = asyncio.run(run_bakeoff(backend, items, voices, STRATEGIES, tmp_path, concurrency=2))

    assert len(cells) == len(items) * len(voices) * len(STRATEGIES)
    ok = [c for c in cells if c.item_index == 0]
    failed = [c for c in cells if c.item_index == 1]
    assert all(c.error is None and (tmp_path / c.file).stat().st_size > 0 for c in ok)
    assert all(c.file is None and "service unavailable" in c.error for c in failed)

    page = build_page(items, cells, voices, STRATEGIES)
    assert "το &lt;σπίτι&gt;" in page and "<σπίτι>" not in page
    assert page.count("<audio") == len(ok)
    assert 'src="audio/01_carrier_athina.mp3"' in page
    assert f"{len(failed)} failed" in page
