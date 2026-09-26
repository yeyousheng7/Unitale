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
  /** Missing on earlier workspaces; treat as a standalone script. */
  kind?: 'standalone' | 'novelChapter'
  novelId?: string
  data: {
    rawScript: string
    scriptLines: ScriptLine[]
    rawAnalysisResult: string
    characters: Character[]
    [key: string]: unknown
  }
}

export interface NovelDocument {
  id: string
  title: string
  sourceFileName: string
  encoding: string
  /** All scripts in source order, including optional front matter. */
  chapterIds: string[]
  /** Script ID of the source text before chapter one, when present. */
  introScriptId?: string
  /** Legacy saved selection; current processing scope is transient and passed to batch actions. */
  selectedChapterIds?: string[]
  /** Role name -> project timbre library entry ID. */
  roleTimbreIds: Record<string, string>
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
  novels?: NovelDocument[]
  currentScriptId: string
  libraries: ProjectLibraries
  timestamp: number
}
