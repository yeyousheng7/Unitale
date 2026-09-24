import assert from 'node:assert/strict'
import test from 'node:test'
import { auditAssetRecords, referencedAssetIds } from '../src/services/storage/audit.ts'

test('asset audit covers references across scripts and libraries', () => {
  const project = {
    characters: [{ id: 'c', name: 'Narrator', voiceAssetId: 'voice' }],
    scriptList: [
      { id: 'a', name: 'A', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [
        { id: 'line-a', type: 'dialogue', audioAssetId: 'line-audio' },
        { id: 'image-a', type: 'bgImage', bgImageAssetId: 'cover' },
      ] } },
      { id: 'b', name: 'B', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [
        { id: 'line-b', type: 'dialogue', audioAssetId: 'line-audio' },
      ] } },
    ],
    currentScriptId: 'a',
    libraries: { sfx: [{ assetId: 'effect' }], bgm: [], timbres: [], filters: [], emotions: [] },
    timestamp: 0,
  }
  const references = referencedAssetIds(project)
  assert.deepEqual([...references].sort(), ['cover', 'effect', 'line-audio', 'voice'])
  const result = auditAssetRecords([
    { key: 'line-audio', byteLength: 20 }, { key: 'orphan', byteLength: 30 },
  ], references)
  assert.deepEqual({ count: result.orphanCount, bytes: result.orphanBytes, keys: result.orphanKeys },
    { count: 1, bytes: 30, keys: ['orphan'] })
})
