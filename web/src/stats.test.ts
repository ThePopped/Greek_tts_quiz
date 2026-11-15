import { describe, expect, it } from 'vitest'
import {
  categoryTallies,
  percentRight,
  percentText,
  rightText,
  spokenText,
  toneColor,
  wordTally,
} from './stats'
import type { WordStats } from './storage'
import type { Word } from './vocab'

const word = (id: string, category: string): Word => ({
  id,
  greek: id,
  answers: [id],
  category,
  pos: 'noun',
  notes: '',
  audio: `audio/${id}.mp3`,
})

const WORDS = [word('f1', 'Food'), word('f2', 'Food'), word('f3', 'Food'), word('c1', 'Colours'), word('n1', 'Numbers')]
const s = (seen: number, correct: number): WordStats => ({ seen, correct, lastSeen: 1 })

describe('wordTally', () => {
  it("is one word's counts, or zero if never answered", () => {
    const stats = { f1: s(4, 3) }
    expect(wordTally(stats, 'f1')).toEqual({ seen: 4, correct: 3 })
    expect(wordTally(stats, 'f2')).toEqual({ seen: 0, correct: 0 })
  })
})

describe('categoryTallies', () => {
  it("pools every answer to a category's words", () => {
    const tallies = categoryTallies(WORDS, { f1: s(4, 3), f2: s(6, 2), c1: s(1, 1) })
    expect(tallies.get('Food')).toEqual({ seen: 10, correct: 5 })
    expect(tallies.get('Colours')).toEqual({ seen: 1, correct: 1 })
  })

  it('includes categories with nothing answered, at zero', () => {
    expect(categoryTallies(WORDS, {}).get('Numbers')).toEqual({ seen: 0, correct: 0 })
  })

  it('ignores stats for words no longer in the vocab', () => {
    expect(categoryTallies(WORDS, { gone: s(9, 9) }).get('Food')).toEqual({ seen: 0, correct: 0 })
  })
})

describe('percentRight', () => {
  it('is undefined when nothing has been answered', () => {
    expect(percentRight({ seen: 0, correct: 0 })).toBeUndefined()
  })

  it('rounds to a whole number', () => {
    expect(percentRight({ seen: 60, correct: 47 })).toBe(78)
    expect(percentRight({ seen: 3, correct: 2 })).toBe(67)
  })

  it('keeps 100% for all right and 0% for none right', () => {
    expect(percentRight({ seen: 200, correct: 199 })).toBe(99)
    expect(percentRight({ seen: 200, correct: 1 })).toBe(1)
    expect(percentRight({ seen: 5, correct: 5 })).toBe(100)
    expect(percentRight({ seen: 5, correct: 0 })).toBe(0)
  })
})

describe('labels', () => {
  it('shows counts, a percentage, or "new"', () => {
    expect(rightText({ seen: 4, correct: 3 })).toBe('3 of 4 right')
    expect(rightText({ seen: 0, correct: 0 })).toBe('new')
    expect(percentText({ seen: 60, correct: 47 })).toBe('78%')
    expect(percentText({ seen: 0, correct: 0 })).toBe('new')
  })

  it('reads as a sentence for screen readers', () => {
    expect(spokenText({ seen: 4, correct: 3 })).toBe('Answered correctly 3 of 4 times')
    expect(spokenText({ seen: 1, correct: 0 })).toBe('Answered correctly 0 of 1 time')
    expect(spokenText({ seen: 0, correct: 0 })).toBe('Not answered yet')
  })
})

describe('toneColor', () => {
  it('runs red → amber → green', () => {
    expect(toneColor(0)).toBe('color-mix(in oklab, var(--warn) 0%, var(--wrong))')
    expect(toneColor(25)).toBe('color-mix(in oklab, var(--warn) 50%, var(--wrong))')
    expect(toneColor(50)).toBe('color-mix(in oklab, var(--right) 0%, var(--warn))')
    expect(toneColor(100)).toBe('color-mix(in oklab, var(--right) 100%, var(--warn))')
  })

  it('clamps out-of-range values', () => {
    expect(toneColor(-5)).toBe(toneColor(0))
    expect(toneColor(140)).toBe(toneColor(100))
  })
})
