import type { ProjectSnapshot } from '../../types/project'

type SnapshotInput = Pick<ProjectSnapshot, 'characters' | 'scriptList' | 'novels' | 'currentScriptId' | 'libraries'>

function omitEmptyAssetIds<T extends Record<string, unknown>>(item: T, keys: string[]): T {
  const result = { ...item }
  for (const key of keys) if (result[key] === '') delete result[key]
  return result
}

function plainScript(script: ProjectSnapshot['scriptList'][number]) {
  const plainLines = (script.data.scriptLines || []).map((line) => {
    const { audioUrl, imageUrl, isGenerating, abortController, ...rest } = line
    return omitEmptyAssetIds(rest, ['audioAssetId', 'bgImageAssetId'])
  })
  return {
    ...script,
    data: {
      ...script.data,
      scriptLines: plainLines,
      characters: (script.data.characters || []).map((character) => {
        const { isAnalyzing, isGeneratingVoice, abortController, ...rest } = character
        return omitEmptyAssetIds(rest, ['voiceAssetId'])
      }),
    },
  }
}

export function createProjectSnapshot(input: SnapshotInput): ProjectSnapshot {
  const plainScriptList = input.scriptList.map(plainScript)

  return JSON.parse(JSON.stringify({
    characters: input.characters.map((character) => {
      const { isAnalyzing, isGeneratingVoice, abortController, ...rest } = character
      return omitEmptyAssetIds(rest, ['voiceAssetId'])
    }),
    scriptList: plainScriptList,
    novels: input.novels || [],
    currentScriptId: input.currentScriptId,
    libraries: {
      ...input.libraries,
      sfx: input.libraries.sfx.map(item => omitEmptyAssetIds(item, ['assetId'])),
      bgm: input.libraries.bgm.map(item => omitEmptyAssetIds(item, ['assetId'])),
      timbres: input.libraries.timbres.map(item => omitEmptyAssetIds(item, ['assetId'])),
    },
    timestamp: Date.now(),
  })) as ProjectSnapshot
}

/** The save path serializes only scripts whose records will be written. */
export function createProjectSaveSnapshot(input: SnapshotInput, changed: ReadonlySet<string>): ProjectSnapshot {
  const header = createProjectSnapshot({ ...input, scriptList: [] })
  return {
    ...header,
    scriptList: input.scriptList.map(script => changed.has(script.id)
      ? JSON.parse(JSON.stringify(plainScript(script))) as ProjectSnapshot['scriptList'][number]
      : script),
  }
}
