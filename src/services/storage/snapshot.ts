import type { ProjectSnapshot } from '../../types/project'

type SnapshotInput = Pick<ProjectSnapshot, 'characters' | 'scriptList' | 'currentScriptId' | 'libraries'>

export function createProjectSnapshot(input: SnapshotInput): ProjectSnapshot {
  const plainScriptList = input.scriptList.map((script) => {
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
  })

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
