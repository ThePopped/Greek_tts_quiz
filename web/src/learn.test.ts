import { describe, expect, it } from 'vitest'
import {
  BATCH_SIZE,
  boxOf,
  emptyLearnState,
  FAMILIAR_AT,
  learnProgress,
  MASTERED_AT,
  pickLearnSession,
  prepareSession,
  progressText,
  recentPercent,
  recordLearnAnswer,
  RECENT_WINDOW,
  START_SIZE,
  unlockText,
  type LearnEntry,
  type LearnState,
} from './learn'
import type { Word } from './vocab'

const word = (id: string): Word => ({
  id,
  greek: id,
  answers: [id],
  category: 'c',
  pos: 'noun',
  notes: '',
  audio: `audio/${id}.mp3`,
})
const vocab = Array.from({ length: 30 }, (_, i) => word(`w${String(i).padStart(2, '0')}`))

const entry = (streak: number, added = 1, lastSeen = 0): LearnEntry => ({ streak, added, lastSeen })
const stateOf = (words: Record<string, LearnEntry>, recent: boolean[] = []): LearnState => ({ words, recent })

/** A fixed sequence of "random" numbers, so shuffles are repeatable. */
const seeded = () => {
  let x = 0.123
  return () => (x = (x * 9301 + 0.49297) % 1)
}

describe('boxes', () => {
  it('follow the streak of right answers', () => {
    expect(boxOf({ streak: 0 })).toBe('learning')
    expect(boxOf({ streak: FAMILIAR_AT - 1 })).toBe('learning')
    expect(boxOf({ streak: FAMILIAR_AT })).toBe('familiar')
    expect(boxOf({ streak: MASTERED_AT - 1 })).toBe('familiar')
    expect(boxOf({ streak: MASTERED_AT })).toBe('mastered')
    expect(boxOf({ streak: 40 })).toBe('mastered')
  })
})

describe('recordLearnAnswer', () => {
  it('adds to the streak when right, resets it when wrong, and notes when', () => {
    let s = stateOf({ w00: entry(3) })
    s = recordLearnAnswer(s, 'w00', true, 50)
    expect(s.words.w00).toEqual({ streak: 4, added: 1, lastSeen: 50 })
    s = recordLearnAnswer(s, 'w00', false, 60)
    expect(s.words.w00).toEqual({ streak: 0, added: 1, lastSeen: 60 })
    expect(s.recent).toEqual([true, false])
  })

  it('keeps only the most recent answers', () => {
    let s = stateOf({ w00: entry(0) })
    for (let i = 0; i < RECENT_WINDOW + 5; i++) s = recordLearnAnswer(s, 'w00', i >= 5, i)
    expect(s.recent).toHaveLength(RECENT_WINDOW)
    expect(s.recent.every(Boolean)).toBe(true)
  })

  it('ignores words not in the set and leaves the old state alone', () => {
    const s = stateOf({ w00: entry(1) })
    expect(recordLearnAnswer(s, 'w01', true, 5)).toBe(s)
    recordLearnAnswer(s, 'w00', true, 5)
    expect(s.words.w00.streak).toBe(1)
    expect(s.recent).toEqual([])
  })
})

describe('learnProgress and unlocking', () => {
  it('has no set at first; the first session starts one', () => {
    const p = learnProgress(emptyLearnState(), vocab)
    expect(p).toEqual({
      total: 0,
      counts: { learning: 0, familiar: 0, mastered: 0 },
      remaining: 30,
      unlock: { kind: 'start', adds: START_SIZE },
    })
  })

  it('counts each box, and waits while any word is still learning', () => {
    const p = learnProgress(stateOf({ w00: entry(0), w01: entry(1), w02: entry(2), w03: entry(6) }), vocab)
    expect(p.counts).toEqual({ learning: 2, familiar: 1, mastered: 1 })
    expect(p.unlock).toEqual({ kind: 'learning', left: 2 })
  })

  it('waits while recent accuracy is under 85%', () => {
    const recent = [...Array(16).fill(true), ...Array(4).fill(false)] // 80%
    expect(learnProgress(stateOf({ w00: entry(2) }, recent), vocab).unlock).toEqual({ kind: 'accuracy', percent: 80 })
  })

  it('is ready for more once nothing is learning and accuracy is high enough', () => {
    const recent = [...Array(17).fill(true), ...Array(3).fill(false)] // 85%
    expect(learnProgress(stateOf({ w00: entry(2), w01: entry(5) }, recent), vocab).unlock).toEqual({
      kind: 'ready',
      adds: BATCH_SIZE,
    })
  })

  it('never adds more words than are left, and says when every word is in', () => {
    const almost = Object.fromEntries(vocab.slice(0, 29).map((w) => [w.id, entry(3)]))
    expect(learnProgress(stateOf(almost), vocab).unlock).toEqual({ kind: 'ready', adds: 1 })
    const all = Object.fromEntries(vocab.map((w) => [w.id, entry(0)]))
    expect(learnProgress(stateOf(all), vocab).unlock).toEqual({ kind: 'complete' })
  })

  it('ignores words no longer in the vocab', () => {
    const p = learnProgress(stateOf({ gone: entry(0), w00: entry(2) }), vocab)
    expect(p.total).toBe(1)
    expect(p.unlock.kind).toBe('ready')
  })

  it('works out recent accuracy', () => {
    expect(recentPercent(emptyLearnState())).toBeUndefined()
    expect(recentPercent(stateOf({}, [true, true, false]))).toBe(67)
  })
})

