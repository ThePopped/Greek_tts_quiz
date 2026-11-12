import './style.css'
import { renderQuiz } from './quiz'
import { renderStart } from './start'
import { store } from './storage'
import { loadVocab, type Vocab, type Word } from './vocab'

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
    renderQuiz(app, words, {
      // No feedback yet (plan step 18): move straight on to the next word.
      onSubmit: (_word, _typed, next) => next(),
      onFinish: () => showDone(vocab, words.length),
      onQuit: () => showStart(vocab),
    }),
  )
}

// Placeholder until the end-of-session summary is built (plan step 19).
function showDone(vocab: Vocab, count: number): void {
  show(() => {
    app.innerHTML = `
      <main>
        <h1>Session done</h1>
        <p class="summary"></p>
        <button type="button" class="back">Back to start</button>
      </main>`
    app.querySelector('.summary')!.textContent = `You went through ${count} word${count === 1 ? '' : 's'}.`
    app.querySelector('.back')!.addEventListener('click', () => showStart(vocab))
  })
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
