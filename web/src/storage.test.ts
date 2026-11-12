import { describe, expect, it } from 'vitest'
import { grade } from './grading'
import { createStore } from './storage'

/** An in-memory stand-in for localStorage. */
class FakeStorage {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

/** Storage that throws on every call, like a blocked or full localStorage. */
const broken = {
  getItem(): string | null {
    throw new Error('SecurityError')
  },
  setItem(): void {
    throw new Error('QuotaExceededError')
  },
}

const HOUSE = { id: 'home-01', answers: ['house', 'home'] }

describe('word stats', () => {
  it('starts empty', () => {
    const store = createStore(() => new FakeStorage())
    expect(store.stats('home-01')).toBeUndefined()
    expect(store.allStats()).toEqual({})
  })

  it('counts seen, correct and when last seen', () => {
    const store = createStore(() => new FakeStorage())
    store.record('home-01', true, 1000)
    store.record('home-01', false, 2000)
    expect(store.record('home-01', true, 3000)).toEqual({ seen: 3, correct: 2, lastSeen: 3000 })
    store.record('num-05', false, 4000)
    expect(store.allStats()).toEqual({
      'home-01': { seen: 3, correct: 2, lastSeen: 3000 },
      'num-05': { seen: 1, correct: 0, lastSeen: 4000 },
    })
  })

  it('persists across page loads', () => {
    const storage = new FakeStorage()
    createStore(() => storage).record('home-01', true, 1000)
    expect(createStore(() => storage).stats('home-01')).toEqual({ seen: 1, correct: 1, lastSeen: 1000 })
  })

  it('returns copies, not its own state', () => {
    const store = createStore(() => new FakeStorage())
    store.record('home-01', true, 1000)
    store.stats('home-01')!.seen = 99
    store.allStats()['home-01'].seen = 99
    expect(store.stats('home-01')!.seen).toBe(1)
  })
})

describe('added answers', () => {
  it('are accepted alongside the vocab answers', () => {
    const store = createStore(() => new FakeStorage())
    expect(store.acceptedAnswers(HOUSE)).toEqual(['house', 'home'])
    expect(grade('dwelling', store.acceptedAnswers(HOUSE)).verdict).toBe('wrong')

    store.addAnswer('home-01', ' dwelling ')
    expect(store.addedAnswers('home-01')).toEqual(['dwelling'])
    expect(store.acceptedAnswers(HOUSE)).toEqual(['house', 'home', 'dwelling'])
    expect(grade('Dwelling', store.acceptedAnswers(HOUSE)).verdict).toBe('correct')
    expect(store.addedAnswers('num-05')).toEqual([])
  })

  it('ignore blanks and repeats that differ only in case, accents or punctuation', () => {
    const store = createStore(() => new FakeStorage())
    store.addAnswer('home-01', 'a dwelling')
    store.addAnswer('home-01', 'Dwelling!')
    store.addAnswer('home-01', '   ')
    store.addAnswer('home-01', '?!')
    expect(store.addedAnswers('home-01')).toEqual(['a dwelling'])
  })

  it('persist across page loads', () => {
    const storage = new FakeStorage()
    createStore(() => storage).addAnswer('home-01', 'dwelling')
    expect(createStore(() => storage).addedAnswers('home-01')).toEqual(['dwelling'])
  })
})

describe('start screen choice', () => {
  it('is undefined until saved, then persists across page loads', () => {
    const storage = new FakeStorage()
    expect(createStore(() => storage).startChoice()).toBeUndefined()
    createStore(() => storage).saveStartChoice({ categories: ['Family', 'Colours'], count: 20 })
    expect(createStore(() => storage).startChoice()).toEqual({ categories: ['Family', 'Colours'], count: 20 })
  })

  it('ignores corrupt or malformed saved choices', () => {
    const storage = new FakeStorage()
    for (const raw of ['{not json', '[]', '{"categories":["Family"],"count":15}', '{"categories":"Family","count":10}']) {
      storage.setItem('greek-quiz:v1:start', raw)
      expect(createStore(() => storage).startChoice()).toBeUndefined()
    }
  })

  it('is undefined (and saving is a no-op) when storage throws', () => {
    const store = createStore(() => broken)
    store.saveStartChoice({ categories: ['Family'], count: 'all' })
    expect(store.startChoice()).toBeUndefined()
  })
})

describe('when storage misbehaves', () => {
  it('works for the session if localStorage throws', () => {
    const store = createStore(() => broken)
    expect(store.stats('home-01')).toBeUndefined()
    store.record('home-01', true, 1000)
    store.addAnswer('home-01', 'dwelling')
    expect(store.stats('home-01')).toEqual({ seen: 1, correct: 1, lastSeen: 1000 })
    expect(store.acceptedAnswers(HOUSE)).toContain('dwelling')
  })

  it('works if localStorage is missing or its getter throws', () => {
    for (const getStorage of [
      () => undefined,
      () => {
        throw new Error('SecurityError')
      },
    ]) {
      const store = createStore(getStorage)
      store.record('home-01', false, 1000)
      expect(store.stats('home-01')).toEqual({ seen: 1, correct: 0, lastSeen: 1000 })
    }
  })

  it('works without the browser default (Node has no localStorage)', () => {
    const store = createStore()
    store.record('home-01', true, 1000)
    expect(store.stats('home-01')?.seen).toBe(1)
  })

  it('starts fresh from corrupt JSON and skips malformed entries', () => {
    const storage = new FakeStorage()
    storage.setItem('greek-quiz:v1:stats', '{not json')
    storage.setItem('greek-quiz:v1:answers', '["not", "a", "map"]')
    const fresh = createStore(() => storage)
    expect(fresh.allStats()).toEqual({})
    expect(fresh.addedAnswers('home-01')).toEqual([])

    storage.setItem(
      'greek-quiz:v1:stats',
      JSON.stringify({
        good: { seen: 2, correct: 1, lastSeen: 5 },
        partial: { seen: 2 },
        text: { seen: '2', correct: 1, lastSeen: 5 },
        nothing: null,
      }),
    )
    storage.setItem('greek-quiz:v1:answers', JSON.stringify({ good: ['x'], bad: 'x', mixed: ['x', 1] }))
    const mixed = createStore(() => storage)
    expect(Object.keys(mixed.allStats())).toEqual(['good'])
    expect(mixed.addedAnswers('good')).toEqual(['x'])
    expect(mixed.addedAnswers('bad')).toEqual([])
    expect(mixed.addedAnswers('mixed')).toEqual([])

    mixed.record('good', true, 9) // saving rewrites the cleaned-up map
    expect(JSON.parse(storage.getItem('greek-quiz:v1:stats')!)).toEqual({
      good: { seen: 3, correct: 2, lastSeen: 9 },
    })
  })
})
