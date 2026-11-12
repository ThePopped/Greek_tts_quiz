// Results of one quiz session: how each word went, and the running score.

import { clean, grade } from './grading'
import type { Word } from './vocab'

/**
 * How an answer went. `dont-know`: gave up (button, or Enter on an empty box).
 * `overruled`: graded wrong, but the user pressed "I was right".
 */
export type Outcome = 'correct' | 'typo' | 'wrong' | 'dont-know' | 'overruled'

export interface Checked {
  outcome: Exclude<Outcome, 'overruled'>
  /** The accepted answer that matched (the closest one for a typo). */
  answer?: string
}

export interface WordResult {
  word: Word
  typed: string
  outcome: Outcome
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

/** Typos and "I was right" count as right. */
export function isRight(outcome: Outcome): boolean {
  return outcome === 'correct' || outcome === 'typo' || outcome === 'overruled'
}

export function tally(results: readonly Pick<WordResult, 'outcome'>[]): Score {
  const right = results.filter((r) => isRight(r.outcome)).length
  return { right, wrong: results.length - right }
}

export function scoreText({ right, wrong }: Score): string {
  return `${right} ✓ ${wrong} ✗`
}
