import type { ProjectSnapshot } from '../../types/project'

type SnapshotInput = Pick<ProjectSnapshot, 'characters' | 'scriptList' | 'currentScriptId' | 'libraries'>

function plainScript(script: ProjectSnapshot['scriptList'][number]) {
  const plainLines = (script.data.scriptLines || []).map((line) => {
    const { audioUrl, imageUrl, isGenerating, abortController, ...rest } = line
    return rest
  })
  return {
    ...script,
    data: {
      ...script.data,
      scriptLines: plainLines,
      characters: (script.data.characters || []).map((character) => {
        const { isAnalyzing, isGeneratingVoice, abortController, ...rest } = character
        return rest
      }),
    },
  }
}

export function createProjectSnapshot(input: SnapshotInput): ProjectSnapshot {
  const plainScriptList = input.scriptList.map(plainScript)

  return JSON.parse(JSON.stringify({
    characters: input.characters.map((character) => {
      const { isAnalyzing, isGeneratingVoice, abortController, ...rest } = character
      return rest
    }),
    scriptList: plainScriptList,
    currentScriptId: input.currentScriptId,
    libraries: input.libraries,
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
