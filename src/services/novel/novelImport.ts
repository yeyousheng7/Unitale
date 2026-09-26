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

/** Builds every chapter and front matter record without choosing a processing range. */
export function buildNovelImport(fileName: string, result: ParsedTxtNovel): NovelImportDraft {
  if (isEmptyNovel(result)) throw new Error('TXT file has no content')
  const novelId = crypto.randomUUID()
  const scripts: ScriptDocument[] = []
  const append = (chapter: TxtChapter) => {
    const script: ScriptDocument = {
      id: crypto.randomUUID(), kind: 'novelChapter', novelId, name: chapter.title,
      data: { rawScript: chapter.content, rawAnalysisResult: '', scriptLines: [], characters: [] },
    }
    scripts.push(script)
  }
  if (result.intro) append(result.intro)
  const introScriptId = result.intro ? scripts[0]!.id : undefined
  result.chapters.forEach(append)
  const title = fileName.replace(/\.txt$/i, '').trim() || '未命名小说'
  return {
    novel: { id: novelId, title, sourceFileName: fileName, encoding: result.encoding,
      chapterIds: scripts.map(script => script.id), introScriptId, selectedChapterIds: [], roleTimbreIds: {} },
    scripts,
  }
}
