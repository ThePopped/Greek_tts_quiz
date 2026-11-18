// Learn mode: a working set of words that grows only once you know what's in it.
//
// Each word in the set has a streak of right answers in a row, and that streak
// decides its box: learning, familiar, or mastered. A wrong answer (or "Don't
// know") resets the streak, so the word goes back to learning.
//
// Each word also has a due date. Learning words are always due. A right answer
// to a due word adds to its streak and moves its next review further out
// (INTERVAL_DAYS), so familiar and mastered words come back on the day they're
// due. Sessions take learning words and due reviews first, then fill up with
// extra practice. New words are added a few at a time, picked at random from
// the rest of the vocab, but only once nothing is learning, nothing is due, and
// recent answers are mostly right.

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
/**
 * Days until the next review, by the streak after a right answer (the last
 * one is the cap). 0 means always due: learning words come up every session.
 */
export const INTERVAL_DAYS: readonly number[] = [0, 0, 1, 3, 7, 16, 35, 70, 120]
/** Most of a session that learning words take before due reviews get a place. */
export const LEARNING_SHARE = 0.5

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
  /** Local midnight of the day it's next due, in ms since the epoch (0: due now). */
  due: number
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

/** Local midnight at the start of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** `days` calendar days after `ms`, at the same local time (so a DST change doesn't shift it). */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Days until the next review for a word with this streak. */
export function intervalDays(streak: number): number {
  return INTERVAL_DAYS[Math.min(streak, INTERVAL_DAYS.length - 1)]
}

/** When a word with this streak, answered at `now`, is next due (0 if always due). */
export function dueAfter(streak: number, now: number): number {
  const days = intervalDays(streak)
  return days === 0 ? 0 : addDays(startOfDay(now), days)
}

