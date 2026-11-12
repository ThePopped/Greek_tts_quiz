"""Generate the quiz's audio and word list from ``data/vocab.csv``.

For every row: pick the text, voice and strategy (the row's overrides, else the
defaults in ``config``), synthesise and process the clip (``strategies.render``),
then write ``web/public/audio/<id>.mp3``. Finally write ``web/public/vocab.json``,
the file the quiz app loads.

Clips are cached in ``pipeline/.cache/audio/`` under a hash of
(text, voice, strategy), so a re-run only synthesises rows whose settings
changed. Fixing a bad clip is: edit the row's ``tts_text`` / ``voice`` /
``strategy`` in the CSV, re-run. Bump ``CACHE_VERSION`` after changing how clips
are processed (e.g. ``clip.py`` settings) to regenerate everything.

A row that fails (after the backend's own retries) is reported and left out of
``vocab.json``, so the app never lists a word without audio; re-running retries
only the failed rows.

    uv run python -m greek_tts.generate
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from greek_tts.config import DEFAULT_STRATEGY, DEFAULT_VOICE
from greek_tts.strategies import STRATEGIES, Strategy, render
from greek_tts.tts import VOICES, EdgeTTSBackend, TTSBackend

PIPELINE_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = PIPELINE_DIR.parent
DEFAULT_CSV = REPO_DIR / "data" / "vocab.csv"
DEFAULT_WEB_PUBLIC = REPO_DIR / "web" / "public"
DEFAULT_CACHE = PIPELINE_DIR / ".cache" / "audio"

CACHE_VERSION = 1  # bump to invalidate every cached clip
CSV_COLUMNS = ["id", "greek", "english", "category", "pos", "tts_text", "voice", "strategy", "notes"]


@dataclass(frozen=True)
class VocabRow:
    id: str
    greek: str
    answers: list[str]  # accepted English answers; the first is the main one
    category: str
    pos: str
    notes: str
    text: str  # what is sent to the TTS engine (before the strategy shapes it)
    voice: str
    strategy: Strategy

    @property
    def cache_key(self) -> str:
        payload = json.dumps([CACHE_VERSION, self.text, self.voice, self.strategy], ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]

    @property
    def audio_file(self) -> str:
        return f"audio/{self.id}.mp3"


def load_vocab(path: Path) -> list[VocabRow]:
    """Read the CSV and resolve each row's overrides against the defaults."""
    with path.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != CSV_COLUMNS:
            raise ValueError(f"{path}: expected columns {CSV_COLUMNS}, got {reader.fieldnames}")
        rows = []
        for line, raw in enumerate(reader, start=2):
            if None in raw or None in raw.values():
                raise ValueError(f"{path}:{line}: wrong number of cells (stray comma?)")
            cells = {k: v.strip() for k, v in raw.items()}
            voice = cells["voice"] or DEFAULT_VOICE
            strategy = cells["strategy"] or DEFAULT_STRATEGY
            if voice not in VOICES:
                raise ValueError(f"{path}:{line}: unknown voice {voice!r}")
            if strategy not in STRATEGIES:
                raise ValueError(f"{path}:{line}: unknown strategy {strategy!r}")
            rows.append(
                VocabRow(
                    id=cells["id"],
                    greek=cells["greek"],
                    answers=[a.strip() for a in cells["english"].split("|") if a.strip()],
                    category=cells["category"],
                    pos=cells["pos"],
                    notes=cells["notes"],
                    text=cells["tts_text"] or cells["greek"],
                    voice=voice,
                    strategy=cast(Strategy, strategy),
                )
            )
    ids = [r.id for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path}: duplicate ids")
    return rows


@dataclass
class Report:
    generated: list[str] = field(default_factory=list)
    cached: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)  # id -> error
    removed: list[str] = field(default_factory=list)  # orphaned mp3s deleted from the output

    @property
    def ok_ids(self) -> set[str]:
        return set(self.generated) | set(self.cached)


