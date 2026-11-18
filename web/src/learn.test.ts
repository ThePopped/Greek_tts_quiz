import { describe, expect, it } from 'vitest'
import {
  addDays,
  BATCH_SIZE,
  boxOf,
  dueAfter,
  emptyLearnState,
  FAMILIAR_AT,
  INTERVAL_DAYS,
  isDue,
  learnProgress,
  MASTERED_AT,
  migratedDue,
  pickLearnSession,
  prepareSession,
  progressText,
  recentPercent,
  recordLearnAnswer,
  RECENT_WINDOW,
  START_SIZE,
  startOfDay,
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

/** Local midnight on day `n` (1 January 2026 is day 0). */
const day = (n: number) => new Date(2026, 0, 1 + n).getTime()
const HOUR = 3_600_000
/** "Now" in most tests: midday on day 10. */
const NOW = day(10) + 12 * HOUR
/** A due date safely after NOW. */
const LATER = day(20)

const entry = (streak: number, added = 1, lastSeen = 0, due = 0): LearnEntry => ({ streak, added, lastSeen, due })
/** A familiar or mastered word that isn't due until LATER. */
const notDue = (streak: number) => entry(streak, 1, 1, LATER)
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

describe('days and due dates', () => {
  it('works in local calendar days', () => {
    expect(startOfDay(NOW)).toBe(day(10))
    expect(startOfDay(day(10))).toBe(day(10))
    expect(addDays(day(10), 3)).toBe(day(13))
    // Across the end of March (a DST change in Europe) it stays at local midnight.
    const march28 = new Date(2026, 2, 28).getTime()
    expect(addDays(march28, 2)).toBe(new Date(2026, 2, 30).getTime())
    expect(new Date(addDays(march28, 2)).getHours()).toBe(0)
  })

  it('spaces reviews further out as the streak grows, up to a cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map((s) => dueAfter(s, NOW))).toEqual([
      0,
      0,
      day(11),
      day(13),
      day(17),
      day(26),
      day(45),
      day(80),
      day(130),
      day(130),
      day(130),
    ])
    expect(INTERVAL_DAYS[FAMILIAR_AT]).toBe(1) // a word that just became familiar comes back tomorrow
  })

  it('is due from local midnight of its due day', () => {
    expect(isDue({ due: 0 }, NOW)).toBe(true)
    expect(isDue({ due: day(11) }, day(11) - 1)).toBe(false) // 23:59:59.999 the day before
    expect(isDue({ due: day(11) }, day(11))).toBe(true)
    expect(isDue({ due: day(11) }, day(15))).toBe(true) // overdue
  })

  it('gives words saved before due dates one, from when they were last answered', () => {
    expect(migratedDue({ streak: 3, lastSeen: 0 })).toBe(0)
    expect(migratedDue({ streak: 1, lastSeen: NOW })).toBe(0)
    expect(migratedDue({ streak: 2, lastSeen: NOW })).toBe(day(11))
    expect(migratedDue({ streak: 5, lastSeen: NOW })).toBe(day(26))
  })
})

describe('recordLearnAnswer', () => {
  it('adds to the streak of a due word and moves its next review out', () => {
    let s = stateOf({ w00: entry(1) })
    s = recordLearnAnswer(s, 'w00', true, NOW)
    expect(s.words.w00).toEqual({ streak: 2, added: 1, lastSeen: NOW, due: day(11) })
    s = recordLearnAnswer(s, 'w00', true, day(11) + HOUR)
    expect(s.words.w00).toEqual({ streak: 3, added: 1, lastSeen: day(11) + HOUR, due: day(14) })
    expect(s.recent).toEqual([true, true])
  })

  it('keeps learning words due, so they come up every session', () => {
    const s = recordLearnAnswer(stateOf({ w00: entry(0) }), 'w00', true, NOW)
    expect(s.words.w00).toEqual({ streak: 1, added: 1, lastSeen: NOW, due: 0 })
  })

  it('only notes the time of a right answer to a word not due yet', () => {
    const s = recordLearnAnswer(stateOf({ w00: notDue(3) }), 'w00', true, NOW)
    expect(s.words.w00).toEqual({ streak: 3, added: 1, lastSeen: NOW, due: LATER })
    expect(s.recent).toEqual([true])
  })

  it('sends a wrong answer back to learning, due now, even if it wasn’t due', () => {
    for (const before of [entry(4, 1, 1, day(5)), notDue(6)]) {
      const s = recordLearnAnswer(stateOf({ w00: before }), 'w00', false, NOW)
      expect(s.words.w00).toEqual({ streak: 0, added: 1, lastSeen: NOW, due: 0 })
      expect(s.recent).toEqual([false])
    }
  })

  it('keeps only the most recent answers', () => {
    let s = stateOf({ w00: entry(0) })
    for (let i = 0; i < RECENT_WINDOW + 5; i++) s = recordLearnAnswer(s, 'w00', i >= 5, NOW + i)
    expect(s.recent).toHaveLength(RECENT_WINDOW)
    expect(s.recent.every(Boolean)).toBe(true)
  })

  it('ignores words not in the set and leaves the old state alone', () => {
    const s = stateOf({ w00: entry(1) })
    expect(recordLearnAnswer(s, 'w01', true, NOW)).toBe(s)
    recordLearnAnswer(s, 'w00', true, NOW)
    expect(s.words.w00.streak).toBe(1)
    expect(s.recent).toEqual([])
  })
})

