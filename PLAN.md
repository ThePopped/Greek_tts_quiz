# Greek Vocab Listening Quiz: Plan

## Context
This is a personal app for learning Greek. It plays a Greek word aloud and you type the English meaning. All audio is generated ahead of time and stored, so nothing is generated live. The main technical uncertainty is whether TTS sounds right on single words or article + noun, so the plan settles that with a listening comparison before building the full pipeline. Decisions already made with the user:
- **TTS:** edge-tts first (the Azure voices Athina and Nestoras), with Azure as the official fallback.
- **Grading:** each word has a list of accepted answers, drafted by Claude Code and checked by the user. Input is cleaned up before comparing, small typos are accepted, and there is an "I was right" button.
- **Build step:** Python. The front end is a static site with progress saved in the browser. It works on phone and desktop, and offline support is not needed.
- **Not in v1:** spaced repetition, English → Greek direction, grammar content.
- **Budget:** a few pounds a month is fine, and an Azure or Google account is fine.

The project folder is empty. Tools available: Python 3.14, uv 0.10, Node 22, ffmpeg, git.

## Repository layout
```
Greek_tts_quiz/
  data/vocab.csv                 # the word list (edited by hand, Claude-drafted)
  pipeline/                      # Python (uv project, pinned to Python 3.12 for faster-whisper wheels)
    pyproject.toml               # edge-tts, faster-whisper; ffmpeg via subprocess (no pydub: audioop was removed in 3.13)
    src/greek_tts/
      tts.py                     # TTS backend interface + EdgeTTSBackend (AzureBackend later, same interface)
      clip.py                    # clip using word-boundary times, trim, fade, loudness-normalise (ffmpeg)
      strategies.py              # how the text is sent: plain / punctuated / carrier-sentence + clip
      bakeoff.py                 # comparison: tricky words × strategies × voices → listening page
      generate.py                # CSV → audio/*.mp3 + vocab.json (cached, only regenerates changed rows)
      qa.py                      # Whisper (language="el") round-trip check → list of flagged words
  web/                           # Vite + vanilla TypeScript (no framework needed)
    public/audio/<id>.mp3, public/vocab.json   # pipeline output
    src/grading.ts (+ grading.test.ts, Vitest)
    src/quiz.ts, src/storage.ts, src/main.ts, index.html, style.css
  .github/workflows/deploy.yml   # build web/ and deploy to GitHub Pages
```

## Data format: `data/vocab.csv`
Columns: `id, greek, english, category, pos, tts_text, voice, strategy, notes`
- `english` holds the accepted answers separated by `|`, e.g. `house|home`. For verbs: `eat|to eat|I eat`.
- `tts_text`, `voice`, `strategy` are optional per-word overrides, used to fix individual bad clips.
- **Beginner conventions:** nouns with the definite article in nominative singular (`το σπίτι`), which teaches gender. Verbs in 1st person singular present (`τρώω`), the Greek dictionary form. Adjectives in masculine form. Plus set phrases (`καλημέρα`, `ευχαριστώ`).
- **First deck:** about 300 items in themed categories: greetings & phrases, numbers 1–20, family, food & drink, home, colours, days/time, common verbs, common adjectives, places/transport, question words. Claude drafts the list and accepted answers; the user checks them.

## Implementation steps
Status key: `[not started]` · `[in progress]` · `[done]`. The status is updated as each step is completed.

**Convention:** when a step is finished (tests pass, status set to `[done]`), commit it straight away as its own commit. Commit messages are clear and concise: an imperative subject line of no more than about 60 characters that says what the step added (e.g. `Add ffmpeg clip processing: cut, trim, normalise`), then, if useful, a short body saying why or noting non-obvious decisions.

### Phase 1: Scaffold
1. `[done]` `git init`, a `.gitignore` (Python venv, node_modules, `pipeline/bakeoff_out/`, `pipeline/.cache/`), and a short README.
2. `[done]` Set up `pipeline/` as a uv project pinned to Python 3.12, with `edge-tts` and `faster-whisper` as dependencies. Check that `uv run python -c "import edge_tts"` works.
3. `[done]` Set up `web/` with Vite (vanilla-ts template) and add Vitest. Check that `npm run dev` serves the default page.

