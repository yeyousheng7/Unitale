import assert from 'node:assert/strict'
import test from 'node:test'
import { buildNovelImport, isEmptyNovel } from '../src/services/novel/novelImport.ts'

test('novel import stores every chapter while selection only controls processing', () => {
  const parsed = { encoding: 'gb18030', intro: { title: '简介', content: '前言。\n' }, chapters: [
    { title: '第一章 雨夜', content: '正文一。\n\n' },
    { title: '第二章 重逢', content: '正文二。' },
  ] }
  const { novel, scripts } = buildNovelImport('长夜微光.txt', parsed, new Set([1]))
  assert.equal(novel.title, '长夜微光')
  assert.equal(novel.encoding, 'gb18030')
  assert.deepEqual(novel.chapterIds, scripts.map(script => script.id))
  assert.deepEqual(novel.selectedChapterIds, [scripts[2].id])
  assert.equal(scripts[0].name, '简介')
  assert.equal(scripts[1].data.rawScript, '正文一。\n\n')
  assert.ok(scripts.every(script => script.kind === 'novelChapter' && script.novelId === novel.id))
  assert.equal(new Set(scripts.map(script => script.id)).size, 3)
})

test('empty fallback is rejected but a heading-only chapter remains importable', () => {
  const empty = { encoding: 'utf-8', intro: null, chapters: [{ title: '正文', content: ' \n' }] }
  assert.equal(isEmptyNovel(empty), true)
  assert.throws(() => buildNovelImport('empty.txt', empty, new Set([0])), /no content/)
  const headingOnly = { ...empty, chapters: [{ title: '第一章', content: '' }] }
  assert.equal(isEmptyNovel(headingOnly), false)
  assert.equal(buildNovelImport('title.txt', headingOnly, new Set([0])).scripts[0].name, '第一章')
})
