// Quiz screen: play each word's clip, take the answer (typed, or picked from a
// few choices), then show feedback.
//
// Audio on phones: browsers only let a page start sound from a user gesture.
// A single <audio> element is reused for every word, so once one play() has
// been allowed (the Start tap usually counts; if not, the ▶ tap does), the
// following words can play automatically.
//
// A word's result is saved and scored when you move on from its feedback.
// Only typed answers go into the per-word stats: picking from choices is
// recognising a word, and the stats mean "can recall it".

import type { Choices } from './choices'
import { check, isRight, scoreText, tally, type AskedAs, type Outcome, type WordResult } from './session'
import type { Store } from './storage'
import type { Word } from './vocab'

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** Ctrl+Space or ↑ (with no other modifiers) replays the word. */
export function isReplayKey(e: KeyLike): boolean {
  if (e.altKey || e.shiftKey || e.metaKey) return false
  if (e.ctrlKey) return e.code === 'Space' || e.key === ' '
  return e.key === 'ArrowUp'
}

/** Keys 1–9 (with no modifiers) pick that choice: its index, or undefined for other keys. */
export function choiceIndex(e: KeyLike, count: number): number | undefined {
  if (e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return undefined
  if (!/^[1-9]$/.test(e.key)) return undefined
  const index = Number(e.key) - 1
  return index < count ? index : undefined
}

/** URL of a word's clip, under the site's base URL. */
export function audioUrl(word: Pick<Word, 'audio'>, base: string = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/?$/, '/')}${word.audio.replace(/^\//, '')}`
}

/** The heading of the feedback panel. */
export const VERDICTS: Record<Outcome, string> = {
  correct: '✓ Correct',
  typo: '✓ Almost: check the spelling',
  wrong: '✗ Not quite',
  'dont-know': '✗ The answer was',
}

/** The line under the heading, about what was typed or chosen. */
export function feedbackDetail(outcome: Outcome, typed: string, matched?: string, asked: AskedAs = 'type'): string {
  switch (outcome) {
    case 'typo':
      return `You typed “${typed}”. It's spelt “${matched}”.`
    case 'wrong':
      return asked === 'choice' ? `You chose “${typed}”.` : `You typed “${typed}”.`
    default:
      return ''
  }
}

export type QuizStore = Pick<Store, 'record'>

export interface QuizHandlers {
  /** The last word's result is final. `results` has one entry per word, in order. */
  onFinish(results: WordResult[]): void
  /** The user left the session early. */
  onQuit(): void
  /** One word's result is final (called before the next word, or before onFinish). */
  onResult?(result: WordResult): void
  /**
   * Called as each word is shown: the options to pick from, or undefined to
   * type the answer (the default).
   */
  choicesFor?(word: Word): Choices | undefined
}

const ASKING_KEYS = 'Replay: tap ▶, Ctrl+Space or ↑ · Enter to check · Enter on an empty box if you don’t know'
const CHOICE_KEYS = 'Replay: tap ▶, Ctrl+Space or ↑ · 1–4 to pick'
const FEEDBACK_KEYS = 'Replay: tap ▶, Ctrl+Space or ↑ · Enter for the next word'

/** Show the quiz for `words`. Returns a function that stops audio and removes listeners. */
export function renderQuiz(
  root: HTMLElement,
  words: readonly Word[],
  store: QuizStore,
  handlers: QuizHandlers,
): () => void {
  root.innerHTML = `
    <main class="quiz">
      <header class="quiz-bar">
        <button type="button" class="quit">✕ Quit</button>
        <span class="progress" aria-live="polite"></span>
        <span class="score"></span>
      </header>
      <button type="button" class="play" aria-label="Play the word">
        <span class="play-icon" aria-hidden="true">▶</span>
      </button>
      <p class="play-hint" aria-live="polite"></p>
      <div class="choices" role="group" aria-label="Pick the English meaning" hidden></div>
      <form class="answer-form" autocomplete="off">
        <input class="answer" type="text" name="answer" aria-label="English meaning"
          placeholder="Type the English meaning" autocapitalize="off" autocorrect="off"
          spellcheck="false" enterkeyhint="go" />
        <button type="submit" class="check primary">Check</button>
      </form>
      <button type="button" class="dont-know">Don’t know</button>
      <section class="feedback" aria-live="polite" hidden>
        <h2 class="verdict"></h2>
        <p class="detail"></p>
        <p class="greek" lang="el"></p>
        <p class="meaning"></p>
        <p class="notes"></p>
      </section>
      <p class="keys"></p>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const screen = $('.quiz')
  const progress = $('.progress')
  const score = $('.score')
  const playButton = $<HTMLButtonElement>('.play')
  const hint = $('.play-hint')
  const form = $<HTMLFormElement>('.answer-form')
  const input = $<HTMLInputElement>('.answer')
  const checkButton = $<HTMLButtonElement>('.check')
  const dontKnow = $<HTMLButtonElement>('.dont-know')
  const choiceBox = $('.choices')
  const feedback = $('.feedback')
  const keys = $('.keys')

  const audio = new Audio()
  audio.preload = 'auto'
  const listeners = new AbortController()
  const { signal } = listeners

  let index = 0
  let phase: 'asking' | 'feedback' | 'done' = 'asking'
  /** The word being given feedback on. */
  let current: WordResult | undefined
  let matched: string | undefined
  /** The current word's options, if it's asked as a choice. */
  let choices: Choices | undefined
  const results: WordResult[] = []

  function setHint(text: string, needsTap = false): void {
    hint.textContent = text
    playButton.classList.toggle('needs-tap', needsTap)
  }

  function play(): void {
    audio.currentTime = 0
    audio.play().then(
      () => setHint(''),
      (err: unknown) => {
        // NotAllowedError: no gesture yet, so ask for a tap. AbortError: a newer play() took over.
        if (err instanceof DOMException && err.name === 'NotAllowedError') setHint('Tap ▶ to listen', true)
      },
    )
  }

  function showScore(): void {
    const { right, wrong } = tally(results)
    score.textContent = scoreText({ right, wrong })
    score.setAttribute('aria-label', `${right} right, ${wrong} wrong`)
  }

  /** Put the focus where Enter does the right thing: the box when typing, Next after a choice. */
  function focusAnswer(): void {
    if (!choices) input.focus()
    else if (phase === 'feedback') checkButton.focus()
  }

  function showChoices(options: readonly string[]): void {
    choiceBox.replaceChildren(
      ...options.map((option, i) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'choice'
        button.dataset.index = String(i)
        button.textContent = option
        button.setAttribute('aria-keyshortcuts', String(i + 1))
        return button
      }),
    )
  }

  function showWord(): void {
    phase = 'asking'
    screen.dataset.phase = phase // the CSS shrinks ▶ during feedback on small screens
    const word = words[index]
    choices = handlers.choicesFor?.(word)
    screen.dataset.asked = choices ? 'choice' : 'type'
    progress.textContent = `Word ${index + 1} of ${words.length}`
    input.value = ''
    input.readOnly = false
    input.hidden = choices !== undefined
    checkButton.textContent = 'Check'
    form.hidden = choices !== undefined // shown again (Next only) once a choice is made
    choiceBox.hidden = choices === undefined
    if (choices) {
      showChoices(choices.options)
      // Moving the focus off the box closes the phone keyboard.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    dontKnow.hidden = false
    feedback.hidden = true
    keys.textContent = choices ? CHOICE_KEYS : ASKING_KEYS
    focusAnswer()
    audio.src = audioUrl(word)
    play()
  }

  function showFeedback(): void {
    if (!current) return
    const { word, typed, outcome } = current
    feedback.hidden = false
    feedback.dataset.outcome = isRight(outcome) ? 'right' : 'wrong'
    $('.verdict').textContent = VERDICTS[outcome]
    const detail = feedbackDetail(outcome, typed, matched, current.asked)
    $('.detail').textContent = detail
    $('.detail').hidden = detail === ''
    $('.greek').textContent = word.greek
    $('.meaning').textContent = word.answers.join(', ')
    $('.notes').textContent = word.notes
    $('.notes').hidden = word.notes === ''
    feedback.scrollIntoView?.({ block: 'nearest' })
  }

  function answer(typed: string): void {
    const word = words[index]
    const result = check(typed, word.answers)
    current = { word, typed: typed.trim(), outcome: result.outcome, asked: 'type' }
    matched = result.answer
    input.value = current.typed
    input.readOnly = true // keeps focus (and the phone keyboard), so Enter moves on
    toFeedback()
  }

  /** Pick option `picked` of the choices, or give up (undefined: "Don't know"). */
  function pick(picked: number | undefined): void {
    if (!choices) return
    const word = words[index]
    const outcome: Outcome = picked === undefined ? 'dont-know' : picked === choices.correct ? 'correct' : 'wrong'
    current = { word, typed: picked === undefined ? '' : choices.options[picked], outcome, asked: 'choice' }
    matched = undefined
    for (const button of choiceBox.querySelectorAll<HTMLButtonElement>('.choice')) {
      const i = Number(button.dataset.index)
      button.disabled = true
      if (i === choices.correct) button.dataset.mark = 'right'
      else if (i === picked) button.dataset.mark = 'wrong'
    }
    form.hidden = false
    toFeedback()
  }

  function toFeedback(): void {
    phase = 'feedback'
    screen.dataset.phase = phase
    checkButton.textContent = index === words.length - 1 ? 'Finish' : 'Next'
    dontKnow.hidden = true
    keys.textContent = FEEDBACK_KEYS
    showFeedback()
    focusAnswer()
  }

  function next(): void {
    if (phase !== 'feedback' || !current) return
    if (current.asked === 'type') store.record(current.word.id, isRight(current.outcome))
    handlers.onResult?.(current)
    results.push(current)
    current = undefined
    showScore()
    index += 1
    if (index >= words.length) {
      phase = 'done'
      audio.pause()
      handlers.onFinish([...results])
    } else {
      showWord()
    }
  }

  audio.addEventListener('play', () => playButton.classList.add('playing'), { signal })
  for (const ev of ['pause', 'ended'] as const) {
    audio.addEventListener(ev, () => playButton.classList.remove('playing'), { signal })
  }
  audio.addEventListener('error', () => setHint("Couldn't load this word's audio."), { signal })

  playButton.addEventListener(
    'click',
    () => {
      play()
      focusAnswer()
    },
    { signal },
  )

  $('.quit').addEventListener('click', () => handlers.onQuit(), { signal })

  document.addEventListener(
    'keydown',
    (e) => {
      if (isReplayKey(e)) {
        e.preventDefault()
        play()
        return
      }
      if (phase !== 'asking' || !choices) return
      const picked = choiceIndex(e, choices.options.length)
      if (picked === undefined) return
      e.preventDefault()
      pick(picked)
    },
    { signal },
  )

  // Enter (or the Check/Next button) checks the answer, then moves on.
  form.addEventListener(
    'submit',
    (e) => {
      e.preventDefault()
      if (phase === 'asking') answer(input.value)
      else if (phase === 'feedback') next()
    },
    { signal },
  )

  dontKnow.addEventListener(
    'click',
    () => {
      if (phase !== 'asking') return
      if (choices) pick(undefined)
      else answer('')
    },
    { signal },
  )

  choiceBox.addEventListener(
    'click',
    (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('.choice')
      if (phase === 'asking' && button) pick(Number(button.dataset.index))
    },
    { signal },
  )

  showScore()
  if (words.length === 0) {
    phase = 'done'
    handlers.onFinish([])
  } else {
    showWord()
  }

  return () => {
    listeners.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
