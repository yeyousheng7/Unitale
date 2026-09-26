import type { ProjectSnapshot, ScriptDocument } from '../../types/project'
import type { AssetRef, AssetStore } from './assetStore'
import { crc32OfBlob } from './assetStore'
import { referencedAssetIds } from './audit'

export const WORKSPACE_DB_NAME = 'UnitaleWorkspaceDB'
export const WORKSPACE_DB_VERSION = 2
export const DEFAULT_PROJECT_ID = 'default'

let openPromise: Promise<IDBDatabase> | null = null

export function openWorkspaceDB(): Promise<IDBDatabase> {
  if (openPromise) return openPromise
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of ['projects', 'scripts', 'assetMetadata', 'assetBlobs', 'recentDirectories', 'settings']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
      const metadata = request.transaction!.objectStore('assetMetadata')
      if (!metadata.indexNames.contains('byProject')) metadata.createIndex('byProject', 'projectId')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onclose = () => { openPromise = null }
      db.onversionchange = () => { db.close(); openPromise = null }
      resolve(db)
    }
    request.onerror = () => { openPromise = null; reject(request.error) }
    request.onblocked = () => { openPromise = null; reject(new Error('Workspace database upgrade is blocked by another tab')) }
  })
  return openPromise
}

function transact<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
  return openWorkspaceDB().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result: T
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'))
    tx.onerror = () => reject(tx.error || new Error('Database transaction failed'))
    try { action(tx, value => { result = value }) } catch (error) { tx.abort(); reject(error) }
  }))
}

export class IndexedDbAssetStore implements AssetStore {
  async put(blob: Blob, metadata: { projectId: string; kind: AssetRef['kind'] }): Promise<AssetRef> {
    const id = crypto.randomUUID()
    const ref: AssetRef = {
      id, projectId: metadata.projectId, kind: metadata.kind,
      mimeType: blob.type || 'application/octet-stream', byteLength: blob.size,
      crc32: await crc32OfBlob(blob), backend: 'indexeddb', location: `assetBlobs/${id}`, createdAt: Date.now(),
    }
    await transact<void>(['assetBlobs', 'assetMetadata'], 'readwrite', tx => {
      tx.objectStore('assetBlobs').put(blob, ref.id)
      tx.objectStore('assetMetadata').put(ref, ref.id)
    })
    return ref
  }

  get(id: string): Promise<Blob | null> {
    return transact<Blob | null>(['assetBlobs'], 'readonly', (tx, done) => {
      const request = tx.objectStore('assetBlobs').get(id)
      request.onsuccess = () => done(request.result || null)
    })
  }

  remove(id: string): Promise<void> {
    return transact<void>(['assetBlobs', 'assetMetadata'], 'readwrite', tx => {
      tx.objectStore('assetBlobs').delete(id)
      tx.objectStore('assetMetadata').delete(id)
    })
  }

  list(projectId: string): Promise<AssetRef[]> {
    return transact<AssetRef[]>(['assetMetadata'], 'readonly', (tx, done) => {
      const items: AssetRef[] = []
      const request = tx.objectStore('assetMetadata').index('byProject').openCursor(IDBKeyRange.only(projectId))
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          items.push(cursor.value)
          cursor.continue()
        } else done(items)
      }
    })
  }
}

export const indexedDbAssetStore = new IndexedDbAssetStore()

interface ProjectHeader {
  id: string
  characters: ProjectSnapshot['characters']
  currentScriptId: string
  libraries: ProjectSnapshot['libraries']
  scriptIds: string[]
  novels?: ProjectSnapshot['novels']
  timestamp: number
}

export async function saveWorkspaceProject(data: ProjectSnapshot, changedScriptIds?: ReadonlySet<string>, projectId = DEFAULT_PROJECT_ID): Promise<void> {
  const header: ProjectHeader = {
    id: projectId, characters: data.characters, currentScriptId: data.currentScriptId,
    libraries: data.libraries, scriptIds: data.scriptList.map(script => script.id),
    novels: data.novels || [], timestamp: data.timestamp,
  }
  const writes = changedScriptIds
    ? data.scriptList.filter(script => changedScriptIds.has(script.id)) : data.scriptList
  await transact<void>(['projects', 'scripts'], 'readwrite', tx => {
    tx.objectStore('projects').put(header, projectId)
    const store = tx.objectStore('scripts')
    for (const script of writes) store.put(script, `${projectId}:${script.id}`)
  })
}

export async function loadWorkspaceProject(projectId = DEFAULT_PROJECT_ID): Promise<ProjectSnapshot | null> {
  const header = await transact<ProjectHeader | null>(['projects'], 'readonly', (tx, done) => {
    const request = tx.objectStore('projects').get(projectId)
    request.onsuccess = () => done(request.result || null)
  })
  if (!header) return null
  const scripts = await Promise.all(header.scriptIds.map(id => loadWorkspaceScript(id, projectId)))
  if (scripts.some(script => script === null)) throw new Error(`Project ${projectId} has missing script records`)
  return { characters: header.characters, currentScriptId: header.currentScriptId,
    libraries: header.libraries, novels: header.novels || [], timestamp: header.timestamp,
    scriptList: scripts.filter((script): script is ScriptDocument => script !== null) }
}

