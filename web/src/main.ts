import './style.css'
import { parseListParam, type LinkedList } from './lists'
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

/** `linked` is a `?list=` link's words, given only to the first start screen of a visit. */
function showStart(vocab: Vocab, linked?: LinkedList): void {
  show(() => renderStart(app, vocab, store, (words) => showQuiz(vocab, words), linked))
}

/**
 * Read a `?list=` link, then drop it from the address bar: it has been loaded
 * into the picker, and a reload should show what was picked since, not the link again.
 */
function takeLinkedList(vocab: Vocab): LinkedList | undefined {
  const linked = parseListParam(location.search, new Set(vocab.words.map((w) => w.id)))
  if (linked) {
    const params = new URLSearchParams(location.search)
    params.delete('list')
    const query = params.toString()
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  }
  return linked
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
    const vocab = await loadVocab()
    showStart(vocab, takeLinkedList(vocab))
  } catch (err) {
    app.innerHTML = '<main><h1>Greek Listening Quiz</h1><p class="error"></p></main>'
    app.querySelector('.error')!.textContent = err instanceof Error ? err.message : String(err)
  }
}

void init()
