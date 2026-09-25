import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { createRenderer, defineComponent, h } from 'vue'
import { createI18n, i18nKey } from '../src/i18n/index.ts'
import { useUnitaleWorkspace } from '../src/composables/useUnitaleWorkspace.js'
import { indexedDbAssetStore, setActiveProjectId } from '../src/services/storage/workspaceDb.ts'

const blobs = new Map()
let urlNumber = 0
URL.createObjectURL = blob => {
  const url = `blob:audio-workspace-${++urlNumber}`
  blobs.set(url, blob)
  return url
}
URL.revokeObjectURL = () => {}
globalThis.fetch = async url => blobs.has(url) ? new Response(blobs.get(url)) : new Response('', { status: 404 })
const localValues = new Map()
globalThis.localStorage = { getItem: key => localValues.get(key) ?? null, setItem: (key, value) => localValues.set(key, String(value)) }
const downloads = []
globalThis.document = {
  documentElement: { lang: 'zh-CN' }, title: '',
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ click() { downloads.push(this.href) }, remove() {} }),
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { estimate: async () => ({}) } } })
globalThis.alert = () => {}
globalThis.confirm = () => true

let decoding = 0
let maxDecoding = 0
let filterCount = 0
const starts = []
const decodedKinds = []
const makeBuffer = (kind, duration, sampleRate = 44100) => ({
  kind, duration, sampleRate, length: duration * sampleRate, numberOfChannels: 1,
  getChannelData: () => new Float32Array(duration * sampleRate),
})
class AudioContextMock {
  state = 'running'
  currentTime = 0
  destination = {}
  async decodeAudioData(bytes) {
    decoding++
    maxDecoding = Math.max(maxDecoding, decoding)
    await new Promise(resolve => setTimeout(resolve, 2))
    decoding--
    const kind = new TextDecoder().decode(bytes)
    decodedKinds.push(kind)
    return makeBuffer(kind, kind === 'effect' ? 125 : kind === 'bgm' ? 3 : 1)
  }
  createBufferSource() { return { connect(node) { return node }, start() {}, stop() {} } }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, value: 1 }, connect(node) { return node } } }
}
globalThis.window = { AudioContext: AudioContextMock, innerWidth: 800, innerHeight: 600,
  showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }) }) }
