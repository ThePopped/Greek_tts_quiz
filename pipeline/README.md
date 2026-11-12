# greek-tts pipeline

Offline build step: reads `../data/vocab.csv`, generates Greek audio with edge-tts, clips and normalises it with ffmpeg, writes the MP3s and `vocab.json` into `../web/public/`, and runs a Whisper check to flag bad clips.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and `ffmpeg` on PATH. uv installs Python 3.12 and the dependencies:

```sh
cd pipeline
uv sync
```

Modules are run with `uv run python -m greek_tts.<module>` (added as they are built).

| Module | What it does |
|---|---|
| `tts` | TTS backend interface + edge-tts implementation. Returns MP3 bytes and per-word timings in seconds. Try it: `uv run python -m greek_tts.tts "Το σπίτι." --voice athina --out sample.mp3` |
| `clip` | ffmpeg post-processing: optional cut at a timestamp (with 40 ms lead-in + click-free fade), trailing-silence trim (keeps 150 ms), two-pass loudness normalisation to -18 LUFS. Try it: `uv run python -m greek_tts.clip in.mp3 out.mp3 --start 1.1` |
| `strategies` | How text is sent to the TTS engine: `plain` (as written), `punctuated` (full stop added), `carrier` (`Η λέξη είναι: …`, then cut at the target's first word). All three then go through `clip`. Try it: `uv run python -m greek_tts.strategies "το σπίτι" --strategy carrier --voice athina --out sample.mp3` |

## Tests

```sh
uv run pytest
```
