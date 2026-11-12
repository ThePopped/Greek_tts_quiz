"""qa.py: normalisation, comparison, transcript cache, report page (no Whisper model)."""

from pathlib import Path

import pytest

from greek_tts.generate import load_vocab
from greek_tts.qa import build_page, check, compare, flagged, normalise, sound_key

HEADER = "id,greek,english,category,pos,tts_text,voice,strategy,notes\n"
ROWS = (
    "home-01,το σπίτι,house|home,Home,noun,,,,\n"
    "num-05,πέντε,five|5,Numbers,num,,,,\n"
    "q-01,πού;,where,Questions,adv,,,,\n"
    "home-02,η πόρτα,door,Home,noun,,,,\n"
)


class FakeTranscriber:
    """Hears whatever ``heard`` says for a clip's file name; counts calls."""

    name = "fake"

    def __init__(self, heard: dict[str, str]) -> None:
        self.heard = heard
        self.calls: list[str] = []

    def transcribe(self, path: Path) -> str:
        self.calls.append(path.stem)
        return self.heard[path.stem]


@pytest.fixture
def rows(tmp_path):
    csv = tmp_path / "vocab.csv"
    csv.write_text(HEADER + ROWS, encoding="utf-8")
    return load_vocab(csv)


@pytest.fixture
def audio_dir(tmp_path, rows):
    d = tmp_path / "audio"
    d.mkdir()
    for r in rows:
        (d / f"{r.id}.mp3").write_bytes(r.id.encode())  # distinct bytes per clip
    return d


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Το σπίτι.", "το σπιτι"),
        ("Πού;", "που"),  # Greek question mark
        ("ΠΡΟΪΟΝ", "προιον"),  # diaeresis, capitals
        ("Τι  κάνεις;", "τι κανεισ"),  # final sigma folded, spaces collapsed
        ("Ναι, ναι...", "ναι ναι"),
    ],
)
def test_normalise(text, expected):
    assert normalise(text) == expected


@pytest.mark.parametrize(
    "expected, heard",
    [
        ("πίνω", "Πήνο."),  # ι/η, ω/ο
        ("ψηλός", "Ψιλός."),
        ("παίζω", "Πέζω."),  # αι/ε
        ("ποτέ", "Πωτε."),
        ("το νερό", "Τονερό"),  # spaces
        ("εννέα", "Ενέα!"),  # double letters
        ("το προϊόν", "Το προιόν"),  # diaeresis
    ],
)
def test_same_sounding_spellings_match(expected, heard):
    assert sound_key(expected) == sound_key(heard)


def test_different_sounds_dont_match():
    assert sound_key("το") != sound_key("του")  # ου is "u", not "o"
    assert sound_key("δέκα") != sound_key("Δικα")
    assert sound_key("δύο") != sound_key("Βιω")


def test_compare(rows):
    by_id = {r.id: r for r in rows}
    assert compare(by_id["home-01"], "Το σπήτι.") == ("ok", 1.0)
    assert compare(by_id["num-05"], "5") == ("ok", 1.0)  # digits accepted when they're an answer
    assert compare(by_id["num-05"], "6")[0] == "mismatch"
    # The noun was heard, the article wasn't (dropped, or a lone η heard as "και").
    assert compare(by_id["home-02"], "και πόρτα.")[0] == "article"
    assert compare(by_id["home-01"], "Σπίτι.")[0] == "article"
    assert compare(by_id["home-01"], "καλημέρα")[0] == "mismatch"
    assert compare(by_id["home-01"], "") == ("mismatch", 0.0)


def test_check_flags_mismatches_worst_first(rows, audio_dir, tmp_path):
    (audio_dir / "home-02.mp3").unlink()  # a missing clip is flagged first
    heard = {"home-01": "Σπίτι.", "num-05": "Πέντε.", "q-01": "Ποιος;"}
    results = check(rows, audio_dir, FakeTranscriber(heard), tmp_path / "qa.json")

    assert [r.row.id for r in results] == ["home-01", "num-05", "q-01", "home-02"]
    assert [r.row.id for r in flagged(results)] == ["home-02", "q-01", "home-01"]
    assert flagged(results)[0].heard is None


def test_transcripts_are_cached_by_clip_bytes(rows, audio_dir, tmp_path):
    heard = {"home-01": "το σπίτι", "num-05": "5", "q-01": "πού", "home-02": "η πόρτα"}
    cache = tmp_path / "qa.json"
    first = FakeTranscriber(heard)
    check(rows, audio_dir, first, cache)
    assert len(first.calls) == 4

    second = FakeTranscriber(heard)
    results = check(rows, audio_dir, second, cache)
    assert second.calls == []
    assert all(r.ok for r in results)

    (audio_dir / "q-01.mp3").write_bytes(b"regenerated clip")
    third = FakeTranscriber(heard)
    check(rows, audio_dir, third, cache)
    assert third.calls == ["q-01"]


def test_page_lists_flags_with_players(rows, audio_dir, tmp_path):
    heard = {"home-01": "το σπίτι", "num-05": "πέντε", "q-01": "ποιος", "home-02": "η πόρτα"}
    results = check(rows, audio_dir, FakeTranscriber(heard), tmp_path / "qa.json")
    out_dir = tmp_path / "qa_out"

    page = build_page(results, audio_dir, out_dir)

    assert "1 of 4 clips flagged" in page
    assert 'src="../audio/q-01.mp3"' in page
    assert "ποιος" in page
    assert "home-01" not in page


def test_load_audio_decodes_to_16khz_float(tmp_path, make_mp3):
    from greek_tts.qa import load_audio

    clip = tmp_path / "tone.mp3"
    clip.write_bytes(make_mp3("0.5*sin(2*PI*440*t)", 1.0))
    samples = load_audio(clip)

    assert samples.dtype.name == "float32"
    assert abs(len(samples) - 16000) < 1600  # ~1 s at 16 kHz (mp3 padding aside)
    assert 0.3 < abs(samples).max() <= 1.0
