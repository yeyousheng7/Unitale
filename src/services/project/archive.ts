import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter, configure } from '@zip.js/zip.js'
import type { ProjectSnapshot } from '../../types/project'
import type { AssetRef, AssetStore } from '../storage/assetStore'
import { crc32OfBlob } from '../storage/assetStore'
import { referencedAssetIds } from '../storage/audit'
import { saveWorkspaceProject } from '../storage/workspaceDb'

configure({ useWebWorkers: false })

export const ARCHIVE_FORMAT_VERSION = 1
// Leave room for the manifest and ZIP central directory under a 128 MiB package goal.
export const ARCHIVE_PART_TARGET_BYTES = 112 * 1024 * 1024
export const ARCHIVE_CHUNK_BYTES = 8 * 1024 * 1024

interface ArchiveAsset extends AssetRef {
  chunks: Array<{ path: string; part: number; byteLength: number }>
}

interface ArchiveManifest {
  formatVersion: 1
  archiveId: string
  partIndex: number
  partCount: number
  scripts: Array<{ id: string; path: string; part: number }>
  assets: ArchiveAsset[]
}

type ArchiveEntry = { path: string; text?: string; assetId?: string; start?: number; end?: number }
type ArchivePartHeader = Pick<ArchiveManifest, 'formatVersion' | 'archiveId' | 'partIndex' | 'partCount'>

function planArchive(snapshot: ProjectSnapshot, refs: AssetRef[], targetBytes: number) {
  const referenced = referencedAssetIds(snapshot)
  const refById = new Map(refs.map(ref => [ref.id, ref]))
  const missing = [...referenced].filter(id => !refById.has(id))
  if (missing.length) throw new Error(`Missing media assets: ${missing.join(', ')}`)

  const project = { characters: snapshot.characters, currentScriptId: snapshot.currentScriptId,
    libraries: snapshot.libraries, timestamp: snapshot.timestamp }
  const parts: ArchiveEntry[][] = [[{ path: 'project.json', text: JSON.stringify(project) }]]
  let partBytes = new Blob([parts[0]![0]!.text!]).size
  if (partBytes > targetBytes) throw new Error('Project metadata exceeds the archive part size')
  const assets: ArchiveAsset[] = []
  const includedAssets = new Set<string>()
  const push = (entry: ArchiveEntry, bytes: number) => {
    if (partBytes + bytes > targetBytes && parts[parts.length - 1]!.length) {
      parts.push([])
      partBytes = 0
    }
    const part = parts.length - 1
    parts[part]!.push(entry)
    partBytes += bytes
    return part
  }
  const addAsset = (id: string) => {
    if (includedAssets.has(id)) return
    const ref = refById.get(id)
    if (!ref) throw new Error(`Missing media asset ${id}`)
    includedAssets.add(id)
    const chunks: ArchiveAsset['chunks'] = []
    for (let start = 0, index = 0; start < ref.byteLength || (ref.byteLength === 0 && index === 0); index++) {
      const end = Math.min(start + ARCHIVE_CHUNK_BYTES, ref.byteLength)
      const size = end - start
      const path = `assets/${ref.id}/${String(index).padStart(6, '0')}`
      const part = push({ path, assetId: ref.id, start, end }, size)
      chunks.push({ path, part, byteLength: size })
      start = end
      if (ref.byteLength === 0) break
    }
    assets.push({ ...ref, chunks })
  }
  const addIds = (values: unknown[]) => {
    for (const value of values) if (typeof value === 'string' && value) addAsset(value)
  }
  const scripts = snapshot.scriptList.map((script, index) => {
    const path = `scripts/${String(index).padStart(6, '0')}.json`
    const text = JSON.stringify(script)
    const part = push({ path, text }, new Blob([text]).size)
    addIds((script.data.characters || []).map(character => character.voiceAssetId))
    for (const line of script.data.scriptLines || []) addIds([line.audioAssetId, line.bgImageAssetId])
    return { id: script.id, path, part }
  })
  addIds(snapshot.characters.map(character => character.voiceAssetId))
  for (const library of [snapshot.libraries.sfx, snapshot.libraries.bgm, snapshot.libraries.timbres]) {
    addIds(library.map(item => item.assetId))
  }
  const archiveId = crypto.randomUUID()
  const manifests: ArchiveManifest[] = parts.map((_, partIndex) => ({
    formatVersion: ARCHIVE_FORMAT_VERSION, archiveId, partIndex, partCount: parts.length,
    scripts, assets,
  }))
  return { parts, manifests }
}

