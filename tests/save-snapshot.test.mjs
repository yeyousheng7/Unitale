import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectSaveSnapshot } from '../src/services/storage/snapshot.ts'

test('autosave serializes only changed scripts and strips their runtime URLs', () => {
  const old = { id: 'old', name: 'Old', data: { rawScript: 'unchanged', rawAnalysisResult: '', characters: [], scriptLines: [] } }
  const edited = { id: 'edited', name: 'Edited', data: { rawScript: 'changed', rawAnalysisResult: '', characters: [], scriptLines: [
    { id: 'line', type: 'dialogue', audioAssetId: 'stable', audioUrl: 'blob:transient' },
  ] } }
  const result = createProjectSaveSnapshot({ characters: [], currentScriptId: 'edited',
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] }, scriptList: [old, edited] }, new Set(['edited']))
  assert.equal(result.scriptList[0], old)
  assert.notEqual(result.scriptList[1], edited)
  assert.equal(result.scriptList[1].data.scriptLines[0].audioUrl, undefined)
  assert.equal(result.scriptList[1].data.scriptLines[0].audioAssetId, 'stable')
})
