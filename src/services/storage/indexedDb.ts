import type { ProjectSnapshot } from '../../types/project'

export const DB_NAME = 'UnitaleDB'
export const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null
let dbPromise: Promise<IDBDatabase> | null = null

export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = (event) => {
      console.error('DB Error', event)
      dbPromise = null
      reject(event)
    }
    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result
      dbInstance.onclose = () => { dbInstance = null; dbPromise = null }
      dbInstance.onversionchange = () => { dbInstance?.close(); dbInstance = null; dbPromise = null }
      resolve(dbInstance)
    }
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('project')) db.createObjectStore('project')
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
    }
  })
  return dbPromise
}

export async function saveAssetToDB(key: string, blob: Blob): Promise<void> {
  try {
    if (!dbInstance) await initDB()
    return await new Promise((resolve, reject) => {
      try {
        const tx = dbInstance!.transaction('assets', 'readwrite')
        tx.objectStore('assets').put(blob, key)
        tx.oncomplete = () => resolve()
        tx.onerror = (event) => reject(event)
      } catch (error) { reject(error) }
    })
  } catch (error) {
    const dbError = error as { name?: string; message?: string }
    if (dbError.name === 'InvalidStateError' || dbError.message?.includes('closing')) {
      console.warn('DB connection closed, retrying saveAssetToDB...')
      dbInstance = null
      dbPromise = null
      await initDB()
      return new Promise((resolve, reject) => {
        const tx = dbInstance!.transaction('assets', 'readwrite')
        tx.objectStore('assets').put(blob, key)
        tx.oncomplete = () => resolve()
        tx.onerror = (event) => reject(event)
      })
    }
    throw error
  }
}

export async function loadAssetFromDB(key: string): Promise<Blob | null | undefined> {
  if (!dbInstance) await initDB()
  return new Promise((resolve) => {
    const tx = dbInstance!.transaction('assets', 'readonly')
    const request = tx.objectStore('assets').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function saveAssetsBatch(items: Array<{ key: string; blob: Blob }>): Promise<void> {
  if (!dbInstance) await initDB()

  const uniqueMap = new Map<string, Blob>()
  items.forEach((item) => uniqueMap.set(item.key, item.blob))
  const entries = Array.from(uniqueMap.entries())
  const BATCH_SIZE = 5

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE)
    let retries = 3
    while (retries > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = dbInstance!.transaction('assets', 'readwrite')
          const store = tx.objectStore('assets')
          tx.oncomplete = () => resolve()
          tx.onerror = (event) => reject(event)
          tx.onabort = (event) => reject(event)
          for (const [key, blob] of chunk) store.put(blob, key)
        })
        break
      } catch (error) {
        console.warn(`Batch save failed (chunk ${i}), retrying...`, error)
        retries--
        if (retries === 0) throw error
        dbInstance = null
        dbPromise = null
        await initDB()
      }
    }
  }
}

export async function saveProjectRecord(data: ProjectSnapshot): Promise<void> {
  if (!dbInstance) await initDB()
  return new Promise((resolve, reject) => {
    const tx = dbInstance!.transaction('project', 'readwrite')
    tx.objectStore('project').put(data, 'currentState')
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => reject(event)
  })
}

export async function loadProjectRecord(): Promise<ProjectSnapshot | null | undefined> {
  if (!dbInstance) await initDB()
  return new Promise((resolve) => {
    const tx = dbInstance!.transaction('project', 'readonly')
    const request = tx.objectStore('project').get('currentState')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function deleteAssetFromDB(key: string): Promise<void> {
  if (!dbInstance) await initDB()
  return new Promise((resolve, reject) => {
    const tx = dbInstance!.transaction('assets', 'readwrite')
    const request = tx.objectStore('assets').delete(key)
    request.onsuccess = () => resolve()
    request.onerror = (event) => reject((event.target as IDBRequest).error)
  })
}
