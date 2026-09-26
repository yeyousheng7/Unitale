import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectoryProjectStore } from '../src/services/storage/directoryStore.ts'

class MemoryFile {
  constructor(name) { this.name = name; this.blob = new Blob([]) }
  async getFile() { return this.blob }
  async createWritable() {
    let next = this.blob
    return {
      write: async value => { next = value instanceof Blob ? value : new Blob([value]) },
      close: async () => { this.blob = next },
      abort: async () => {},
    }
  }
}
class MemoryDirectory {
  constructor(name) { this.name = name; this.children = new Map() }
  async getDirectoryHandle(name, options = {}) {
    let child = this.children.get(name)
    if (!child && options.create) this.children.set(name, child = new MemoryDirectory(name))
    if (!(child instanceof MemoryDirectory)) throw new DOMException('Directory missing', 'NotFoundError')
    return child
  }
  async getFileHandle(name, options = {}) {
    let child = this.children.get(name)
    if (!child && options.create) this.children.set(name, child = new MemoryFile(name))
    if (!(child instanceof MemoryFile)) throw new DOMException('File missing', 'NotFoundError')
    return child
  }
  async removeEntry(name) { this.children.delete(name) }
  async queryPermission() { return 'granted' }
  async requestPermission() { return 'granted' }
}

function snapshot(id) {
  return { characters: [], currentScriptId: 'one', timestamp: 1,
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] },
    scriptList: [{ id: 'one', name: 'One', data: { rawScript: 'hello', rawAnalysisResult: '', characters: [], scriptLines: [
      { id: 'line', type: 'dialogue', audioAssetId: id },
    ] } }],
  }
}

test('directory project reopens from manifest without browser database', async () => {
  const parent = new MemoryDirectory('selected')
  const audio = new Blob(['voice'], { type: 'audio/wav' })
  const ref = { id: crypto.randomUUID(), projectId: 'old', kind: 'dialogue', mimeType: 'audio/wav',
    byteLength: audio.size, crc32: '8b9d9604', backend: 'indexeddb', createdAt: 1 }
  // Calculate the checksum from actual content, as migration must reject mismatches.
  const { crc32OfBlob } = await import('../src/services/storage/assetStore.ts')
  ref.crc32 = await crc32OfBlob(audio)
  const source = { async get(id) { return id === ref.id ? audio : null } }
  const first = await DirectoryProjectStore.migrateFromIndexedDb(parent, snapshot(ref.id), source, [ref])
  const reopened = await DirectoryProjectStore.open(first.handle)
  assert.equal((await reopened.loadProject()).scriptList[0].data.rawScript, 'hello')
  assert.equal(await (await reopened.get(ref.id)).text(), 'voice')
  assert.equal((await reopened.list(reopened.projectId))[0].backend, 'directory')
  const next = snapshot(ref.id)
  next.novels = [{ id: 'book', title: 'Book', sourceFileName: 'book.txt', encoding: 'utf-8',
    chapterIds: ['one'], selectedChapterIds: ['one'], roleTimbreIds: {} }]
  next.scriptList[0].data.rawScript = 'edited'
  await reopened.saveProject(next, new Set(['one']))
  const again = await DirectoryProjectStore.open(first.handle)
  assert.equal((await again.loadProject()).scriptList[0].data.rawScript, 'edited')
  assert.deepEqual((await again.loadProject()).novels, next.novels)
})

test('failed migration never writes a valid manifest', async () => {
  const parent = new MemoryDirectory('selected')
  const missing = { id: 'missing', projectId: 'old', kind: 'dialogue', mimeType: 'audio/wav',
    byteLength: 5, crc32: '00000000', backend: 'indexeddb', createdAt: 1 }
  await assert.rejects(DirectoryProjectStore.migrateFromIndexedDb(parent, snapshot('missing'), { get: async () => null }, [missing]), /Missing asset/)
  const child = [...parent.children.values()][0]
  await assert.rejects(DirectoryProjectStore.open(child), /File missing/)
})

test('failed directory save keeps the committed manifest and script revision', async () => {
  const parent = new MemoryDirectory('selected')
  const source = { get: async () => null }
  const initial = snapshot('')
  initial.scriptList[0].data.scriptLines = []
  const store = await DirectoryProjectStore.migrateFromIndexedDb(parent, initial, source, [])
  const manifest = await store.handle.getFileHandle('manifest.json')
  const originalCreateWritable = manifest.createWritable.bind(manifest)
  manifest.createWritable = async () => {
    const writable = await originalCreateWritable()
    return { ...writable, close: async () => { throw new Error('Disk full') } }
  }
  const changed = snapshot('')
  changed.scriptList[0].data.scriptLines = []
  changed.scriptList[0].data.rawScript = 'new text'
  await assert.rejects(store.saveProject(changed, new Set(['one'])), /Disk full/)
  manifest.createWritable = originalCreateWritable
  const reopened = await DirectoryProjectStore.open(store.handle)
  assert.equal((await reopened.loadProject()).scriptList[0].data.rawScript, 'hello')
})
