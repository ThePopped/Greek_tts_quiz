// Progress shown on the start screen, worked out from the saved per-word
// results. A category's numbers pool every answer to its words, however the
// session was chosen (a custom-list answer counts toward the word's own category).

import type { WordStats } from './storage'
import type { Word } from './vocab'

/** Answers given and how many were right. */
export interface Tally {
  seen: number
  correct: number
}

const NONE: Tally = { seen: 0, correct: 0 }

/** One word's tally (zero if it has never been answered). */
export function wordTally(stats: Readonly<Record<string, WordStats>>, id: string): Tally {
  const s = stats[id]
  return s ? { seen: s.seen, correct: s.correct } : { ...NONE }
}

/** Each category's pooled tally, for every category that has words. */
export function categoryTallies(
  words: readonly Word[],
  stats: Readonly<Record<string, WordStats>>,
): Map<string, Tally> {
  const out = new Map<string, Tally>()
  for (const w of words) {
    const t = out.get(w.category) ?? { ...NONE }
    const s = stats[w.id]
    if (s) {
      t.seen += s.seen
      t.correct += s.correct
    }
    out.set(w.category, t)
  }
  return out
}

/**
 * Whole-number percentage right, or undefined if nothing has been answered.
 * Only all-right shows 100% and only none-right shows 0%, so rounding never
 * hides a miss or a hit.
 */
export function percentRight({ seen, correct }: Tally): number | undefined {
  if (seen <= 0) return undefined
  const p = Math.round((correct / seen) * 100)
  if (correct >= seen) return 100
  if (correct <= 0) return 0
  return Math.min(99, Math.max(1, p))
}

/** The short label: "3 of 4 right", or "new". */
export function rightText({ seen, correct }: Tally): string {
  return seen > 0 ? `${correct} of ${seen} right` : 'new'
}

/** The percentage label: "78%", or "new". */
export function percentText(t: Tally): string {
  const p = percentRight(t)
  return p === undefined ? 'new' : `${p}%`
}

/** What a screen reader hears: "Answered correctly 3 of 4 times", or "Not answered yet". */
export function spokenText({ seen, correct }: Tally): string {
  return seen > 0 ? `Answered correctly ${correct} of ${seen} ${seen === 1 ? 'time' : 'times'}` : 'Not answered yet'
}

/**
 * The tint for a percentage, as a CSS colour: red at 0, amber at 50, green at
 * 100, blended in between. Uses the theme's colour tokens, so it follows dark mode.
 */
export function toneColor(percent: number): string {
  const p = Math.min(100, Math.max(0, percent))
  return p < 50
    ? `color-mix(in oklab, var(--warn) ${p * 2}%, var(--wrong))`
    : `color-mix(in oklab, var(--right) ${(p - 50) * 2}%, var(--warn))`
}
