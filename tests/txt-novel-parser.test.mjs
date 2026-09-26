import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTxtNovel } from '../src/services/text/txtNovelParser.ts'

const utf8 = text => new TextEncoder().encode(text)

test('recognizes common Chinese, English, and special chapter headings', async () => {
  const text = [
    '书名：长街', '作者：某人', '',
    '序章 开场', '序章正文。',
    '楔子', '楔子正文。',
    '第一章 雨夜', '第一章正文。',
    '第十二章：旧信', '第十二章正文。',
    '第1章 重逢', '第1章正文。',
    '第 12 章 归来', '第 12 章正文。',
    '第一回 初见', '第一回正文。',
    '第1回 再见', '第1回正文。',
    'Chapter 1 Beginning', 'They left at dawn.',
    'Chapter 12: Return', 'They came home.',
    '番外 旧友', '番外正文。',
    '后记', '后记正文。',
  ].join('\n')
  const result = await parseTxtNovel(utf8(text))

  assert.equal(result.encoding, 'utf-8')
  assert.deepEqual(result.chapters.map(chapter => chapter.title), [
    '序章 开场', '楔子', '第一章 雨夜', '第十二章：旧信', '第1章 重逢',
    '第 12 章 归来', '第一回 初见', '第1回 再见', 'Chapter 1 Beginning',
    'Chapter 12: Return', '番外 旧友', '后记',
  ])
  assert.deepEqual(result.intro, { title: '简介', content: '书名：长街\n作者：某人\n\n' })
  assert.equal(result.chapters[2].content, '第一章正文。\n')
  assert.equal(result.chapters.at(-1).content, '后记正文。')
})

test('left parentheses delimit titles when mixed with ordinary chapter headings', async () => {
  const text = '第一章 开始\n开场。\n第二章（上）\n正文一。\n第三章(下)\n正文二。\n第4回（终）\n正文三。\nChapter 5 (Afterword)\nThe end.'
  const result = await parseTxtNovel(utf8(text))
  assert.deepEqual(result.chapters, [
    { title: '第一章 开始', content: '开场。\n' },
    { title: '第二章（上）', content: '正文一。\n' },
    { title: '第三章(下)', content: '正文二。\n' },
    { title: '第4回（终）', content: '正文三。\n' },
    { title: 'Chapter 5 (Afterword)', content: 'The end.' },
  ])
})

test('cuts by source offsets and preserves CRLF, blank lines, indentation, and punctuation', async () => {
  const intro = '书名：长街\r\n作者：某人\r\n\r\n'
  const first = '　　风吹过旧城。\r\n\r\n  “你来了？”她问。 \r\n\r\n'
  const second = '\r\n	信纸泛黄。\r\n'
  const text = `${intro}　第一章：雨夜　\r\n${first}第 12 章 旧信\r\n${second}`
  const result = await parseTxtNovel(new Blob([text], { type: 'text/plain' }))

  assert.equal(result.intro.content, intro)
  assert.deepEqual(result.chapters, [
    { title: '第一章：雨夜', content: first },
    { title: '第 12 章 旧信', content: second },
  ])
})

test('automatically decodes GBK and GB18030, with a manual encoding override', async () => {
  // Precomputed with iconv. The second sample includes a GB18030 four-byte character.
  const gbk = Buffer.from('b5dad2bbd5c220d3ead2b90ad3eac2e4d4dabec9b3c7a1a30ab5dab6fed5c220d6d8b7ea0acbfdd6d5d3dad5d2b5bdc4c7b7e2d0c5a1a30a', 'hex')
  const gb18030 = Buffer.from('b5dad2bbd5c220d3ead2b90a95328236b3f6cfd6c1cba1a30ab5dab6fed5c220d6d8b7ea0acbfdd6d5d3dad5d2b5bdc4c7b7e2d0c5a1a30a', 'hex')

  const auto = await parseTxtNovel(gbk)
  assert.equal(auto.encoding, 'gb18030')
  assert.deepEqual(auto.chapters.map(chapter => chapter.title), ['第一章 雨夜', '第二章 重逢'])
  assert.equal(auto.chapters[0].content, '雨落在旧城。\n')

  const manual = await parseTxtNovel(gbk, { encoding: 'gbk' })
  assert.equal(manual.encoding, 'gbk')
  assert.deepEqual(manual.chapters, auto.chapters)

  const extended = await parseTxtNovel(gb18030)
  assert.equal(extended.encoding, 'gb18030')
  assert.equal(extended.chapters[0].content, '𠀀出现了。\n')
  await assert.rejects(parseTxtNovel(gbk, { encoding: 'utf-8' }))
})

