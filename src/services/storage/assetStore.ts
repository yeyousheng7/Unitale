export type AssetKind = 'dialogue' | 'backgroundImage' | 'voice' | 'sfx' | 'bgm'
export type StorageBackend = 'indexeddb' | 'directory'

export interface AssetRef {
  id: string
  projectId: string
  kind: AssetKind
  mimeType: string
  byteLength: number
  crc32: string
  backend: StorageBackend
  location: string
  createdAt: number
}

export interface AssetStore {
  put(blob: Blob, metadata: { projectId: string; kind: AssetKind }): Promise<AssetRef>
  get(id: string): Promise<Blob | null>
  remove(id: string): Promise<void>
  list(projectId: string): Promise<AssetRef[]>
}

export async function crc32OfBlob(blob: Blob): Promise<string> {
  let crc = 0xffffffff
  const reader = blob.stream().getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      for (const byte of value) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
      }
    }
  } finally { reader.releaseLock() }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}
