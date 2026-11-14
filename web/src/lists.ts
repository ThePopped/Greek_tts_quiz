// Custom word lists: share links (?list=id,id,…), word search, and list names.

import type { Word } from './vocab'

export const LIST_PARAM = 'list'
export const MAX_LIST_NAME = 40

/** The words a `?list=` link asked for. */
export interface LinkedList {
  /** Known ids, in link order, without repeats. */
  ids: string[]
  /** How many ids in the link aren't in the vocab (removed or mistyped). */
  skipped: number
}

/** Read the `?list=` parameter of a query string, or undefined if it has none. */
export function parseListParam(search: string, known: ReadonlySet<string>): LinkedList | undefined {
  const raw = new URLSearchParams(search).get(LIST_PARAM)
  if (raw === null) return undefined
  const ids = new Set<string>()
  const unknown = new Set<string>()
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (id === '') continue
    if (known.has(id)) ids.add(id)
    else unknown.add(id)
  }
  return { ids: [...ids], skipped: unknown.size }
}

/** A link to `page` (the app's URL, without a query) that opens these words in the picker. */
export function listLink(ids: readonly string[], page: string): string {
  return `${page}?${LIST_PARAM}=${ids.map(encodeURIComponent).join(',')}`
}

/** Fold text for searching: no accents, lower case, final ς as σ, single spaces. */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** What a word is found by: its Greek and every accepted English answer, folded. */
export function searchKey(word: Pick<Word, 'greek' | 'answers'>): string {
  return foldForSearch([word.greek, ...word.answers].join(' | '))
}

/** Whether a word's search key contains the (folded) query. An empty query matches everything. */
export function matchesSearch(key: string, query: string): boolean {
  return key.includes(foldForSearch(query))
}

/** A list name as typed, tidied: trimmed, single spaces, at most MAX_LIST_NAME characters. */
export function cleanListName(text: string): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_LIST_NAME).join('').trim()
}

/** Whether two id lists hold the same ids, ignoring order and repeats. */
export function sameIds(a: Iterable<string>, b: Iterable<string>): boolean {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every((id) => y.has(id))
}
