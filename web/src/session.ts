// Results of one quiz session: how each word went, and the running score.

import { clean, grade } from './grading'
import type { Word } from './vocab'

/** How an answer went. `dont-know`: gave up (button, or Enter on an empty box). */
export type Outcome = 'correct' | 'typo' | 'wrong' | 'dont-know'

export interface Checked {
  outcome: Outcome
  /** The accepted answer that matched (the closest one for a typo). */
  answer?: string
}

/** How a word was asked: typed into the box, or picked from a few choices. */
export type AskedAs = 'type' | 'choice'

export interface WordResult {
  word: Word
  /** What was typed, or the option picked ('' for "Don't know"). */
  typed: string
  outcome: Outcome
  asked: AskedAs
}

export interface Score {
  right: number
  wrong: number
}

/** Grade a typed answer. Nothing typed (or only punctuation) means "don't know". */
export function check(typed: string, accepted: readonly string[]): Checked {
  if (clean(typed) === '') return { outcome: 'dont-know' }
  const { verdict, answer } = grade(typed, accepted)
  return answer === undefined ? { outcome: verdict } : { outcome: verdict, answer }
}

/** Typos count as right. */
export function isRight(outcome: Outcome): boolean {
  return outcome === 'correct' || outcome === 'typo'
}

export function tally(results: readonly Pick<WordResult, 'outcome'>[]): Score {
  const right = results.filter((r) => isRight(r.outcome)).length
  return { right, wrong: results.length - right }
}

export function scoreText({ right, wrong }: Score): string {
  return `${right} ✓ ${wrong} ✗`
}

/** The words answered wrong or given up on, in the order they were asked. */
export function missed(results: readonly WordResult[]): WordResult[] {
  return results.filter((r) => !isRight(r.outcome))
}

/** What the answer was, for a missed word: "You typed “car”", "You chose “car”" or "You didn’t know". */
export function answeredText({ typed, outcome, asked }: Pick<WordResult, 'typed' | 'outcome' | 'asked'>): string {
  if (outcome === 'dont-know') return 'You didn’t know'
  return `${asked === 'choice' ? 'You chose' : 'You typed'} “${typed}”`
}

/** The end-of-session headline, e.g. "7 of 10 right (70%)". */
export function summaryText({ right, wrong }: Score): string {
  const total = right + wrong
  if (total === 0) return 'No words answered.'
  return `${right} of ${total} right (${Math.round((right / total) * 100)}%)`
}