describe('learnProgress and unlocking', () => {
  it('has no set at first; the first session starts one', () => {
    const p = learnProgress(emptyLearnState(), vocab, NOW)
    expect(p).toEqual({
      total: 0,
      counts: { learning: 0, familiar: 0, mastered: 0 },
      remaining: 30,
      due: 0,
      unlock: { kind: 'start', adds: START_SIZE },
    })
  })

  it('counts each box, and waits while any word is still learning', () => {
    const p = learnProgress(stateOf({ w00: entry(0), w01: entry(1), w02: notDue(2), w03: notDue(6) }), vocab, NOW)
    expect(p.counts).toEqual({ learning: 2, familiar: 1, mastered: 1 })
    expect(p.unlock).toEqual({ kind: 'learning', left: 2 })
  })

  it('counts the reviews due now, and waits until they are done', () => {
    const s = stateOf({ w00: entry(2, 1, 1, day(9)), w01: entry(6, 1, 1, day(10)), w02: notDue(3) }, [true])
    const p = learnProgress(s, vocab, NOW)
    expect(p.due).toBe(2)
    expect(p.nextDue).toBeUndefined()
    expect(p.unlock).toEqual({ kind: 'due', count: 2 })
  })

  it('says when the next reviews fall due, and how many', () => {
    const s = stateOf({ w00: entry(2, 1, 1, day(13)), w01: entry(3, 1, 1, day(12)), w02: entry(6, 1, 1, day(12)) })
    const p = learnProgress(s, vocab, NOW)
    expect(p.due).toBe(0)
    expect(p.nextDue).toEqual({ day: day(12), count: 2 })
  })

  it('waits while recent accuracy is under 85%', () => {
    const recent = [...Array(16).fill(true), ...Array(4).fill(false)] // 80%
    expect(learnProgress(stateOf({ w00: notDue(2) }, recent), vocab, NOW).unlock).toEqual({
      kind: 'accuracy',
      percent: 80,
    })
  })

  it('is ready for more once nothing is learning or due and accuracy is high enough', () => {
    const recent = [...Array(17).fill(true), ...Array(3).fill(false)] // 85%
    expect(learnProgress(stateOf({ w00: notDue(2), w01: notDue(5) }, recent), vocab, NOW).unlock).toEqual({
      kind: 'ready',
      adds: BATCH_SIZE,
    })
  })

  it('never adds more words than are left, and says when every word is in', () => {
    const almost = Object.fromEntries(vocab.slice(0, 29).map((w) => [w.id, notDue(3)]))
    expect(learnProgress(stateOf(almost), vocab, NOW).unlock).toEqual({ kind: 'ready', adds: 1 })
    const all = Object.fromEntries(vocab.map((w) => [w.id, entry(0)]))
    expect(learnProgress(stateOf(all), vocab, NOW).unlock).toEqual({ kind: 'complete' })
  })

  it('ignores words no longer in the vocab', () => {
    const p = learnProgress(stateOf({ gone: entry(0), w00: notDue(2) }), vocab, NOW)
    expect(p.total).toBe(1)
    expect(p.unlock.kind).toBe('ready')
  })

  it('works out recent accuracy', () => {
    expect(recentPercent(emptyLearnState())).toBeUndefined()
    expect(recentPercent(stateOf({}, [true, true, false]))).toBe(67)
  })
})

