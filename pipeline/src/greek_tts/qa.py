"""Whisper round-trip check: does each clip sound like the word it should be?

Every clip in ``web/public/audio/`` is transcribed by faster-whisper (``small``,
CPU, ``language="el"``) and compared with the row's ``greek`` text by sound:
accents, case, punctuation, spaces and double letters are ignored, and spellings
that sound alike count as equal (ι/η/υ/ει/οι, ο/ω, ε/αι), because Whisper picks
any of them for a lone word. Clips that don't match are printed, worst first,
and listed with audio players on ``qa_out/index.html`` so they can be checked
by ear: ``mismatch`` (a different word was heard) before ``article`` (the word
was heard but its article wasn't, often Whisper mishearing a lone η).

A flag is a prompt to listen, not proof the clip is wrong: Whisper also
mishears short words and lone syllables. And because accents are stripped, it
can't catch a wrong stress (πότε vs ποτέ). Fixing a clip is the same as for
``generate``: set the row's ``tts_text`` / ``voice`` / ``strategy`` override,
re-run ``generate``, then re-run this.

Transcripts are cached in ``.cache/qa.json`` by (model, clip bytes), so a
re-run only transcribes clips that changed.

    uv run python -m greek_tts.qa
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

from greek_tts.generate import DEFAULT_CSV, DEFAULT_WEB_PUBLIC, PIPELINE_DIR, VocabRow, load_vocab

DEFAULT_MODEL = "small"
DEFAULT_TRANSCRIPT_CACHE = PIPELINE_DIR / ".cache" / "qa.json"
DEFAULT_OUT = PIPELINE_DIR / "qa_out"


class Transcriber(Protocol):
    name: str  # part of the cache key: a different model means new transcripts

    def transcribe(self, path: Path) -> str: ...


class WhisperTranscriber:
    """faster-whisper on the CPU. The model (~500 MB for ``small``) downloads on first use."""

    def __init__(self, model: str = DEFAULT_MODEL) -> None:
        self.name = f"whisper-{model}"
        self._model_name = model
        self._model = None

    def transcribe(self, path: Path) -> str:
        if self._model is None:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")  # harmless on Windows
            from faster_whisper import WhisperModel  # slow import; only needed for real runs

            self._model = WhisperModel(self._model_name, device="cpu", compute_type="int8")
        segments, _info = self._model.transcribe(
            load_audio(path),
            language="el",
            beam_size=5,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        return " ".join(s.text.strip() for s in segments).strip()


def load_audio(path: Path) -> np.ndarray:
    """Decode to 16 kHz mono float32 with ffmpeg, the input Whisper expects.

    Done here rather than by faster-whisper, whose PyAV decoder breaks with
    PyAV 19 (``open() got an unexpected keyword argument 'metadata_errors'``).
    """
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def normalise(text: str) -> str:
    """Strip accents/diaeresis, case (incl. final ς → σ) and punctuation; collapse spaces."""
    decomposed = unicodedata.normalize("NFD", text)
    bare = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    return " ".join(re.sub(r"[^\w\s]|_", " ", bare).split())


# Spellings that sound the same in modern Greek. Whisper picks any of them for
# a lone word (Πήνο for πίνω, Πωτε for ποτέ), so they must not count as errors.
# Order matters: digraphs before single letters; ου becomes a placeholder so its
# υ isn't read as ι.
_SAME_SOUND = [("ου", "u"), ("ει", "ι"), ("οι", "ι"), ("υι", "ι"), ("αι", "ε"), ("η", "ι"), ("υ", "ι"), ("ω", "ο")]
ARTICLES = {"ο", "η", "το", "οι", "τα"}


def sound_key(text: str) -> str:
    """``normalise`` plus: same-sounding spellings merged, double letters and spaces dropped."""
    key = normalise(text)
    for spelling, sound in _SAME_SOUND:
        key = key.replace(spelling, sound)
    return re.sub(r"(.)\1", r"\1", key.replace(" ", ""))


Verdict = Literal["ok", "article", "mismatch", "missing"]


@dataclass(frozen=True)
class Result:
    row: VocabRow
    heard: str | None  # None: the clip is missing
    verdict: Verdict
    similarity: float  # 0..1 between the expected and heard sound keys

    @property
    def ok(self) -> bool:
        return self.verdict == "ok"


def compare(row: VocabRow, heard: str) -> tuple[Verdict, float]:
    """Does the transcript sound like the row's Greek?

    ``article``: the word was heard but its article wasn't (dropped, or misheard as
    "και"/"οι", which Whisper does a lot with a lone η). Worth a listen, but less
    likely to be a bad clip than a ``mismatch``.
    """
    # Whisper often writes numbers as digits ("5" for πέντε); the answers list them.
    if normalise(heard).isdigit() and normalise(heard) in row.answers:
        return "ok", 1.0
    expected, got = sound_key(row.greek), sound_key(heard)
    if got == expected:
        return "ok", 1.0
    similarity = round(difflib.SequenceMatcher(None, expected, got).ratio(), 2) if got else 0.0
    article, *rest = normalise(row.greek).split()
    if rest and article in ARTICLES and got.endswith(sound_key(" ".join(rest))):
        return "article", similarity
    return "mismatch", similarity


def check(rows: list[VocabRow], audio_dir: Path, transcriber: Transcriber, cache_path: Path) -> list[Result]:
    """Transcribe every row's clip (cached by model + clip bytes) and compare it."""
    cache: dict[str, str] = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    results = []
    todo = 0
    try:
        for n, row in enumerate(rows, start=1):
            path = audio_dir / f"{row.id}.mp3"
            if not path.exists():
                results.append(Result(row, None, "missing", 0.0))
                continue
            key = f"{transcriber.name}:{hashlib.sha256(path.read_bytes()).hexdigest()[:20]}"
            if key not in cache:
                cache[key] = transcriber.transcribe(path)
                todo += 1
                print(f"[{n:3d}/{len(rows)}] {row.id}  {row.greek} → {cache[key]}")
            results.append(Result(row, cache[key], *compare(row, cache[key])))
    finally:  # keep finished transcripts even if interrupted
        if todo:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return results


