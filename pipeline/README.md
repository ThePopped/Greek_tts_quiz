# greek-tts pipeline

Offline build step: reads `../data/vocab.csv`, generates Greek audio with edge-tts, clips and normalises it with ffmpeg, writes the MP3s and `vocab.json` into `../web/public/`, and runs a Whisper check to flag bad clips.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and `ffmpeg` on PATH. uv installs Python 3.12 and the dependencies:

```sh
cd pipeline
uv sync
```

Modules are run with `uv run python -m greek_tts.<module>` (added as they are built).