async function writeZip(
  writer: BlobWriter | WritableStream<Uint8Array>,
  entries: ArchiveEntry[], manifest: ArchiveManifest, store: AssetStore,
): Promise<Blob | void> {
  const zip = new ZipWriter(writer)
  try {
    const header: ArchiveManifest | ArchivePartHeader = manifest.partIndex === 0 ? manifest : {
      formatVersion: manifest.formatVersion, archiveId: manifest.archiveId,
      partIndex: manifest.partIndex, partCount: manifest.partCount,
    }
    await zip.add(manifest.partIndex === 0 ? 'manifest.json' : 'part.json', new TextReader(JSON.stringify(header)))
    for (const entry of entries) {
      if (entry.text !== undefined) {
        await zip.add(entry.path, new TextReader(entry.text))
      } else {
        const blob = await store.get(entry.assetId!)
        if (!blob) throw new Error(`Missing media asset ${entry.assetId}`)
        await zip.add(entry.path, new BlobReader(blob.slice(entry.start, entry.end)), { level: 0 })
      }
    }
    return await zip.close()
  } catch (error) {
    try { await zip.close() } catch { /* preserve original error */ }
    throw error
  }
}

export async function* exportArchiveParts(
  snapshot: ProjectSnapshot, refs: AssetRef[], store: AssetStore,
  targetBytes = ARCHIVE_PART_TARGET_BYTES,
): AsyncGenerator<{ name: string; blob: Blob }> {
  const { parts, manifests } = planArchive(snapshot, refs, targetBytes)
  for (let index = 0; index < parts.length; index++) {
    const blob = await writeZip(new BlobWriter('application/zip'), parts[index]!, manifests[index]!, store) as Blob
    yield { name: `Unitale_${manifests[index]!.archiveId}_part-${String(index + 1).padStart(3, '0')}-of-${String(parts.length).padStart(3, '0')}.zip`, blob }
  }
}

export async function exportArchiveToStream(
  snapshot: ProjectSnapshot, refs: AssetRef[], store: AssetStore, writable: WritableStream<Uint8Array>,
): Promise<void> {
  const { parts, manifests } = planArchive(snapshot, refs, Number.POSITIVE_INFINITY)
  await writeZip(writable, parts[0]!, manifests[0]!, store)
}

