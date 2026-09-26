import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNovelImport, isEmptyNovel } from '../src/services/novel/novelImport.ts'
import { parseTxtNovel } from '../src/services/text/txtNovelParser.ts'
import 'fake-indexeddb/auto'
import { loadWorkspaceProject, saveWorkspaceProject } from '../src/services/storage/workspaceDb.ts'

test('novel import stores every chapter without choosing processing scope', () => {
  const parsed = { encoding: 'gb18030', intro: { title: '简介', content: '前言。\n' }, chapters: [
    { title: '第一章 雨夜', content: '正文一。\n\n' },
    { title: '第二章 重逢', content: '正文二。' },
  ] }
  const { novel, scripts } = buildNovelImport('长夜微光.txt', parsed)
  assert.equal(novel.title, '长夜微光')
  assert.equal(novel.encoding, 'gb18030')
  assert.deepEqual(novel.chapterIds, scripts.map(script => script.id))
  assert.equal(novel.introScriptId, scripts[0].id)
  assert.deepEqual(novel.selectedChapterIds, [])
  assert.equal(scripts[0].name, '简介')
  assert.equal(scripts[1].data.rawScript, '正文一。\n\n')
  assert.ok(scripts.every(script => script.kind === 'novelChapter' && script.novelId === novel.id))
  assert.equal(new Set(scripts.map(script => script.id)).size, 3)
})

test('empty fallback is rejected but a heading-only chapter remains importable', () => {
  const empty = { encoding: 'utf-8', intro: null, chapters: [{ title: '正文', content: ' \n' }] }
  assert.equal(isEmptyNovel(empty), true)
  assert.throws(() => buildNovelImport('empty.txt', empty), /no content/)
  const headingOnly = { ...empty, chapters: [{ title: '第一章', content: '' }] }
  assert.equal(isEmptyNovel(headingOnly), false)
  assert.equal(buildNovelImport('title.txt', headingOnly).scripts[0].name, '第一章')
  assert.equal(buildNovelImport('title.txt', headingOnly).novel.introScriptId, undefined)
})

test('whole-book preview confirmation stores front matter and starts with no processing selection', async () => {
  const parsed = { encoding: 'utf-8', intro: { title: '简介', content: '卷首。\n' },
    chapters: [{ title: '第一章', content: '正文。' }] }
  const { novel, scripts } = buildNovelImport('book.txt', parsed)
  assert.equal(scripts.length, 2)
  assert.equal(novel.introScriptId, scripts[0].id)
  assert.deepEqual(novel.selectedChapterIds, [])
  const projectId = `front-matter-${crypto.randomUUID()}`
  await saveWorkspaceProject({ characters: [], currentScriptId: scripts[0].id, timestamp: Date.now(),
    scriptList: scripts, novels: [novel],
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] } }, undefined, projectId)
  assert.equal((await loadWorkspaceProject(projectId)).novels[0].introScriptId, scripts[0].id)
})

test('one thousand chapters with millions of characters keep order through storage', async t => {
  const body = `　　雨落在窗前，林夏翻开旧信。\n\n${'这是这一章的正文，保留原有段落。'.repeat(100)}\n`
  const source = Array.from({ length: 1000 }, (_, index) => `第${index + 1}章 远方来信\n${body}`).join('')
  const start = performance.now()
  const parsed = await parseTxtNovel(new Blob([source]))
  const draft = buildNovelImport('长篇小说.txt', parsed)
  const projectId = `long-novel-${crypto.randomUUID()}`
  await saveWorkspaceProject({ characters: [], currentScriptId: draft.scripts[0].id, timestamp: Date.now(),
    scriptList: draft.scripts, novels: [draft.novel],
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] } }, undefined, projectId)
  const restored = await loadWorkspaceProject(projectId)
  assert.equal(source.length > 1_000_000, true)
  assert.equal(parsed.chapters.length, 1000)
  assert.equal(restored.scriptList.length, 1000)
  assert.equal(restored.scriptList[999].data.rawScript, parsed.chapters[999].content)
  assert.deepEqual(restored.novels[0].selectedChapterIds, [])
  t.diagnostic(`parsed and saved ${source.length} characters across 1000 chapters in ${Math.round(performance.now() - start)} ms`)
})
