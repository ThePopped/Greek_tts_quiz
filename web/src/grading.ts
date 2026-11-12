// Grading a typed English answer against a word's accepted answers.

export type Verdict = 'correct' | 'typo' | 'wrong'

export interface Grade {
  verdict: Verdict
  /** The accepted answer that matched (the closest one for a typo); absent when wrong. */
  answer?: string
}

const LEADING_WORD = /^(?:the|a|an|to|i) (?=\S)/

/**
 * Normalise an answer for comparison: strip accents, lowercase, drop
 * apostrophes ("don't" → "dont"), turn other punctuation into spaces
 * ("good-looking" → "good looking"), collapse spaces, and drop one leading
 * the/a/an/to/i ("to eat", "I eat" → "eat") unless it is the whole answer.
 */
export function clean(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_WORD, '')
}

/**
 * Damerau-Levenshtein distance (optimal string alignment): insertions,
 * deletions, substitutions and swaps of two adjacent characters each cost 1.
 */
export function editDistance(a: string, b: string): number {
  const s = Array.from(a)
  const t = Array.from(b)
  // d[i][j] = distance between the first i chars of s and the first j of t.
  const d: number[][] = Array.from({ length: s.length + 1 }, (_, i) =>
    Array.from({ length: t.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[s.length][t.length]
}

/**
 * How many edits still count as a typo of this (cleaned) answer. Short answers
 * and numbers must be exact: one edit turns "bad" into "sad" and "5" into "6".
 */
export function typoAllowance(answer: string): number {
  const length = Array.from(answer).length
  if (/\d/.test(answer) || length <= 3) return 0
  return length <= 5 ? 1 : 2
}

export function grade(input: string, answers: readonly string[]): Grade {
  const typed = clean(input)
  if (typed === '') return { verdict: 'wrong' }

  let best: { answer: string; distance: number } | undefined
  for (const answer of answers) {
    const target = clean(answer)
    if (target === '') continue
    if (typed === target) return { verdict: 'correct', answer }
    const distance = editDistance(typed, target)
    if (distance <= typoAllowance(target) && (!best || distance < best.distance)) {
      best = { answer, distance }
    }
  }
  return best ? { verdict: 'typo', answer: best.answer } : { verdict: 'wrong' }
}
