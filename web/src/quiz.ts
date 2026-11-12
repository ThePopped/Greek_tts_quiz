// Quiz screen: play each word's clip and take the typed answer.
//
// Audio on phones: browsers only let a page start sound from a user gesture.
// A single <audio> element is reused for every word, so once one play() has
// been allowed (the Start tap usually counts; if not, the ▶ tap does), the
// following words can play automatically.

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

export interface QuizHandlers {
  /** An answer was submitted for `word`. Call `next` to move on to the next word. */
  onSubmit(word: Word, typed: string, next: () => void): void
  /** `next` was called after the last word. */
  onFinish(): void
  /** The user left the session early. */
  onQuit(): void
}

/** Show the quiz for `words`. Returns a function that stops audio and removes listeners. */
export function renderQuiz(root: HTMLElement, words: readonly Word[], handlers: QuizHandlers): () => void {
  root.innerHTML = `
    <main class="quiz">
      <header class="quiz-bar">
        <button type="button" class="quit">✕ Quit</button>
        <span class="progress" aria-live="polite"></span>
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
      <p class="keys">Replay: tap ▶, Ctrl+Space or ↑ · Enter to check</p>
    </main>`

  const progress = root.querySelector<HTMLSpanElement>('.progress')!
  const playButton = root.querySelector<HTMLButtonElement>('.play')!
  const hint = root.querySelector<HTMLParagraphElement>('.play-hint')!
  const form = root.querySelector<HTMLFormElement>('.answer-form')!
  const input = root.querySelector<HTMLInputElement>('.answer')!

  const audio = new Audio()
  audio.preload = 'auto'
  const listeners = new AbortController()
  const { signal } = listeners

  let index = 0
  let waiting = false // submitted, waiting for `next`
  let done = false

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

  function showWord(): void {
    const word = words[index]
    progress.textContent = `Word ${index + 1} of ${words.length}`
    input.value = ''
    input.focus()
    audio.src = audioUrl(word)
    play()
  }

  function next(): void {
    if (done || !waiting) return
    waiting = false
    index += 1
    if (index >= words.length) {
      done = true
      audio.pause()
      handlers.onFinish()
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

  root.querySelector('.quit')!.addEventListener('click', () => handlers.onQuit(), { signal })

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isReplayKey(e)) return
      e.preventDefault()
      play()
    },
    { signal },
  )

  form.addEventListener(
    'submit',
    (e) => {
      e.preventDefault()
      const typed = input.value
      if (waiting || done || typed.trim() === '') return
      waiting = true
      handlers.onSubmit(words[index], typed, next)
    },
    { signal },
  )

  if (words.length === 0) {
    done = true
    handlers.onFinish()
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
