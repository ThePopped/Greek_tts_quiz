// End-of-session summary: the score, the words missed, and "retry missed".

import { audioUrl } from './quiz'
import { missed, summaryText, tally, type WordResult } from './session'
import type { Store } from './storage'
import type { Word } from './vocab'

export interface SummaryHandlers {
  /** Quiz the missed words again (in the order they were asked; the caller shuffles). */
  onRetry(words: Word[]): void
  /** Back to the start screen. */
  onNewSession(): void
}

/** Show the summary of a finished session. Returns a function that stops audio and removes listeners. */
export function renderSummary(
  root: HTMLElement,
  results: readonly WordResult[],
  store: Pick<Store, 'acceptedAnswers'>,
  handlers: SummaryHandlers,
): () => void {
  const misses = missed(results)

  root.innerHTML = `
    <main class="summary-screen">
      <h1>Session done</h1>
      <p class="headline"></p>
      <p class="all-right" hidden>Nothing missed. Well done!</p>
      <div class="summary-actions">
        <button type="button" class="retry primary" hidden></button>
        <button type="button" class="new-session">New session</button>
      </div>
      <section class="missed" hidden>
        <h2 class="missed-title"></h2>
        <ul class="missed-list"></ul>
      </section>
    </main>`

  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const retry = $<HTMLButtonElement>('.retry')
  const newSession = $<HTMLButtonElement>('.new-session')
  const list = $('.missed-list')

  const audio = new Audio()
  const listeners = new AbortController()
  const { signal } = listeners

  $('.headline').textContent = summaryText(tally(results))

  if (misses.length > 0) {
    $('.missed').hidden = false
    $('.missed-title').textContent = `Missed (${misses.length})`
    for (const { word, typed, outcome } of misses) {
      const item = document.createElement('li')
      item.innerHTML = `
        <button type="button" class="say" aria-label="Play">▶</button>
        <div class="missed-text">
          <span class="missed-greek" lang="el"></span>
          <span class="missed-answers"></span>
          <span class="missed-typed"></span>
        </div>`
      const say = item.querySelector<HTMLButtonElement>('.say')!
      say.setAttribute('aria-label', `Play ${word.greek}`)
      say.addEventListener(
        'click',
        () => {
          audio.src = audioUrl(word)
          audio.play().catch(() => {}) // a tap is a gesture, so this only fails if the clip is missing
        },
        { signal },
      )
      item.querySelector('.missed-greek')!.textContent = word.greek
      item.querySelector('.missed-answers')!.textContent = store.acceptedAnswers(word).join(', ')
      item.querySelector('.missed-typed')!.textContent =
        outcome === 'dont-know' ? 'You didn’t know' : `You typed “${typed}”`
      list.append(item)
    }
    retry.hidden = false
    retry.textContent = `Retry missed (${misses.length})`
    retry.addEventListener('click', () => handlers.onRetry(misses.map((r) => r.word)), { signal })
  } else if (results.length > 0) {
    $('.all-right').hidden = false
  }

  newSession.addEventListener('click', () => handlers.onNewSession(), { signal })
  ;(retry.hidden ? newSession : retry).focus()

  return () => {
    listeners.abort()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
