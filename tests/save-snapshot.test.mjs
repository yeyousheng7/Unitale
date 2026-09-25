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

test('autosave omits cleared media references in changed scripts and project header', () => {
  const edited = { id: 'edited', name: 'Edited', data: { rawScript: '', rawAnalysisResult: '',
    characters: [{ id: 'narrator', name: 'Narrator', voiceAssetId: '' }],
    scriptLines: [{ id: 'line', type: 'dialogue', audioAssetId: '', bgImageAssetId: '' }] } }
  const result = createProjectSaveSnapshot({
    characters: [{ id: 'narrator', name: 'Narrator', voiceAssetId: '' }],
    currentScriptId: 'edited', scriptList: [edited],
    libraries: { sfx: [], bgm: [], timbres: [{ id: 'timbre', assetId: '' }], filters: [], emotions: [] },
  }, new Set(['edited']))
  assert.equal(Object.hasOwn(result.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(result.scriptList[0].data.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(result.scriptList[0].data.scriptLines[0], 'audioAssetId'), false)
  assert.equal(Object.hasOwn(result.scriptList[0].data.scriptLines[0], 'bgImageAssetId'), false)
  assert.equal(Object.hasOwn(result.libraries.timbres[0], 'assetId'), false)
})
