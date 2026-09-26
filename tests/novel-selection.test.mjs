import assert from 'node:assert/strict'
import test from 'node:test'
import { selectChapterRange, updateChapterSelection } from '../src/services/novel/chapterSelection.ts'
import { chapterProgress } from '../src/services/novel/chapterProgress.ts'

test('page selection changes visible chapters and retains hidden-page choices', () => {
  const chapters = ['chapter-1', 'chapter-2', 'chapter-3', 'chapter-4']
  const selected = new Set(['chapter-1', 'chapter-4'])
  const shownBySearch = ['chapter-2', 'chapter-3']
  const added = updateChapterSelection(chapters, selected, 'page', shownBySearch)
  assert.deepEqual(added, chapters)
  assert.deepEqual(updateChapterSelection(chapters, new Set(added), 'page', shownBySearch), ['chapter-1', 'chapter-4'])
})

test('select all current results ignores pagination but respects filters', () => {
  const chapters = [0, 1, 2, 3, 4]
  const selected = new Set([0, 4])
  assert.deepEqual(updateChapterSelection(chapters, selected, 'result', [1, 2]), [1, 2])
  assert.deepEqual(updateChapterSelection(chapters, selected, 'result', chapters), chapters)
  assert.deepEqual(updateChapterSelection(chapters, selected, 'clear', [1, 2]), [])
})

test('one-based range replaces selection and excludes front matter supplied separately', () => {
  assert.deepEqual(selectChapterRange(['chapter-1', 'chapter-2', 'chapter-3'], 2, 3), ['chapter-2', 'chapter-3'])
  assert.throws(() => selectChapterRange(['chapter-1'], 0, 1), RangeError)
  assert.throws(() => selectChapterRange(['chapter-1'], 1, 2), RangeError)
})

test('chapter progress distinguishes partial audio from finished and ignores empty dialogue', () => {
  const chapter = lines => ({ data: { scriptLines: lines } })
  assert.deepEqual(chapterProgress(chapter([])), { analysis: 'pending', audio: 'none', total: 0, generated: 0, failed: 0 })
  assert.deepEqual(chapterProgress(chapter([
    { type: 'dialogue', text: '甲', audioAssetId: 'asset-1' },
    { type: 'dialogue', text: '乙', ttsError: 'failed' },
    { type: 'dialogue', text: ' ' },
  ])), { analysis: 'analyzed', audio: 'partial', total: 2, generated: 1, failed: 1 })
  assert.equal(chapterProgress(chapter([{ type: 'dialogue', text: '甲', audioAssetId: 'asset-1' }])).audio, 'complete')
  assert.equal(chapterProgress({ data: { scriptLines: [], analysisError: 'HTTP 500' } }).analysis, 'failed')
})