def flagged(results: list[Result]) -> list[Result]:
    """Everything not ok: missing clips, then mismatches, then article-only, each worst first."""
    order = {"missing": 0, "mismatch": 1, "article": 2}
    return sorted((r for r in results if not r.ok), key=lambda r: (order[r.verdict], r.similarity))


def summarise(flags: list[Result]) -> str:
    counts = {v: sum(r.verdict == v for r in flags) for v in ("missing", "mismatch", "article")}
    return ", ".join(f"{n} {v}" for v, n in counts.items() if n) or "none"


def build_page(results: list[Result], audio_dir: Path, out_dir: Path) -> str:
    flags = flagged(results)
    esc = html.escape
    headings = {
        "missing": "Missing clips",
        "mismatch": "Mismatches: Whisper heard a different word",
        "article": "Article only: the word was heard, its article wasn't (often Whisper mishearing a lone η)",
    }
    rows = []
    previous = None
    for r in flags:
        if r.verdict != previous:
            rows.append(f'<tr class="group"><th colspan="6">{esc(headings[r.verdict])}</th></tr>')
            previous = r.verdict
        src = Path(os.path.relpath(audio_dir / f"{r.row.id}.mp3", out_dir)).as_posix()
        player = '<td class="missing">no clip</td>' if r.heard is None else (
            f'<td><audio controls preload="none" src="{esc(src)}"></audio></td>'
        )
        sent = f"{r.row.text} · {r.row.voice} · {r.row.strategy}"
        rows.append(
            f'<tr><td class="id">{esc(r.row.id)}</td>'
            f'<td><span class="greek">{esc(r.row.greek)}</span>'
            f'<span class="english">{esc(r.row.answers[0])}</span></td>'
            f'<td class="greek">{esc(r.heard or "")}</td>'
            f'<td class="score">{r.similarity:.0%}</td>{player}'
            f'<td class="sent">{esc(sent)}</td></tr>'
        )
    summary = f"{len(flags)} of {len(results)} clips flagged ({summarise(flags)})"
    body = (
        f"<table><thead><tr><th>id</th><th>Expected</th><th>Whisper heard</th><th>Similarity</th>"
        f"<th>Clip</th><th>Sent to TTS</th></tr></thead><tbody>\n{chr(10).join(rows)}\n</tbody></table>"
        if flags else "<p>Nothing flagged.</p>"
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio QA</title>
<style>
  :root {{ color-scheme: light dark; font: 15px/1.4 system-ui, 'Segoe UI', sans-serif; }}
  body {{ margin: 0; padding: 1.5rem 1rem; }}
  h1 {{ margin: 0 0 .25rem; font-size: 1.4rem; }}
  p {{ margin: 0 0 1rem; max-width: 50rem; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #8884; padding: .4rem .5rem; text-align: left; vertical-align: middle; }}
  thead th {{ position: sticky; top: 0; background: Canvas; }}
  .greek {{ display: block; font-size: 1.1rem; }}
  .english {{ display: block; font-size: .85rem; opacity: .75; }}
  .id, .sent, .score {{ font-size: .85rem; white-space: nowrap; }}
  .sent {{ opacity: .75; }}
  .missing {{ color: #c33; }}
  audio {{ height: 2rem; width: 11rem; vertical-align: middle; }}
  tbody tr:nth-child(odd) {{ background: #8881; }}
  tr.group th {{ background: Canvas; padding-top: 1rem; font-size: 1rem; }}
</style>
</head>
<body>
<h1>Audio QA</h1>
<p>{summary}, worst first in each group. Whisper's transcript is compared with the expected
Greek by sound: accents, case, punctuation, spaces and double letters are ignored, and spellings
that sound alike count as equal (ι/η/υ/ει/οι, ο/ω, ε/αι). A flag means "listen to this", not
"this is wrong": Whisper mishears short words too, and it can't catch a wrong stress. To fix a clip, set the
row's <code>tts_text</code>, <code>voice</code> or <code>strategy</code> in <code>data/vocab.csv</code>
and re-run <code>generate</code>.</p>
{body}
<script>
  document.addEventListener('play', (e) => {{
    for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause();
  }}, true);
</script>
</body>
</html>
"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Flag clips whose Whisper transcript doesn't match the word.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--audio", type=Path, default=DEFAULT_WEB_PUBLIC / "audio")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="where to write index.html")
    parser.add_argument("--cache", type=Path, default=DEFAULT_TRANSCRIPT_CACHE)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="faster-whisper model size")
    args = parser.parse_args()

    started = time.perf_counter()
    rows = load_vocab(args.csv)
    results = check(rows, args.audio, WhisperTranscriber(args.model), args.cache)
    flags = flagged(results)

    args.out.mkdir(parents=True, exist_ok=True)
    page = args.out / "index.html"
    page.write_text(build_page(results, args.audio, args.out), encoding="utf-8")

    print(f"\n{len(flags)} of {len(results)} clips flagged: {summarise(flags)} ({time.perf_counter() - started:.0f}s)")
    for r in flags:
        heard = "(no clip)" if r.heard is None else r.heard
        print(f"  {r.verdict:8s} {r.similarity:4.0%}  {r.row.id:9s} {r.row.greek}  →  {heard}")
    print(f"listen: open {page}")


if __name__ == "__main__":
    main()
