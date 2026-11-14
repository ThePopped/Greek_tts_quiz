import { describe, expect, it } from 'vitest'
import realVocab from '../public/vocab.json'
import { cleanListName, foldForSearch, listLink, matchesSearch, parseListParam, sameIds, searchKey } from './lists'
import { parseVocab } from './vocab'

const KNOWN = new Set(['fam-01', 'fam-02', 'food-12', 'col-03'])

describe('parseListParam', () => {
  it('is undefined without a list parameter', () => {
    expect(parseListParam('', KNOWN)).toBeUndefined()
    expect(parseListParam('?other=1', KNOWN)).toBeUndefined()
  })

  it('reads known ids in order, without repeats or blanks', () => {
    expect(parseListParam('?list=food-12,fam-01, col-03 ,,fam-01', KNOWN)).toEqual({
      ids: ['food-12', 'fam-01', 'col-03'],
      skipped: 0,
    })
  })

  it('counts unknown ids as skipped', () => {
    expect(parseListParam('?list=fam-01,gone-99,typo,gone-99', KNOWN)).toEqual({ ids: ['fam-01'], skipped: 2 })
    expect(parseListParam('?list=gone-99', KNOWN)).toEqual({ ids: [], skipped: 1 })
    expect(parseListParam('?list=', KNOWN)).toEqual({ ids: [], skipped: 0 })
  })

  it('accepts commas encoded as %2C (some apps re-encode links)', () => {
    expect(parseListParam('?list=fam-01%2Cfam-02', KNOWN)?.ids).toEqual(['fam-01', 'fam-02'])
  })
})

describe('listLink', () => {
  it('round-trips through parseListParam', () => {
    const page = 'https://example.github.io/Greek_tts_quiz/'
    const link = listLink(['fam-02', 'col-03'], page)
    expect(link).toBe('https://example.github.io/Greek_tts_quiz/?list=fam-02,col-03')
    expect(parseListParam(new URL(link).search, KNOWN)?.ids).toEqual(['fam-02', 'col-03'])
  })

  it('keeps every real word id link-safe', () => {
    const vocab = parseVocab(realVocab)
    const ids = vocab.words.map((w) => w.id)
    const link = listLink(ids, 'https://example.com/')
    expect(parseListParam(new URL(link).search, new Set(ids))).toEqual({ ids, skipped: 0 })
  })
})

describe('search', () => {
  it('ignores accents, case and final sigma', () => {
    expect(foldForSearch('Σπίτι')).toBe('σπιτι')
    expect(foldForSearch('  Καλός  ')).toBe('καλοσ')
    const key = searchKey({ greek: 'το σπίτι', answers: ['house', 'home'] })
    for (const q of ['σπιτι', 'ΣΠΊΤΙ', 'το σπ', 'HOME', 'hou', '', '  ']) expect(matchesSearch(key, q)).toBe(true)
    for (const q of ['car', 'σπίτια']) expect(matchesSearch(key, q)).toBe(false)
    expect(matchesSearch(searchKey({ greek: 'καλός', answers: ['good'] }), 'καλοσ')).toBe(true)
    expect(matchesSearch(searchKey({ greek: 'καλός', answers: ['good'] }), 'καλός')).toBe(true)
  })

  it('finds a word by any of its answers', () => {
    const key = searchKey({ greek: 'γεια σου', answers: ['hello', 'hi', 'bye', 'goodbye'] })
    expect(matchesSearch(key, 'goodbye')).toBe(true)
  })
})

describe('cleanListName', () => {
  it('trims, collapses spaces and caps the length', () => {
    expect(cleanListName('  Food   week 1 ')).toBe('Food week 1')
    expect(cleanListName('   ')).toBe('')
    expect(cleanListName('x'.repeat(60))).toHaveLength(40)
    expect(cleanListName('λέξεις '.repeat(10)).length).toBeLessThanOrEqual(40)
  })
})

describe('sameIds', () => {
  it('compares as sets', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameIds(['a', 'b', 'a'], ['b', 'a'])).toBe(true)
    expect(sameIds(['a'], ['a', 'b'])).toBe(false)
    expect(sameIds([], [])).toBe(true)
  })
})