async def generate_audio(
    rows: list[VocabRow],
    backend: TTSBackend,
    audio_dir: Path,
    cache_dir: Path,
    *,
    concurrency: int = 4,
    delay: float = 0.2,
    force: bool = False,
) -> Report:
    """Make sure ``audio_dir/<id>.mp3`` is up to date for every row.

    ``concurrency`` caps parallel TTS requests and each worker pauses ``delay``
    seconds after a request, to stay polite to the free edge-tts service.
    """
    audio_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    report = Report()
    semaphore = asyncio.Semaphore(concurrency)

    to_generate = []
    for row in rows:
        cached = cache_dir / f"{row.cache_key}.mp3"
        if cached.exists() and not force:
            _write_if_changed(audio_dir / f"{row.id}.mp3", cached.read_bytes())
            report.cached.append(row.id)
        else:
            to_generate.append(row)

    done = 0

    async def one(row: VocabRow) -> None:
        nonlocal done
        async with semaphore:
            try:
                clip = await render(backend, row.text, row.voice, row.strategy)
                _write_if_changed(cache_dir / f"{row.cache_key}.mp3", clip.audio)
                _write_if_changed(audio_dir / f"{row.id}.mp3", clip.audio)
                report.generated.append(row.id)
                status = "ok"
            except Exception as exc:  # noqa: BLE001 - reported at the end, other rows carry on
                report.failed[row.id] = f"{type(exc).__name__}: {exc}"
                status = "FAILED"
            done += 1
            print(f"[{done:3d}/{len(to_generate)}] {status:6s} {row.id}  {row.text} · {row.voice} · {row.strategy}")
            if delay:
                await asyncio.sleep(delay)

    await asyncio.gather(*(one(r) for r in to_generate))

    # Rows that were deleted or renamed leave orphaned clips behind.
    wanted = {f"{r.id}.mp3" for r in rows}
    for path in sorted(audio_dir.glob("*.mp3")):
        if path.name not in wanted:
            path.unlink()
            report.removed.append(path.name)
    # A failed row must not keep a stale clip from an earlier run.
    for row_id in report.failed:
        (audio_dir / f"{row_id}.mp3").unlink(missing_ok=True)

    return report


def build_vocab_json(rows: list[VocabRow], ok_ids: set[str]) -> dict[str, Any]:
    """The quiz app's data: categories in CSV order, then one entry per word with audio."""
    words = [
        {
            "id": r.id,
            "greek": r.greek,
            "answers": r.answers,
            "category": r.category,
            "pos": r.pos,
            "notes": r.notes,
            "audio": r.audio_file,
        }
        for r in rows
        if r.id in ok_ids
    ]
    categories = list(dict.fromkeys(w["category"] for w in words))
    return {"categories": categories, "words": words}


def _write_if_changed(path: Path, data: bytes) -> None:
    """Write ``data`` unless the file already holds exactly that (keeps git and mtimes quiet)."""
    if path.exists() and path.read_bytes() == data:
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Generate quiz audio and vocab.json from the CSV.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_WEB_PUBLIC, help="web/public directory")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--concurrency", type=int, default=4, help="parallel TTS requests")
    parser.add_argument("--delay", type=float, default=0.2, help="pause after each request (seconds)")
    parser.add_argument("--force", action="store_true", help="ignore the cache and regenerate every clip")
    args = parser.parse_args()

    started = time.perf_counter()
    rows = load_vocab(args.csv)
    report = asyncio.run(
        generate_audio(
            rows,
            EdgeTTSBackend(),
            args.out / "audio",
            args.cache,
            concurrency=args.concurrency,
            delay=args.delay,
            force=args.force,
        )
    )
    vocab = build_vocab_json(rows, report.ok_ids)
    out_json = args.out / "vocab.json"
    _write_if_changed(out_json, (json.dumps(vocab, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    print(
        f"{len(rows)} rows: {len(report.generated)} generated, {len(report.cached)} cached, "
        f"{len(report.failed)} failed, {len(report.removed)} orphaned clips removed "
        f"({time.perf_counter() - started:.0f}s)"
    )
    print(f"wrote {out_json} ({len(vocab['words'])} words)")
    if report.failed:
        print("\nFailed rows (left out of vocab.json; re-run to retry just these):")
        for row_id, error in report.failed.items():
            print(f"  {row_id}: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