test('UTF-8 BOM is removed during decoding', async () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8('第一章 雨夜\n正文。')])
  const result = await parseTxtNovel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  assert.equal(result.encoding, 'utf-8')
  assert.deepEqual(result.chapters, [{ title: '第一章 雨夜', content: '正文。' }])
})

test('empty, whitespace-only, and BOM-only input keep the fallback chapter contract', async () => {
  for (const [input, content] of [
    [new Uint8Array(), ''],
    [utf8(' \t\r\n　\n'), ' \t\r\n　\n'],
    [Uint8Array.of(0xef, 0xbb, 0xbf), ''],
  ]) {
    assert.deepEqual(await parseTxtNovel(input), {
      chapters: [{ title: '正文', content }], intro: null, encoding: 'utf-8',
    })
  }
})

test('markerless text becomes one chapter without losing source text', async () => {
  const text = '　　大雨下了一整夜。\n\n\n第二天清晨，她推开门。\n'
  const result = await parseTxtNovel(utf8(text), { fallbackTitle: '长街' })
  assert.deepEqual(result, { chapters: [{ title: '长街', content: text }], intro: null, encoding: 'utf-8' })
})

test('a whitespace-only prefix is not emitted as intro', async () => {
  const result = await parseTxtNovel(utf8('\n　\n第一章 开始\n正文。'))
  assert.equal(result.intro, null)
  assert.deepEqual(result.chapters, [{ title: '第一章 开始', content: '正文。' }])
})

test('consecutive headings and a final heading without a newline remain visible', async () => {
  const result = await parseTxtNovel(utf8('第一章 开始\n第二章 继续\n第三章 结束'))
  assert.deepEqual(result.chapters, [
    { title: '第一章 开始', content: '' },
    { title: '第二章 继续', content: '' },
    { title: '第三章 结束', content: '' },
  ])
})

test('standalone CR and mixed newlines preserve exact content boundaries', async () => {
  const result = await parseTxtNovel(utf8('第一章 开始\r第一行。\n第二行。\r\n第二章 继续\r最后一行。'))
  assert.deepEqual(result.chapters, [
    { title: '第一章 开始', content: '第一行。\n第二行。\r\n' },
    { title: '第二章 继续', content: '最后一行。' },
  ])
})

test('decodes only the selected bytes of a Uint8Array subarray', async () => {
  const chapter = utf8('第一章 开始\n正文。')
  const padded = new Uint8Array(chapter.length + 4)
  padded.set([0xff, 0xff], 0)
  padded.set(chapter, 2)
  padded.set([0xff, 0xff], chapter.length + 2)
  assert.deepEqual(await parseTxtNovel(padded.subarray(2, chapter.length + 2)), {
    chapters: [{ title: '第一章 开始', content: '正文。' }], intro: null, encoding: 'utf-8',
  })
})

test('reports failure when auto decoders both reject input or manual label is invalid', async () => {
  await assert.rejects(parseTxtNovel(Uint8Array.of(0xff)))
  await assert.rejects(parseTxtNovel(utf8('正文。'), { encoding: 'not-an-encoding' }), RangeError)
})

test('chapter-like prose without a heading boundary remains body text', async () => {
  const text = '第一章 开端\n第一章的标题写在纸上。\n第十二章里没有答案。\nChapter 1st was crossed out.\n第二章 继续\n正文。'
  const result = await parseTxtNovel(utf8(text))
  assert.equal(result.chapters.length, 2)
  assert.equal(result.chapters[0].content, '第一章的标题写在纸上。\n第十二章里没有答案。\nChapter 1st was crossed out.\n')
})

test('handles a thousand regular chapters without losing the first or last body', async () => {
  const text = Array.from({ length: 1000 }, (_, index) => `第${index + 1}章 标题\n　　这是第${index + 1}章的正文。\n`).join('')
  const result = await parseTxtNovel(utf8(text))
  assert.equal(result.chapters.length, 1000)
  assert.equal(result.chapters[0].content, '　　这是第1章的正文。\n')
  assert.equal(result.chapters.at(-1).content, '　　这是第1000章的正文。\n')
})
