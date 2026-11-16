// Learn mode: a working set of words that grows only once you know what's in it.
//
// Each word in the set has a streak of right answers in a row, and that streak
// decides its box: learning, familiar, or mastered. A wrong answer (or "Don't
// know") resets the streak, so the word goes back to learning. Sessions mix the
// boxes, most weight on learning and familiar, with mastered words spot-checked.
// New words are added a few at a time, picked at random from the rest of the
// vocab, but only once nothing is left in learning and recent answers are
// mostly right. Spacing is by number of answers, not by day.

import { shuffle, type QuestionCount, type Word } from './vocab'

/** How many random words a new learn set starts with. */
export const START_SIZE = 8
/** How many new words are added each time the set is ready for more. */
export const BATCH_SIZE = 3
/** Right answers in a row that move a word from learning to familiar. */
export const FAMILIAR_AT = 2
/** Right answers in a row that make a word mastered. */
export const MASTERED_AT = 5
/** How many of the set's most recent answers the accuracy check looks at. */
export const RECENT_WINDOW = 20
/** Share of recent answers that must be right before new words are added. */
export const UNLOCK_ACCURACY = 0.85
/** Share of a session's questions given to learning and familiar words; the rest are mastered spot-checks. */
export const MIX = { learning: 0.4, familiar: 0.4 } as const

export type Box = 'learning' | 'familiar' | 'mastered'
export const BOXES: readonly Box[] = ['learning', 'familiar', 'mastered']

/** One word in the learn set. */
export interface LearnEntry {
  /** Right answers in a row (reset to 0 by a wrong one). */
  streak: number
  /** When the word was added to the set, in ms since the epoch. */
  added: number
  /** When it was last answered in learn mode (0 if never). */
  lastSeen: number
}

export interface LearnState {
  /** The words in the set, by id. */
  words: Record<string, LearnEntry>
  /** The set's most recent answers, oldest first (true = right), at most RECENT_WINDOW. */
  recent: boolean[]
}

export const emptyLearnState = (): LearnState => ({ words: {}, recent: [] })

export function boxOf(entry: Pick<LearnEntry, 'streak'>): Box {
  if (entry.streak >= MASTERED_AT) return 'mastered'
  if (entry.streak >= FAMILIAR_AT) return 'familiar'
  return 'learning'
}

/** The set's words that are still in the vocab, with their entries. */
export function setWords(state: LearnState, words: readonly Word[]): { word: Word; entry: LearnEntry }[] {
  return words.filter((w) => state.words[w.id]).map((word) => ({ word, entry: state.words[word.id] }))
}

/** Percentage of the recent answers that were right, or undefined if there are none. */
export function recentPercent(state: LearnState): number | undefined {
  if (state.recent.length === 0) return undefined
  return Math.round((state.recent.filter(Boolean).length / state.recent.length) * 100)
}

/** Whether the next session will add words, and if not, what's holding them back. */
export type Unlock =
  | { kind: 'start'; adds: number } // no set yet: the first session starts it
  | { kind: 'ready'; adds: number } // the next session adds new words
  | { kind: 'learning'; left: number } // words still in learning
  | { kind: 'accuracy'; percent: number } // too many recent misses
  | { kind: 'complete' } // every word is already in the set

export interface LearnProgress {
  total: number
  counts: Record<Box, number>
  /** Vocab words not in the set yet. */
  remaining: number
  unlock: Unlock
}

export function learnProgress(state: LearnState, words: readonly Word[]): LearnProgress {
  const inSet = setWords(state, words)
  const counts: Record<Box, number> = { learning: 0, familiar: 0, mastered: 0 }
  for (const { entry } of inSet) counts[boxOf(entry)]++
  const remaining = words.length - inSet.length
  return { total: inSet.length, counts, remaining, unlock: unlockStatus(inSet.length, counts.learning, remaining, state) }
}

function unlockStatus(total: number, learning: number, remaining: number, state: LearnState): Unlock {
  if (total === 0) return { kind: 'start', adds: Math.min(START_SIZE, remaining) }
  if (remaining === 0) return { kind: 'complete' }
  if (learning > 0) return { kind: 'learning', left: learning }
  const percent = recentPercent(state)
  if (percent !== undefined && percent < UNLOCK_ACCURACY * 100) return { kind: 'accuracy', percent }
  return { kind: 'ready', adds: Math.min(BATCH_SIZE, remaining) }
}

