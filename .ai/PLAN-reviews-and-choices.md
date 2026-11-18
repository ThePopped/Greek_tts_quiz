# Learn mode: daily reviews and tap-to-answer

## Context
Learn mode (step 26 in `PLAN.md`) spaces words by number of answers, not by day. A mastered word stays mastered forever, even after a month away, and there's no "what should I do today". New words are typed from the first time they're heard, which is slow on a phone and discouraging at the start. This plan adds two things:
- **Daily reviews:** each word gets a due date that moves further out with each right answer. The start screen shows "12 words due today", and sessions go to the words that are due.
- **Tap-to-answer:** words in *learning* are asked as 4 choices. Once *familiar*, they're typed. Recognising comes first, then recalling.

Same convention as `PLAN.md`: one step at a time, update its status, commit each finished step on its own. Run tests from PowerShell (see step 19).

**Decided with the user:**
- Fixed gaps, not FSRS. They build on the existing streak and boxes and need no new dependency.
- Reviews are **learn mode only**. Due dates belong to the learn set's words. Category and custom-list sessions don't read or change them; they only update the % stats, as now. Learn mode is the daily routine, and the other modes are free practice.
- Choices only in learn mode. Category and custom-list sessions stay typed.
- Choice answers move words between learn boxes but are **not** recorded in the per-word `{seen, correct}` stats, so the start screen's % still means "can recall it".
- New words are added only when nothing is in learning **and** no reviews are due (plus the existing 85% accuracy rule). This stops reviews piling up.

## Phase 10: Daily reviews

