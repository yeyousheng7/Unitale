import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { indexedDbAssetStore, loadWorkspaceProject, saveWorkspaceProject } from '../src/services/storage/workspaceDb.ts'
import { exportArchiveParts, importArchiveParts } from '../src/services/project/archive.ts'

function snapshot(assetId, projectId = 'test') {
  return {
    characters: [], currentScriptId: 'first', timestamp: 1,
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] },
    scriptList: [
      { id: 'first', name: 'First', data: { rawScript: '第一章', rawAnalysisResult: '', characters: [], scriptLines: [
        { id: 'line-1', type: 'dialogue', text: 'Hello', audioAssetId: assetId, audioUrl: 'blob:temporary' },
      ] } },
      { id: 'second', name: 'Second', data: { rawScript: '第二章', rawAnalysisResult: '', characters: [], scriptLines: [] } },
    ],
  }
}

test('asset writes use immutable ids, complete before returning, and retain identical filenames independently', async () => {
  const a = await indexedDbAssetStore.put(new Blob(['one'], { type: 'audio/wav' }), { projectId: 'test', kind: 'voice' })
  const b = await indexedDbAssetStore.put(new Blob(['two'], { type: 'audio/wav' }), { projectId: 'test', kind: 'voice' })
  assert.notEqual(a.id, b.id)
  assert.equal(await (await indexedDbAssetStore.get(a.id)).text(), 'one')
  assert.equal(await (await indexedDbAssetStore.get(b.id)).text(), 'two')
  assert.equal(await indexedDbAssetStore.get('nonexistent'), null)
  await indexedDbAssetStore.remove(a.id)
  assert.equal(await indexedDbAssetStore.get(a.id), null)
})

test('archive roundtrips multiple scripts and media with checksums', async () => {
  const media = await indexedDbAssetStore.put(new Blob(['spoken words'], { type: 'audio/wav' }), { projectId: 'test', kind: 'dialogue' })
  const source = snapshot(media.id)
  await saveWorkspaceProject(source, undefined, 'test')
  assert.equal((await loadWorkspaceProject('test')).scriptList.length, 2)
  const parts = []
  for await (const part of exportArchiveParts(source, [media], indexedDbAssetStore, 2000)) parts.push(part.blob)
  assert.ok(parts.length >= 1)
  const imported = await importArchiveParts(parts, indexedDbAssetStore)
  assert.equal(imported.snapshot.scriptList.length, 2)
  const remappedId = imported.snapshot.scriptList[0].data.scriptLines[0].audioAssetId
  assert.notEqual(remappedId, media.id)
  assert.equal(await (await indexedDbAssetStore.get(remappedId)).text(), 'spoken words')
  assert.equal((await loadWorkspaceProject(imported.projectId)).scriptList.length, 2)
})

test('missing archive part is rejected without switching projects', async () => {
  const media = await indexedDbAssetStore.put(new Blob(['long audio'.repeat(200)], { type: 'audio/wav' }), { projectId: 'test', kind: 'dialogue' })
  const parts = []
  for await (const part of exportArchiveParts(snapshot(media.id), [media], indexedDbAssetStore, 900)) parts.push(part.blob)
  assert.ok(parts.length > 1)
  await assert.rejects(importArchiveParts(parts.slice(0, 1), indexedDbAssetStore), /Expected .*archive parts/)
  await assert.rejects(importArchiveParts(parts.slice(1), indexedDbAssetStore), /manifest is missing/)
})

test('import rejects changed media checksums and rolls back assets written before a quota failure', async () => {
  const first = await indexedDbAssetStore.put(new Blob(['first'], { type: 'audio/wav' }), { projectId: 'failure-source', kind: 'dialogue' })
  const second = await indexedDbAssetStore.put(new Blob(['second'], { type: 'audio/wav' }), { projectId: 'failure-source', kind: 'dialogue' })
  const source = snapshot(first.id)
  source.scriptList[1].data.scriptLines.push({ id: 'line-2', type: 'dialogue', audioAssetId: second.id })
  const parts = []
  for await (const part of exportArchiveParts(source, [first, second], indexedDbAssetStore)) parts.push(part.blob)
  const removed = []
  let writes = 0
  const failingStore = {
    async put() {
      if (++writes === 2) throw new DOMException('Quota reached', 'QuotaExceededError')
      return { id: 'staged-asset' }
    },
    async remove(id) { removed.push(id) },
  }
  await assert.rejects(importArchiveParts(parts, failingStore), /Quota reached/)
  assert.deepEqual(removed, ['staged-asset'])

  const wrongSource = { get: async () => new Blob(['wrong'], { type: 'audio/wav' }) }
  const changedParts = []
  for await (const part of exportArchiveParts(snapshot(first.id), [first], wrongSource)) changedParts.push(part.blob)
  await assert.rejects(importArchiveParts(changedParts, indexedDbAssetStore), /checksum/)
})

test('media larger than 8 MiB is split into checked chunks across parts', async () => {
  const payload = new Uint8Array(9 * 1024 * 1024)
  payload.fill(37)
  const asset = await indexedDbAssetStore.put(new Blob([payload], { type: 'audio/wav' }), { projectId: 'big-test', kind: 'dialogue' })
  const parts = []
  for await (const part of exportArchiveParts(snapshot(asset.id), [asset], indexedDbAssetStore, 9 * 1024 * 1024)) parts.push(part.blob)
  assert.ok(parts.length >= 2)
  const imported = await importArchiveParts(parts, indexedDbAssetStore)
  const newId = imported.snapshot.scriptList[0].data.scriptLines[0].audioAssetId
  const restored = await indexedDbAssetStore.get(newId)
  assert.equal(restored.size, payload.byteLength)
  assert.equal((await restored.slice(0, 1).arrayBuffer()).byteLength, 1)
})
