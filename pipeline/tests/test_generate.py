"""generate.py: CSV loading, caching, overrides, failures, vocab.json (no network)."""

import asyncio

import pytest

from greek_tts.config import DEFAULT_STRATEGY, DEFAULT_VOICE
from greek_tts.generate import DEFAULT_CSV, build_vocab_json, generate_audio, load_vocab
from greek_tts.tts import Synthesis, WordBoundary

HEADER = "id,greek,english,category,pos,tts_text,voice,strategy,notes\n"
ROWS = (
    "home-01,το σπίτι,house|home,Home,noun,,,,neuter\n"
    "food-01,το νερό,water,Food & drink,noun,,athina,carrier,\n"
    "home-02,η πόρτα,door,Home,noun,η πόρτα!,,,\n"
)


class RecordingBackend:
    """Returns a tone, records every call; text containing "fail" raises."""

    def __init__(self, audio: bytes) -> None:
        self.audio = audio
        self.calls: list[tuple[str, str]] = []

    async def synthesize(self, text: str, voice: str) -> Synthesis:
        self.calls.append((text, voice))
        if "fail" in text:
            raise RuntimeError("service unavailable")
        words = [WordBoundary(w, 0.3 * n, 0.3 * n + 0.2) for n, w in enumerate(text.split())]
        return Synthesis(text=text, voice=voice, audio=self.audio, words=words)


@pytest.fixture(scope="module")
def tone(make_mp3) -> bytes:
    return make_mp3("if(between(t,0.1,2.0),0.3*sin(2*PI*440*t),0)", 2.5)


def write_csv(tmp_path, body: str):
    path = tmp_path / "vocab.csv"
    path.write_text(HEADER + body, encoding="utf-8")
    return path


def run(rows, backend, tmp_path, **kwargs):
    return asyncio.run(
        generate_audio(rows, backend, tmp_path / "audio", tmp_path / "cache", delay=0, **kwargs)
    )


def test_load_vocab_applies_defaults_and_overrides(tmp_path):
    rows = {r.id: r for r in load_vocab(write_csv(tmp_path, ROWS))}

    assert rows["home-01"].answers == ["house", "home"]
    assert (rows["home-01"].voice, rows["home-01"].strategy) == (DEFAULT_VOICE, DEFAULT_STRATEGY)
    assert (rows["food-01"].voice, rows["food-01"].strategy) == ("athina", "carrier")
    assert rows["home-02"].text == "η πόρτα!"  # tts_text replaces greek for synthesis
    assert rows["home-02"].greek == "η πόρτα"


@pytest.mark.parametrize(
    "body, message",
    [
        ("x-01,α,a,C,noun,,robot,,\n", "unknown voice"),
        ("x-01,α,a,C,noun,,,shout,\n", "unknown strategy"),
        ("x-01,α,a,C,noun,,,,,extra\n", "wrong number of cells"),
        ("x-01,α,a,C,noun,,,,\nx-01,β,b,C,noun,,,,\n", "duplicate ids"),
    ],
)
def test_load_vocab_rejects_bad_rows(tmp_path, body, message):
    with pytest.raises(ValueError, match=message):
        load_vocab(write_csv(tmp_path, body))


def test_real_csv_loads():
    rows = load_vocab(DEFAULT_CSV)
    assert len(rows) > 300
    assert len({r.cache_key for r in rows}) == len(rows)


def test_generates_every_row_then_uses_the_cache(tmp_path, tone):
    rows = load_vocab(write_csv(tmp_path, ROWS))
    backend = RecordingBackend(tone)

    first = run(rows, backend, tmp_path)
    assert sorted(first.generated) == ["food-01", "home-01", "home-02"]
    assert not first.failed
    for row in rows:
        assert (tmp_path / "audio" / f"{row.id}.mp3").stat().st_size > 0
    # Overrides reach the backend: carrier prefix + athina for food-01, tts_text for home-02.
    assert ("Η λέξη είναι: το νερό.", "athina") in backend.calls
    assert ("η πόρτα!", DEFAULT_VOICE) in backend.calls

    backend.calls.clear()
    second = run(rows, backend, tmp_path)
    assert backend.calls == []
    assert sorted(second.cached) == ["food-01", "home-01", "home-02"]

    forced = run(rows, backend, tmp_path, force=True)
    assert len(backend.calls) == 3 and len(forced.generated) == 3


def test_changing_a_row_regenerates_only_that_row(tmp_path, tone):
    backend = RecordingBackend(tone)
    run(load_vocab(write_csv(tmp_path, ROWS)), backend, tmp_path)
    backend.calls.clear()

    edited = ROWS.replace("home-01,το σπίτι,house|home,Home,noun,,,,", "home-01,το σπίτι,house|home,Home,noun,,athina,,")
    report = run(load_vocab(write_csv(tmp_path, edited)), backend, tmp_path)

    assert report.generated == ["home-01"]
    assert backend.calls == [("το σπίτι.", "athina")]


def test_removes_orphaned_clips(tmp_path, tone):
    backend = RecordingBackend(tone)
    run(load_vocab(write_csv(tmp_path, ROWS)), backend, tmp_path)

    only_first = ROWS.splitlines(keepends=True)[0]
    report = run(load_vocab(write_csv(tmp_path, only_first)), backend, tmp_path)

    assert report.removed == ["food-01.mp3", "home-02.mp3"]
    assert sorted(p.name for p in (tmp_path / "audio").iterdir()) == ["home-01.mp3"]


def test_failed_row_is_reported_and_left_out_of_vocab_json(tmp_path, tone):
    body = ROWS + "home-03,το κρεβάτι,bed,Home,noun,fail please,,,\n"
    rows = load_vocab(write_csv(tmp_path, body))
    # A stale clip from an earlier run must not survive the failure.
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "home-03.mp3").write_bytes(b"old")

    report = run(rows, RecordingBackend(tone), tmp_path)

    assert list(report.failed) == ["home-03"]
    assert "service unavailable" in report.failed["home-03"]
    assert not (tmp_path / "audio" / "home-03.mp3").exists()
    vocab = build_vocab_json(rows, report.ok_ids)
    assert [w["id"] for w in vocab["words"]] == ["home-01", "food-01", "home-02"]


def test_vocab_json_shape(tmp_path):
    rows = load_vocab(write_csv(tmp_path, ROWS))
    vocab = build_vocab_json(rows, {r.id for r in rows})

    assert vocab["categories"] == ["Home", "Food & drink"]  # first-seen CSV order
    assert vocab["words"][0] == {
        "id": "home-01",
        "greek": "το σπίτι",
        "answers": ["house", "home"],
        "category": "Home",
        "pos": "noun",
        "notes": "neuter",
        "audio": "audio/home-01.mp3",
    }