27. `[done]` Due dates in `learn.ts` and `storage.ts` (pure, tested).
    - `LearnEntry` gains `due` (ms since epoch, local midnight of the day it's next due; 0 = due now).
    - `INTERVAL_DAYS` constant, indexed by the streak after a right answer: streak 0–1 → 0 (learning words are always due), 2 → 1 day, 3 → 3, 4 → 7, 5 → 16, 6 → 35, 7 → 70, then 120 (cap). Use local calendar days (`setDate`, so DST is safe).
    - `recordLearnAnswer`: a right answer to a due word does streak + 1 and `due = today + INTERVAL_DAYS[streak]`. A right answer to a word that **wasn't** due (extra practice) only updates `lastSeen`, so cramming doesn't push gaps out. A wrong answer sets streak 0 and `due` 0, as now.
    - `isDue(entry, now)` = `entry.due <= now`. `learnProgress` gains `due` (familiar and mastered words due now) and `nextDue` (the next day anything falls due, and how many words).
    - Unlock gets a new `{ kind: 'due'; count }` state, checked after `learning` and before `accuracy`. New words come in only when learning is empty, nothing is due, and accuracy is ≥ 85%.
    - `pickLearnSession` replaces the 40/40/20 `MIX`. In order: learning words (shortest streak, then newest, first) up to `LEARNING_SHARE` (0.5) of the session; then due reviews, most overdue first (ties: longest unseen); then any places still free, first learning words, then extra practice (not-yet-due words, soonest due first). Each word still comes up once at most, and the order is shuffled. Mastered words now come back when due, not as random spot-checks.
    - `storage.ts`: `isLearnEntry` accepts entries with no `due` (saved before this step) and gives them `due = startOfDay(lastSeen) + INTERVAL_DAYS[streak]` (0 if never seen), so existing sets are spread out, not all due at once.
    - Tests: the gap sequence, wrong resets, a not-due right answer doesn't advance, the session order (learning, then overdue, then extra), the `due` unlock state, migration of old entries, a day boundary at local midnight (pass `now` in).
    *Result:* `learn.ts` gains `INTERVAL_DAYS`, `LEARNING_SHARE`, `startOfDay`, `addDays`, `intervalDays`, `dueAfter`, `isDue` and `migratedDue`; `MIX` is gone. `learnProgress` and `pickLearnSession` now take `now` (callers in `start.ts` and `main.ts` pass `Date.now()`; the start screen reads the same time for `prepareSession` and the pick). `learnProgress` also returns `due` and `nextDue` (only set when nothing is due), ready for step 28. `unlockText` already has the `due` wording ("New words unlock once today’s 5 reviews are done."), because the switch must cover every kind, so the start screen shows it now. Everything else on screen is unchanged until step 28. Saved entries without `due` get one from `migratedDue`; a saved `due` that isn't a number ≥ 0 makes the entry malformed, so it's skipped. One thing to know about migration: streaks earned under the old rules (several right answers in one day) keep their length, so a word already at 5 in a row is first due 16 days after it was last answered. Checked in the browser with a set saved in the old format: it loaded, words last seen 2 days ago with streak 2 were due (overdue since yesterday), streak-3 words last seen today were due in 3 days, and a wrong answer reset its word to streak 0, due now. No console errors. Tests 144/144, `tsc` and the build are clean.

28. `[not started]` Show the schedule on the start screen and summary.
    - Learn panel headline: "12 words due today", or "All caught up. Next: 4 words tomorrow" / "… in 3 days". The box tiles stay.
    - The word list's per-word line adds when it's due ("due today", "in 3 days") next to the streak.
    - Footer: "10 questions: 3 learning, 7 reviews". When nothing is due: "Nothing due: 10 questions of extra practice."
    - `unlockText` for `due`: "New words unlock once today's 5 reviews are done."
    - The learn session's summary adds "5 still due today" or "All caught up for today".
    - Check in the browser at 400px, light and dark, with a seeded set (some overdue, some due later). Use a fake clock (`Date.now` override in Playwright) to step forward a day and see words fall due.

## Phase 11: Tap-to-answer for new words

29. `[not started]` Choice options: new `choices.ts` (pure, tested).
    - `pickChoices(word, words, random)` → 4 options in random order, plus which one is right. The right option is `word.answers[0]`. The other three are other words' `answers[0]`: same category first, then same `pos`, then any.
    - Skip any word whose answers overlap the target's after `clean()` from `grading.ts` (e.g. γεια σου / γεια σας both mean "hello"). Remove duplicate options after `clean()` too.
    - Tests: always 4 distinct options with exactly one right one; no option overlaps the target's answers; same category is preferred; a tiny category falls back to other words.

30. `[not started]` Choice questions in the quiz, used by learn mode.
    - `QuizHandlers` gains an optional `askAs(word): 'type' | 'choice'` (default `'type'`), read when each word is shown. `main.ts` passes it for learn sessions and their retries: a word in the learning box → `'choice'`.
    - Choice layout: the answer box is hidden and the phone keyboard doesn't open. 4 large buttons in a 2×2 grid (at least 44px tall, long answers wrap). Keys 1–4 pick, and "Don't know" stays. After a pick, the right option goes green, a wrong pick goes red, and the same feedback panel appears (verdict, Greek, all answers, notes). A primary Next button gets focus, so Enter moves on. Replay (▶, Ctrl+Space, ↑) works as now.
    - Outcomes stay `correct` / `wrong` / `dont-know` (no typos with choices). `WordResult` gains `asked: 'type' | 'choice'`, and `typed` holds the option picked.
    - Stats: `quiz.ts` calls `store.record` only for typed answers. `onResult` still runs for both kinds, so learn boxes, streaks, due dates and recent accuracy all count choice answers. The in-session score counts both.
    - Summary: missed choice words say "You chose “goodbye”".
    - Check in the browser at 400×800, 400×440 and 1280×800, light and dark: a fresh learn set is all choices; a word right twice switches to typing; a typed miss goes back to choices; category sessions are unchanged; the % stats don't move for choice answers. No horizontal scroll, no console errors.

31. `[not started]` **Checkpoint:** the user's brother uses it for about a week. Then tune `INTERVAL_DAYS`, `LEARNING_SHARE`, `FAMILIAR_AT` (when typing starts) and `BATCH_SIZE` from how it felt: too many reviews per day, or new words coming too slowly or too fast.

## Verification
- `npm test` (from PowerShell) after each step. New tests in `learn.test.ts`, `storage.test.ts`, `choices.test.ts`, `quiz.test.ts`.
- Steps 28 and 30: `npm run dev` and the Playwright MCP, as described in each step.
- After deploy: on a phone, a new learn set opens with choice buttons and no keyboard, and the next day the start screen shows words due.
