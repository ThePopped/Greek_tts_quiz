import { describe, expect, it } from 'vitest'
import { clean, editDistance, grade, typoAllowance } from './grading'

const HOUSE = ['house', 'home'] // το σπίτι
const EAT = ['to eat', 'eat'] // τρώω
const FIVE = ['five', '5'] // πέντε
const BAD = ['bad'] // κακός

describe('clean', () => {
  it.each([
    ['The House', 'house'],
    ['  a   big  house ', 'big house'],
    ['to eat', 'eat'],
    ['I eat', 'eat'],
    ['café', 'cafe'],
    ['Crème brûlée', 'creme brulee'],
    ["I don't know", 'dont know'],
    ['I don’t know', 'dont know'], // curly apostrophe
    ['good-looking', 'good looking'],
    ['house!?', 'house'],
    ['the', 'the'], // never cleaned away entirely
    ['a', 'a'],
    ['theatre', 'theatre'], // only whole leading words
    ['', ''],
  ])('%j → %j', (text, expected) => {
    expect(clean(text)).toBe(expected)
  })
})

describe('editDistance', () => {
  it.each([
    ['house', 'house', 0],
    ['hous', 'house', 1], // deletion
    ['housse', 'house', 1], // insertion
    ['hoyse', 'house', 1], // substitution
    ['huose', 'house', 1], // adjacent swap
    ['hsoue', 'house', 2],
    ['', 'abc', 3],
    ['car', 'house', 5],
  ])('%j vs %j = %i', (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected)
    expect(editDistance(b, a)).toBe(expected)
  })
})

describe('typoAllowance', () => {
  it.each([
    ['bad', 0],
    ['5', 0],
    ['100', 0],
    ['house', 1],
    ['door', 1],
    ['kitchen', 2],
    ['good morning', 2],
  ])('%j allows %i', (answer, expected) => {
    expect(typoAllowance(answer)).toBe(expected)
  })
})

describe('grade', () => {
  it('ignores case and a leading article', () => {
    expect(grade('The House', HOUSE)).toEqual({ verdict: 'correct', answer: 'house' })
    expect(grade('a home', HOUSE)).toEqual({ verdict: 'correct', answer: 'home' })
  })

  it('accepts "to eat" and "I eat" for eat', () => {
    expect(grade('to eat', EAT).verdict).toBe('correct')
    expect(grade('I eat', EAT).verdict).toBe('correct')
    expect(grade('eat', ['to eat']).verdict).toBe('correct')
  })

  it('strips accents from the input', () => {
    expect(grade('hóuse', HOUSE).verdict).toBe('correct')
    expect(grade('cafe', ['café']).verdict).toBe('correct')
  })

  it('ignores punctuation and extra spaces', () => {
    expect(grade("  I don't   know. ", ['I do not know', "I don't know"]).verdict).toBe('correct')
    expect(grade('good looking', ['good-looking']).verdict).toBe('correct')
  })

  it('calls a near miss a typo and names the intended answer', () => {
    expect(grade('hous', HOUSE)).toEqual({ verdict: 'typo', answer: 'house' })
    expect(grade('huose', HOUSE)).toEqual({ verdict: 'typo', answer: 'house' })
    expect(grade('kitchne', ['kitchen'])).toEqual({ verdict: 'typo', answer: 'kitchen' })
    expect(grade('kitchn', ['kitchen']).verdict).toBe('typo')
  })

  it('picks the closest answer for a typo', () => {
    expect(grade('hone', HOUSE)).toEqual({ verdict: 'typo', answer: 'home' })
  })

  it('allows one edit up to 5 letters and two beyond', () => {
    expect(grade('hos', HOUSE).verdict).toBe('wrong') // 2 edits from a 5-letter answer
    expect(grade('ktchn', ['kitchen']).verdict).toBe('typo') // 2 edits, 7 letters
    expect(grade('ktcn', ['kitchen']).verdict).toBe('wrong') // 3 edits
  })

  it('needs short answers and numbers to be exact', () => {
    expect(grade('sad', BAD).verdict).toBe('wrong')
    expect(grade('6', FIVE).verdict).toBe('wrong')
    expect(grade('5', FIVE).verdict).toBe('correct')
    expect(grade('fiv', FIVE).verdict).toBe('typo') // "five" itself is 4 letters
  })

  it('marks a different word wrong', () => {
    expect(grade('car', HOUSE)).toEqual({ verdict: 'wrong' })
  })

  it('marks blank input wrong', () => {
    expect(grade('', HOUSE).verdict).toBe('wrong')
    expect(grade('  ?! ', HOUSE).verdict).toBe('wrong')
    expect(grade('the', HOUSE).verdict).toBe('wrong')
  })
})
