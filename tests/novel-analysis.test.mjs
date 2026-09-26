import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeNovelChapter, applyNovelRoleBindings } from '../src/services/novel/novelAnalysis.ts'

const timbres = [
  { id: 'voice-a', name: '声音甲', refPath: '/server/a.wav', assetId: 'asset-a' },
  { id: 'voice-b', name: '声音乙', refPath: '/server/b.wav', assetId: 'asset-b' },
]

test('novel role mapping stays within a book and preserves chapter overrides', () => {
  const first = applyNovelRoleBindings([' 小明 ', '小明'], [], { 小明: 'voice-a' }, timbres)
  assert.equal(first.length, 1)
  assert.equal(first[0].voiceFile, '/server/a.wav')
  assert.equal(first[0].voiceAssetId, 'asset-a')
  const overridden = applyNovelRoleBindings(['小明'], [{ id: 'local', name: '小明', voiceFile: '/server/b.wav', voiceAssetId: 'asset-b', volume: 0.7 }], { 小明: 'voice-a' }, timbres)
  assert.equal(overridden[0].voiceFile, '/server/b.wav')
  assert.equal(overridden[0].volume, 0.7)
  const otherBook = applyNovelRoleBindings(['小明'], [], {}, timbres)
  assert.equal(otherBook[0].voiceFile, '')
})

test('chapter analysis maps resource names to IDs and applies the book voice', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, ...options }
    return Response.json({ choices: [{ message: { content: JSON.stringify([
      { type: 'dialogue', role_name: '小明', text_content: '你好', sfx: [{ name: '敲门', position: 0.5 }], filter: '电话' },
      { type: 'bgm', action: 'play', name: '夜色' },
    ]) } }] })
  }
  try {
    const script = { id: 'chapter', name: '第一章', data: { rawScript: '他敲了敲门。', characters: [], scriptLines: [] } }
    const result = await analyzeNovelChapter(script, {
      config: { baseUrl: 'https://llm.example/v1', model: 'model', key: 'key' },
      promptTemplate: '${rawScript}', customPrompt: false, bgImageCount: 0,
      emotions: [], sfx: [{ id: 'sfx-id', name: '敲门' }], bgm: [{ id: 'bgm-id', name: '夜色' }],
      filters: [{ id: 'filter-id', name: '电话' }], timbres, roleTimbreIds: { 小明: 'voice-a' },
      signal: new AbortController().signal,
    })
    assert.equal(request.url, 'https://llm.example/v1/chat/completions')
    assert.match(JSON.parse(request.body).messages[0].content, /第一章/)
    assert.equal(result.scriptLines[0].sfx[0].sfxId, 'sfx-id')
    assert.equal(result.scriptLines[0].filterId, 'filter-id')
    assert.equal(result.scriptLines[1].bgmId, 'bgm-id')
    assert.equal(result.characters[0].voiceFile, '/server/a.wav')
  } finally { globalThis.fetch = originalFetch }
})
