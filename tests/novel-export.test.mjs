import assert from 'node:assert/strict'
import test from 'node:test'
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { DecodedAudioCache } from '../src/services/audio/decodedCache.ts'
import { exportNovelChaptersZip, incompleteNovelChapters, novelSrt } from '../src/services/novel/novelExport.ts'

const buffer = (frames = 44100) => ({
  length: frames, sampleRate: 44100, numberOfChannels: 2, duration: frames / 44100,
  getChannelData: () => new Float32Array(frames),
})
class FakeNode {
  gain = { value: 1 }
  connect() { return this }
  start() {}
  stop() {}
}
class FakeOfflineAudioContext {
  constructor(channels, frames, sampleRate) { this.frames = frames; this.sampleRate = sampleRate; this.destination = new FakeNode() }
  createBufferSource() { return new FakeNode() }
  createGain() { return new FakeNode() }
  async startRendering() { return buffer(this.frames) }
}

test('export preflight and SRT use only scalar timing', () => {
  const ready = { name: '第一章', data: { scriptLines: [{ type: 'dialogue', text: '你好', audioAssetId: 'a' }] } }
  const pending = { name: '第二章', data: { scriptLines: [{ type: 'dialogue', text: '再见' }] } }
  assert.deepEqual(incompleteNovelChapters([ready, pending]), ['第二章'])
  assert.equal(novelSrt([{ line: { text: '你好' }, start: 0.05, end: 1.05 }]), '1\n00:00:00,050 --> 00:00:01,050\n你好\n')
})

test('chapter export creates a WAV and SRT inside a named ZIP folder', async () => {
  const previous = globalThis.OfflineAudioContext
  globalThis.OfflineAudioContext = FakeOfflineAudioContext
  try {
    const script = { id: 'chapter', name: '第一章', data: {
      characters: [{ name: '甲', volume: 1 }], scriptLines: [
        { id: 'line', type: 'dialogue', role: '甲', text: '第一句', audioAssetId: 'audio', trimStart: 0, trimEnd: 1, speed: 1 },
      ],
    } }
    const zip = await exportNovelChaptersZip({ scripts: [script], libraries: { sfx: [], bgm: [], filters: [] },
      store: { get: async id => id === 'audio' ? new Blob(['audio']) : null },
      cache: new DecodedAudioCache(), decode: async () => buffer() })
    const reader = new ZipReader(new BlobReader(zip))
    const entries = await reader.getEntries()
    assert.deepEqual(entries.map(entry => entry.filename), [
      '0001_第一章/subtitles.srt', '0001_第一章/audio_001-of-001.wav',
    ])
    const srt = await entries[0].getData(new BlobWriter())
    assert.match(await srt.text(), /00:00:00,050 --> 00:00:01,050/)
    const wav = await entries[1].getData(new BlobWriter())
    assert.equal((await wav.slice(0, 4).text()), 'RIFF')
    await reader.close()
  } finally { globalThis.OfflineAudioContext = previous }
})
