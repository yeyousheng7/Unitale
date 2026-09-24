import type { Character, ScriptDocument } from '../../types/project'

interface ProjectExportInput {
  sfx: Record<string, unknown>[]
  bgm: Record<string, unknown>[]
  timbres: Record<string, unknown>[]
  filters: Record<string, unknown>[]
  emotions: Record<string, unknown>[]
  characters: Character[]
  scriptList: ScriptDocument[]
  currentScriptId: string
}

export function createProjectExportBlob(input: ProjectExportInput): Blob {
  const blobParts: BlobPart[] = []
  blobParts.push('{\n  "version": "2.0",\n  "timestamp": "' + new Date().toISOString() + '",\n  "libraries": {\n')

  blobParts.push('    "sfx": [')
  for (let i = 0; i < input.sfx.length; i++) {
    blobParts.push(JSON.stringify(input.sfx[i] || null))
    if (i < input.sfx.length - 1) blobParts.push(',')
  }
  blobParts.push('],\n')

  blobParts.push('    "bgm": [')
  for (let i = 0; i < input.bgm.length; i++) {
    blobParts.push(JSON.stringify(input.bgm[i] || null))
    if (i < input.bgm.length - 1) blobParts.push(',')
  }
  blobParts.push('],\n')

  blobParts.push('    "timbres": [')
  for (let i = 0; i < input.timbres.length; i++) {
    blobParts.push(JSON.stringify(input.timbres[i] || null))
    if (i < input.timbres.length - 1) blobParts.push(',')
  }
  blobParts.push('],\n')

  blobParts.push('    "filters": ' + JSON.stringify(input.filters) + ',\n')
  blobParts.push('    "emotions": ' + JSON.stringify(input.emotions) + '\n  },\n')
  blobParts.push('  "project": {\n')
  blobParts.push('    "characters": ' + JSON.stringify(input.characters) + ',\n')

  blobParts.push('    "scriptList": [')
  for (let i = 0; i < input.scriptList.length; i++) {
    const script = input.scriptList[i]!
    blobParts.push('{"id":' + JSON.stringify(script.id) + ',"name":' + JSON.stringify(script.name) + ',"data":{')
    blobParts.push('"rawScript":' + JSON.stringify(script.data.rawScript || '') + ',"rawAnalysisResult":' + JSON.stringify(script.data.rawAnalysisResult || '') + ',"characters":' + JSON.stringify(script.data.characters || []) + ',"scriptLines":[')

    const lines = script.data.scriptLines || []
    for (let j = 0; j < lines.length; j++) {
      blobParts.push(JSON.stringify(lines[j] || null))
      if (j < lines.length - 1) blobParts.push(',')
    }
    blobParts.push(']}}')
    if (i < input.scriptList.length - 1) blobParts.push(',')
  }
  blobParts.push('],\n')
  blobParts.push('    "currentScriptId": ' + JSON.stringify(input.currentScriptId) + '\n  }\n}')

  return new Blob(blobParts, { type: 'application/json;charset=utf-8' })
}
