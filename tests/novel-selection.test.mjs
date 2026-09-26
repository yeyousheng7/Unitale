import assert from 'node:assert/strict'
import test from 'node:test'
import { selectChapterRange, updateChapterSelection } from '../src/services/novel/chapterSelection.ts'
import { chapterProgress, selectedChapterProgress } from '../src/services/novel/chapterProgress.ts'

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

test('selected chapter stage follows usable scripts and completed audio', () => {
  const chapter = (rawScript, scriptLines, analysisError = '') => ({ data: { rawScript, scriptLines, analysisError } })
  const pending = chapter('正文', [])
  const ready = chapter('正文', [{ type: 'dialogue', text: '你好' }])
  const voiced = chapter('正文', [{ type: 'dialogue', text: '你好', audioAssetId: 'asset-1' }])
  assert.equal(selectedChapterProgress([]).stage, 'select')
  assert.deepEqual(selectedChapterProgress([pending, ready]), {
    stage: 'analysis', selected: 2, unanalyzed: 1, emptyBody: 0, noDialogue: 0,
    missingAudio: 1, retainedAnalysisFailures: 0,
  })
  assert.equal(selectedChapterProgress([ready]).stage, 'tts')
  assert.equal(selectedChapterProgress([voiced]).stage, 'export')
  assert.equal(selectedChapterProgress([chapter('正文', [], 'HTTP 500')]).unanalyzed, 1)
})

test('empty bodies and chapters without dialogue require review instead of a dead-end task', () => {
  const chapter = (rawScript, scriptLines, analysisError = '') => ({ data: { rawScript, scriptLines, analysisError } })
  const blank = chapter('', [])
  const noDialogue = chapter('正文', [{ type: 'bgm' }])
  const retained = chapter('正文', [{ type: 'dialogue', text: '你好', audioAssetId: 'asset-1' }], 'retry failed')
  assert.deepEqual(selectedChapterProgress([blank, noDialogue, retained]), {
    stage: 'review', selected: 3, unanalyzed: 0, emptyBody: 1, noDialogue: 1,
    missingAudio: 0, retainedAnalysisFailures: 1,
  })
  assert.equal(selectedChapterProgress([noDialogue]).stage, 'review')
  assert.equal(selectedChapterProgress([retained]).stage, 'export')
})