export function loadWorkspaceScript(id: string, projectId = DEFAULT_PROJECT_ID): Promise<ScriptDocument | null> {
  return transact<ScriptDocument | null>(['scripts'], 'readonly', (tx, done) => {
    const request = tx.objectStore('scripts').get(`${projectId}:${id}`)
    request.onsuccess = () => done(request.result || null)
  })
}

export async function removeWorkspaceScript(id: string, projectId = DEFAULT_PROJECT_ID): Promise<void> {
  await transact<void>(['scripts'], 'readwrite', tx => {
    tx.objectStore('scripts').delete(`${projectId}:${id}`)
  })
}

/** Remove an inactive IndexedDB project and media that no other project references. */
export async function removeWorkspaceProject(projectId: string): Promise<void> {
  if (!projectId) throw new Error('Project id is required')
  const active = await getActiveWorkspace()
  if (active.backend === 'indexeddb' && active.id === projectId) throw new Error('Cannot remove the active project')
  await transact<void>(['settings', 'projects', 'scripts', 'assetMetadata', 'assetBlobs'], 'readwrite', tx => {
    const settings = tx.objectStore('settings')
    const projects = tx.objectStore('projects')
    const scripts = tx.objectStore('scripts')
    const activeRequest = settings.get('activeWorkspace')
    const projectRequest = projects.getAll() as IDBRequest<ProjectHeader[]>
    const scriptRequest = scripts.openCursor()
    const scriptRecords = new Map<string, ScriptDocument>()
    let scriptsRead = false

    const finish = () => {
      if (!scriptsRead || activeRequest.readyState !== 'done' || projectRequest.readyState !== 'done') return
      const active = activeRequest.result as ActiveWorkspace | undefined
      if ((active || { id: DEFAULT_PROJECT_ID, backend: 'indexeddb' }).backend === 'indexeddb' &&
          (active?.id || DEFAULT_PROJECT_ID) === projectId) {
        tx.abort()
        return
      }

      const others = projectRequest.result.filter(project => project.id !== projectId)
      const prefix = `${projectId}:`
      const nestedOtherPrefixes = others.map(project => `${project.id}:`).filter(other => other.startsWith(prefix))
      const otherScriptKeys = new Set(others.flatMap(project => project.scriptIds.map(id => `${project.id}:${id}`)))
      const referencedByOtherProject = new Map<string, string>()
      for (const project of others) {
        const projectScripts = project.scriptIds.map(id => scriptRecords.get(`${project.id}:${id}`)).filter((script): script is ScriptDocument => !!script)
        for (const id of referencedAssetIds({ ...project, scriptList: projectScripts })) {
          if (!referencedByOtherProject.has(id)) referencedByOtherProject.set(id, project.id)
        }
      }

      projects.delete(projectId)
      for (const key of scriptRecords.keys()) {
        if (key.startsWith(prefix) && !otherScriptKeys.has(key) && !nestedOtherPrefixes.some(other => key.startsWith(other))) scripts.delete(key)
      }
      const mediaRequest = tx.objectStore('assetMetadata').index('byProject').openCursor(IDBKeyRange.only(projectId))
      mediaRequest.onsuccess = () => {
        const cursor = mediaRequest.result
        if (!cursor) return
        const ref = cursor.value as AssetRef
        const nextOwner = referencedByOtherProject.get(ref.id)
        if (nextOwner) {
          cursor.update({ ...ref, projectId: nextOwner })
        } else {
          cursor.delete()
          tx.objectStore('assetBlobs').delete(ref.id)
        }
        cursor.continue()
      }
    }

    activeRequest.onsuccess = finish
    projectRequest.onsuccess = finish
    scriptRequest.onsuccess = () => {
      const cursor = scriptRequest.result
      if (cursor) {
        scriptRecords.set(String(cursor.key), cursor.value as ScriptDocument)
        cursor.continue()
      } else {
        scriptsRead = true
        finish()
      }
    }
  })
}

export type ActiveWorkspace = { id: string; backend: 'indexeddb' | 'directory' }

export function getActiveWorkspace(): Promise<ActiveWorkspace> {
  return transact<ActiveWorkspace>(['settings'], 'readonly', (tx, done) => {
    const request = tx.objectStore('settings').get('activeWorkspace')
    request.onsuccess = () => done(request.result || { id: DEFAULT_PROJECT_ID, backend: 'indexeddb' })
  })
}

export function setActiveWorkspace(workspace: ActiveWorkspace): Promise<void> {
  return transact<void>(['settings'], 'readwrite', tx => { tx.objectStore('settings').put(workspace, 'activeWorkspace') })
}

export async function getActiveProjectId(): Promise<string> { return (await getActiveWorkspace()).id }
export async function setActiveProjectId(id: string): Promise<void> { await setActiveWorkspace({ id, backend: 'indexeddb' }) }

export async function storeRecentDirectory(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await transact<void>(['recentDirectories'], 'readwrite', tx => { tx.objectStore('recentDirectories').put(handle, id) })
}

export function loadRecentDirectory(id: string): Promise<FileSystemDirectoryHandle | null> {
  return transact<FileSystemDirectoryHandle | null>(['recentDirectories'], 'readonly', (tx, done) => {
    const request = tx.objectStore('recentDirectories').get(id)
    request.onsuccess = () => done(request.result || null)
  })
}
