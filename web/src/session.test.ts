import { describe, expect, it } from 'vitest'
import { answeredText, check, isRight, missed, scoreText, summaryText, tally, type Outcome, type WordResult } from './session'
import type { Word } from './vocab'

const HOUSE = ['house', 'home']

describe('check', () => {
  it('grades a typed answer', () => {
    expect(check('The House', HOUSE)).toEqual({ outcome: 'correct', answer: 'house' })
    expect(check('hous', HOUSE)).toEqual({ outcome: 'typo', answer: 'house' })
    expect(check('car', HOUSE)).toEqual({ outcome: 'wrong' })
  })

  it("treats nothing typed as don't know", () => {
    expect(check('', HOUSE)).toEqual({ outcome: 'dont-know' })
    expect(check('   ', HOUSE)).toEqual({ outcome: 'dont-know' })
    expect(check('?!', HOUSE)).toEqual({ outcome: 'dont-know' })
  })
})

describe('isRight', () => {
  it('counts typos as right', () => {
    const right: Outcome[] = ['correct', 'typo']
    const wrong: Outcome[] = ['wrong', 'dont-know']
    expect(right.every(isRight)).toBe(true)
    expect(wrong.some(isRight)).toBe(false)
  })
})

describe('tally and scoreText', () => {
  it('starts at zero', () => {
    expect(tally([])).toEqual({ right: 0, wrong: 0 })
    expect(scoreText(tally([]))).toBe('0 ✓ 0 ✗')
  })

  it('counts right and wrong answers', () => {
    const outcomes: Outcome[] = ['correct', 'typo', 'wrong', 'dont-know', 'correct']
    const score = tally(outcomes.map((outcome) => ({ outcome })))
    expect(score).toEqual({ right: 3, wrong: 2 })
    expect(scoreText(score)).toBe('3 ✓ 2 ✗')
  })
})

describe('missed', () => {
  const word = (id: string): Word => ({
    id,
    greek: id,
    answers: [id],
    category: 'test',
    pos: 'noun',
    notes: '',
    audio: `audio/${id}.mp3`,
  })
  const result = (id: string, outcome: Outcome): WordResult => ({ word: word(id), typed: '', outcome, asked: 'type' })

  it('keeps wrong and given-up words, in the order asked', () => {
    const results = [
      result('a', 'correct'),
      result('b', 'dont-know'),
      result('c', 'typo'),
      result('d', 'wrong'),
    ]
    expect(missed(results).map((r) => r.word.id)).toEqual(['b', 'd'])
    expect(missed([])).toEqual([])
  })
})

describe('summaryText', () => {
  it('gives right out of total with a rounded percentage', () => {
    expect(summaryText({ right: 7, wrong: 3 })).toBe('7 of 10 right (70%)')
    expect(summaryText({ right: 2, wrong: 1 })).toBe('2 of 3 right (67%)')
    expect(summaryText({ right: 0, wrong: 0 })).toBe('No words answered.')
  })
})

describe('answeredText', () => {
  it('says what was typed or chosen, or that it wasn’t known', () => {
    expect(answeredText({ typed: 'car', outcome: 'wrong', asked: 'type' })).toBe('You typed “car”')
    expect(answeredText({ typed: 'goodbye', outcome: 'wrong', asked: 'choice' })).toBe('You chose “goodbye”')
    expect(answeredText({ typed: '', outcome: 'dont-know', asked: 'type' })).toBe('You didn’t know')
    expect(answeredText({ typed: '', outcome: 'dont-know', asked: 'choice' })).toBe('You didn’t know')
  })
})
