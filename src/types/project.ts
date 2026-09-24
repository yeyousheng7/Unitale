export interface ScriptLine {
  id: string
  type: string
  [key: string]: unknown
}

export interface Character {
  id: string
  name: string
  [key: string]: unknown
}

export interface ScriptDocument {
  id: string
  name: string
  data: {
    rawScript: string
    scriptLines: ScriptLine[]
    rawAnalysisResult: string
    characters: Character[]
    [key: string]: unknown
  }
}

export interface ProjectLibraries {
  sfx: Record<string, unknown>[]
  bgm: Record<string, unknown>[]
  timbres: Record<string, unknown>[]
  filters: Record<string, unknown>[]
  emotions: Record<string, unknown>[]
}

export interface ProjectSnapshot {
  characters: Character[]
  scriptList: ScriptDocument[]
  currentScriptId: string
  libraries: ProjectLibraries
  timestamp: number
}
