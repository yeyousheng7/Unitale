import assert from 'node:assert/strict'
import test from 'node:test'
import { makeWavHeader, frameRanges, AUDIO_EXPORT_PART_SECONDS, WAV_MAX_DATA_BYTES } from '../src/services/audio/wav.ts'

test('two minute parts cover the timeline without gaps and WAV header has exact byte lengths', () => {
  const rate = 44100
  const ranges = frameRanges(5 * 60 * rate + 1, AUDIO_EXPORT_PART_SECONDS * rate)
  assert.deepEqual(ranges.map(part => part.count), [120 * rate, 120 * rate, 60 * rate + 1])
  assert.equal(ranges[1].start, ranges[0].count)
  const header = makeWavHeader(ranges[0].count, rate, 2)
  const view = new DataView(header.buffer)
  assert.equal(view.getUint32(4, true), ranges[0].count * 4 + 36)
  assert.equal(view.getUint32(40, true), ranges[0].count * 4)
  assert.throws(() => makeWavHeader(Math.ceil(WAV_MAX_DATA_BYTES / 4) + 1, rate, 2), /4 GiB/)
})
