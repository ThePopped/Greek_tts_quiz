import './style.css'
import { pickChoices, type Choices } from './choices'
import { boxOf, dueSummary, learnProgress, progressText, recordLearnAnswer, unlockText } from './learn'
import { parseListParam, type LinkedList } from './lists'
import { renderQuiz } from './quiz'
import { isRight, type WordResult } from './session'
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
  show(() => renderStart(app, vocab, store, (words, mode) => showQuiz(vocab, words, mode === 'learn'), linked))
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

/**
 * Learn mode asks words in the learning box as a choice (recognise it first),
 * and familiar and mastered words as typed (then recall it).
 */
function learnChoices(vocab: Vocab, word: Word): Choices | undefined {
  const entry = store.learnState().words[word.id]
  if (!entry || boxOf(entry) !== 'learning') return undefined
  const choices = pickChoices(word, vocab.words)
  return choices.options.length > 1 ? choices : undefined
}

/**
 * `learn`: a learn-mode session (including its retries), whose answers also
 * move words between boxes, and whose learning words are asked as choices.
 */
function showQuiz(vocab: Vocab, words: Word[], learn: boolean): void {
  show(() =>
    renderQuiz(app, words, store, {
      onFinish: (results) => showDone(vocab, results, learn),
      onQuit: () => showStart(vocab),
      onResult: learn
        ? ({ word, outcome }) =>
            store.saveLearnState(recordLearnAnswer(store.learnState(), word.id, isRight(outcome), Date.now()))
        : undefined,
      choicesFor: learn ? (word) => learnChoices(vocab, word) : undefined,
    }),
  )
}

function showDone(vocab: Vocab, results: WordResult[], learn: boolean): void {
  const progress = learn ? learnProgress(store.learnState(), vocab.words, Date.now()) : undefined
  show(() =>
    renderSummary(
      app,
      results,
      {
        onRetry: (words) => showQuiz(vocab, shuffle(words), learn),
        onNewSession: () => showStart(vocab),
      },
      progress ? [progressText(progress), dueSummary(progress), unlockText(progress.unlock)].filter((t) => t !== undefined) : [],
    ),
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
