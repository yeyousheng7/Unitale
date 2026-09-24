import type { ProjectSnapshot } from '../../types/project'

export function referencedLegacyAssetKeys(project: ProjectSnapshot): Set<string> {
  const keys = new Set<string>()
  for (const library of [project.libraries.sfx, project.libraries.bgm]) {
    for (const item of library) if (typeof item.filename === 'string' && item.filename) keys.add(item.filename)
  }
  for (const item of project.libraries.timbres) {
    if (typeof item.refPath === 'string' && item.refPath) keys.add(item.refPath)
  }
  for (const character of project.characters) {
    if (typeof character.voiceFile === 'string' && character.voiceFile) keys.add(character.voiceFile)
  }
  for (const script of project.scriptList) {
    for (const character of script.data.characters || []) {
      if (typeof character.voiceFile === 'string' && character.voiceFile) keys.add(character.voiceFile)
    }
    for (const line of script.data.scriptLines || []) {
      if (line.type === 'dialogue') keys.add(`line_audio_${line.id}`)
      if (line.type === 'bgImage') {
        keys.add(typeof line.bgImageAssetKey === 'string' && line.bgImageAssetKey
          ? line.bgImageAssetKey : `bgImage_${line.id}`)
      }
    }
  }
  return keys
}

export function auditAssetRecords(
  records: Array<{ key: string; byteLength: number }>,
  referenced: ReadonlySet<string>,
) {
  const orphanKeys: string[] = []
  let totalBytes = 0
  let orphanBytes = 0
  for (const record of records) {
    totalBytes += record.byteLength
    if (!referenced.has(record.key)) {
      orphanKeys.push(record.key)
      orphanBytes += record.byteLength
    }
  }
  return { assetCount: records.length, totalBytes, orphanCount: orphanKeys.length, orphanBytes, orphanKeys }
}

export function referencedAssetIds(project: ProjectSnapshot): Set<string> {
  const ids = new Set<string>()
  const add = (value: unknown) => { if (typeof value === 'string' && value) ids.add(value) }
  for (const library of [project.libraries.sfx, project.libraries.bgm, project.libraries.timbres]) {
    for (const item of library) add(item.assetId)
  }
  for (const character of project.characters) add(character.voiceAssetId)
  for (const script of project.scriptList) {
    for (const character of script.data.characters || []) add(character.voiceAssetId)
    for (const line of script.data.scriptLines || []) {
      add(line.audioAssetId)
      add(line.bgImageAssetId)
    }
  }
  return ids
}
