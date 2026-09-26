import assert from 'node:assert/strict'
import test from 'node:test'
import { updateChapterSelection } from '../src/services/novel/chapterSelection.ts'

test('page selection changes visible chapters and retains hidden-page choices', () => {
  const chapters = ['chapter-1', 'chapter-2', 'chapter-3', 'chapter-4']
  const selected = new Set(['chapter-1', 'chapter-4'])
  const shownBySearch = ['chapter-2', 'chapter-3']
  const added = updateChapterSelection(chapters, selected, 'page', shownBySearch)
  assert.deepEqual(added, chapters)
  assert.deepEqual(updateChapterSelection(chapters, new Set(added), 'page', shownBySearch), ['chapter-1', 'chapter-4'])
})

test('full-book actions ignore pagination and preserve source order', () => {
  const chapters = [0, 1, 2, 3, 4]
  const selected = new Set([0, 4])
  assert.deepEqual(updateChapterSelection(chapters, selected, 'all', [1, 2]), chapters)
  assert.deepEqual(updateChapterSelection(chapters, selected, 'invert', [1, 2]), [1, 2, 3])
  assert.deepEqual(updateChapterSelection(chapters, selected, 'clear', [1, 2]), [])
})
