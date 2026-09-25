import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { indexedDbAssetStore, loadWorkspaceProject, loadWorkspaceScript, removeWorkspaceProject, saveWorkspaceProject, setActiveProjectId } from '../src/services/storage/workspaceDb.ts'
import { exportArchiveParts, importArchiveParts } from '../src/services/project/archive.ts'
import { createProjectSnapshot } from '../src/services/storage/snapshot.ts'

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

test('unbound character voice and cleared line audio roundtrip as absent references', async () => {
  const source = snapshot('')
  source.characters.push({ id: 'character', name: 'Narrator', voiceAssetId: '' })
  source.scriptList[0].data.characters.push({ id: 'character', name: 'Narrator', voiceAssetId: '' })
  const saved = createProjectSnapshot(source)
  assert.equal(Object.hasOwn(saved.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(saved.scriptList[0].data.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(saved.scriptList[0].data.scriptLines[0], 'audioAssetId'), false)
  const parts = []
  // Older snapshots can still contain empty references; import normalizes those too.
  for await (const part of exportArchiveParts(source, [], indexedDbAssetStore)) parts.push(part.blob)
  const imported = await importArchiveParts(parts, indexedDbAssetStore)
  assert.equal(Object.hasOwn(imported.snapshot.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(imported.snapshot.scriptList[0].data.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(imported.snapshot.scriptList[0].data.scriptLines[0], 'audioAssetId'), false)
  const loaded = await loadWorkspaceProject(imported.projectId)
  assert.equal(Object.hasOwn(loaded.characters[0], 'voiceAssetId'), false)
  assert.equal(Object.hasOwn(loaded.scriptList[0].data.scriptLines[0], 'audioAssetId'), false)
})

test('nonempty references without archive media are rejected on export and import', async () => {
  await assert.rejects(async () => {
    for await (const _ of exportArchiveParts(snapshot('missing-id'), [], indexedDbAssetStore)) {}
  }, /Missing media assets: missing-id/)

  const source = snapshot('missing-id')
  const manifest = {
    formatVersion: 1, archiveId: crypto.randomUUID(), partIndex: 0, partCount: 1,
    scripts: source.scriptList.map((script, index) => ({ id: script.id, path: `scripts/${String(index).padStart(6, '0')}.json`, part: 0 })),
    assets: [],
  }
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)))
  await writer.add('project.json', new TextReader(JSON.stringify({
    characters: source.characters, currentScriptId: source.currentScriptId,
    libraries: source.libraries, timestamp: source.timestamp,
  })))
  for (let index = 0; index < source.scriptList.length; index++) {
    await writer.add(manifest.scripts[index].path, new TextReader(JSON.stringify(source.scriptList[index])))
  }
  const archive = await writer.close()
  await assert.rejects(importArchiveParts([archive], indexedDbAssetStore), /Missing asset reference missing-id/)
})

test('project removal deletes owned records but keeps media referenced by another project', async () => {
  const oldId = crypto.randomUUID()
  const nextId = crypto.randomUUID()
  const exclusive = await indexedDbAssetStore.put(new Blob(['exclusive']), { projectId: oldId, kind: 'dialogue' })
  const shared = await indexedDbAssetStore.put(new Blob(['shared']), { projectId: oldId, kind: 'dialogue' })
  const unrelated = await indexedDbAssetStore.put(new Blob(['unrelated']), { projectId: nextId, kind: 'dialogue' })
  const old = snapshot(exclusive.id)
  old.scriptList[1].data.scriptLines.push({ id: 'shared', type: 'dialogue', audioAssetId: shared.id })
  await saveWorkspaceProject(old, undefined, oldId)
  // A prior save can leave a script record after it disappears from the header.
  await saveWorkspaceProject({ ...old, scriptList: old.scriptList.slice(0, 1) }, undefined, oldId)
  await saveWorkspaceProject(snapshot(shared.id), undefined, nextId)
  await setActiveProjectId(nextId)
  await removeWorkspaceProject(oldId)
  assert.equal(await loadWorkspaceProject(oldId), null)
  assert.equal(await loadWorkspaceScript('first', oldId), null)
  assert.equal(await loadWorkspaceScript('second', oldId), null)
  assert.equal(await indexedDbAssetStore.get(exclusive.id), null)
  assert.equal(await (await indexedDbAssetStore.get(shared.id)).text(), 'shared')
  assert.equal(await (await indexedDbAssetStore.get(unrelated.id)).text(), 'unrelated')
  assert.deepEqual(await indexedDbAssetStore.list(oldId), [])
  assert.ok((await indexedDbAssetStore.list(nextId)).some(asset => asset.id === shared.id))
  assert.equal((await loadWorkspaceProject(nextId)).scriptList.length, 2)
  await assert.rejects(removeWorkspaceProject(nextId), /Cannot remove the active project/)
  assert.equal((await loadWorkspaceProject(nextId)).scriptList.length, 2)
})

test('missing archive part is rejected without switching projects', async () => {
  const oldId = crypto.randomUUID()
  const oldMedia = await indexedDbAssetStore.put(new Blob(['old project']), { projectId: oldId, kind: 'dialogue' })
  await saveWorkspaceProject(snapshot(oldMedia.id), undefined, oldId)
  await setActiveProjectId(oldId)
  const media = await indexedDbAssetStore.put(new Blob(['long audio'.repeat(200)], { type: 'audio/wav' }), { projectId: 'test', kind: 'dialogue' })
  const parts = []
  for await (const part of exportArchiveParts(snapshot(media.id), [media], indexedDbAssetStore, 900)) parts.push(part.blob)
  assert.ok(parts.length > 1)
  await assert.rejects(importArchiveParts(parts.slice(0, 1), indexedDbAssetStore), /Expected .*archive parts/)
  await assert.rejects(importArchiveParts(parts.slice(1), indexedDbAssetStore), /manifest is missing/)
  assert.equal((await loadWorkspaceProject(oldId)).scriptList.length, 2)
  assert.equal(await (await indexedDbAssetStore.get(oldMedia.id)).text(), 'old project')
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
