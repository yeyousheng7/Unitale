import assert from 'node:assert/strict'
import test from 'node:test'
import { auditAssetRecords, referencedLegacyAssetKeys } from '../src/services/storage/audit.ts'

test('legacy asset audit covers all scripts and shared library files without deleting anything', () => {
  const project = {
    characters: [{ id: 'c', name: 'Narrator', voiceFile: 'shared.wav' }],
    scriptList: [
      { id: 'a', name: 'A', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [
        { id: 'line-a', type: 'dialogue' },
        { id: 'image-a', type: 'bgImage', bgImageAssetKey: 'cover-a' },
      ] } },
      { id: 'b', name: 'B', data: { rawScript: '', rawAnalysisResult: '', characters: [], scriptLines: [
        { id: 'line-b', type: 'dialogue' },
      ] } },
    ],
    currentScriptId: 'a',
    libraries: { sfx: [{ filename: 'shared.wav' }], bgm: [], timbres: [], filters: [], emotions: [] },
    timestamp: 0,
  }
  const references = referencedLegacyAssetKeys(project)
  assert.deepEqual([...references].sort(), ['cover-a', 'line_audio_line-a', 'line_audio_line-b', 'shared.wav'])
  const result = auditAssetRecords([
    { key: 'shared.wav', byteLength: 10 },
    { key: 'line_audio_line-b', byteLength: 20 },
    { key: 'deleted-line', byteLength: 30 },
  ], references)
  assert.deepEqual({ count: result.orphanCount, bytes: result.orphanBytes, keys: result.orphanKeys },
    { count: 1, bytes: 30, keys: ['deleted-line'] })
})
