// Multiple-choice options for a word: its own first answer plus other words'
// first answers as wrong options, preferring words from the same category,
// then the same part of speech, so the wrong options are plausible.

import { clean } from './grading'
import { shuffle, type Word } from './vocab'

/** How many options a choice question shows, the right one included. */
export const CHOICE_COUNT = 4

export interface Choices {
  /** The options, in the order to show them. */
  options: string[]
  /** Index of the right option in `options`. */
  correct: number
}

/**
 * The options for a choice question about `word`: `word.answers[0]` and up to
 * CHOICE_COUNT - 1 wrong options taken from `words`, in random order. A wrong
 * option comes from a word none of whose answers match any of the target's
 * after clean() (γεια σου and γεια σας both mean "hello", so neither is a wrong
 * option for the other), and no two options are the same after clean(). Same
 * category first, then the same part of speech, then any word. With too few
 * usable words there are fewer than CHOICE_COUNT options.
 */
export function pickChoices(
  word: Word,
  words: readonly Word[],
  random: () => number = Math.random,
): Choices {
  const right = word.answers[0]
  const targetAnswers = new Set(word.answers.map(clean))
  const usable = words.filter(
    (w) => w.id !== word.id && !w.answers.some((a) => targetAnswers.has(clean(a))),
  )
  const tiers = [
    usable.filter((w) => w.category === word.category),
    usable.filter((w) => w.category !== word.category && w.pos === word.pos),
    usable.filter((w) => w.category !== word.category && w.pos !== word.pos),
  ]

  const wrong: string[] = []
  const taken = new Set([clean(right)])
  for (const tier of tiers) {
    for (const w of shuffle(tier, random)) {
      if (wrong.length === CHOICE_COUNT - 1) break
      const option = w.answers[0]
      const key = clean(option)
      if (key === '' || taken.has(key)) continue
      taken.add(key)
      wrong.push(option)
    }
  }

  const options = shuffle([right, ...wrong], random)
  return { options, correct: options.indexOf(right) }
}
