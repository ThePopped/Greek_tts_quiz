# Vocab list

`vocab.csv` is the word list. It is edited by hand, then turned into audio and `vocab.json` by the pipeline. Save it as UTF-8. `uv run pytest` (in `pipeline/`) checks its structure.

| Column | Meaning |
|---|---|
| `id` | Stable id, `<category>-<nn>` (e.g. `food-07`). It names the audio file, so don't change it once audio exists. New words take the next free number. |
| `greek` | What is shown and spoken. |
| `english` | Accepted answers separated by `\|`. The first is shown as the main answer. |
| `category` | Groups words on the quiz's start screen. |
| `pos` | `noun`, `verb`, `adj`, `adv`, `num`, `phrase` or `question`. |
| `tts_text` | Optional: send this to the TTS engine instead of `greek` (e.g. to fix a mispronunciation). |
| `voice` | Optional: `athina` or `nestoras` (default `nestoras`). |
| `strategy` | Optional: `plain`, `punctuated` or `carrier` (default `punctuated`). |
| `notes` | Shown with the answer: gender, other spellings, related words. |

## Conventions

- Nouns: definite article + nominative singular (`το σπίτι`), so the article teaches the gender. A few plural-only words are plural (`οι γονείς`).
- Verbs: 1st person singular present (`τρώω`), the Greek dictionary form.
- Adjectives: masculine singular (`κόκκινος`).
- Answers don't need "the", "a", "to" or "I" in front: the quiz drops those before comparing, so `eat` also accepts "to eat" and "I eat". It also ignores case, accents and punctuation, and allows small typos.
- Keep commas out of fields, or wrap the field in double quotes.
