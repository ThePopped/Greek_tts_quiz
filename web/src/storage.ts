// What the quiz remembers between visits: per-word results and the answers
// the user has added with "I was right". Kept in localStorage, but every read
// and write is guarded, so a blocked or broken storage (private windows, full
// quota, hand-edited JSON) only means nothing is remembered next time.

import { clean } from './grading'

export interface WordStats {
  seen: number
  correct: number
  /** When the word was last answered, in ms since the epoch. */
  lastSeen: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const STATS_KEY = 'greek-quiz:v1:stats'
const ANSWERS_KEY = 'greek-quiz:v1:answers'

function isStats(value: unknown): value is WordStats {
  if (typeof value !== 'object' || value === null) return false
  const { seen, correct, lastSeen } = value as Record<string, unknown>
  return [seen, correct, lastSeen].every((n) => typeof n === 'number' && Number.isFinite(n))
}

function isAnswerList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((a) => typeof a === 'string')
}

export function createStore(getStorage: () => StorageLike | undefined = () => globalThis.localStorage) {
  function storage(): StorageLike | undefined {
    try {
      return getStorage() ?? undefined // reading window.localStorage itself can throw
    } catch {
      return undefined
    }
  }

  /** Read a JSON map, keeping only entries that pass `valid`. */
  function load<T>(key: string, valid: (v: unknown) => v is T): Record<string, T> {
    const out: Record<string, T> = {}
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(key) ?? '{}')
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [id, v] of Object.entries(parsed)) if (valid(v)) out[id] = v
      }
    } catch {
      // unreadable or corrupt: start empty
    }
    return out
  }

  function save(key: string, value: unknown): void {
    try {
      storage()?.setItem(key, JSON.stringify(value))
    } catch {
      // full or blocked: keep going with what's in memory
    }
  }

  // Loaded once; writes go to memory first so the session works even if saving fails.
  let stats: Record<string, WordStats> | undefined
  let answers: Record<string, string[]> | undefined
  const allStats = () => (stats ??= load(STATS_KEY, isStats))
  const allAnswers = () => (answers ??= load(ANSWERS_KEY, isAnswerList))

  return {
    /** Results for one word, or undefined if it has never been answered. */
    stats(id: string): WordStats | undefined {
      const s = allStats()[id]
      return s && { ...s }
    },

    /** Results for every word answered so far, by id. */
    allStats(): Record<string, WordStats> {
      return structuredClone(allStats())
    },

    /** Count one answer to a word. */
    record(id: string, wasCorrect: boolean, now: number = Date.now()): WordStats {
      const all = allStats()
      const prev = all[id] ?? { seen: 0, correct: 0, lastSeen: 0 }
      const next = { seen: prev.seen + 1, correct: prev.correct + (wasCorrect ? 1 : 0), lastSeen: now }
      all[id] = next
      save(STATS_KEY, all)
      return { ...next }
    },

    /** Answers the user has added for a word. */
    addedAnswers(id: string): string[] {
      return [...(allAnswers()[id] ?? [])]
    },

    /** Accept `answer` for this word from now on. Blank answers and repeats are ignored. */
    addAnswer(id: string, answer: string): void {
      const trimmed = answer.trim()
      const key = clean(trimmed)
      if (key === '') return
      const all = allAnswers()
      const list = all[id] ?? []
      if (list.some((a) => clean(a) === key)) return
      all[id] = [...list, trimmed]
      save(ANSWERS_KEY, all)
    },

    /** A word's answers from vocab.json plus the ones the user added. */
    acceptedAnswers(word: { id: string; answers: readonly string[] }): string[] {
      return [...word.answers, ...(allAnswers()[word.id] ?? [])]
    },
  }
}

export type Store = ReturnType<typeof createStore>

/** The app's store, backed by the browser's localStorage. */
export const store: Store = createStore()
