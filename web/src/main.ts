import './style.css'
import { renderStart } from './start'
import { store } from './storage'
import { loadVocab, type Vocab, type Word } from './vocab'

const app = document.querySelector<HTMLDivElement>('#app')!

function showStart(vocab: Vocab): void {
  renderStart(app, vocab, store, (words) => showQuiz(vocab, words))
}

// Placeholder until the quiz screen is built (plan step 17).
function showQuiz(vocab: Vocab, words: Word[]): void {
  app.innerHTML = `
    <main>
      <h1>Quiz</h1>
      <p class="summary"></p>
      <button type="button" class="back">Back</button>
    </main>`
  app.querySelector('.summary')!.textContent = `${words.length} words chosen. The quiz screen comes next.`
  app.querySelector('.back')!.addEventListener('click', () => showStart(vocab))
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