describe('prepareSession', () => {
  it('starts an empty set with START_SIZE random new words, due now', () => {
    const { state, added } = prepareSession(emptyLearnState(), vocab, NOW, seeded())
    expect(added).toHaveLength(START_SIZE)
    expect(new Set(added).size).toBe(START_SIZE)
    expect(Object.keys(state.words).sort()).toEqual([...added].sort())
    for (const id of added) expect(state.words[id]).toEqual({ streak: 0, added: NOW, lastSeen: 0, due: 0 })
  })

  it('adds a batch of words not already in the set when ready', () => {
    const before = stateOf({ w00: notDue(2), w01: notDue(3) }, [true, true])
    const { state, added } = prepareSession(before, vocab, NOW, seeded())
    expect(added).toHaveLength(BATCH_SIZE)
    expect(added).not.toContain('w00')
    expect(added).not.toContain('w01')
    expect(Object.keys(state.words)).toHaveLength(2 + BATCH_SIZE)
    expect(state.words.w00).toEqual(notDue(2))
    expect(Object.keys(before.words)).toHaveLength(2) // the old state is left alone
  })

  it('adds nothing while words are still learning', () => {
    const { state, added } = prepareSession(stateOf({ w00: entry(1), w01: notDue(4) }), vocab, NOW)
    expect(added).toEqual([])
    expect(Object.keys(state.words)).toEqual(['w00', 'w01'])
  })

  it('adds nothing while reviews are due', () => {
    const { added } = prepareSession(stateOf({ w00: entry(3, 1, 1, day(10)), w01: notDue(4) }), vocab, NOW)
    expect(added).toEqual([])
  })

  it('drops words no longer in the vocab', () => {
    const { state } = prepareSession(stateOf({ gone: entry(0), w00: entry(0) }), vocab, NOW)
    expect(Object.keys(state.words)).toEqual(['w00'])
  })
})

describe('pickLearnSession', () => {
  /**
   * w00–w09 learning (streak 0 or 1, added at i), w10–w19 due reviews (w19 most
   * overdue), w20–w29 not due yet (w29 due soonest).
   */
  const full = stateOf(
    Object.fromEntries(
      vocab.map((w, i) => {
        if (i < 10) return [w.id, entry(i % 2, i)]
        if (i < 20) return [w.id, entry(i < 15 ? 3 : MASTERED_AT, 0, 1, day(19 - i))]
        return [w.id, entry(i < 25 ? 3 : MASTERED_AT, 0, 1, day(50 - i))]
      }),
    ),
  )
  const ids = (ws: Word[]) => ws.map((w) => w.id).sort()

  it('gives learning words up to half the session, then due reviews, most overdue first', () => {
    const ws = pickLearnSession(full, vocab, 10, NOW, seeded())
    expect(ws).toHaveLength(10)
    // learning: streak 0 first (w00, w02, w04, w06, w08), newest first → w08, w06, w04, w02, w00
    // due: oldest due date first → w19, w18, w17, w16, w15
    expect(ids(ws)).toEqual(['w00', 'w02', 'w04', 'w06', 'w08', 'w15', 'w16', 'w17', 'w18', 'w19'])
  })

  it('brings mastered words back when they are due, not before', () => {
    const ws = pickLearnSession(full, vocab, 20, NOW, seeded())
    expect(ids(ws)).toEqual(vocab.slice(0, 20).map((w) => w.id)) // every learning word and every due review
  })

  it('gives places reviews can’t use to the rest of the learning words', () => {
    const s = stateOf({ w00: entry(0), w01: entry(0), w02: entry(1), w03: entry(1), w04: entry(3, 0, 1, day(10)) })
    // half of 4 is 2 learning; 1 review is due; the 4th place goes to another learning word
    expect(ids(pickLearnSession(s, vocab, 4, NOW, seeded()))).toEqual(['w00', 'w01', 'w02', 'w04'])
  })

  it('fills up with extra practice, the soonest due first, when nothing else is left', () => {
    const s = stateOf({ w00: entry(0), w01: entry(2, 0, 1, day(14)), w02: entry(2, 0, 1, day(12)), w03: notDue(6) })
    expect(ids(pickLearnSession(s, vocab, 3, NOW, seeded()))).toEqual(['w00', 'w01', 'w02'])
  })

  it('asks every word once when the count is "all" or larger than the set', () => {
    expect(pickLearnSession(full, vocab, 'all', NOW)).toHaveLength(30)
    const small = stateOf({ w00: entry(0), w01: notDue(3) })
    expect(ids(pickLearnSession(small, vocab, 10, NOW))).toEqual(['w00', 'w01'])
  })

  it('is empty when there is no set', () => {
    expect(pickLearnSession(emptyLearnState(), vocab, 10, NOW)).toEqual([])
  })
})

describe('text', () => {
  it('describes the set', () => {
    expect(progressText(learnProgress(emptyLearnState(), vocab, NOW))).toBe('You haven’t started a learn set yet.')
    const p = learnProgress(stateOf({ w00: entry(0), w01: entry(2), w02: entry(9), w03: entry(9) }), vocab, NOW)
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
    expect(unlockText({ kind: 'due', count: 1 })).toBe('New words unlock once today’s 1 review is done.')
    expect(unlockText({ kind: 'due', count: 5 })).toBe('New words unlock once today’s 5 reviews are done.')
    expect(unlockText({ kind: 'accuracy', percent: 80 })).toBe(
      'New words unlock at 85% right over your last 20 answers (now 80%).',
    )
  })
})
