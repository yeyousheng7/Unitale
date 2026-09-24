import type { ProjectSnapshot, ScriptDocument } from '../../types/project'
import type { AssetRef, AssetStore } from './assetStore'
import { crc32OfBlob } from './assetStore'

const DIRECTORY_FORMAT_VERSION = 1
const MANIFEST_FILE = 'manifest.json'

type ScriptEntry = { id: string; path: string }
type DirectoryManifest = {
  formatVersion: 1
  projectId: string
  projectPath: string
  scripts: ScriptEntry[]
  assets: AssetRef[]
}

async function fileAt(root: FileSystemDirectoryHandle, path: string, create = false): Promise<FileSystemFileHandle> {
  const segments = path.split('/')
  let directory = root
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment, { create })
  return directory.getFileHandle(segments[segments.length - 1]!, { create })
}

async function readBlob(root: FileSystemDirectoryHandle, path: string): Promise<Blob> {
  return (await fileAt(root, path)).getFile()
}

async function writeBlob(root: FileSystemDirectoryHandle, path: string, blob: Blob): Promise<void> {
  const writable = await (await fileAt(root, path, true)).createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    throw error
  }
}

async function readJson<T>(root: FileSystemDirectoryHandle, path: string): Promise<T> {
  return JSON.parse(await (await readBlob(root, path)).text()) as T
}

async function writeJson(root: FileSystemDirectoryHandle, path: string, data: unknown): Promise<void> {
  await writeBlob(root, path, new Blob([JSON.stringify(data)], { type: 'application/json' }))
}

async function removeAt(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const segments = path.split('/')
  let directory = root
  for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment)
  await directory.removeEntry(segments[segments.length - 1]!)
}

function assetPath(id: string): string { return `assets/${id}` }
function scriptPath(): string { return `scripts/${crypto.randomUUID()}.json` }
function projectPath(): string { return `projects/${crypto.randomUUID()}.json` }

export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const }
  const permissionHandle = handle as FileSystemDirectoryHandle & {
    queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
    requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  }
  if (typeof permissionHandle.queryPermission !== 'function') return false
  if (await permissionHandle.queryPermission(options) === 'granted') return true
  return await permissionHandle.requestPermission(options) === 'granted'
}

/** The manifest in the user-selected directory is the authoritative project pointer. */
export class DirectoryProjectStore implements AssetStore {
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(readonly handle: FileSystemDirectoryHandle, private manifest: DirectoryManifest) {}

  static async open(handle: FileSystemDirectoryHandle): Promise<DirectoryProjectStore> {
    const manifest = await readJson<DirectoryManifest>(handle, MANIFEST_FILE)
    if (manifest.formatVersion !== DIRECTORY_FORMAT_VERSION || !manifest.projectId ||
        !Array.isArray(manifest.scripts) || !Array.isArray(manifest.assets)) throw new Error('Invalid Unitale directory manifest')
    return new DirectoryProjectStore(handle, manifest)
  }

  static async migrateFromIndexedDb(
    parent: FileSystemDirectoryHandle, snapshot: ProjectSnapshot, source: AssetStore, refs: AssetRef[],
  ): Promise<DirectoryProjectStore> {
    const projectId = crypto.randomUUID()
    const root = await parent.getDirectoryHandle(`Unitale_${projectId.slice(0, 8)}`, { create: true })
    const manifest: DirectoryManifest = {
      formatVersion: 1, projectId, projectPath: '', scripts: [], assets: [],
    }
    const store = new DirectoryProjectStore(root, manifest)
    for (const ref of refs) {
      const blob = await source.get(ref.id)
      if (!blob) throw new Error(`Missing asset ${ref.id}`)
      if (blob.size !== ref.byteLength || await crc32OfBlob(blob) !== ref.crc32) throw new Error(`Asset checksum mismatch ${ref.id}`)
      await writeBlob(root, assetPath(ref.id), blob)
      manifest.assets.push({ ...ref, projectId, backend: 'directory', location: assetPath(ref.id) })
    }
    const project = { characters: snapshot.characters, currentScriptId: snapshot.currentScriptId,
      libraries: snapshot.libraries, timestamp: snapshot.timestamp }
    manifest.projectPath = projectPath()
    await writeJson(root, manifest.projectPath, project)
    for (const script of snapshot.scriptList) {
      const path = scriptPath()
      await writeJson(root, path, script)
      manifest.scripts.push({ id: script.id, path })
    }
    // This is the only commit point. Failed copies leave the IndexedDB project active.
    await writeJson(root, MANIFEST_FILE, manifest)
    return store
  }

