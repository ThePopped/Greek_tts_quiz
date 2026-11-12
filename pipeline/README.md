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
| `config` | Defaults chosen in the bake-off: voice **nestoras**, strategy **punctuated**. A vocab row's `voice` / `strategy` columns override them. |
| `tts` | TTS backend interface + edge-tts implementation. Returns MP3 bytes and per-word timings in seconds. Try it: `uv run python -m greek_tts.tts "Το σπίτι." --voice athina --out sample.mp3` |
| `clip` | ffmpeg post-processing: optional cut at a timestamp (with 40 ms lead-in + click-free fade), trailing-silence trim (keeps 150 ms), two-pass loudness normalisation to -18 LUFS. Try it: `uv run python -m greek_tts.clip in.mp3 out.mp3 --start 1.1` |
| `strategies` | How text is sent to the TTS engine: `plain` (as written), `punctuated` (full stop added), `carrier` (`Η λέξη είναι: …`, then cut at the target's first word). All three then go through `clip`. Try it: `uv run python -m greek_tts.strategies "το σπίτι" --strategy carrier --voice athina --out sample.mp3` |
| `bakeoff` | Renders 22 tricky items (lone articles, stress pairs like πότε/ποτέ, ϊ, questions…) with the `punctuated` and `carrier` strategies in both voices, into `bakeoff_out/index.html` (a table of audio players; open it directly in a browser). `plain` is left out because it gives the same audio as `punctuated`. Run: `uv run python -m greek_tts.bakeoff` (about 30 s) |
| `generate` | Reads `../data/vocab.csv`, applies each row's `tts_text` / `voice` / `strategy` overrides (else the `config` defaults), and writes `../web/public/audio/<id>.mp3` plus `../web/public/vocab.json`. Clips are cached in `.cache/audio/` by a hash of (text, voice, strategy), so a re-run only synthesises changed rows; clips for deleted rows are removed. Failed rows are listed, left out of `vocab.json`, and retried on the next run. Run: `uv run python -m greek_tts.generate` (about 4 min from scratch, seconds when cached; `--force` ignores the cache) |
| `qa` | Transcribes every clip with faster-whisper (`small`, CPU, `language="el"`) and compares it with the row's Greek by sound: accents, case, punctuation, spaces and double letters are ignored, spellings that sound alike count as equal (ι/η/υ/ει/οι, ο/ω, ε/αι), and digits count for numbers. Prints the flags worst first, `mismatch` (a different word heard) before `article` (the word heard but not its article) and writes `qa_out/index.html`, with a player for each flagged clip. A flag means "listen to this": Whisper also mishears short words, and it can't hear a wrong stress. Transcripts are cached in `.cache/qa.json` by clip content, so a re-run only transcribes changed clips. Run: `uv run python -m greek_tts.qa` (the first run downloads the ~500 MB model and takes about 16 min; cached re-runs take seconds) |

## Tests

```sh
uv run pytest
```
