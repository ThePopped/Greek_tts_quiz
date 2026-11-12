"""Bake-off: render tricky items with every strategy and voice, side by side.

Writes ``bakeoff_out/index.html`` (a table of audio players, one row per item,
one column per strategy × voice) plus the clips in ``bakeoff_out/audio/``.
Open the page in a browser, listen, and pick the default strategy and voice.

    uv run python -m greek_tts.bakeoff
"""

from __future__ import annotations

import argparse
import asyncio
import html
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from greek_tts.clip import duration
from greek_tts.strategies import Strategy, build_tts_text, render
from greek_tts.tts import VOICES, EdgeTTSBackend, TTSBackend

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "bakeoff_out"

# "plain" is left out: edge-tts gives the same audio for "πότε" and "πότε."
# (measured: the difference is no bigger than between two runs of the same text),
# so a plain column would only duplicate the punctuated one.
BAKEOFF_STRATEGIES: tuple[Strategy, ...] = ("punctuated", "carrier")


@dataclass(frozen=True)
class Item:
    greek: str
    english: str
    why: str  # what makes it a hard case for TTS


ITEMS: list[Item] = [
    Item("ο σκύλος", "the dog", "masculine article ο: a lone vowel"),
    Item("η γάτα", "the cat", "feminine article η: a lone vowel"),
    Item("το νερό", "the water", "two short syllables, final stress"),
    Item("και", "and", "unstressed function word on its own"),
    Item("πότε", "when", "stress pair with ποτέ"),
    Item("ποτέ", "never", "stress pair with πότε"),
    Item("ναι", "yes", "one syllable; sounds like English 'neh'"),
    Item("όχι", "no", "short two-syllable word"),
    Item("το ρολόι", "the clock", "ό-ι: two vowels pronounced separately"),
    Item("το τσάι", "the tea", "ά-ι: two vowels pronounced separately"),
    Item("το προϊόν", "the product", "diaeresis ϊ"),
    Item("τρώω", "I eat", "verb, double vowel ωω"),
    Item("είμαι", "I am", "verb, digraphs ει and αι"),
    Item("οι γονείς", "the parents", "plural article οι"),
    Item("ένα", "one", "number; also the article 'a'"),
    Item("δεκαεννέα", "nineteen", "long compound number"),
    Item("κόκκινος", "red", "adjective, double κκ"),
    Item("η Τετάρτη", "Wednesday", "capitalised day name"),
    Item("καλημέρα", "good morning", "greeting, usually said with feeling"),
    Item("ευχαριστώ", "thank you", "ευ digraph, final stress"),
    Item("τι κάνεις;", "how are you?", "question intonation"),
    Item("πού είναι η τουαλέτα;", "where is the toilet?", "longer question"),
]


@dataclass(frozen=True)
class Cell:
    item_index: int
    strategy: Strategy
    voice: str
    tts_text: str
    file: str | None  # path relative to the page, None if rendering failed
    seconds: float | None
    error: str | None


def cell_file(item_index: int, strategy: str, voice: str) -> str:
    return f"audio/{item_index + 1:02d}_{strategy}_{voice}.mp3"


async def run_bakeoff(
    backend: TTSBackend,
    items: list[Item],
    voices: list[str],
    strategies: tuple[Strategy, ...],
    out_dir: Path,
    concurrency: int = 4,
) -> list[Cell]:
    """Render every item × strategy × voice into ``out_dir/audio``.

    A failure in one cell is recorded on the page rather than aborting the run.
    """
    (out_dir / "audio").mkdir(parents=True, exist_ok=True)
    for stale in (out_dir / "audio").glob("*.mp3"):
        stale.unlink()
    semaphore = asyncio.Semaphore(concurrency)
    jobs = [(i, s, v) for i in range(len(items)) for v in voices for s in strategies]
    done = 0

    async def one(i: int, strategy: Strategy, voice: str) -> Cell:
        nonlocal done
        text = items[i].greek
        async with semaphore:
            try:
                clip = await render(backend, text, voice, strategy)
                rel = cell_file(i, strategy, voice)
                (out_dir / rel).write_bytes(clip.audio)
                seconds = await asyncio.to_thread(duration, clip.audio)
                cell = Cell(i, strategy, voice, clip.tts_text, rel, seconds, None)
            except Exception as exc:  # noqa: BLE001 - shown on the page instead
                tts_text = build_tts_text(text, strategy)
                cell = Cell(i, strategy, voice, tts_text, None, None, f"{type(exc).__name__}: {exc}")
        done += 1
        status = "FAILED" if cell.error else "ok"
        print(f"[{done:3d}/{len(jobs)}] {status:6s} {text} · {strategy} · {voice}")
        return cell

    return await asyncio.gather(*(one(i, s, v) for i, s, v in jobs))


