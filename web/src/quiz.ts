// Quiz screen: play each word's clip, take the typed answer, then show feedback.
//
// Audio on phones: browsers only let a page start sound from a user gesture.
// A single <audio> element is reused for every word, so once one play() has
// been allowed (the Start tap usually counts; if not, the ▶ tap does), the
// following words can play automatically.
//
// A word's result is final only when you move on from its feedback, so
// "I was right" can still change it; that's when it's saved and scored.

import { check, isRight, scoreText, tally, type Outcome, type WordResult } from './session'
import type { Store } from './storage'
import type { Word } from './vocab'

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** Ctrl+Space or ↑ (with no other modifiers) replays the word. */
export function isReplayKey(e: KeyLike): boolean {
  if (e.altKey || e.shiftKey || e.metaKey) return false
  if (e.ctrlKey) return e.code === 'Space' || e.key === ' '
  return e.key === 'ArrowUp'
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
  overruled: '✓ Counted as right',
}

/** The line under the heading, about what was typed. */
export function feedbackDetail(outcome: Outcome, typed: string, matched?: string): string {
  switch (outcome) {
    case 'typo':
      return `You typed “${typed}”. It's spelt “${matched}”.`
    case 'wrong':
      return `You typed “${typed}”.`
    case 'overruled':
      return `“${typed}” will be accepted from now on.`
    default:
      return ''
  }
}

export type QuizStore = Pick<Store, 'acceptedAnswers' | 'addAnswer' | 'record'>

export interface QuizHandlers {
  /** The last word's result is final. `results` has one entry per word, in order. */
  onFinish(results: WordResult[]): void
  /** The user left the session early. */
  onQuit(): void
}

const ASKING_KEYS = 'Replay: tap ▶, Ctrl+Space or ↑ · Enter to check · Enter on an empty box if you don’t know'
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
      <form class="answer-form" autocomplete="off">
        <input class="answer" type="text" name="answer" aria-label="English meaning"
          placeholder="Type the English meaning" autocapitalize="off" autocorrect="off"
          spellcheck="false" enterkeyhint="go" />
        <button type="submit" class="check">Check</button>
      </form>
      <button type="button" class="dont-know">Don’t know</button>
      <section class="feedback" aria-live="polite" hidden>
        <h2 class="verdict"></h2>
        <p class="detail"></p>
        <p class="greek" lang="el"></p>
        <p class="meaning"></p>
        <p class="notes"></p>
        <button type="button" class="overrule">I was right</button>
      </section>
      <p class="keys"></p>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const progress = $('.progress')
  const score = $('.score')
  const playButton = $<HTMLButtonElement>('.play')
  const hint = $('.play-hint')
  const form = $<HTMLFormElement>('.answer-form')
  const input = $<HTMLInputElement>('.answer')
  const checkButton = $<HTMLButtonElement>('.check')
  const dontKnow = $<HTMLButtonElement>('.dont-know')
  const feedback = $('.feedback')
  const overrule = $<HTMLButtonElement>('.overrule')
  const keys = $('.keys')

  const audio = new Audio()
  audio.preload = 'auto'
  const listeners = new AbortController()
  const { signal } = listeners

  let index = 0
  let phase: 'asking' | 'feedback' | 'done' = 'asking'
  /** The word being given feedback on; its outcome can still change. */
  let current: WordResult | undefined
  let matched: string | undefined
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

  function showWord(): void {
    phase = 'asking'
    const word = words[index]
    progress.textContent = `Word ${index + 1} of ${words.length}`
    input.value = ''
    input.readOnly = false
    checkButton.textContent = 'Check'
    dontKnow.hidden = false
    feedback.hidden = true
    keys.textContent = ASKING_KEYS
    input.focus()
    audio.src = audioUrl(word)
    play()
  }

  function showFeedback(): void {
    if (!current) return
    const { word, typed, outcome } = current
    feedback.hidden = false
    feedback.dataset.outcome = isRight(outcome) ? 'right' : 'wrong'
    $('.verdict').textContent = VERDICTS[outcome]
    const detail = feedbackDetail(outcome, typed, matched)
    $('.detail').textContent = detail
    $('.detail').hidden = detail === ''
    $('.greek').textContent = word.greek
    $('.meaning').textContent = store.acceptedAnswers(word).join(', ')
    $('.notes').textContent = word.notes
    $('.notes').hidden = word.notes === ''
    overrule.hidden = outcome !== 'wrong'
    feedback.scrollIntoView?.({ block: 'nearest' })
  }

  function answer(typed: string): void {
    const word = words[index]
    const result = check(typed, store.acceptedAnswers(word))
    current = { word, typed: typed.trim(), outcome: result.outcome }
    matched = result.answer
    phase = 'feedback'
    input.value = current.typed
    input.readOnly = true // keeps focus (and the phone keyboard), so Enter moves on
    checkButton.textContent = index === words.length - 1 ? 'Finish' : 'Next'
    dontKnow.hidden = true
    keys.textContent = FEEDBACK_KEYS
    showFeedback()
    input.focus()
  }

  function next(): void {
    if (phase !== 'feedback' || !current) return
    store.record(current.word.id, isRight(current.outcome))
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
      input.focus()
    },
    { signal },
  )

  $('.quit').addEventListener('click', () => handlers.onQuit(), { signal })

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isReplayKey(e)) return
      e.preventDefault()
      play()
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
      if (phase === 'asking') answer('')
    },
    { signal },
  )

  overrule.addEventListener(
    'click',
    () => {
      if (phase !== 'feedback' || current?.outcome !== 'wrong') return
      store.addAnswer(current.word.id, current.typed)
      current.outcome = 'overruled'
      showFeedback()
      input.focus()
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
