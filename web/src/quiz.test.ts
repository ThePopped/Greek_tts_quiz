import { describe, expect, it } from 'vitest'
import { audioUrl, choiceIndex, feedbackDetail, isReplayKey } from './quiz'

const key = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('isReplayKey', () => {
  it('replays on Ctrl+Space and ↑', () => {
    expect(isReplayKey(key(' ', 'Space', { ctrlKey: true }))).toBe(true)
    expect(isReplayKey(key('ArrowUp', 'ArrowUp'))).toBe(true)
  })

  it('ignores plain Space (it types a space), other keys and extra modifiers', () => {
    expect(isReplayKey(key(' ', 'Space'))).toBe(false)
    expect(isReplayKey(key('Enter', 'Enter'))).toBe(false)
    expect(isReplayKey(key('ArrowDown', 'ArrowDown'))).toBe(false)
    expect(isReplayKey(key('ArrowUp', 'ArrowUp', { shiftKey: true }))).toBe(false)
    expect(isReplayKey(key(' ', 'Space', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isReplayKey(key(' ', 'Space', { metaKey: true }))).toBe(false)
  })
})

describe('audioUrl', () => {
  it('puts the clip under the base URL', () => {
    expect(audioUrl({ audio: 'audio/phr-01.mp3' }, '/')).toBe('/audio/phr-01.mp3')
    expect(audioUrl({ audio: 'audio/phr-01.mp3' }, '/Greek_tts_quiz/')).toBe('/Greek_tts_quiz/audio/phr-01.mp3')
    expect(audioUrl({ audio: '/audio/phr-01.mp3' }, '/Greek_tts_quiz')).toBe('/Greek_tts_quiz/audio/phr-01.mp3')
  })
})

describe('feedbackDetail', () => {
  it('says what was typed, and the spelling for a typo', () => {
    expect(feedbackDetail('typo', 'hous', 'house')).toBe('You typed “hous”. It\'s spelt “house”.')
    expect(feedbackDetail('wrong', 'car')).toBe('You typed “car”.')
  })

  it('says what was chosen for a choice question', () => {
    expect(feedbackDetail('wrong', 'goodbye', undefined, 'choice')).toBe('You chose “goodbye”.')
    expect(feedbackDetail('correct', 'hello', undefined, 'choice')).toBe('')
    expect(feedbackDetail('dont-know', '', undefined, 'choice')).toBe('')
  })

  it('says nothing more when right or when nothing was typed', () => {
    expect(feedbackDetail('correct', 'house', 'house')).toBe('')
    expect(feedbackDetail('dont-know', '')).toBe('')
  })
})

describe('choiceIndex', () => {
  it('maps keys 1 to 4 to the options', () => {
    expect(choiceIndex(key('1', 'Digit1'), 4)).toBe(0)
    expect(choiceIndex(key('4', 'Digit4'), 4)).toBe(3)
    expect(choiceIndex(key('2', 'Numpad2'), 4)).toBe(1)
  })

  it('ignores keys past the last option, other keys and modifiers', () => {
    expect(choiceIndex(key('5', 'Digit5'), 4)).toBeUndefined()
    expect(choiceIndex(key('3', 'Digit3'), 2)).toBeUndefined()
    expect(choiceIndex(key('0', 'Digit0'), 4)).toBeUndefined()
    expect(choiceIndex(key('a', 'KeyA'), 4)).toBeUndefined()
    expect(choiceIndex(key('Enter', 'Enter'), 4)).toBeUndefined()
    expect(choiceIndex(key('1', 'Digit1', { ctrlKey: true }), 4)).toBeUndefined()
    expect(choiceIndex(key('!', 'Digit1', { shiftKey: true }), 4)).toBeUndefined()
  })
})
