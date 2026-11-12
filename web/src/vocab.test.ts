import { describe, expect, it } from 'vitest'
import realVocab from '../public/vocab.json'
import { countByCategory, parseVocab, pickWords, shuffle, type Word } from './vocab'

function word(id: string, category: string): Word {
  return { id, greek: id, answers: [id], category, pos: 'noun', notes: '', audio: `audio/${id}.mp3` }
}

const WORDS = [
  word('a1', 'A'),
  word('a2', 'A'),
  word('a3', 'A'),
  word('b1', 'B'),
  word('b2', 'B'),
  word('c1', 'C'),
]

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

describe('parseVocab', () => {
  it('accepts the real vocab.json', () => {
    const vocab = parseVocab(realVocab)
    expect(vocab.words.length).toBeGreaterThan(0)
    // every word's category is one of the listed categories, and every category has words
    const counts = countByCategory(vocab.words)
    expect([...counts.keys()].sort()).toEqual([...vocab.categories].sort())
  })

  it('rejects malformed data', () => {
    expect(() => parseVocab(null)).toThrow()
    expect(() => parseVocab({ categories: ['A'], words: [] })).toThrow(/no words/)
    expect(() => parseVocab({ words: [word('a1', 'A')] })).toThrow(/categories/)
    expect(() => parseVocab({ categories: ['A'], words: [{ ...word('a1', 'A'), answers: [] }] })).toThrow(
      /word 0/,
    )
  })
})

describe('countByCategory', () => {
  it('counts words per category', () => {
    expect(countByCategory(WORDS)).toEqual(
      new Map([
        ['A', 3],
        ['B', 2],
        ['C', 1],
      ]),
    )
  })
})

describe('pickWords', () => {
  it('takes only words from the chosen categories', () => {
    const picked = pickWords(WORDS, ['A', 'C'], 'all')
    expect(picked.map((w) => w.id).sort()).toEqual(['a1', 'a2', 'a3', 'c1'])
  })

  it('takes at most the requested number, with no repeats', () => {
    const picked = pickWords(WORDS, ['A', 'B', 'C'], 10)
    expect(picked).toHaveLength(6)
    expect(new Set(picked.map((w) => w.id)).size).toBe(6)

    const many = Array.from({ length: 30 }, (_, i) => word(`w${i}`, 'A'))
    const ten = pickWords(many, ['A'], 10)
    expect(ten).toHaveLength(10)
    expect(new Set(ten.map((w) => w.id)).size).toBe(10)
    expect(pickWords(many, ['A'], 20)).toHaveLength(20)
  })

  it('returns nothing when no category is chosen', () => {
    expect(pickWords(WORDS, [], 10)).toEqual([])
  })

  it('shuffles, and does not change the input', () => {
    const before = WORDS.map((w) => w.id)
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) => pickWords(WORDS, ['A', 'B', 'C'], 'all', seeded(i)).map((w) => w.id).join()),
    )
    expect(orders.size).toBeGreaterThan(1)
    expect(WORDS.map((w) => w.id)).toEqual(before)
  })
})

describe('shuffle', () => {
  it('returns a reordered copy with the same items', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const orders = new Set(Array.from({ length: 20 }, (_, i) => shuffle(items, seeded(i)).join()))
    expect(orders.size).toBeGreaterThan(1)
    expect([...shuffle(items)].sort()).toEqual(items)
    expect(items).toEqual([1, 2, 3, 4, 5, 6])
    expect(shuffle([])).toEqual([])
  })
})
