import { describe, expect, it } from 'vitest'
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

describe('start screen choice', () => {
  it('is undefined until saved, then persists across page loads', () => {
    const storage = new FakeStorage()
    expect(createStore(() => storage).startChoice()).toBeUndefined()
    const choice = { mode: 'list', categories: ['Family', 'Colours'], words: ['fam-01', 'col-02'], count: 20 } as const
    createStore(() => storage).saveStartChoice({ ...choice, categories: [...choice.categories], words: [...choice.words] })
    expect(createStore(() => storage).startChoice()).toEqual(choice)
  })

  it('keeps any whole-number count, not just the presets', () => {
    const storage = new FakeStorage()
    createStore(() => storage).saveStartChoice({ mode: 'categories', categories: ['Family'], words: [], count: 15 })
    expect(createStore(() => storage).startChoice()?.count).toBe(15)
  })

  it('reads a choice saved before custom lists existed as "categories" mode', () => {
    const storage = new FakeStorage()
    storage.setItem('greek-quiz:v1:start', '{"categories":["Family"],"count":10}')
    expect(createStore(() => storage).startChoice()).toEqual({
      mode: 'categories',
      categories: ['Family'],
      words: [],
      count: 10,
    })
  })

  it('ignores corrupt or malformed saved choices', () => {
    const storage = new FakeStorage()
    for (const raw of [
      '{not json',
      '[]',
      '{"categories":"Family","count":10}',
      '{"categories":["Family"],"count":0}',
      '{"categories":["Family"],"count":-3}',
      '{"categories":["Family"],"count":2.5}',
      '{"categories":["Family"],"count":"15"}',
      '{"categories":["Family"]}',
      '{"mode":"words","categories":["Family"],"count":10}',
      '{"mode":"list","categories":["Family"],"words":"fam-01","count":10}',
      '{"mode":"list","categories":["Family"],"words":[1,2],"count":10}',
    ]) {
      storage.setItem('greek-quiz:v1:start', raw)
      expect(createStore(() => storage).startChoice()).toBeUndefined()
    }
  })

  it('is undefined (and saving is a no-op) when storage throws', () => {
    const store = createStore(() => broken)
    store.saveStartChoice({ mode: 'categories', categories: ['Family'], words: [], count: 'all' })
    expect(store.startChoice()).toBeUndefined()
  })
})

describe('saved lists', () => {
  it('saves, replaces and deletes lists by name, and persists them', () => {
    const storage = new FakeStorage()
    const store = createStore(() => storage)
    expect(store.savedLists()).toEqual([])
    store.saveList('Food', ['food-01', 'food-02'])
    store.saveList('animals', ['ani-01'])
    store.saveList('Food', ['food-03']) // same name: replaces
    expect(createStore(() => storage).savedLists()).toEqual([
      { name: 'animals', ids: ['ani-01'] },
      { name: 'Food', ids: ['food-03'] },
    ])
    store.deleteList('animals')
    store.deleteList('nothing by this name')
    expect(createStore(() => storage).savedLists()).toEqual([{ name: 'Food', ids: ['food-03'] }])
  })

  it('sorts by name, ignoring case and with numbers in order', () => {
    const store = createStore(() => new FakeStorage())
    for (const name of ['week 10', 'Week 2', 'apples', 'week 1']) store.saveList(name, ['x'])
    expect(store.savedLists().map((l) => l.name)).toEqual(['apples', 'week 1', 'Week 2', 'week 10'])
  })

  it('takes any name, even ones that look like object keys', () => {
    const storage = new FakeStorage()
    createStore(() => storage).saveList('__proto__', ['a'])
    createStore(() => storage).saveList('constructor', ['b'])
    expect(createStore(() => storage).savedLists()).toEqual([
      { name: '__proto__', ids: ['a'] },
      { name: 'constructor', ids: ['b'] },
    ])
  })

  it('returns copies, not its own state', () => {
    const store = createStore(() => new FakeStorage())
    const ids = ['a']
    store.saveList('L', ids)
    ids.push('changed')
    store.savedLists()[0].ids.push('changed')
    expect(store.savedLists()).toEqual([{ name: 'L', ids: ['a'] }])
  })

  it('skips malformed entries and survives corrupt JSON', () => {
    const storage = new FakeStorage()
    storage.setItem('greek-quiz:v1:lists', '{not json')
    expect(createStore(() => storage).savedLists()).toEqual([])
    storage.setItem(
      'greek-quiz:v1:lists',
      JSON.stringify([{ name: 'ok', ids: ['a'] }, { name: '', ids: [] }, { name: 'bad', ids: 'a' }, { ids: ['a'] }, null]),
    )
    expect(createStore(() => storage).savedLists()).toEqual([{ name: 'ok', ids: ['a'] }])
    storage.setItem('greek-quiz:v1:lists', '{"ok":["a"]}')
    expect(createStore(() => storage).savedLists()).toEqual([])
  })

  it('works for the session when storage throws', () => {
    const store = createStore(() => broken)
    store.saveList('L', ['a'])
    expect(store.savedLists()).toEqual([{ name: 'L', ids: ['a'] }])
  })
})

