import assert from 'node:assert/strict'
import test from 'node:test'
import { DecodedAudioCache, audioBufferBytes } from '../src/services/audio/decodedCache.ts'

test('original and processed audio share a byte budget with LRU eviction', () => {
  const evicted = []
  const cache = new DecodedAudioCache(12)
  cache.set('source:a', 'a', 4, value => evicted.push(value))
  cache.set('processed:a', 'p', 4, value => evicted.push(value))
  cache.get('source:a')
  cache.set('source:b', 'b', 8, value => evicted.push(value))
  assert.deepEqual(evicted, ['p'])
  assert.equal(cache.byteLength, 12)
  assert.equal(cache.get('source:a'), 'a')
  assert.equal(cache.get('processed:a'), undefined)
})

test('pinned audio stays while in use and oversize items do not enter cache', () => {
  const cache = new DecodedAudioCache(8)
  cache.set('a', 1, 8)
  const unpin = cache.pin('a')
  cache.set('b', 2, 8)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('b'), undefined)
  unpin()
  assert.equal(cache.set('huge', 3, 9), false)
  assert.equal(cache.byteLength, 8)
  assert.equal(audioBufferBytes({ length: 4, numberOfChannels: 2 }), 32)
})