  get projectId(): string { return this.manifest.projectId }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(job)
    this.queue = result
    return result
  }

  async loadProject(): Promise<ProjectSnapshot> {
    const project = await readJson<Omit<ProjectSnapshot, 'scriptList'>>(this.handle, this.manifest.projectPath)
    const scriptList = await Promise.all(this.manifest.scripts.map(entry => readJson<ScriptDocument>(this.handle, entry.path)))
    return { ...project, scriptList }
  }

  saveProject(snapshot: ProjectSnapshot, changedScriptIds?: ReadonlySet<string>): Promise<void> {
    return this.serialize(async () => {
      const old = this.manifest
      const next: DirectoryManifest = { ...old, scripts: old.scripts.map(entry => ({ ...entry })), assets: [...old.assets], projectPath: projectPath() }
      const obsoletePaths = [old.projectPath]
      await writeJson(this.handle, next.projectPath, {
        characters: snapshot.characters, currentScriptId: snapshot.currentScriptId,
        libraries: snapshot.libraries, timestamp: snapshot.timestamp,
      })
      const currentIds = new Set(snapshot.scriptList.map(script => script.id))
      next.scripts = next.scripts.filter(entry => {
        if (currentIds.has(entry.id)) return true
        obsoletePaths.push(entry.path)
        return false
      })
      for (const script of snapshot.scriptList) {
        const existing = next.scripts.find(entry => entry.id === script.id)
        if (existing && changedScriptIds && !changedScriptIds.has(script.id)) continue
        const path = scriptPath()
        await writeJson(this.handle, path, script)
        if (existing) {
          obsoletePaths.push(existing.path)
          existing.path = path
        } else next.scripts.push({ id: script.id, path })
      }
      await writeJson(this.handle, MANIFEST_FILE, next)
      this.manifest = next
      await Promise.allSettled(obsoletePaths.filter(Boolean).map(path => removeAt(this.handle, path)))
    })
  }

  put(blob: Blob, metadata: { projectId: string; kind: AssetRef['kind'] }): Promise<AssetRef> {
    return this.serialize(async () => {
      if (metadata.projectId !== this.projectId) throw new Error('Asset belongs to another project')
      const id = crypto.randomUUID()
      const ref: AssetRef = {
        id, projectId: this.projectId, kind: metadata.kind,
        mimeType: blob.type || 'application/octet-stream', byteLength: blob.size,
        crc32: await crc32OfBlob(blob), backend: 'directory', location: assetPath(id), createdAt: Date.now(),
      }
      await writeBlob(this.handle, assetPath(ref.id), blob)
      const next = { ...this.manifest, assets: [...this.manifest.assets, ref] }
      await writeJson(this.handle, MANIFEST_FILE, next)
      this.manifest = next
      return ref
    })
  }

  async get(id: string): Promise<Blob | null> {
    const ref = this.manifest.assets.find(asset => asset.id === id)
    if (!ref) return null
    const blob = await readBlob(this.handle, assetPath(id))
    if (blob.size !== ref.byteLength) throw new Error(`Asset size mismatch ${id}`)
    return blob
  }

  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      if (!this.manifest.assets.some(asset => asset.id === id)) return
      const next = { ...this.manifest, assets: this.manifest.assets.filter(asset => asset.id !== id) }
      await writeJson(this.handle, MANIFEST_FILE, next)
      this.manifest = next
      await removeAt(this.handle, assetPath(id)).catch(() => {})
    })
  }

  async list(projectId: string): Promise<AssetRef[]> {
    return projectId === this.projectId ? [...this.manifest.assets] : []
  }
}
