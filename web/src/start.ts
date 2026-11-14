// Start screen: choose categories and how many questions, then start a session.

import type { StartChoice, Store } from './storage'
import {
  countByCategory,
  parseQuestionCount,
  pickWords,
  PRESET_COUNTS,
  type QuestionCount,
  type Vocab,
  type Word,
} from './vocab'

const DEFAULT_COUNT: QuestionCount = 10

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** The saved choice, with any categories no longer in the vocab dropped. Falls back to everything. */
function initialChoice(vocab: Vocab, store: Store): StartChoice {
  const saved = store.startChoice()
  const categories = saved?.categories.filter((c) => vocab.categories.includes(c)) ?? []
  return {
    categories: categories.length > 0 ? categories : [...vocab.categories],
    count: saved?.count ?? DEFAULT_COUNT,
  }
}

export function renderStart(
  root: HTMLElement,
  vocab: Vocab,
  store: Store,
  onStart: (words: Word[]) => void,
): void {
  const counts = countByCategory(vocab.words)
  const initial = initialChoice(vocab, store)

  const categoryBoxes = vocab.categories
    .map((name, i) => {
      const checked = initial.categories.includes(name) ? ' checked' : ''
      return `
        <label class="category">
          <input type="checkbox" name="category" value="${i}"${checked} />
          <span class="category-name">${escapeHtml(name)}</span>
          <span class="category-count">${counts.get(name) ?? 0}</span>
        </label>`
    })
    .join('')

  const isPreset = PRESET_COUNTS.includes(initial.count)
  const presetRadios = PRESET_COUNTS.map((n) => {
    const checked = n === initial.count ? ' checked' : ''
    return `
      <label class="count">
        <input type="radio" name="count" value="${n}"${checked} />
        <span>${n === 'all' ? 'All' : n}</span>
      </label>`
  }).join('')
  // Any other number: a fourth pill holding a small number box.
  const otherRadio = `
      <label class="count count-other">
        <input type="radio" name="count" value="other"${isPreset ? '' : ' checked'} />
        <input type="text" class="count-input" inputmode="numeric" pattern="[0-9]*" maxlength="4"
          autocomplete="off" placeholder="Other" aria-label="Other number of questions"
          value="${isPreset ? '' : initial.count}" />
      </label>`

  root.innerHTML = `
    <main class="start">
      <h1>Greek Listening Quiz</h1>
      <p class="lede">Hear a Greek word, type what it means in English.</p>
      <form class="start-form">
        <fieldset>
          <legend>Categories</legend>
          <div class="category-actions">
            <button type="button" data-select="all">Select all</button>
            <button type="button" data-select="none">Select none</button>
          </div>
          <div class="categories">${categoryBoxes}</div>
        </fieldset>
        <fieldset>
          <legend>Questions</legend>
          <div class="counts">${presetRadios}${otherRadio}</div>
        </fieldset>
        <div class="start-footer">
          <p class="summary" aria-live="polite"></p>
          <button type="submit" class="start-button primary">Start</button>
        </div>
      </form>
    </main>`

  const form = root.querySelector<HTMLFormElement>('.start-form')!
  const boxes = [...form.querySelectorAll<HTMLInputElement>('input[name="category"]')]
  const summary = form.querySelector<HTMLParagraphElement>('.summary')!
  const startButton = form.querySelector<HTMLButtonElement>('.start-button')!
  const otherButton = form.querySelector<HTMLInputElement>('input[name="count"][value="other"]')!
  const otherInput = form.querySelector<HTMLInputElement>('.count-input')!

  /** The current choice; `count` is undefined when "Other" is picked but its box isn't a valid number. */
  function currentChoice(): { categories: string[]; count: QuestionCount | undefined } {
    const categories = boxes.filter((b) => b.checked).map((b) => vocab.categories[Number(b.value)])
    const raw = form.querySelector<HTMLInputElement>('input[name="count"]:checked')?.value
    const count: QuestionCount | undefined =
      raw === 'other' ? parseQuestionCount(otherInput.value) : raw === 'all' ? 'all' : Number(raw)
    return { categories, count }
  }

  function update(): void {
    const { categories, count } = currentChoice()
    const available = categories.reduce((sum, c) => sum + (counts.get(c) ?? 0), 0)
    if (available === 0 || count === undefined) {
      startButton.disabled = true
      summary.textContent = available === 0 ? 'Choose at least one category.' : 'Type how many questions.'
      return
    }
    const questions = count === 'all' ? available : Math.min(count, available)
    startButton.disabled = false
    summary.textContent = `${questions} question${questions === 1 ? '' : 's'} from ${available} word${available === 1 ? '' : 's'}.`
  }

  form.addEventListener('change', (e) => {
    if (e.target === otherButton) otherInput.focus() // picked "Other": ready to type
    update()
  })
  form.addEventListener('input', update) // the number box, as each digit is typed

  // Tapping or typing in the number box selects "Other".
  otherInput.addEventListener('focus', () => {
    if (!otherButton.checked) {
      otherButton.checked = true
      update()
    }
  })

  form.querySelector('.category-actions')!.addEventListener('click', (e) => {
    const which = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.select
    if (!which) return
    for (const b of boxes) b.checked = which === 'all'
    update()
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const { categories, count } = currentChoice()
    if (count === undefined) return
    const words = pickWords(vocab.words, categories, count)
    if (words.length === 0) return
    store.saveStartChoice({ categories, count })
    onStart(words)
  })

  update()
}
