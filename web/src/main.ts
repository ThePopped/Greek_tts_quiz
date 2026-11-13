import './style.css'
import { renderQuiz } from './quiz'
import type { WordResult } from './session'
import { renderStart } from './start'
import { store } from './storage'
import { renderSummary } from './summary'
import { loadVocab, shuffle, type Vocab, type Word } from './vocab'

const app = document.querySelector<HTMLDivElement>('#app')!

/** Tears down the current screen (stops audio, removes listeners) before the next one is shown. */
let leaveScreen: () => void = () => {}

function show(render: () => (() => void) | void): void {
  leaveScreen()
  leaveScreen = render() ?? (() => {})
}

function showStart(vocab: Vocab): void {
  show(() => renderStart(app, vocab, store, (words) => showQuiz(vocab, words)))
}

function showQuiz(vocab: Vocab, words: Word[]): void {
  show(() =>
    renderQuiz(app, words, store, {
      onFinish: (results) => showDone(vocab, results),
      onQuit: () => showStart(vocab),
    }),
  )
}

function showDone(vocab: Vocab, results: WordResult[]): void {
  show(() =>
    renderSummary(app, results, {
      onRetry: (words) => showQuiz(vocab, shuffle(words)),
      onNewSession: () => showStart(vocab),
    }),
  )
}

async function init(): Promise<void> {
  app.innerHTML = '<main><p>Loading words…</p></main>'
  try {
    showStart(await loadVocab())
  } catch (err) {
    app.innerHTML = '<main><h1>Greek Listening Quiz</h1><p class="error"></p></main>'
    app.querySelector('.error')!.textContent = err instanceof Error ? err.message : String(err)
  }
}

void init()