describe('prepareSession', () => {
  it('starts an empty set with START_SIZE random new words', () => {
    const { state, added } = prepareSession(emptyLearnState(), vocab, 100, seeded())
    expect(added).toHaveLength(START_SIZE)
    expect(new Set(added).size).toBe(START_SIZE)
    expect(Object.keys(state.words).sort()).toEqual([...added].sort())
    for (const id of added) expect(state.words[id]).toEqual({ streak: 0, added: 100, lastSeen: 0 })
  })

  it('adds a batch of words not already in the set when ready', () => {
    const before = stateOf({ w00: entry(2), w01: entry(3) }, [true, true])
    const { state, added } = prepareSession(before, vocab, 200, seeded())
    expect(added).toHaveLength(BATCH_SIZE)
    expect(added).not.toContain('w00')
    expect(added).not.toContain('w01')
    expect(Object.keys(state.words)).toHaveLength(2 + BATCH_SIZE)
    expect(state.words.w00).toEqual(entry(2))
    expect(Object.keys(before.words)).toHaveLength(2) // the old state is left alone
  })

  it('adds nothing while words are still learning', () => {
    const { state, added } = prepareSession(stateOf({ w00: entry(1), w01: entry(4) }), vocab, 300)
    expect(added).toEqual([])
    expect(Object.keys(state.words)).toEqual(['w00', 'w01'])
  })

  it('drops words no longer in the vocab', () => {
    const { state } = prepareSession(stateOf({ gone: entry(0), w00: entry(0) }), vocab, 300)
    expect(Object.keys(state.words)).toEqual(['w00'])
  })
})

describe('pickLearnSession', () => {
  /** 10 learning (newest last), 10 familiar, 10 mastered, each box asked longest ago first. */
  const full = stateOf(
    Object.fromEntries(
      vocab.map((w, i) => {
        if (i < 10) return [w.id, entry(i % 2, i, 0)] // learning: streak 0 or 1, added at i
        if (i < 20) return [w.id, entry(3, 0, i)] // familiar: last seen at i
        return [w.id, entry(MASTERED_AT, 0, i)] // mastered: last seen at i
      }),
    ),
  )
  const boxCounts = (ws: Word[], s: LearnState) => {
    const c = { learning: 0, familiar: 0, mastered: 0 }
    for (const w of ws) c[boxOf(s.words[w.id])]++
    return c
  }

  it('mixes about 40% learning, 40% familiar and 20% mastered', () => {
    const ws = pickLearnSession(full, vocab, 10, seeded())
    expect(ws).toHaveLength(10)
    expect(new Set(ws.map((w) => w.id)).size).toBe(10)
    expect(boxCounts(ws, full)).toEqual({ learning: 4, familiar: 4, mastered: 2 })
  })

  it('takes the weakest, newest learning words and the longest-unasked others', () => {
    const ids = pickLearnSession(full, vocab, 10, seeded()).map((w) => w.id).sort()
    // learning: streak 0 first (w00, w02, w04, w06, w08), newest first → w08, w06, w04, w02
    // familiar: last seen longest ago → w10–w13; mastered → w20, w21
    expect(ids).toEqual(['w02', 'w04', 'w06', 'w08', 'w10', 'w11', 'w12', 'w13', 'w20', 'w21'])
  })

  it('fills places a box can’t use from the others, learning first', () => {
    const s = stateOf({ w00: entry(0), w01: entry(0), w02: entry(0), w03: entry(2), w04: entry(9) })
    const ws = pickLearnSession(s, vocab, 4, seeded())
    // quotas 2 / 2 / 0: familiar has 1, so a third learning word takes its place
    expect(boxCounts(ws, s)).toEqual({ learning: 3, familiar: 1, mastered: 0 })
  })

  it('asks every word once when the count is "all" or larger than the set', () => {
    expect(pickLearnSession(full, vocab, 'all')).toHaveLength(30)
    const small = stateOf({ w00: entry(0), w01: entry(3) })
    expect(pickLearnSession(small, vocab, 10).map((w) => w.id).sort()).toEqual(['w00', 'w01'])
  })

  it('is empty when there is no set', () => {
    expect(pickLearnSession(emptyLearnState(), vocab, 10)).toEqual([])
  })
})

describe('text', () => {
  it('describes the set', () => {
    expect(progressText(learnProgress(emptyLearnState(), vocab))).toBe('You haven’t started a learn set yet.')
    const p = learnProgress(stateOf({ w00: entry(0), w01: entry(2), w02: entry(9), w03: entry(9) }), vocab)
    expect(progressText(p)).toBe('Your set: 4 words · 1 learning · 1 familiar · 2 mastered')
  })

  it('says what unlocks new words', () => {
    expect(unlockText({ kind: 'start', adds: 8 })).toBe('Your first session starts a set of 8 random words.')
    expect(unlockText({ kind: 'ready', adds: 3 })).toBe('Your next session adds 3 new words.')
    expect(unlockText({ kind: 'learning', left: 1 })).toBe(
      'New words unlock when you get the 1 learning word right 2 times in a row.',
    )
    expect(unlockText({ kind: 'learning', left: 3 })).toBe(
      'New words unlock when you get each of the 3 learning words right 2 times in a row.',
    )
    expect(unlockText({ kind: 'accuracy', percent: 80 })).toBe(
      'New words unlock at 85% right over your last 20 answers (now 80%).',
    )
  })
})
