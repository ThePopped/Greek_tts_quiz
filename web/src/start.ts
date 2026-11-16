// Start screen: choose the words (by category, a hand-picked custom list, or
// the learn set) and how many questions, then start a session.

import {
  boxOf,
  BOXES,
  learnProgress,
  pickLearnSession,
  prepareSession,
  setWords,
  unlockText,
  type Box,
} from './learn'
import { cleanListName, listLink, matchesSearch, MAX_LIST_NAME, sameIds, searchKey, type LinkedList } from './lists'
import {
  categoryTallies,
  percentRight,
  percentText,
  rightText,
  spokenText,
  toneColor,
  wordTally,
  type Tally,
} from './stats'
import type { StartChoice, StartMode, Store } from './storage'
import {
  countByCategory,
  parseQuestionCount,
  pickWords,
  pickWordsById,
  PRESET_COUNTS,
  type QuestionCount,
  type Vocab,
  type Word,
} from './vocab'

const DEFAULT_COUNT: QuestionCount = 10

const BOX_LABELS: Record<Box, string> = { learning: 'Learning', familiar: 'Familiar', mastered: 'Mastered' }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * A progress badge, tinted by percentage right (untinted when never answered).
 * Screen readers hear `spoken` instead of the short visible label.
 */
function statBadge(t: Tally, visible: string, spoken: string, extraClass = ''): string {
  const p = percentRight(t)
  const tone = p === undefined ? '' : ` style="--tone: ${toneColor(p)}"`
  return `<span class="stat${p === undefined ? ' is-new' : ''}${extraClass}"${tone}><span aria-hidden="true">${visible}</span><span class="sr-only">${spoken}</span></span>`
}

/** A category's badge: its percentage right; screen readers also hear the counts. */
function categoryBadge(t: Tally, extraClass = ''): string {
  const spoken = t.seen > 0 ? `${percentText(t)} right. ${spokenText(t)}.` : spokenText(t)
  return statBadge(t, percentText(t), spoken, extraClass)
}

/**
 * The saved choice, with categories and words no longer in the vocab dropped
 * (no categories left falls back to all of them). A link's list, if it has
 * any known words, replaces the saved custom list.
 */
function initialChoice(vocab: Vocab, store: Store, linked: LinkedList | undefined): StartChoice {
  const saved = store.startChoice()
  const known = new Set(vocab.words.map((w) => w.id))
  const categories = saved?.categories.filter((c) => vocab.categories.includes(c)) ?? []
  const choice: StartChoice = {
    mode: saved?.mode ?? 'categories',
    categories: categories.length > 0 ? categories : [...vocab.categories],
    words: saved?.words.filter((id) => known.has(id)) ?? [],
    count: saved?.count ?? DEFAULT_COUNT,
  }
  return linked && linked.ids.length > 0 ? { ...choice, mode: 'list', words: linked.ids } : choice
}

function linkNotice(linked: LinkedList | undefined): string {
  if (!linked) return ''
  if (linked.ids.length === 0) return 'None of the words in that link were found.'
  const skipped =
    linked.skipped > 0 ? ` ${plural(linked.skipped, 'word')} in the link ${linked.skipped === 1 ? "wasn't" : "weren't"} found.` : ''
  return `Opened a shared list of ${plural(linked.ids.length, 'word')}.${skipped} Save it to keep it on this device.`
}

