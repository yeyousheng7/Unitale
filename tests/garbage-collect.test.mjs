import assert from 'node:assert/strict'
import test from 'node:test'
import { collectOrphanAssets } from '../src/services/storage/garbageCollect.ts'

const base = {
  characters: [], currentScriptId: 'a', timestamp: 1,
  libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] },
  scriptList: [
    { id: 'a', name: 'A', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [{ id: 'a1', type: 'dialogue', audioAssetId: 'shared' }] } },
    { id: 'b', name: 'B', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [{ id: 'b1', type: 'dialogue', audioAssetId: 'shared' }] } },
  ],
}

test('collector respects shared references, in-flight assets, and grace period', async () => {
  const removed = []
  const store = {
    async list() { return [
      { id: 'shared', createdAt: 0 }, { id: 'orphan', createdAt: 0 },
      { id: 'pending', createdAt: 0 }, { id: 'fresh', createdAt: 990 },
    ] },
    async remove(id) { removed.push(id) },
  }
  const result = await collectOrphanAssets(store, 'p', base, new Set(['pending']), 1000, 100)
  assert.deepEqual(result, ['orphan'])
  assert.deepEqual(removed, ['orphan'])
})
