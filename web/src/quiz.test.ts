import { describe, expect, it } from 'vitest'
import { audioUrl, feedbackDetail, isReplayKey } from './quiz'

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
    expect(feedbackDetail('overruled', 'dwelling')).toBe('“dwelling” will be accepted from now on.')
  })

  it('says nothing more when right or when nothing was typed', () => {
    expect(feedbackDetail('correct', 'house', 'house')).toBe('')
    expect(feedbackDetail('dont-know', '')).toBe('')
  })
})
