import type { NovelDocument, ScriptDocument } from '../../types/project'
import type { ParsedTxtNovel, TxtChapter } from '../text/txtNovelParser'

export interface NovelImportDraft {
  novel: NovelDocument
  scripts: ScriptDocument[]
}

export function isEmptyNovel(result: ParsedTxtNovel): boolean {
  return !result.intro && result.chapters.length === 1 &&
    result.chapters[0]?.title === '正文' && !result.chapters[0]?.content.trim()
}

/** Builds complete chapter records; selection controls processing, not retention. */
export function buildNovelImport(
  fileName: string,
  result: ParsedTxtNovel,
  selectedChapterIndexes: ReadonlySet<number>,
  includeIntro = false,
): NovelImportDraft {
  if (isEmptyNovel(result)) throw new Error('TXT file has no content')
  const novelId = crypto.randomUUID()
  const scripts: ScriptDocument[] = []
  const selectedChapterIds: string[] = []
  const append = (chapter: TxtChapter, selected: boolean) => {
    const script: ScriptDocument = {
      id: crypto.randomUUID(), kind: 'novelChapter', novelId, name: chapter.title,
      data: { rawScript: chapter.content, rawAnalysisResult: '', scriptLines: [], characters: [] },
    }
    scripts.push(script)
    if (selected) selectedChapterIds.push(script.id)
  }
  if (result.intro) append(result.intro, includeIntro)
  const introScriptId = result.intro ? scripts[0]!.id : undefined
  result.chapters.forEach((chapter, index) => append(chapter, selectedChapterIndexes.has(index)))
  const title = fileName.replace(/\.txt$/i, '').trim() || '未命名小说'
  return {
    novel: { id: novelId, title, sourceFileName: fileName, encoding: result.encoding,
      chapterIds: scripts.map(script => script.id), introScriptId, selectedChapterIds, roleTimbreIds: {} },
    scripts,
  }
}