export function renderStart(
  root: HTMLElement,
  vocab: Vocab,
  store: Store,
  onStart: (words: Word[], mode: StartMode) => void,
  linked?: LinkedList,
): void {
  const counts = countByCategory(vocab.words)
  const known = new Set(vocab.words.map((w) => w.id))
  const initial = initialChoice(vocab, store, linked)
  const initialWords = new Set(initial.words)
  const stats = store.allStats()
  const tallies = categoryTallies(vocab.words, stats)
  const tallyOf = (category: string): Tally => tallies.get(category) ?? { seen: 0, correct: 0 }

  const radio = (name: string, value: string, label: string, checked: boolean) => `
      <label class="pill">
        <input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''} />
        <span>${label}</span>
      </label>`

  const categoryBoxes = vocab.categories
    .map((name, i) => {
      const checked = initial.categories.includes(name) ? ' checked' : ''
      const t = tallyOf(name)
      const answered = t.seen > 0 ? ` · ${rightText(t)}` : ''
      return `
        <label class="category">
          <input type="checkbox" name="category" value="${i}"${checked} />
          <span class="category-text">
            <span class="category-name">${escapeHtml(name)}</span>
            <span class="category-detail">${plural(counts.get(name) ?? 0, 'word')}<span aria-hidden="true">${answered}</span></span>
          </span>
          ${categoryBadge(t)}
        </label>`
    })
    .join('')

  // Every word, grouped under its category; a checkbox's value is the word's index in vocab.words.
  const wordGroups = vocab.categories
    .map((category) => {
      const rows = vocab.words
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => w.category === category)
        .map(({ w, i }) => {
          const checked = initialWords.has(w.id) ? ' checked' : ''
          const t = wordTally(stats, w.id)
          return `
          <label class="word">
            <input type="checkbox" name="word" value="${i}"${checked} />
            <span class="word-text">
              <span class="word-greek" lang="el">${escapeHtml(w.greek)}</span>
              <span class="word-english">${escapeHtml(w.answers.join(', '))}</span>
            </span>
            ${statBadge(t, rightText(t), spokenText(t), ' stat-word')}
          </label>`
        })
        .join('')
      return `
        <section class="word-group">
          <h3><span>${escapeHtml(category)}</span>${categoryBadge(tallyOf(category), ' stat-heading')}</h3>
          ${rows}
        </section>`
    })
    .join('')

  const isPreset = PRESET_COUNTS.includes(initial.count)
  const presetRadios = PRESET_COUNTS.map((n) =>
    radio('count', String(n), n === 'all' ? 'All' : String(n), n === initial.count),
  ).join('')
  // Any other number: a fourth pill holding a small number box.
  const otherRadio = `
      <label class="pill count-other">
        <input type="radio" name="count" value="other"${isPreset ? '' : ' checked'} />
        <input type="text" class="count-input" inputmode="numeric" pattern="[0-9]*" maxlength="4"
          autocomplete="off" placeholder="Other" aria-label="Other number of questions"
          value="${isPreset ? '' : initial.count}" />
      </label>`

  root.innerHTML = `
    <main class="start">
      <h1>Greek Listening Quiz</h1>
      <p class="lede">Hear a Greek word, type what it means in English.</p>
      <p class="notice" role="status"${linked ? '' : ' hidden'}>${escapeHtml(linkNotice(linked))}</p>
      <form class="start-form">
        <div class="pills modes" role="radiogroup" aria-label="Choose words">
          ${radio('mode', 'categories', 'By category', initial.mode === 'categories')}
          ${radio('mode', 'list', 'Custom list', initial.mode === 'list')}
          ${radio('mode', 'learn', 'Learn', initial.mode === 'learn')}
        </div>
        <fieldset class="by-categories">
          <legend>Categories</legend>
          <div class="select-actions">
            <button type="button" data-select="all">Select all</button>
            <button type="button" data-select="none">Select none</button>
          </div>
          <div class="categories">${categoryBoxes}</div>
        </fieldset>
        <fieldset class="by-list">
          <legend>Words</legend>
          <div class="list-row saved-lists">
            <select class="list-select" aria-label="Saved lists"></select>
            <button type="button" class="list-delete">Delete</button>
          </div>
          <div class="list-row">
            <input type="text" class="list-name text-input" maxlength="${MAX_LIST_NAME}" autocomplete="off"
              enterkeyhint="done" placeholder="Name this list" aria-label="List name" />
            <button type="button" class="list-save">Save</button>
            <button type="button" class="list-share">Get link</button>
          </div>
          <p class="list-status" aria-live="polite"></p>
          <input type="text" class="list-link text-input" readonly aria-label="Link to this list" hidden />
          <input type="search" class="word-search text-input" autocomplete="off" enterkeyhint="search"
            placeholder="Search Greek or English" aria-label="Search words" />
          <div class="select-actions">
            <button type="button" class="tick-shown">Tick all</button>
            <button type="button" class="untick-all">Untick all</button>
            <label class="ticked-only"><input type="checkbox" /> Ticked only</label>
          </div>
          <div class="word-groups">${wordGroups}</div>
          <p class="no-matches" hidden>No words match.</p>
        </fieldset>
        <fieldset class="by-learn">
          <legend>Learn</legend>
          <p class="learn-intro">Learn a small set of words well. New ones are added a few at a time, once you know the ones you have.</p>
          <div class="learn-panel"></div>
          <button type="button" class="learn-reset">Start over</button>
        </fieldset>
        <fieldset>
          <legend>Questions</legend>
          <div class="pills">${presetRadios}${otherRadio}</div>
        </fieldset>
        <div class="start-footer">
          <p class="summary" aria-live="polite"></p>
          <button type="submit" class="start-button primary">Start</button>
        </div>
      </form>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const form = $<HTMLFormElement>('.start-form')
  const categoryBoxesEl = [...form.querySelectorAll<HTMLInputElement>('input[name="category"]')]
  const wordBoxes = [...form.querySelectorAll<HTMLInputElement>('input[name="word"]')]
  const wordRows = wordBoxes.map((box) => box.closest<HTMLElement>('.word')!)
  const searchKeys = vocab.words.map(searchKey)
  const groups = [...form.querySelectorAll<HTMLElement>('.word-group')]
  const summary = $<HTMLParagraphElement>('.summary')
  const startButton = $<HTMLButtonElement>('.start-button')
  const otherButton = $<HTMLInputElement>('input[name="count"][value="other"]')
  const otherInput = $<HTMLInputElement>('.count-input')
  const byCategories = $<HTMLFieldSetElement>('.by-categories')
  const byList = $<HTMLFieldSetElement>('.by-list')
  const savedListsRow = $('.saved-lists')
  const listSelect = $<HTMLSelectElement>('.list-select')
  const deleteButton = $<HTMLButtonElement>('.list-delete')
  const nameInput = $<HTMLInputElement>('.list-name')
  const saveButton = $<HTMLButtonElement>('.list-save')
  const shareButton = $<HTMLButtonElement>('.list-share')
  const listStatus = $<HTMLParagraphElement>('.list-status')
  const linkInput = $<HTMLInputElement>('.list-link')
  const search = $<HTMLInputElement>('.word-search')
  const tickShown = $<HTMLButtonElement>('.tick-shown')
  const tickedOnly = $<HTMLInputElement>('.ticked-only input')
  const noMatches = $<HTMLParagraphElement>('.no-matches')
  const byLearn = $<HTMLFieldSetElement>('.by-learn')
  const learnPanel = $('.learn-panel')
  const learnReset = $<HTMLButtonElement>('.learn-reset')

  function mode(): StartMode {
    const value = form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value
    return value === 'list' || value === 'learn' ? value : 'categories'
  }
  const tickedIds = () => wordBoxes.filter((b) => b.checked).map((b) => vocab.words[Number(b.value)].id)

  /** The current choice; `count` is undefined when "Other" is picked but its box isn't a valid number. */
  function currentChoice(): Omit<StartChoice, 'count'> & { count: QuestionCount | undefined } {
    const categories = categoryBoxesEl.filter((b) => b.checked).map((b) => vocab.categories[Number(b.value)])
    const raw = form.querySelector<HTMLInputElement>('input[name="count"]:checked')?.value
    const count: QuestionCount | undefined =
      raw === 'other' ? parseQuestionCount(otherInput.value) : raw === 'all' ? 'all' : Number(raw)
    return { mode: mode(), categories, words: tickedIds(), count }
  }

  function update(): void {
    const { mode, categories, words, count } = currentChoice()
    byCategories.hidden = mode !== 'categories'
    byList.hidden = mode !== 'list'
    byLearn.hidden = mode !== 'learn'

    const ticked = words.length
    saveButton.disabled = ticked === 0
    shareButton.disabled = ticked === 0
    deleteButton.disabled = listSelect.value === ''

    if (mode === 'learn') {
      const { total, unlock } = learnProgress(store.learnState(), vocab.words)
      const adds = unlock.kind === 'start' || unlock.kind === 'ready' ? unlock.adds : 0
      const available = total + adds
      startButton.disabled = count === undefined || available === 0
      if (count === undefined) summary.textContent = 'Type how many questions.'
      else {
        const questions = count === 'all' ? available : Math.min(count, available)
        const isNew = adds === 0 ? '' : adds === available ? ', all new' : `, ${adds} of them new`
        summary.textContent = `${plural(questions, 'question')} from your set of ${plural(available, 'word')}${isNew}.`
      }
      return
    }

    const available =
      mode === 'list' ? ticked : categories.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0)
    if (available === 0 || count === undefined) {
      startButton.disabled = true
      summary.textContent =
        available > 0 ? 'Type how many questions.' : mode === 'list' ? 'Tick at least one word.' : 'Choose at least one category.'
      return
    }
    const questions = count === 'all' ? available : Math.min(count, available)
    startButton.disabled = false
    summary.textContent = `${plural(questions, 'question')} from ${plural(available, 'word')}.`
  }

  // ---- Search and filters ----

  function applyFilter(): void {
    const query = search.value
    const onlyTicked = tickedOnly.checked
    let shown = 0
    wordRows.forEach((row, i) => {
      const visible = matchesSearch(searchKeys[i], query) && (!onlyTicked || wordBoxes[i].checked)
      row.hidden = !visible
      if (visible) shown++
    })
    for (const group of groups) group.hidden = !group.querySelector('.word:not([hidden])')
    noMatches.hidden = shown > 0
    noMatches.textContent = onlyTicked && query.trim() === '' ? 'No words ticked yet.' : 'No words match.'
    tickShown.textContent = query.trim() === '' && !onlyTicked ? 'Tick all' : 'Tick shown'
  }

  // ---- Saved lists ----

  /** The saved lists, keeping only ids still in the vocab. */
  const savedLists = () => store.savedLists().map((l) => ({ ...l, ids: l.ids.filter((id) => known.has(id)) }))

  function fillListSelect(selected: string): void {
    const lists = savedLists()
    listSelect.replaceChildren(
      new Option('New list', ''),
      ...lists.map((l) => new Option(`${l.name} (${l.ids.length})`, l.name)),
    )
    listSelect.value = lists.some((l) => l.name === selected) ? selected : ''
    savedListsRow.hidden = lists.length === 0
  }

  function setTicks(ids: Iterable<string>): void {
    const wanted = new Set(ids)
    wordBoxes.forEach((box, i) => (box.checked = wanted.has(vocab.words[i].id)))
    ticksChanged()
  }

  /** After ticks change: an old link no longer matches, and a loaded list may now differ from its saved copy. */
  function ticksChanged(): void {
    linkInput.hidden = true
    const loaded = savedLists().find((l) => l.name === listSelect.value)
    listStatus.textContent = loaded && !sameIds(loaded.ids, tickedIds()) ? `Changed since saved. Save to update “${loaded.name}”.` : ''
    applyFilter()
  }

  listSelect.addEventListener('change', () => {
    const list = savedLists().find((l) => l.name === listSelect.value)
    if (list) {
      nameInput.value = list.name
      setTicks(list.ids)
      listStatus.textContent = `Loaded “${list.name}”.`
    } else {
      nameInput.value = '' // "New list": keep the ticks, ready to save under a new name
      listStatus.textContent = ''
    }
    update()
  })

  function saveList(): void {
    const name = cleanListName(nameInput.value)
    const ids = tickedIds()
    if (ids.length === 0) return
    if (name === '') {
      listStatus.textContent = 'Type a name for the list first.'
      nameInput.focus()
      return
    }
    const exists = savedLists().some((l) => l.name === name)
    if (exists && name !== listSelect.value && !confirm(`Replace the saved list “${name}”?`)) return
    store.saveList(name, ids)
    fillListSelect(name)
    nameInput.value = name
    listStatus.textContent = `Saved “${name}” (${plural(ids.length, 'word')}).`
    update()
  }

  saveButton.addEventListener('click', saveList)

  deleteButton.addEventListener('click', () => {
    const name = listSelect.value
    if (name === '' || !confirm(`Delete the list “${name}”? The ticked words stay ticked.`)) return
    store.deleteList(name)
    fillListSelect('')
    nameInput.value = ''
    listStatus.textContent = `Deleted “${name}”.`
    update()
  })

  shareButton.addEventListener('click', async () => {
    const ids = tickedIds()
    if (ids.length === 0) return
    linkInput.value = listLink(ids, location.origin + location.pathname)
    linkInput.hidden = false
    linkInput.select()
    try {
      await navigator.clipboard.writeText(linkInput.value)
      listStatus.textContent = 'Link copied. Open it on another device to get this list there.'
    } catch {
      listStatus.textContent = 'Copy this link to open the list on another device:'
    }
  })
  linkInput.addEventListener('focus', () => linkInput.select())

  // ---- Learn set ----

  /** The set's progress: a count per box, what unlocks new words, and the words themselves. */
  function showLearn(): void {
    const state = store.learnState()
    const progress = learnProgress(state, vocab.words)
    learnReset.hidden = progress.total === 0
    $('.learn-intro').hidden = progress.total > 0
    const status = `<p class="learn-status">${escapeHtml(unlockText(progress.unlock))}</p>`
    if (progress.total === 0) {
      learnPanel.innerHTML = status
      return
    }
    const tiles = BOXES.map(
      (box) => `
        <div class="learn-box" data-box="${box}">
          <span class="learn-count">${progress.counts[box]}</span>
          <span class="learn-label">${BOX_LABELS[box]}</span>
        </div>`,
    ).join('')
    const inSet = setWords(state, vocab.words)
    const groups = BOXES.map((box) => {
      const rows = inSet
        .filter(({ entry }) => boxOf(entry) === box)
        .sort((a, b) => b.entry.added - a.entry.added)
        .map(
          ({ word, entry }) => `
          <li class="learn-word">
            <span class="word-text">
              <span class="word-greek" lang="el">${escapeHtml(word.greek)}</span>
              <span class="word-english">${escapeHtml(word.answers.join(', '))}</span>
            </span>
            <span class="learn-streak">${entry.streak > 0 ? `${entry.streak} in a row` : entry.lastSeen === 0 ? 'new' : 'missed last time'}</span>
          </li>`,
        )
        .join('')
      return rows === '' ? '' : `<h3>${BOX_LABELS[box]} (${progress.counts[box]})</h3><ul>${rows}</ul>`
    }).join('')
    learnPanel.innerHTML = `
      <p class="learn-total">${plural(progress.total, 'word')} in your set, ${progress.remaining} still to come.</p>
      <div class="learn-boxes">${tiles}</div>
      ${status}
      <details class="learn-words">
        <summary>Words in your set</summary>
        <div class="learn-groups">${groups}</div>
      </details>`
  }

  learnReset.addEventListener('click', () => {
    const { total } = learnProgress(store.learnState(), vocab.words)
    if (!confirm(`Start over? Your learn set of ${plural(total, 'word')} is cleared. Your answer stats are kept.`)) return
    store.resetLearn()
    showLearn()
    update()
  })

  // ---- Wiring ----

  form.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement
    if (target === otherButton) otherInput.focus() // picked "Other": ready to type
    if (target.name === 'word') ticksChanged()
    if (target === tickedOnly) applyFilter()
    update()
  })
  form.addEventListener('input', (e) => {
    if (e.target === search) applyFilter()
    update() // the number box, as each digit is typed
  })

  // Enter in the search or name box shouldn't start the quiz.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      search.blur() // closes the phone keyboard
    }
  })
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveList()
    }
  })

  // Tapping or typing in the number box selects "Other".
  otherInput.addEventListener('focus', () => {
    if (!otherButton.checked) {
      otherButton.checked = true
      update()
    }
  })

  byCategories.querySelector('.select-actions')!.addEventListener('click', (e) => {
    const which = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.select
    if (!which) return
    for (const b of categoryBoxesEl) b.checked = which === 'all'
    update()
  })

  tickShown.addEventListener('click', () => {
    wordBoxes.forEach((box, i) => {
      if (!wordRows[i].hidden) box.checked = true
    })
    ticksChanged()
    update()
  })
  $('.untick-all').addEventListener('click', () => {
    setTicks([])
    update()
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const { mode, categories, words: ids, count } = currentChoice()
    if (count === undefined) return
    let words: Word[]
    if (mode === 'learn') {
      // Start the set, or add new words if it's ready for them, then pick from it.
      const { state } = prepareSession(store.learnState(), vocab.words, Date.now())
      store.saveLearnState(state)
      words = pickLearnSession(state, vocab.words, count)
    } else {
      words = mode === 'list' ? pickWordsById(vocab.words, ids, count) : pickWords(vocab.words, categories, count)
    }
    if (words.length === 0) return
    store.saveStartChoice({ mode, categories, words: ids, count })
    onStart(words, mode)
  })

  // A saved list holding exactly the starting ticks shows as loaded.
  const matching = initial.words.length > 0 ? savedLists().find((l) => sameIds(l.ids, initial.words)) : undefined
  fillListSelect(matching?.name ?? '')
  nameInput.value = matching?.name ?? ''
  showLearn()
  applyFilter()
  update()
}
