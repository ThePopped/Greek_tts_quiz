# Greek TTS Quiz

A personal listening quiz for Greek vocabulary: the app plays a Greek word aloud and you type the English meaning.

All audio is generated ahead of time by a Python pipeline and served as static files, so the app has no backend.

## Layout

| Path | What it is |
|---|---|
| `PLAN.md` | Build plan: 22 steps with statuses |
| `data/vocab.csv` | The word list: Greek, accepted English answers, category, optional TTS overrides |
| `pipeline/` | Python (uv) build step: TTS → clipped/normalised MP3s + `vocab.json`, plus a Whisper QA check |
| `web/` | Vite + TypeScript static quiz app, deployed to GitHub Pages |

## Status

Audio for the full 374-word list is generated (`web/public/audio/`, `web/public/vocab.json`). Next: the Whisper QA check, then the quiz app. See `PLAN.md`.