### Phase 2: TTS comparison (checkpoint with the user)
4. `[done]` `tts.py`: a `TTSBackend` interface (`synthesize(text, voice) -> (mp3_bytes, word_boundaries)`) and `EdgeTTSBackend`. Pass `boundary="WordBoundary"` and convert offsets to seconds. Confirm the units (expected 100-ns ticks) against a test clip.
5. `[done]` `clip.py`: ffmpeg helpers to cut from a timestamp (minus about 40 ms padding, 10 ms fade-in), trim leading/trailing silence, and normalise loudness (`loudnorm`).
6. `[done]` `strategies.py`: three ways of sending text: `plain` (as-is), `punctuated` (`Το σπίτι.`), `carrier` (`Η λέξη είναι: Το σπίτι.` → clip at the target's first word boundary).
7. `[done]` `bakeoff.py`: about 20 tricky items (ο/η/το, και, πότε/ποτέ, words with ϊ, verbs, phrases) × 3 ways × 2 voices (Athina, Nestoras) → `pipeline/bakeoff_out/index.html`, a table of audio players. *Finding:* `plain` gives the same audio as `punctuated` (edge-tts treats unpunctuated text as a finished sentence), so the page compares only `punctuated` and `carrier`: 22 items × 2 × 2 = 88 clips.
8. `[done]` **Checkpoint:** the user listens and picks the default way and voice. Record the choice in the pipeline config. *Decision:* voice **Nestoras**, strategy **punctuated** (`pipeline/src/greek_tts/config.py`). All 22 items sounded right in both voices and both strategies, and the user couldn't hear a difference between punctuated and carrier, so the simpler one (no cut) won. Carrier stays available as a per-word override.

### Phase 3: Vocab list
9. `[done]` Claude drafts `data/vocab.csv` (about 300 rows, the categories above) with accepted answers, following the beginner conventions. *Result:* 374 rows over the 11 categories (numbers also cover 0 and the tens to 100). Column meanings and conventions are in `data/README.md`; `pipeline/tests/test_vocab_csv.py` checks the structure (cell count, unique ids and Greek, clean answers, valid pos/voice/strategy).
10. `[done]` **Checkpoint:** the user reviews and edits the CSV. *Result:* approved as drafted (374 rows, no changes).

### Phase 4: Full audio generation + QA
11. `[done]` `generate.py`: read the CSV, apply each row's overrides or the defaults, synthesise, clip and normalise, then write `web/public/audio/<id>.mp3` and `web/public/vocab.json`. Cache keyed on a hash of (text, voice, strategy), with light throttling and retry. *Result:* all 374 clips generated in about 4 min with no failures (4 MB in total). A re-run synthesises nothing and takes 3 s. `vocab.json` lists the categories in CSV order, then the words (`id, greek, answers[], category, pos, notes, audio`). The audio is committed because the deploy workflow doesn't run the pipeline.
12. `[done]` `qa.py`: run faster-whisper (`small`, CPU, `language="el"`) on every clip. Compare after stripping accents and lowercasing, and print the words that don't match. *Result:* the plain accent/case comparison flagged 142 of 374, mostly spelling noise (Whisper writes Πήνο for πίνω), so clips are compared by sound: same-sounding spellings (ι/η/υ/ει/οι, ο/ω, ε/αι), double letters and spaces are ignored, and digits count for numbers. That leaves **72 flagged: 57 `mismatch`, 15 `article`** (word heard, article not: usually a lone η heard as "και"). Many top mismatches are Whisper switching to English on short clips ("Yes sirs." for γεια σας), so a flag means "listen", not "broken"; stress errors (πότε/ποτέ) can't be caught. The flagged list with players is at `pipeline/qa_out/index.html`. The first run takes about 16 min on CPU; transcripts are cached by clip content. Audio is decoded with ffmpeg rather than faster-whisper's PyAV path, which breaks with PyAV 19.
13. `[done]` **Checkpoint:** the user listens to the flagged clips and fixes them through the CSV overrides. Re-run `generate.py` (only changed rows regenerate). *Result:* of the 72 flagged clips only adj-36 (κλειστός) was actually mispronounced; the other 71 were Whisper mishearing. Re-rendering it with the same settings gave the same bad audio, so it now uses the `carrier` strategy (still Nestoras), which Whisper hears correctly.

### Phase 5: Quiz web app
14. `[done]` `grading.ts` + `grading.test.ts`:
    - Cleanup: NFKD + strip diacritics, lowercase, strip punctuation, collapse spaces, drop leading `the|a|an|to|i`.
    - Exact match against the cleaned accepted answers → `correct`.
    - Otherwise, Damerau-Levenshtein ≤1 (answer ≤5 chars) or ≤2 (longer) → `typo`.
    - Otherwise → `wrong`.
    *Result:* `grade(input, answers)` returns the verdict plus the matched (or closest) answer, for the feedback panel. One change from the above: answers of 3 letters or fewer and answers with digits must match exactly, because one edit turns `bad` into `sad` or `5` into `6` (101 of the 656 answers). Apostrophes are dropped (`don't` → `dont`) and other punctuation becomes a space.
15. `[done]` `storage.ts`: per-word `{seen, correct, lastSeen}` and user-added accepted answers in localStorage, wrapped in try/catch.
    *Result:* `store.record(id, wasCorrect)`, `store.addAnswer(id, answer)` and `store.acceptedAnswers(word)` (vocab answers plus added ones, to pass to `grade`). Data is read once and kept in memory, so if localStorage is blocked or full the quiz still works for the session and just forgets afterwards. Corrupt or malformed saved entries are skipped.
16. `[done]` Start screen: load `vocab.json`, choose categories and the number of questions (10/20/all), then start.
    *Result:* `vocab.ts` loads and checks `vocab.json` (fetched relative to Vite's base URL, so it works under the Pages sub-path) and `pickWords` draws a shuffled set from the chosen categories. `start.ts` shows one checkbox per category with its word count, select all/none, 10/20/All, and a live "N questions from M words" line; Start is disabled when nothing is ticked. The last choice is remembered in localStorage (`store.startChoice()`), and categories that no longer exist are dropped. Start currently leads to a placeholder screen until step 17.
17. `[done]` Quiz screen: a large ▶ button (the first tap unlocks audio on iOS, after which each new word plays automatically). Replay with Ctrl+Space / ↑ or a tap. Text input where Enter submits.
    *Result:* `quiz.ts` reuses one `<audio>` element for the whole session. The first word plays straight away, because the Start tap counts as a gesture. If the browser still blocks it, the ▶ button pulses with "Tap ▶ to listen", and once one play is allowed the rest play automatically. Enter on an empty box is ignored. The screen shows "Word n of N" and a Quit button, and leaving it stops the audio and removes the key listeners. The input has autocorrect, autocapitalise and spellcheck off, so the phone doesn't "fix" answers. Submitting goes through an `onSubmit(word, typed, next)` hook, which for now moves straight on. Step 18 puts grading and feedback there, and a placeholder "Session done" screen stands in for step 19.
18. `[not started]` Feedback panel: correct / typo (shows the correct spelling) / wrong. Shows the Greek text and all accepted answers, an "I was right" button (which saves the answer as accepted), and Enter to go to the next word. A word's result is final, and saved with `store.record`, only when you move on, so "I was right" can turn a wrong answer into a right one first. A running score for the session (e.g. `7 ✓ 2 ✗`) sits in a corner of the quiz screen. Typos count as right, it updates as each result is final, and it starts at zero each session (including "retry missed"). The saved per-word stats keep adding up across sessions.
19. `[not started]` End-of-session summary: score, list of missed words, "retry missed".
20. `[not started]` Responsive, mobile-first styling (works at about 400px width and on desktop).

### Phase 6: Deploy
21. `[not started]` `.github/workflows/deploy.yml`: build `web/` and deploy to GitHub Pages (set Vite `base` to the repo name). The free plan needs a public repo; Netlify is the alternative if it should stay private.
22. `[not started]` **Checkpoint:** the user creates the GitHub repo and pushes. Check the live URL on a phone.

## Verification
- Step 7: `uv run python -m greek_tts.bakeoff` produces a playable comparison page.
- Steps 11–12: every CSV row has an mp3 and a `vocab.json` entry, and the QA flagged list has been reviewed.
- Step 14: `npm test` covers `"The House"`→correct, `"hous"`→typo, `"to eat"`/`"I eat"`→correct, accented input stripped, `"car"` for σπίτι→wrong.
- Steps 16–20: `npm run dev`, then use the Playwright MCP to check the full quiz flow at desktop and 400px width: play, type, submit, feedback, "I was right", summary, retry.
- Step 22: on the live Pages URL on a phone, audio plays after the first tap.

## Deferred (after v1)
Spaced repetition (FSRS, built on the stored per-word stats), the Azure backend if edge-tts becomes unreliable, grammar/sentence exercises.