/**
 * Get the set ready for a session: start it with START_SIZE random words if it's
 * empty, or add BATCH_SIZE random new words if it's ready for more. Words no
 * longer in the vocab are dropped. Returns the new state and the ids added.
 */
export function prepareSession(
  state: LearnState,
  words: readonly Word[],
  now: number,
  random: () => number = Math.random,
): { state: LearnState; added: string[] } {
  const kept: Record<string, LearnEntry> = {}
  for (const { word, entry } of setWords(state, words)) kept[word.id] = { ...entry }
  const next: LearnState = { words: kept, recent: [...state.recent] }

  const { unlock } = learnProgress(next, words)
  if (unlock.kind !== 'start' && unlock.kind !== 'ready') return { state: next, added: [] }

  const added = shuffle(
    words.filter((w) => !kept[w.id]),
    random,
  )
    .slice(0, unlock.adds)
    .map((w) => w.id)
  for (const id of added) kept[id] = { streak: 0, added: now, lastSeen: 0 }
  return { state: next, added }
}

/**
 * The words for one learn session, in random order: up to `count` words from
 * the set (each at most once), about 40% learning, 40% familiar and 20%
 * mastered. A box without enough words leaves its places to the others.
 *
 * Within a box: learning words with the shortest streak, then the newest, come
 * first; familiar and mastered words that haven't been asked for longest come first.
 */
export function pickLearnSession(
  state: LearnState,
  words: readonly Word[],
  count: QuestionCount,
  random: () => number = Math.random,
): Word[] {
  const inSet = setWords(state, words)
  const size = count === 'all' ? inSet.length : Math.min(count, inSet.length)

  const byBox = (box: Box) => inSet.filter(({ entry }) => boxOf(entry) === box)
  const learning = byBox('learning').sort((a, b) => a.entry.streak - b.entry.streak || b.entry.added - a.entry.added)
  const oldestFirst = (a: { entry: LearnEntry }, b: { entry: LearnEntry }) => a.entry.lastSeen - b.entry.lastSeen
  const queues: Record<Box, { word: Word }[]> = {
    learning,
    familiar: byBox('familiar').sort(oldestFirst),
    mastered: byBox('mastered').sort(oldestFirst),
  }

  const quota: Record<Box, number> = {
    learning: Math.ceil(size * MIX.learning),
    familiar: Math.round(size * MIX.familiar),
    mastered: 0,
  }
  quota.mastered = Math.max(0, size - quota.learning - quota.familiar)

  const chosen: Word[] = []
  for (const box of BOXES) chosen.push(...queues[box].splice(0, quota[box]).map((x) => x.word))
  // Fill places a box couldn't use, learning words first.
  for (const box of BOXES) chosen.push(...queues[box].splice(0, size - chosen.length).map((x) => x.word))
  return shuffle(chosen, random)
}

/** Count one learn-mode answer. Words not in the set are ignored. */
export function recordLearnAnswer(state: LearnState, id: string, right: boolean, now: number): LearnState {
  const entry = state.words[id]
  if (!entry) return state
  return {
    words: { ...state.words, [id]: { ...entry, streak: right ? entry.streak + 1 : 0, lastSeen: now } },
    recent: [...state.recent, right].slice(-RECENT_WINDOW),
  }
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** One line on the set's size: "Your set: 23 words · 18 mastered · 3 familiar · 2 learning". */
export function progressText({ total, counts }: LearnProgress): string {
  if (total === 0) return 'You haven’t started a learn set yet.'
  const parts = BOXES.filter((b) => counts[b] > 0).map((b) => `${counts[b]} ${b}`)
  return `Your set: ${plural(total, 'word')} · ${parts.join(' · ')}`
}

/** What happens next with new words. */
export function unlockText(unlock: Unlock): string {
  switch (unlock.kind) {
    case 'start':
      return `Your first session starts a set of ${plural(unlock.adds, 'random word')}.`
    case 'ready':
      return `Your next session adds ${plural(unlock.adds, 'new word')}.`
    case 'learning':
      return unlock.left === 1
        ? `New words unlock when you get the 1 learning word right ${FAMILIAR_AT} times in a row.`
        : `New words unlock when you get each of the ${unlock.left} learning words right ${FAMILIAR_AT} times in a row.`
    case 'accuracy':
      return `New words unlock at ${UNLOCK_ACCURACY * 100}% right over your last ${RECENT_WINDOW} answers (now ${unlock.percent}%).`
    case 'complete':
      return 'Every word is in your set. Keep practising to master them all.'
  }
}
