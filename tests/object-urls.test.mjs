import assert from 'node:assert/strict'
import test from 'node:test'
import { ObjectUrlManager } from '../src/services/storage/objectUrls.ts'

test('replacing and releasing script media revokes owned URLs', async () => {
  const urls = new ObjectUrlManager()
  const first = urls.create('script:a:audio', new Blob(['one']))
  const second = urls.create('script:a:audio', new Blob(['two']))
  assert.notEqual(first, second)
  await assert.rejects(fetch(first))
  assert.equal(await (await fetch(second)).text(), 'two')
  urls.releasePrefix('script:a:')
  await assert.rejects(fetch(second))
  assert.equal(urls.size, 0)
})