export async function importArchiveParts(files: Blob[], store: AssetStore): Promise<{ projectId: string; snapshot: ProjectSnapshot }> {
  const readers: Array<{ reader: ZipReader<Blob>; entries: Map<string, Awaited<ReturnType<ZipReader<Blob>['getEntries']>>[number]>; header: ArchivePartHeader; manifest?: ArchiveManifest }> = []
  const importedIds: string[] = []
  let committed = false
  try {
    for (const file of files) {
      const reader = new ZipReader(new BlobReader(file))
      const entries = new Map((await reader.getEntries()).map(entry => [entry.filename, entry]))
      const manifestEntry = entries.get('manifest.json')
      const partEntry = entries.get('part.json')
      const headerEntry = manifestEntry || partEntry
      if (!headerEntry || !('getData' in headerEntry) || (manifestEntry && partEntry)) throw new Error('Archive part header is missing or duplicated')
      const header = JSON.parse(await headerEntry.getData(new TextWriter())) as ArchivePartHeader
      if (header.formatVersion !== ARCHIVE_FORMAT_VERSION) throw new Error(`Unsupported archive format ${header.formatVersion}`)
      readers.push({ reader, entries, header, manifest: manifestEntry ? header as ArchiveManifest : undefined })
    }
    if (!readers.length) throw new Error('No archive parts selected')
    const fullManifests = readers.filter(part => part.manifest)
    if (fullManifests.length !== 1) throw new Error('Archive manifest is missing or duplicated')
    const expected = fullManifests[0]!.manifest!
    if (expected.partIndex !== 0) throw new Error('Invalid archive manifest part index')
    if (!Number.isSafeInteger(expected.partCount) || expected.partCount < 1 || expected.partCount > 10000 || !Array.isArray(expected.assets) || !Array.isArray(expected.scripts)) throw new Error('Invalid archive manifest')
    if (readers.length !== expected.partCount) throw new Error(`Expected ${expected.partCount} archive parts, received ${readers.length}`)
    const ordered = Array.from({ length: expected.partCount }, (_, index) => {
      const matches = readers.filter(part => part.header.partIndex === index && part.header.archiveId === expected.archiveId && part.header.partCount === expected.partCount)
      if (matches.length !== 1) throw new Error(`Archive part ${index + 1} is missing or duplicated`)
      return matches[0]!
    })
    const readText = async (path: string, part = 0) => {
      const entry = ordered[part]?.entries.get(path)
      if (!entry || !('getData' in entry)) throw new Error(`Missing archive entry ${path}`)
      return await entry.getData!(new TextWriter())
    }
    const project = JSON.parse(await readText('project.json'))
    if (!project?.libraries || !Array.isArray(project.characters)) throw new Error('Invalid project data')
    const scripts = []
    for (const script of expected.scripts) scripts.push(JSON.parse(await readText(script.path, script.part)))
    const projectId = crypto.randomUUID()
    const idMap = new Map<string, string>()
    for (const asset of expected.assets) {
      if (!asset.id || !Array.isArray(asset.chunks) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0) throw new Error('Invalid asset metadata')
      if (idMap.has(asset.id)) throw new Error(`Duplicate asset id ${asset.id}`)
      if (asset.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) !== asset.byteLength) throw new Error(`Invalid chunk layout for ${asset.id}`)
      const pieces: Blob[] = []
      for (const chunk of asset.chunks) {
        if (!Number.isSafeInteger(chunk.part) || chunk.part < 0 || chunk.part >= ordered.length || !Number.isSafeInteger(chunk.byteLength) || chunk.byteLength < 0 || chunk.byteLength > ARCHIVE_CHUNK_BYTES) throw new Error('Invalid asset chunk')
        const entry = ordered[chunk.part]?.entries.get(chunk.path)
        if (!entry || !('getData' in entry)) throw new Error(`Missing archive entry ${chunk.path}`)
        const piece = await entry.getData!(new BlobWriter())
        if (piece.size !== chunk.byteLength) throw new Error(`Invalid size for ${chunk.path}`)
        pieces.push(piece)
      }
      const blob = new Blob(pieces, { type: asset.mimeType })
      if (blob.size !== asset.byteLength || await crc32OfBlob(blob) !== asset.crc32) throw new Error(`Invalid media checksum for ${asset.id}`)
      const saved = await store.put(blob, { projectId, kind: asset.kind })
      importedIds.push(saved.id)
      idMap.set(asset.id, saved.id)
    }
    const remap = (item: Record<string, unknown>, key: string) => {
      if (typeof item[key] === 'string') {
        if (item[key] === '') {
          delete item[key]
          return
        }
        const next = idMap.get(item[key])
        if (!next) throw new Error(`Missing asset reference ${item[key]}`)
        item[key] = next
      }
    }
    for (const library of [project.libraries.sfx, project.libraries.bgm, project.libraries.timbres]) {
      for (const item of library) remap(item, 'assetId')
    }
    for (const character of project.characters) remap(character, 'voiceAssetId')
    for (const script of scripts) {
      for (const character of script.data.characters || []) remap(character, 'voiceAssetId')
      for (const line of script.data.scriptLines || []) {
        remap(line, 'audioAssetId')
        remap(line, 'bgImageAssetId')
        line.audioUrl = ''
        line.imageUrl = ''
      }
    }
    const snapshot: ProjectSnapshot = { ...project, scriptList: scripts }
    await saveWorkspaceProject(snapshot, undefined, projectId)
    committed = true
    return { projectId, snapshot }
  } finally {
    await Promise.all(readers.map(part => part.reader.close()))
    if (!committed) await Promise.allSettled(importedIds.map(id => store.remove(id)))
  }
}
