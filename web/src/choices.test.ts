import { describe, expect, it } from 'vitest'
import realVocab from '../public/vocab.json'
import { CHOICE_COUNT, pickChoices } from './choices'
import { clean } from './grading'
import { parseVocab, type Word } from './vocab'

const word = (id: string, answers: string[], category = 'c', pos = 'noun'): Word => ({
  id,
  greek: id,
  answers,
  category,
  pos,
  notes: '',
  audio: `audio/${id}.mp3`,
})

/** A seeded random source, so a test can run many varied picks repeatably. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const real = parseVocab(realVocab).words

describe('pickChoices', () => {
  it('gives 4 distinct options with exactly one right one, for every real word', () => {
    const random = seeded(1)
    for (const w of real) {
      const { options, correct } = pickChoices(w, real, random)
      expect(options).toHaveLength(CHOICE_COUNT)
      expect(new Set(options.map(clean)).size).toBe(CHOICE_COUNT)
      expect(options[correct]).toBe(w.answers[0])
      const targets = new Set(w.answers.map(clean))
      const rightOnes = options.filter((o) => targets.has(clean(o)))
      expect(rightOnes).toEqual([w.answers[0]])
    }
  })

  it('never offers a word that shares an answer with the target', () => {
    const hello = word('hello-informal', ['hello', 'hi'])
    const words = [
      hello,
      word('hello-formal', ['Hello!', 'good day']),
      word('hi-there', ['bye', 'Hi']),
      word('a', ['yes']),
      word('b', ['no']),
      word('c', ['thanks']),
    ]
    for (let seed = 0; seed < 20; seed++) {
      const { options } = pickChoices(hello, words, seeded(seed))
      expect(options).not.toContain('Hello!')
      expect(options).not.toContain('bye')
      expect(options.sort()).toEqual(['hello', 'no', 'thanks', 'yes'])
    }
  })

  it('drops wrong options that are the same after clean()', () => {
    const target = word('t', ['house'])
    const words = [
      target,
      word('a', ['to eat']),
      word('b', ['eat']),
      word('c', ['Eat!']),
      word('d', ['drink']),
      word('e', ['sleep']),
    ]
    for (let seed = 0; seed < 20; seed++) {
      const { options } = pickChoices(target, words, seeded(seed))
      expect(options).toHaveLength(CHOICE_COUNT)
      expect(new Set(options.map(clean)).size).toBe(CHOICE_COUNT)
    }
  })

  it('prefers the same category, then the same part of speech', () => {
    const target = word('t', ['red'], 'Colours', 'adj')
    const words = [
      target,
      word('c1', ['blue'], 'Colours', 'adj'),
      word('c2', ['green'], 'Colours', 'adj'),
      word('p1', ['big'], 'Adjectives', 'adj'),
      word('p2', ['small'], 'Adjectives', 'adj'),
      word('o1', ['bread'], 'Food', 'noun'),
      word('o2', ['milk'], 'Food', 'noun'),
    ]
    for (let seed = 0; seed < 20; seed++) {
      const { options } = pickChoices(target, words, seeded(seed))
      expect(options).toContain('blue')
      expect(options).toContain('green')
      expect(options.filter((o) => o === 'big' || o === 'small')).toHaveLength(1)
      expect(options).not.toContain('bread')
      expect(options).not.toContain('milk')
    }
  })

  it('fills a tiny category from other words', () => {
    const target = word('t', ['what'], 'Question words', 'pron')
    const words = [
      target,
      word('q', ['who'], 'Question words', 'pron'),
      word('x', ['bread'], 'Food', 'noun'),
      word('y', ['milk'], 'Food', 'noun'),
      word('z', ['water'], 'Food', 'noun'),
    ]
    const { options } = pickChoices(target, words, seeded(3))
    expect(options).toHaveLength(CHOICE_COUNT)
    expect(options).toContain('who')
    expect(options).toContain('what')
  })

  it('puts the right option in different places', () => {
    const random = seeded(7)
    const places = new Set<number>()
    for (let i = 0; i < 40; i++) places.add(pickChoices(real[0], real, random).correct)
    expect(places.size).toBe(CHOICE_COUNT)
  })

  it('returns fewer options when there are too few usable words', () => {
    const target = word('t', ['one'])
    const { options, correct } = pickChoices(target, [target, word('a', ['two'])], seeded(1))
    expect(options.sort()).toEqual(['one', 'two'])
    expect(correct).toBeGreaterThanOrEqual(0)
  })
})
