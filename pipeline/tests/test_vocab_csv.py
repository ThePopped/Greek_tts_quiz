"""Structural checks on data/vocab.csv, so hand edits can't break the build."""

import csv
import re
from pathlib import Path

import pytest

from greek_tts.strategies import STRATEGIES
from greek_tts.tts import VOICES

VOCAB = Path(__file__).resolve().parents[2] / "data" / "vocab.csv"
COLUMNS = ["id", "greek", "english", "category", "pos", "tts_text", "voice", "strategy", "notes"]
POS = {"noun", "verb", "adj", "adv", "num", "phrase", "question"}


@pytest.fixture(scope="module")
def rows() -> list[dict[str, str]]:
    with VOCAB.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == COLUMNS
        return list(reader)


def test_every_row_has_all_columns(rows):
    # DictReader puts extra cells under None and fills missing ones with None.
    bad = [r["id"] for r in rows if None in r or None in r.values()]
    assert not bad, f"wrong number of cells (stray comma?): {bad}"


def test_required_fields_filled(rows):
    for row in rows:
        for col in ("id", "greek", "english", "category", "pos"):
            assert row[col].strip(), f"{row['id'] or row}: empty {col}"


def test_ids_are_unique_slugs(rows):
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "duplicate ids"
    assert all(re.fullmatch(r"[a-z]+-\d{2,3}", i) for i in ids), "ids must look like 'food-07'"


def test_greek_is_unique(rows):
    seen: dict[str, str] = {}
    for row in rows:
        assert row["greek"] not in seen, f"{row['id']} repeats {seen[row['greek']]}"
        seen[row["greek"]] = row["id"]


def test_english_answers_are_clean(rows):
    for row in rows:
        answers = row["english"].split("|")
        assert all(a and a == a.strip() for a in answers), f"{row['id']}: empty or padded answer"
        assert len(answers) == len(set(answers)), f"{row['id']}: duplicate answer"


def test_pos_and_overrides_are_valid(rows):
    for row in rows:
        assert row["pos"] in POS, f"{row['id']}: unknown pos {row['pos']!r}"
        assert row["voice"] in ("", *VOICES), f"{row['id']}: unknown voice {row['voice']!r}"
        assert row["strategy"] in ("", *STRATEGIES), f"{row['id']}: unknown strategy {row['strategy']!r}"
