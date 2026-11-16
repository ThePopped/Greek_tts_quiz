// What the quiz remembers between visits: per-word results, the start
// screen's last choice, saved custom word lists, and the learn-mode set. Kept in localStorage, but
// every read and write is guarded, so a blocked or broken storage (private
// windows, full quota, hand-edited JSON) only means nothing is remembered next time.

import { emptyLearnState, RECENT_WINDOW, type LearnEntry, type LearnState } from './learn'
import { isQuestionCount, type QuestionCount } from './vocab'

export interface WordStats {
  seen: number
  correct: number
  /** When the word was last answered, in ms since the epoch. */
  lastSeen: number
}

/** How the start screen chooses words: by category, a hand-picked list, or the learn set. */
export type StartMode = 'categories' | 'list' | 'learn'
const START_MODES: readonly unknown[] = ['categories', 'list', 'learn'] satisfies StartMode[]

/** What was picked on the start screen last time. */
export interface StartChoice {
  mode: StartMode
  categories: string[]
  /** The ticked word ids in "Custom list" mode. */
  words: string[]
  count: QuestionCount
}

/** A named custom word list. */
export interface SavedList {
  name: string
  ids: string[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const STATS_KEY = 'greek-quiz:v1:stats'
const START_KEY = 'greek-quiz:v1:start'
const LISTS_KEY = 'greek-quiz:v1:lists'
const LEARN_KEY = 'greek-quiz:v1:learn'

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((s) => typeof s === 'string')

function isSavedList(value: unknown): value is SavedList {
  if (typeof value !== 'object' || value === null) return false
  const { name, ids } = value as Record<string, unknown>
  return typeof name === 'string' && name !== '' && isStringArray(ids)
}

function isStats(value: unknown): value is WordStats {
  if (typeof value !== 'object' || value === null) return false
  const { seen, correct, lastSeen } = value as Record<string, unknown>
  return [seen, correct, lastSeen].every((n) => typeof n === 'number' && Number.isFinite(n))
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

function isLearnEntry(value: unknown): value is LearnEntry {
  if (typeof value !== 'object' || value === null) return false
  const { streak, added, lastSeen } = value as Record<string, unknown>
  return [streak, added, lastSeen].every(isCount)
}

/** Parse the saved learn set, skipping malformed words (anything unreadable is an empty set). */
function toLearnState(value: unknown): LearnState {
  const state = emptyLearnState()
  if (typeof value !== 'object' || value === null) return state
  const { words, recent } = value as Record<string, unknown>
  if (typeof words === 'object' && words !== null && !Array.isArray(words)) {
    for (const [id, entry] of Object.entries(words)) {
      if (isLearnEntry(entry)) state.words[id] = { streak: entry.streak, added: entry.added, lastSeen: entry.lastSeen }
    }
  }
  if (Array.isArray(recent)) state.recent = recent.filter((r) => typeof r === 'boolean').slice(-RECENT_WINDOW)
  return state
}

/** Parse a saved start choice. `mode` and `words` came later, so a choice without them is "categories" mode. */
function toStartChoice(value: unknown): StartChoice | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { mode = 'categories', categories, words = [], count } = value as Record<string, unknown>
  if (!START_MODES.includes(mode)) return undefined
  if (!isStringArray(categories) || !isStringArray(words) || !isQuestionCount(count)) return undefined
  return { mode: mode as StartMode, categories: [...categories], words: [...words], count }
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
  const allStats = () => (stats ??= load(STATS_KEY, isStats))

  // Saved lists: an array (not a map keyed by name, so any name is safe), one per name.
  let lists: Map<string, string[]> | undefined
  function allLists(): Map<string, string[]> {
    if (lists) return lists
    lists = new Map()
    try {
      const parsed: unknown = JSON.parse(storage()?.getItem(LISTS_KEY) ?? '[]')
      if (Array.isArray(parsed)) for (const l of parsed) if (isSavedList(l)) lists.set(l.name, [...l.ids])
    } catch {
      // unreadable or corrupt: no saved lists
    }
    return lists
  }
  const saveLists = () => save(LISTS_KEY, [...allLists()].map(([name, ids]) => ({ name, ids })))

  let learn: LearnState | undefined
  function learnState(): LearnState {
    if (learn) return learn
    try {
      learn = toLearnState(JSON.parse(storage()?.getItem(LEARN_KEY) ?? 'null'))
    } catch {
      learn = emptyLearnState()
    }
    return learn
  }

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

    /** The start screen's last choice, or undefined if none was saved (or it's unreadable). */
    startChoice(): StartChoice | undefined {
      try {
        return toStartChoice(JSON.parse(storage()?.getItem(START_KEY) ?? 'null'))
      } catch {
        return undefined
      }
    },

    saveStartChoice(choice: StartChoice): void {
      const { mode, categories, words, count } = choice
      save(START_KEY, { mode, categories: [...categories], words: [...words], count })
    },

    /** The saved custom lists, sorted by name. */
    savedLists(): SavedList[] {
      return [...allLists()]
        .map(([name, ids]) => ({ name, ids: [...ids] }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
    },

    /** Save a list under a name, replacing any list already called that. */
    saveList(name: string, ids: readonly string[]): void {
      allLists().set(name, [...ids])
      saveLists()
    },

    deleteList(name: string): void {
      if (allLists().delete(name)) saveLists()
    },

    /** The learn-mode set (empty if it hasn't been started). */
    learnState(): LearnState {
      return structuredClone(learnState())
    },

    saveLearnState(state: LearnState): void {
      learn = structuredClone(state)
      save(LEARN_KEY, learn)
    },

    /** Forget the learn set, to start a new one. The per-word stats are kept. */
    resetLearn(): void {
      learn = emptyLearnState()
      save(LEARN_KEY, learn)
    },
  }
}

export type Store = ReturnType<typeof createStore>

/** The app's store, backed by the browser's localStorage. */
export const store: Store = createStore()