export function isDue(entry: Pick<LearnEntry, 'due'>, now: number): boolean {
  return entry.due <= now
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
  | { kind: 'due'; count: number } // reviews due today
  | { kind: 'accuracy'; percent: number } // too many recent misses
  | { kind: 'complete' } // every word is already in the set

export interface LearnProgress {
  total: number
  counts: Record<Box, number>
  /** Vocab words not in the set yet. */
  remaining: number
  /** Familiar and mastered words due now (learning words are always due, and aren't counted). */
  due: number
  /** The next day a review falls due (local midnight), and how many words, if nothing is due now. */
  nextDue?: { day: number; count: number }
  unlock: Unlock
}

export function learnProgress(state: LearnState, words: readonly Word[], now: number): LearnProgress {
  const inSet = setWords(state, words)
  const counts: Record<Box, number> = { learning: 0, familiar: 0, mastered: 0 }
  for (const { entry } of inSet) counts[boxOf(entry)]++
  const reviews = inSet.filter(({ entry }) => boxOf(entry) !== 'learning').map(({ entry }) => entry)
  const due = reviews.filter((e) => isDue(e, now)).length
  const later = reviews.filter((e) => !isDue(e, now)).map((e) => startOfDay(e.due))
  const progress: LearnProgress = {
    total: inSet.length,
    counts,
    remaining: words.length - inSet.length,
    due,
    unlock: unlockStatus(inSet.length, counts.learning, due, words.length - inSet.length, state),
  }
  if (due === 0 && later.length > 0) {
    const day = Math.min(...later)
    progress.nextDue = { day, count: later.filter((d) => d === day).length }
  }
  return progress
}

function unlockStatus(total: number, learning: number, due: number, remaining: number, state: LearnState): Unlock {
  if (total === 0) return { kind: 'start', adds: Math.min(START_SIZE, remaining) }
  if (remaining === 0) return { kind: 'complete' }
  if (learning > 0) return { kind: 'learning', left: learning }
  if (due > 0) return { kind: 'due', count: due }
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

  const { unlock } = learnProgress(next, words, now)
  if (unlock.kind !== 'start' && unlock.kind !== 'ready') return { state: next, added: [] }

  const added = shuffle(
    words.filter((w) => !kept[w.id]),
    random,
  )
    .slice(0, unlock.adds)
    .map((w) => w.id)
  for (const id of added) kept[id] = { streak: 0, added: now, lastSeen: 0, due: 0 }
  return { state: next, added }
}

/** Why a word is in a session: still learning, a review that's due, or extra practice. */
export type SessionKind = 'learning' | 'review' | 'extra'

/**
 * The words for one learn session, before shuffling: up to `count` words from
 * the set, each at most once. In order of priority:
 *   1. learning words (shortest streak, then newest, first), up to LEARNING_SHARE of the session;
 *   2. due reviews, most overdue first (then the ones not asked for longest);
 *   3. any learning words left over;
 *   4. extra practice: reviews not due yet, the soonest due first.
 */
export function planLearnSession(
  state: LearnState,
  words: readonly Word[],
  count: QuestionCount,
  now: number,
): { word: Word; kind: SessionKind }[] {
  const inSet = setWords(state, words)
  const size = count === 'all' ? inSet.length : Math.min(count, inSet.length)

  type Item = { word: Word; entry: LearnEntry }
  const byDue = (a: Item, b: Item) => a.entry.due - b.entry.due || a.entry.lastSeen - b.entry.lastSeen
  const learning = inSet
    .filter(({ entry }) => boxOf(entry) === 'learning')
    .sort((a, b) => a.entry.streak - b.entry.streak || b.entry.added - a.entry.added)
  const reviews = inSet.filter(({ entry }) => boxOf(entry) !== 'learning').sort(byDue)
  const due = reviews.filter(({ entry }) => isDue(entry, now))
  const extra = reviews.filter(({ entry }) => !isDue(entry, now))

  const chosen: { word: Word; kind: SessionKind }[] = []
  const take = (queue: Item[], kind: SessionKind, limit: number) =>
    chosen.push(...queue.splice(0, Math.max(0, limit - chosen.length)).map(({ word }) => ({ word, kind })))
  take(learning, 'learning', Math.ceil(size * LEARNING_SHARE))
  take(due, 'review', size)
  take(learning, 'learning', size)
  take(extra, 'extra', size)
  return chosen
}

/** The words for one learn session (see planLearnSession), in random order. */
export function pickLearnSession(
  state: LearnState,
  words: readonly Word[],
  count: QuestionCount,
  now: number,
  random: () => number = Math.random,
): Word[] {
  return shuffle(
    planLearnSession(state, words, count, now).map(({ word }) => word),
    random,
  )
}

/** How many of a session's words are of each kind. */
export function sessionMix(plan: readonly { kind: SessionKind }[]): Record<SessionKind, number> {
  const mix: Record<SessionKind, number> = { learning: 0, review: 0, extra: 0 }
  for (const { kind } of plan) mix[kind]++
  return mix
}

/**
 * Count one learn-mode answer. Words not in the set are ignored.
 *
 * Right, and the word was due: one more in the streak, and the next review moves out.
 * Right, but not due yet (extra practice): only `lastSeen` changes, so cramming doesn't stretch the gaps.
 * Wrong: the streak goes back to 0 and the word is due again straight away.
 */
export function recordLearnAnswer(state: LearnState, id: string, right: boolean, now: number): LearnState {
  const entry = state.words[id]
  if (!entry) return state
  let next: LearnEntry
  if (!right) next = { ...entry, streak: 0, lastSeen: now, due: 0 }
  else if (!isDue(entry, now)) next = { ...entry, lastSeen: now }
  else {
    const streak = entry.streak + 1
    next = { ...entry, streak, lastSeen: now, due: dueAfter(streak, now) }
  }
  return {
    words: { ...state.words, [id]: next },
    recent: [...state.recent, right].slice(-RECENT_WINDOW),
  }
}

/**
 * The due date for a word saved before due dates existed: its interval counted
 * from the day it was last answered (due now if it never was).
 */
export function migratedDue(entry: Pick<LearnEntry, 'streak' | 'lastSeen'>): number {
  return entry.lastSeen === 0 ? 0 : dueAfter(entry.streak, entry.lastSeen)
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const DAY_MS = 86_400_000

/** "tomorrow" or "in 3 days" for the local day starting at `day`; "today" if it's today or earlier. */
export function whenText(day: number, now: number): string {
  // Rounded, since a day with a DST change is 23 or 25 hours long.
  const days = Math.round((startOfDay(day) - startOfDay(now)) / DAY_MS)
  if (days <= 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** When a familiar or mastered word is next due: "due today", "due tomorrow", "due in 3 days". */
export function dueText(entry: Pick<LearnEntry, 'due'>, now: number): string {
  return `due ${isDue(entry, now) ? 'today' : whenText(entry.due, now)}`
}

/**
 * The learn panel's headline: "12 words due today", or "All caught up. Next: 4
 * words tomorrow". Undefined when there's nothing to say (no set yet, or only
 * learning words, which are always due).
 */
export function dueHeadline({ total, counts, due, nextDue }: LearnProgress, now: number): string | undefined {
  if (total === 0) return undefined
  if (due > 0) return `${plural(due, 'word')} due today`
  const next = nextDue ? ` Next: ${plural(nextDue.count, 'word')} ${whenText(nextDue.day, now)}.` : ''
  if (counts.learning === 0) return `All caught up.${next}`
  return next === '' ? undefined : `No reviews due today.${next}`
}

/**
 * The start button's line for a learn session: "10 questions: 3 learning, 7
 * reviews", or "Nothing due: 10 questions of extra practice." `added` is how
 * many new words the session adds to the set (they're its newest learning words).
 */
export function mixText(mix: Record<SessionKind, number>, added = 0): string {
  const total = mix.learning + mix.review + mix.extra
  if (total > 0 && mix.learning === 0 && mix.review === 0) return `Nothing due: ${plural(total, 'question')} of extra practice.`
  const fresh = Math.min(added, mix.learning)
  if (fresh > 0 && fresh === total) return `${plural(total, 'question')}, all new words.`
  const parts: string[] = []
  if (mix.learning > 0) parts.push(`${mix.learning} learning${fresh > 0 ? ` (${fresh} new)` : ''}`)
  if (mix.review > 0) parts.push(plural(mix.review, 'review'))
  if (mix.extra > 0) parts.push(`${mix.extra} extra practice`)
  return `${plural(total, 'question')}: ${parts.join(', ')}.`
}

/** After a learn session: "5 words still due today", or "All caught up for today". */
export function dueSummary({ total, counts, due }: LearnProgress): string | undefined {
  if (total === 0) return undefined
  if (due > 0) return `${plural(due, 'word')} still due today.`
  return counts.learning === 0 ? 'All caught up for today.' : 'No reviews left for today.'
}

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
    case 'due':
      return `New words unlock once today’s ${plural(unlock.count, 'review')} ${unlock.count === 1 ? 'is' : 'are'} done.`
    case 'accuracy':
      return `New words unlock at ${UNLOCK_ACCURACY * 100}% right over your last ${RECENT_WINDOW} answers (now ${unlock.percent}%).`
    case 'complete':
      return 'Every word is in your set. Keep practising to master them all.'
  }
}
