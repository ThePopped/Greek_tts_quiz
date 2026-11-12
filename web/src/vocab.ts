// The word list written by the pipeline (public/vocab.json), and choosing
// which words go into a quiz session.

export interface Word {
  id: string
  greek: string
  answers: string[]
  category: string
  pos: string
  notes: string
  /** Path of the clip, relative to the site root (e.g. "audio/phr-01.mp3"). */
  audio: string
}

export interface Vocab {
  /** Category names in the order the CSV lists them. */
  categories: string[]
  words: Word[]
}

/** How many questions a session has: a fixed number, or every chosen word. */
export type QuestionCount = 10 | 20 | 'all'
export const QUESTION_COUNTS: readonly QuestionCount[] = [10, 20, 'all']

function isWord(value: unknown): value is Word {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Record<string, unknown>
  return (
    ['id', 'greek', 'category', 'pos', 'notes', 'audio'].every((k) => typeof w[k] === 'string') &&
    Array.isArray(w.answers) &&
    w.answers.length > 0 &&
    w.answers.every((a) => typeof a === 'string')
  )
}

/** Check the shape of parsed vocab.json; throws with a short reason if it's wrong. */
export function parseVocab(data: unknown): Vocab {
  if (typeof data !== 'object' || data === null) throw new Error('vocab.json is not an object')
  const { categories, words } = data as Record<string, unknown>
  if (!Array.isArray(categories) || !categories.every((c) => typeof c === 'string')) {
    throw new Error('vocab.json has no list of categories')
  }
  if (!Array.isArray(words) || words.length === 0) throw new Error('vocab.json has no words')
  const bad = words.findIndex((w) => !isWord(w))
  if (bad !== -1) throw new Error(`vocab.json word ${bad} is malformed`)
  return { categories, words: words as Word[] }
}

/** Fetch and check vocab.json, relative to the site's base URL. */
export async function loadVocab(url = `${import.meta.env.BASE_URL}vocab.json`): Promise<Vocab> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load the word list (HTTP ${res.status})`)
  return parseVocab(await res.json())
}

/** Number of words in each category. */
export function countByCategory(words: readonly Word[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const w of words) counts.set(w.category, (counts.get(w.category) ?? 0) + 1)
  return counts
}

/** A shuffled copy of `items` (Fisher–Yates). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Words for one session: a random selection of `count` words (or all of them)
 * from the chosen categories, in random order.
 */
export function pickWords(
  words: readonly Word[],
  categories: Iterable<string>,
  count: QuestionCount,
  random: () => number = Math.random,
): Word[] {
  const chosen = new Set(categories)
  const pool = shuffle(
    words.filter((w) => chosen.has(w.category)),
    random,
  )
  return count === 'all' ? pool : pool.slice(0, count)
}
