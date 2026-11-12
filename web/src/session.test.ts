import { describe, expect, it } from 'vitest'
import { check, isRight, scoreText, tally, type Outcome } from './session'

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
  it('counts typos and "I was right" as right', () => {
    const right: Outcome[] = ['correct', 'typo', 'overruled']
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
    const outcomes: Outcome[] = ['correct', 'typo', 'wrong', 'overruled', 'dont-know', 'correct']
    const score = tally(outcomes.map((outcome) => ({ outcome })))
    expect(score).toEqual({ right: 4, wrong: 2 })
    expect(scoreText(score)).toBe('4 ✓ 2 ✗')
  })
})
