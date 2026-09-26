import assert from 'node:assert/strict'
import test from 'node:test'
import { missingNovelVoices, synthesizeNovelLine } from '../src/services/novel/novelTts.ts'

test('batch voice preflight lists only unbound dialogue roles', () => {
  const lines = [{ type: 'dialogue', role: '甲', text: '你好' }, { type: 'dialogue', role: '乙', text: '回答' },
    { type: 'dialogue', role: '乙', text: '继续' }, { type: 'bgm', role: '丙' }]
  assert.deepEqual(missingNovelVoices(lines, [{ name: '甲', voiceFile: '/server/voice.wav' }]), ['乙'])
})

test('batch TTS sends a server voice path and uses the stable asset only for upload', async () => {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.includes('/check/audio')) return Response.json({ exists: false })
    if (url.includes('/upload_audio')) return Response.json({ ok: true })
    return new Response(new Blob(['sound'], { type: 'audio/wav' }), { status: 200 })
  }
  try {
    const characters = [{ id: 'speaker', name: '甲', voiceFile: '/server/voice.wav', voiceAssetId: '' }]
    const blob = await synthesizeNovelLine({
      line: { id: 'line', type: 'dialogue', role: '甲', text: '你好', emotion: '高兴', intensity: '较强' },
      characters, emotions: [{ name: '高兴', vector: [1, 0] }],
      timbres: [{ refPath: '/server/voice.wav', assetId: 'stable-asset' }],
      config: { baseUrl: 'https://tts.example/v1' }, store: { get: async id => id === 'stable-asset' ? new Blob(['ref']) : null },
      signal: new AbortController().signal,
    })
    assert.equal(characters[0].voiceAssetId, 'stable-asset')
    assert.equal(await blob.text(), 'sound')
    assert.equal(calls.length, 3)
    const payload = JSON.parse(calls[2].options.body)
    assert.equal(payload.audio_path, '/server/voice.wav')
    assert.deepEqual(payload.emo_vector, [0.75, 0])
  } finally { globalThis.fetch = previous }
})
