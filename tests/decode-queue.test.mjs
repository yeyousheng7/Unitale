import assert from 'node:assert/strict'
import test from 'node:test'
import { createAudioDecodeQueue } from '../src/services/audio/decodeQueue.ts'

test('audio decode queue shares same-asset work and runs at most two decodes', async () => {
  const run = createAudioDecodeQueue(2)
  const pending = []
  let active = 0
  let maximum = 0
  const decode = key => () => new Promise(resolve => {
    active++
    maximum = Math.max(maximum, active)
    pending.push(() => { active--; resolve(key) })
  })
  const first = run('a', decode('a'))
  const duplicate = run('a', decode('wrong'))
  const second = run('b', decode('b'))
  const third = run('c', decode('c'))
  assert.equal(first, duplicate)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending.shift()()
  await first
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending.shift()()
  pending.shift()()
  assert.deepEqual(await Promise.all([first, second, third]), ['a', 'b', 'c'])
  assert.equal(maximum, 2)
})

test('failed decode can be retried', async () => {
  const run = createAudioDecodeQueue(1)
  await assert.rejects(run('a', () => Promise.reject(new Error('decode failed'))), /decode failed/)
  assert.equal(await run('a', () => Promise.resolve('ok')), 'ok')
})