describe('learn set', () => {
  const state = {
    words: { 'home-01': { streak: 2, added: 100, lastSeen: 300 }, 'fam-02': { streak: 0, added: 200, lastSeen: 0 } },
    recent: [true, false, true],
  }

  it('is empty until saved, then persists across page loads', () => {
    const storage = new FakeStorage()
    expect(createStore(() => storage).learnState()).toEqual({ words: {}, recent: [] })
    createStore(() => storage).saveLearnState(state)
    expect(createStore(() => storage).learnState()).toEqual(state)
  })

  it('returns copies, not its own state', () => {
    const store = createStore(() => new FakeStorage())
    const mine = structuredClone(state)
    store.saveLearnState(mine)
    mine.words['home-01'].streak = 99
    store.learnState().recent.push(false)
    expect(store.learnState()).toEqual(state)
  })

  it('starts over without touching the word stats', () => {
    const storage = new FakeStorage()
    const store = createStore(() => storage)
    store.record('home-01', true, 1)
    store.saveLearnState(state)
    store.resetLearn()
    expect(createStore(() => storage).learnState()).toEqual({ words: {}, recent: [] })
    expect(createStore(() => storage).stats('home-01')).toEqual({ seen: 1, correct: 1, lastSeen: 1 })
  })

  it('skips malformed words and survives corrupt JSON', () => {
    const storage = new FakeStorage()
    storage.setItem('greek-quiz:v1:learn', '{not json')
    expect(createStore(() => storage).learnState()).toEqual({ words: {}, recent: [] })
    storage.setItem(
      'greek-quiz:v1:learn',
      JSON.stringify({
        words: {
          good: { streak: 1, added: 5, lastSeen: 6 },
          negative: { streak: -1, added: 5, lastSeen: 6 },
          partial: { streak: 1 },
          text: { streak: '1', added: 5, lastSeen: 6 },
        },
        recent: [true, 'yes', false, null],
      }),
    )
    expect(createStore(() => storage).learnState()).toEqual({
      words: { good: { streak: 1, added: 5, lastSeen: 6 } },
      recent: [true, false],
    })
    storage.setItem('greek-quiz:v1:learn', '{"words":[],"recent":{}}')
    expect(createStore(() => storage).learnState()).toEqual({ words: {}, recent: [] })
  })

  it('works for the session when storage throws', () => {
    const store = createStore(() => broken)
    store.saveLearnState(state)
    expect(store.learnState()).toEqual(state)
  })

  it('remembers "learn" as the start screen mode', () => {
    const storage = new FakeStorage()
    createStore(() => storage).saveStartChoice({ mode: 'learn', categories: [], words: [], count: 10 })
    expect(createStore(() => storage).startChoice()?.mode).toBe('learn')
  })
})

describe('when storage misbehaves', () => {
  it('works for the session if localStorage throws', () => {
    const store = createStore(() => broken)
    expect(store.stats('home-01')).toBeUndefined()
    store.record('home-01', true, 1000)
    expect(store.stats('home-01')).toEqual({ seen: 1, correct: 1, lastSeen: 1000 })
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
    const fresh = createStore(() => storage)
    expect(fresh.allStats()).toEqual({})

    storage.setItem(
      'greek-quiz:v1:stats',
      JSON.stringify({
        good: { seen: 2, correct: 1, lastSeen: 5 },
        partial: { seen: 2 },
        text: { seen: '2', correct: 1, lastSeen: 5 },
        nothing: null,
      }),
    )
    const mixed = createStore(() => storage)
    expect(Object.keys(mixed.allStats())).toEqual(['good'])

    mixed.record('good', true, 9) // saving rewrites the cleaned-up map
    expect(JSON.parse(storage.getItem('greek-quiz:v1:stats')!)).toEqual({
      good: { seen: 3, correct: 2, lastSeen: 9 },
    })
  })
})