def build_page(items: list[Item], cells: list[Cell], voices: list[str], strategies: tuple[Strategy, ...]) -> str:
    by_key = {(c.item_index, c.strategy, c.voice): c for c in cells}
    columns = [(v, s) for v in voices for s in strategies]
    esc = html.escape

    head_voices = "".join(
        f'<th colspan="{len(strategies)}" class="voice">{esc(v)}</th>' for v in voices
    )
    head_strategies = "".join(f"<th>{esc(s)}</th>" for _v, s in columns)

    rows = []
    for i, item in enumerate(items):
        tds = []
        for v, s in columns:
            cell = by_key.get((i, s, v))
            if cell is None:
                tds.append("<td></td>")
            elif cell.file is None:
                tds.append(f'<td class="error" title="{esc(cell.tts_text)}">{esc(cell.error or "")}</td>')
            else:
                tds.append(
                    f'<td title="sent: {esc(cell.tts_text)}">'
                    f'<audio controls preload="none" src="{esc(cell.file)}"></audio>'
                    f'<span class="secs">{cell.seconds:.2f}s</span></td>'
                )
        rows.append(
            f'<tr><th class="item"><span class="greek">{esc(item.greek)}</span>'
            f'<span class="english">{esc(item.english)}</span>'
            f'<span class="why">{esc(item.why)}</span></th>{"".join(tds)}</tr>'
        )

    failures = sum(1 for c in cells if c.error)
    summary = f"{len(items)} items × {len(strategies)} strategies × {len(voices)} voices"
    if failures:
        summary += f" · <strong>{failures} failed</strong>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS bake-off</title>
<style>
  :root {{ color-scheme: light dark; font: 15px/1.4 system-ui, 'Segoe UI', sans-serif; }}
  body {{ margin: 0; padding: 1.5rem 1rem; }}
  h1 {{ margin: 0 0 .25rem; font-size: 1.4rem; }}
  p {{ margin: 0 0 1rem; max-width: 50rem; }}
  .wrap {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #8884; padding: .4rem .5rem; vertical-align: middle; }}
  thead th {{ position: sticky; top: 0; background: Canvas; }}
  th.voice {{ text-transform: capitalize; }}
  th.item {{ text-align: left; min-width: 11rem; }}
  .greek {{ display: block; font-size: 1.15rem; }}
  .english, .why {{ display: block; font-weight: normal; font-size: .85rem; opacity: .75; }}
  .why {{ font-style: italic; }}
  td {{ white-space: nowrap; }}
  audio {{ height: 2rem; width: 11rem; vertical-align: middle; }}
  .secs {{ font-size: .8rem; opacity: .7; margin-left: .3rem; }}
  td.error {{ color: #c33; white-space: normal; max-width: 14rem; font-size: .8rem; }}
  tbody tr:nth-child(odd) {{ background: #8881; }}
</style>
</head>
<body>
<h1>TTS bake-off</h1>
<p>{summary}. <b>punctuated</b> sends the item with a full stop (<i>το σπίτι.</i>),
<b>carrier</b> sends <i>Η λέξη είναι: το σπίτι.</i> and cuts just before the target.
Sending the item without punctuation gives the same audio as punctuated, so it isn't shown.
Hover a player to see the exact text sent. Starting one player stops the others.</p>
<div class="wrap">
<table>
<thead>
<tr><th rowspan="2">Item</th>{head_voices}</tr>
<tr>{head_strategies}</tr>
</thead>
<tbody>
{chr(10).join(rows)}
</tbody>
</table>
</div>
<script>
  // Only one clip plays at a time, so quick comparisons don't overlap.
  document.addEventListener('play', (e) => {{
    for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause();
  }}, true);
</script>
</body>
</html>
"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Render the TTS comparison page.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--concurrency", type=int, default=4, help="parallel TTS requests")
    args = parser.parse_args()

    voices = sorted(VOICES)
    started = time.perf_counter()
    cells = asyncio.run(
        run_bakeoff(EdgeTTSBackend(), ITEMS, voices, BAKEOFF_STRATEGIES, args.out, args.concurrency)
    )
    page = args.out / "index.html"
    page.write_text(build_page(ITEMS, cells, voices, BAKEOFF_STRATEGIES), encoding="utf-8")
    failures = sum(1 for c in cells if c.error)
    print(f"{len(cells) - failures}/{len(cells)} clips in {time.perf_counter() - started:.0f}s")
    print(f"open {page}")


if __name__ == "__main__":
    main()
