import assert from 'node:assert/strict'
import test from 'node:test'
import { clipAudioEvent, totalTimelineDuration } from '../src/services/audio/timeline.ts'

test('a five-second effect starting at 119s spans both 120s WAV parts', () => {
  const effect = { start: 119, end: 124, sourceOffset: 2 }
  assert.deepEqual(clipAudioEvent(effect, 0, 120), { start: 119, duration: 1, offset: 2 })
  assert.deepEqual(clipAudioEvent(effect, 120, 240), { start: 120, duration: 4, offset: 3 })
  assert.equal(clipAudioEvent(effect, 240, 360), null)
})

test('events touching a part boundary have no zero-length clip', () => {
  assert.equal(clipAudioEvent({ start: 120, end: 125 }, 0, 120), null)
  assert.equal(clipAudioEvent({ start: 115, end: 120 }, 120, 240), null)
})

test('audio and video timeline includes the final effect tail', () => {
  assert.equal(totalTimelineDuration(120, [{ end: 124 }], 1.02), 125.02)
  assert.equal(totalTimelineDuration(130, [{ end: 124 }], 1.02), 131.02)
  assert.equal(totalTimelineDuration(120, [], 1.02), 121.02)
})