globalThis.OfflineAudioContext = class {
  constructor(_channels, length, sampleRate) { this.length = length; this.sampleRate = sampleRate; this.destination = {} }
  createBufferSource() { return { connect(node) { return node }, start(...args) { starts.push({ kind: this.buffer.kind, args }) }, stop() {}, set buffer(value) { this._buffer = value }, get buffer() { return this._buffer } } }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(node) { return node } } }
  createBiquadFilter() { filterCount++; return { frequency: {}, Q: {}, connect(node) { return node } } }
  async startRendering() { return makeBuffer('rendered', this.length / this.sampleRate, this.sampleRate) }
}
const renderer = createRenderer({ createElement: name => ({ name, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText() {}, setElementText() {}, patchProp() {}, insert(child, parent) { parent.children.push(child) }, remove() {}, parentNode: () => null, nextSibling: () => null })

test('ID references survive rename in WAV export; SRT decodes serially and hidden waveform stays idle', async () => {
  const projectId = `audio-workspace-${Date.now()}`
  await setActiveProjectId(projectId)
  const dialogue = await indexedDbAssetStore.put(new Blob(['dialogue'], { type: 'audio/wav' }), { projectId, kind: 'dialogue' })
  const effect = await indexedDbAssetStore.put(new Blob(['effect'], { type: 'audio/wav' }), { projectId, kind: 'sfx' })
  const bgm = await indexedDbAssetStore.put(new Blob(['bgm'], { type: 'audio/wav' }), { projectId, kind: 'bgm' })
  let workspace
  const app = renderer.createApp(defineComponent({ setup() { workspace = useUnitaleWorkspace(); return () => h('main') } }))
  app.provide(i18nKey, createI18n('zh-CN'))
  app.mount({ children: [] })
  try {
    await new Promise(resolve => setTimeout(resolve, 550))
    workspace.sfxLibrary.value = [{ id: 'sfx-1', name: 'Renamed effect', assetId: effect.id, volume: 1 }]
    workspace.bgmLibrary.value = [{ id: 'bgm-1', name: 'Renamed music', assetId: bgm.id, volume: 1 }]
    workspace.filterLibrary.value = [{ id: 'filter-1', name: 'Renamed filter', type: 'lowpass', frequency: 1000, Q: 1 }]
    workspace.scriptLines.value = [
      { id: 'music', type: 'bgm', action: 'play', bgmId: 'bgm-1', volume: 1 },
      ...[0, 1, 2].map(index => ({ id: `line-${index}`, type: 'dialogue', role: 'Narrator', text: 'Hello', audioAssetId: dialogue.id,
        trimStart: 0, trimEnd: 1, speed: 1, break_duration: 0, filterId: 'filter-1',
        sfx: index === 0 ? [{ sfxId: 'sfx-1', position: 1 }] : [] })),
    ]
    const hiddenCanvas = { isConnected: true, getClientRects: () => [], getContext: () => ({ clearRect() {}, fillRect() {} }), width: 192, height: 32 }
    workspace.drawWaveform(hiddenCanvas, workspace.scriptLines.value[1])
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(maxDecoding, 0)

    await workspace.exportSRT()
    assert.equal(maxDecoding, 1)
    assert.ok(downloads.length)
    const srt = await blobs.get(downloads.at(-1)).text()
    assert.match(srt, /Hello/)
    maxDecoding = 0
    await workspace.exportAudio()
    const effectStarts = starts.filter(entry => entry.kind === 'effect')
    assert.equal(effectStarts.length, 2, 'the same SFX must be clipped into both 120 second WAV render parts')
    assert.ok(effectStarts[0].args[2] > 100)
    assert.ok(effectStarts[1].args[1] > 110 && effectStarts[1].args[2] > 0)
    assert.ok(starts.some(entry => entry.kind === 'bgm'))
    assert.ok(filterCount > 0)
  } finally { app.unmount() }
})

test('waveform decodes only intersecting canvases, rechecks queued work, and unregisters removed nodes', async () => {
  const projectId = `waveform-${Date.now()}`
  await setActiveProjectId(projectId)
  const assets = await Promise.all(['wave-a', 'wave-b', 'wave-c'].map(async kind =>
    indexedDbAssetStore.put(new Blob([kind], { type: 'audio/wav' }), { projectId, kind: 'dialogue' })))
  const observed = new Set()
  let observer
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this }
    observe(target) { observed.add(target) }
    unobserve(target) { observed.delete(target) }
    disconnect() { observed.clear() }
    emit(target, isIntersecting) { this.callback([{ target, isIntersecting }]) }
  }
  let workspace
  const app = renderer.createApp(defineComponent({ setup() { workspace = useUnitaleWorkspace(); return () => h('main') } }))
  app.provide(i18nKey, createI18n('zh-CN'))
  app.mount({ children: [] })
  try {
    await new Promise(resolve => setTimeout(resolve, 550))
    const lines = assets.map((asset, index) => ({ id: `wave-${index}`, type: 'dialogue', audioAssetId: asset.id }))
    workspace.scriptLines.value = lines
    const canvases = lines.map(() => ({ isConnected: true, getClientRects: () => [{ width: 192, height: 32 }],
      getBoundingClientRect: () => ({ top: 20, left: 20, right: 212, bottom: 52, width: 192, height: 32 }),
      getContext: () => ({ clearRect() {}, fillRect() {} }), width: 192, height: 32 }))
    const before = decodedKinds.length
    canvases.forEach((canvas, index) => workspace.drawWaveform(canvas, workspace.scriptLines.value[index]))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(decodedKinds.length, before, 'layout alone must not begin decoding before an intersection')
    observer.emit(canvases[0], false)
    assert.equal(decodedKinds.length, before)
    canvases.forEach(canvas => observer.emit(canvas, true))
    observer.emit(canvases[2], false)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(decodedKinds.slice(before).sort(), ['wave-a', 'wave-b'])
    assert.ok(maxDecoding <= 2)
    observer.emit(canvases[2], true)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(decodedKinds.includes('wave-c'))
    workspace.drawWaveform(null, workspace.scriptLines.value[2])
    assert.equal(observed.has(canvases[2]), false)
  } finally {
    app.unmount()
    delete globalThis.IntersectionObserver
  }
})

test('without IntersectionObserver, a laid-out offscreen waveform waits until it enters the viewport', async () => {
  const projectId = `waveform-fallback-${Date.now()}`
  await setActiveProjectId(projectId)
  const asset = await indexedDbAssetStore.put(new Blob(['fallback-wave'], { type: 'audio/wav' }), { projectId, kind: 'dialogue' })
  let workspace
  const app = renderer.createApp(defineComponent({ setup() { workspace = useUnitaleWorkspace(); return () => h('main') } }))
  app.provide(i18nKey, createI18n('zh-CN'))
  app.mount({ children: [] })
  try {
    await new Promise(resolve => setTimeout(resolve, 550))
    const line = { id: 'fallback', type: 'dialogue', audioAssetId: asset.id }
    workspace.scriptLines.value = [line]
    let top = 1000
    const canvas = { isConnected: true, getClientRects: () => [{ width: 192, height: 32 }],
      getBoundingClientRect: () => ({ top, bottom: top + 32, left: 10, right: 202, width: 192, height: 32 }),
      getContext: () => ({ clearRect() {}, fillRect() {} }), width: 192, height: 32 }
    const before = decodedKinds.length
    workspace.drawWaveform(canvas, workspace.scriptLines.value[0])
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(decodedKinds.length, before)
    top = 20
    workspace.drawWaveform(canvas, workspace.scriptLines.value[0])
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(decodedKinds.slice(before), ['fallback-wave'])
  } finally { app.unmount() }
})
