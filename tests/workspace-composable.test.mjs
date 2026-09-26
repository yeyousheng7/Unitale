import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import { createRenderer, defineComponent, h, nextTick } from 'vue'
import { createI18n, i18nKey } from '../src/i18n/index.ts'
import { useUnitaleWorkspace } from '../src/composables/useUnitaleWorkspace.js'
import { exportArchiveParts } from '../src/services/project/archive.ts'
import { indexedDbAssetStore, loadWorkspaceProject, saveWorkspaceProject, setActiveProjectId, getActiveProjectId, openWorkspaceDB } from '../src/services/storage/workspaceDb.ts'

const values = new Map()
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
}
globalThis.document = { documentElement: { lang: 'zh-CN' }, title: '' }
globalThis.window = { AudioContext: class { destination = {}; decodeAudioData = async () => ({ length: 1, sampleRate: 1, duration: 1 }) } }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { estimate: async () => ({ usage: 0, quota: 1e9 }) } } })
globalThis.alert = () => {}
globalThis.confirm = () => true
const revoked = []
let nextUrl = 0
URL.createObjectURL = () => `blob:workspace-test-${++nextUrl}`
URL.revokeObjectURL = url => revoked.push(url)
const renderer = createRenderer({
  createElement: name => ({ name, children: [] }), createText: text => ({ text }), createComment: text => ({ text }),
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text },
  patchProp: () => {}, insert: (child, parent) => { parent.children.push(child) }, remove: () => {},
  parentNode: () => null, nextSibling: () => null,
})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const within = (promise, label) => Promise.race([
  promise,
  sleep(2500).then(() => { throw new Error(`${label} did not start`) }),
])
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function mountWorkspace() {
  let workspace
  const app = renderer.createApp(defineComponent({
    setup() {
      workspace = useUnitaleWorkspace()
      return () => h('main')
    },
  }))
  app.provide(i18nKey, createI18n('zh-CN'))
  app.mount({ children: [] })
  return { workspace, unmount: () => app.unmount() }
}
function snapshot(id, assetId = '') {
  return { characters: [], currentScriptId: 'default', timestamp: Date.now(),
    libraries: { sfx: [], bgm: [], timbres: [], filters: [], emotions: [] },
    scriptList: [{ id: 'default', name: 'Old', data: { rawScript: '', rawAnalysisResult: '', characters: [],
      scriptLines: assetId ? [{ id: 'old-line', type: 'dialogue', audioAssetId: assetId }] : [] } }], }
}

test('workspace saves inactive rename, protects TTS ownership, releases deleted media, and cleans replaced projects', async () => {
  const oldId = `composable-old-${Date.now()}`
  const oldAsset = await indexedDbAssetStore.put(new Blob(['old audio'], { type: 'audio/wav' }), { projectId: oldId, kind: 'dialogue' })
  await saveWorkspaceProject(snapshot(oldId, oldAsset.id), undefined, oldId)
  await setActiveProjectId(oldId)
  const { workspace: w, unmount } = mountWorkspace()
  try {
    await sleep(550)
    w.addScript()
    const secondId = w.currentScriptId.value
    w.scriptList.value.find(s => s.id === 'default').name = 'Renamed inactive'
    w.startEditingScript('default')
    w.stopEditingScript()
    await sleep(1150)
    assert.equal((await loadWorkspaceProject(oldId)).scriptList.find(s => s.id === 'default').name, 'Renamed inactive')

    w.ttsConfigs.value = [{ id: 'tts', baseUrl: 'https://example.test' }]
    w.currentTtsConfigId.value = 'tts'
    w.characters.value = [{ id: 'speaker', name: 'Speaker', voiceFile: 'remote.wav' }]
    const line = { id: 'generated', type: 'dialogue', role: 'Speaker', text: 'Hello', audioUrl: '' }
    w.scriptLines.value.push(line)
    let answer
    const originalFetch = globalThis.fetch
    globalThis.fetch = () => new Promise(resolve => { answer = resolve })
    try {
      const generating = w.generateLineAudio(line)
      await nextTick()
      assert.equal(typeof answer, 'function')
      w.switchScript('default')
      assert.equal(w.currentScriptId.value, secondId)
      w.addScript()
      assert.equal(w.currentScriptId.value, secondId)
      answer(new Response(new Blob(['new audio'], { type: 'audio/wav' }), { status: 200 }))
      await generating
    } finally { globalThis.fetch = originalFetch }
    assert.ok(line.audioAssetId)
    assert.equal((await loadWorkspaceProject(oldId)).scriptList.find(s => s.id === secondId).data.scriptLines[0].audioAssetId, line.audioAssetId)
    const lineUrl = line.audioUrl
    w.removeScriptLine(0)
    assert.equal(revoked.filter(url => url === lineUrl).length, 1)
    assert.equal(line.audioUrl, '')

    const parts = []
    for await (const part of exportArchiveParts(snapshot('incoming'), [], indexedDbAssetStore)) parts.push(part.blob)
    const originalPut = indexedDbAssetStore.put
    for (const [action, form, kind] of [
      ['handleTimbreFileUpload', 'timbreForm', 'voice'],
      ['handleSfxFileUpload', 'sfxForm', 'sfx'],
      ['handleBgmFileUpload', 'bgmForm', 'bgm'],
    ]) {
      const entered = deferred()
      const release = deferred()
      let writtenProjectId
      indexedDbAssetStore.put = async function (blob, metadata) {
        writtenProjectId = metadata.projectId
        entered.resolve()
        await release.promise
        return originalPut.call(this, blob, metadata)
      }
      let upload
      try {
        upload = w[action]({ target: { files: [new File(['library audio'], `${kind}.wav`, { type: 'audio/wav' })], value: 'selected' } })
        await within(entered.promise, `${kind} upload`)
        w.switchScript('default')
        assert.equal(w.currentScriptId.value, secondId, `${kind} upload must block script switch`)
        await w.handleImportFile({ target: { files: parts, value: 'selected' } })
        assert.equal(await getActiveProjectId(), oldId, `${kind} upload must block project replacement`)
        release.resolve()
        await upload
        assert.equal(writtenProjectId, oldId)
        assert.ok((await indexedDbAssetStore.list(oldId)).some(asset => asset.id === w[form].value.assetId && asset.kind === kind))
      } finally {
        release.resolve()
        await upload?.catch(() => {})
        indexedDbAssetStore.put = originalPut
      }
    }

    // A second inactive rename made while the first save is in flight must remain dirty.
    await sleep(1150)
    const db = await openWorkspaceDB()
    const originalTransaction = db.transaction
    const saveEntered = deferred()
    const releaseSave = deferred()
    let intercepted = false
    db.transaction = function (stores, mode, ...rest) {
      if (!intercepted && mode === 'readwrite' && stores.includes('projects') && stores.includes('scripts')) {
        intercepted = true
        const writes = []
        const fake = {
          oncomplete: null, onabort: null, onerror: null,
          objectStore: name => ({ put: (value, key) => { writes.push([name, structuredClone(value), key]) } }),
        }
        saveEntered.resolve()
        void releaseSave.promise.then(() => {
          const real = originalTransaction.call(db, stores, mode, ...rest)
          real.oncomplete = event => fake.oncomplete?.(event)
          real.onabort = event => fake.onabort?.(event)
          real.onerror = event => fake.onerror?.(event)
          for (const [name, value, key] of writes) real.objectStore(name).put(value, key)
        })
        return fake
      }
      return originalTransaction.call(this, stores, mode, ...rest)
    }
    try {
      const inactive = w.scriptList.value.find(s => s.id === 'default')
      inactive.name = 'First queued rename'
      w.startEditingScript('default')
      w.stopEditingScript()
      await within(saveEntered.promise, 'delayed save')
      inactive.name = 'Second queued rename'
      w.startEditingScript('default')
      w.stopEditingScript()
      releaseSave.resolve()
      await sleep(1150)
      assert.equal((await loadWorkspaceProject(oldId)).scriptList.find(s => s.id === 'default').name, 'Second queued rename')
    } finally {
      releaseSave.resolve()
      db.transaction = originalTransaction
    }

    await w.handleImportFile({ target: { files: [new Blob(['invalid archive'])], value: 'selected' } })
    assert.equal(await getActiveProjectId(), oldId)
    assert.ok(await loadWorkspaceProject(oldId))
    assert.ok(await indexedDbAssetStore.get(oldAsset.id))

    await w.handleImportFile({ target: { files: parts, value: 'selected' } })
    const activeId = await getActiveProjectId()
    assert.notEqual(activeId, oldId)
    assert.ok(await loadWorkspaceProject(activeId))
    assert.equal(await loadWorkspaceProject(oldId), null)
    assert.equal(await indexedDbAssetStore.get(oldAsset.id), null)
  } catch (error) {
    console.error('Workspace integration test failed:', error)
    throw error
  } finally { unmount() }
})

test('novel import commits all chapters and floating edit restores the standalone script', async () => {
  const projectId = `novel-composable-${Date.now()}`
  await saveWorkspaceProject(snapshot(projectId), undefined, projectId)
  await setActiveProjectId(projectId)
  const { workspace: w, unmount } = mountWorkspace()
  try {
    await sleep(550)
    const novelId = await w.commitNovelImport('book.txt', {
      encoding: 'utf-8', intro: null,
      chapters: [{ title: '第一章', content: '内容一。' }, { title: '第二章', content: '内容二。' }],
    }, [0], false)
    const stored = await loadWorkspaceProject(projectId)
    const novel = stored.novels.find(item => item.id === novelId)
    assert.equal(novel.chapterIds.length, 2)
    assert.deepEqual(novel.selectedChapterIds, [novel.chapterIds[0]])
    assert.equal(stored.scriptList.find(item => item.id === novel.chapterIds[1]).data.rawScript, '内容二。')
    assert.equal(stored.currentScriptId, 'default')
    assert.equal(w.openNovelChapter(novel.chapterIds[0]), true)
    w.rawScript.value = '已修改的内容。'
    await sleep(1150)
    assert.equal((await loadWorkspaceProject(projectId)).currentScriptId, 'default')
    assert.equal(w.closeNovelChapter(), true)
    await sleep(1150)
    const afterEdit = await loadWorkspaceProject(projectId)
    assert.equal(afterEdit.currentScriptId, 'default')
    assert.equal(afterEdit.scriptList.find(item => item.id === novel.chapterIds[0]).data.rawScript, '已修改的内容。')
    assert.equal(w.openNovelChapter(novel.chapterIds[1]), true)
    assert.equal(w.navigateToTab('script'), true)
    assert.equal(w.currentScriptId.value, 'default')
    assert.equal(w.novelEditorId.value, null)
    const unselectedId = await w.commitNovelImport('titles.txt', { encoding: 'utf-8', intro: null,
      chapters: [{ title: '第一章', content: '' }] }, [], false)
    assert.deepEqual(w.novels.value.find(item => item.id === unselectedId).selectedChapterIds, [])
  } finally { unmount() }
})

test('novel voice mapping updates inactive chapters and persists without affecting another book', async () => {
  const projectId = `novel-voices-${Date.now()}`
  await saveWorkspaceProject(snapshot(projectId), undefined, projectId)
  await setActiveProjectId(projectId)
  const { workspace: w, unmount } = mountWorkspace()
  try {
    await sleep(550)
    const parsed = { encoding: 'utf-8', intro: null, chapters: [{ title: '第一章', content: '甲' }, { title: '第二章', content: '乙' }] }
    const firstId = await w.commitNovelImport('one.txt', parsed, [0, 1], false)
    const secondId = await w.commitNovelImport('two.txt', parsed, [0, 1], false)
    const first = w.novels.value.find(item => item.id === firstId)
    const second = w.novels.value.find(item => item.id === secondId)
    for (const id of [...first.chapterIds, ...second.chapterIds]) {
      assert.equal(w.openNovelChapter(id), true)
      w.characters.value = [{ id: `${id}-role`, name: '小明',
        voiceFile: id === first.chapterIds[1] ? '/local/override.wav' : '', voiceAssetId: '' }]
      assert.equal(w.closeNovelChapter(), true)
    }
    const originalVoice = await indexedDbAssetStore.put(new Blob(['old voice']), { projectId, kind: 'voice' })
    w.timbres.value.push({ id: 'shared-voice', name: '男声', refPath: '/server/shared.wav', assetId: originalVoice.id })
    assert.equal(w.openNovelChapter(first.chapterIds[0]), true)
    w.setNovelRoleTimbre(firstId, ' 小明 ', 'shared-voice')
    assert.equal(w.closeNovelChapter(), true)
    await sleep(1150)
    const stored = await loadWorkspaceProject(projectId)
    assert.equal(stored.novels.find(item => item.id === firstId).roleTimbreIds['小明'], 'shared-voice')
    assert.equal(stored.scriptList.find(item => item.id === first.chapterIds[0]).data.characters[0].voiceFile, '/server/shared.wav')
    assert.equal(stored.scriptList.find(item => item.id === first.chapterIds[1]).data.characters[0].voiceFile, '/local/override.wav')
    assert.equal(stored.scriptList.find(item => item.id === second.chapterIds[0]).data.characters[0].voiceFile, '')
    const replacement = await indexedDbAssetStore.put(new Blob(['new voice']), { projectId, kind: 'voice' })
    w.editTimbre(w.timbres.value.find(item => item.id === 'shared-voice'))
    w.timbreForm.value.refPath = '/server/replaced.wav'
    w.timbreForm.value.assetId = replacement.id
    await w.saveTimbre()
    await sleep(1150)
    const replaced = await loadWorkspaceProject(projectId)
    assert.equal(replaced.novels.find(item => item.id === firstId).roleTimbreIds['小明'], 'shared-voice')
    assert.equal(replaced.scriptList.find(item => item.id === first.chapterIds[0]).data.characters[0].voiceFile, '/server/replaced.wav')
    assert.equal(replaced.scriptList.find(item => item.id === first.chapterIds[0]).data.characters[0].voiceAssetId, replacement.id)
    assert.equal(replaced.scriptList.find(item => item.id === first.chapterIds[1]).data.characters[0].voiceFile, '/local/override.wav')
    await w.deleteTimbre('shared-voice')
    await sleep(1150)
    const deleted = await loadWorkspaceProject(projectId)
    assert.equal(deleted.novels.find(item => item.id === firstId).roleTimbreIds['小明'], 'shared-voice')
    assert.equal(deleted.scriptList.find(item => item.id === first.chapterIds[0]).data.characters[0].voiceFile, '/server/replaced.wav')
    assert.ok(await indexedDbAssetStore.get(replacement.id))
  } finally { unmount() }
})

test('novel TTS stops after completed lines and restores saved audio on refresh', async () => {
  const projectId = `novel-tts-${Date.now()}`
  await saveWorkspaceProject(snapshot(projectId), undefined, projectId)
  await setActiveProjectId(projectId)
  const { workspace: w, unmount } = mountWorkspace()
  const originalFetch = globalThis.fetch
  try {
    await sleep(550)
    const novelId = await w.commitNovelImport('voice.txt', { encoding: 'utf-8', intro: null,
      chapters: [{ title: '第一章', content: '甲说了两句。' }] }, [0], false)
    const chapterId = w.novels.value.find(item => item.id === novelId).chapterIds[0]
    assert.equal(w.openNovelChapter(chapterId), true)
    w.characters.value = [{ id: 'speaker', name: '甲', voiceFile: '/server/voice.wav', voiceAssetId: '' }]
    w.scriptLines.value = [
      { id: 'line-1', type: 'dialogue', role: '甲', text: '第一句', audioUrl: '' },
      { id: 'line-2', type: 'dialogue', role: '甲', text: '第二句', audioUrl: '' },
    ]
    assert.equal(w.closeNovelChapter(), true)
    w.ttsConfigs.value = [{ id: 'tts', baseUrl: 'https://tts.example' }]
    w.currentTtsConfigId.value = 'tts'
    const secondEntered = deferred()
    const releaseSecond = deferred()
    let calls = 0
    globalThis.fetch = async url => {
      if (!url.includes('/v2/synthesize')) throw new Error(`Unexpected URL: ${url}`)
      calls++
      if (calls === 2) { secondEntered.resolve(); await releaseSecond.promise }
      return new Response(new Blob([`audio-${calls}`], { type: 'audio/wav' }), { status: 200 })
    }
    const batch = w.generateNovelBatch(novelId)
    await within(secondEntered.promise, 'second chapter line')
    assert.equal(w.currentScriptId.value, 'default')
    w.stopNovelBatch()
    releaseSecond.resolve()
    await batch
    const stored = await loadWorkspaceProject(projectId)
    const lines = stored.scriptList.find(item => item.id === chapterId).data.scriptLines
    assert.ok(lines[0].audioAssetId)
    assert.equal(lines[1].audioAssetId, undefined)
    assert.equal(await (await indexedDbAssetStore.get(lines[0].audioAssetId)).text(), 'audio-1')
  } finally { globalThis.fetch = originalFetch; unmount() }
})

test('novel analysis retries failed chapters and saves book voices without switching scripts', async () => {
  const projectId = `novel-analysis-${Date.now()}`
  await saveWorkspaceProject(snapshot(projectId), undefined, projectId)
  await setActiveProjectId(projectId)
  const { workspace: w, unmount } = mountWorkspace()
  const originalFetch = globalThis.fetch
  try {
    await sleep(550)
    const novelId = await w.commitNovelImport('analysis.txt', { encoding: 'utf-8', intro: null,
      chapters: [{ title: '第一章', content: '林夏走进房间。' }, { title: '第二章', content: '未选择。' }] }, [0], false)
    const chapterIds = w.novels.value.find(item => item.id === novelId).chapterIds
    w.timbres.value.push({ id: 'voice-lin', name: '女声', refPath: '/server/lin.wav', assetId: 'voice-asset' })
    w.setNovelRoleTimbre(novelId, '林夏', 'voice-lin')
    w.llmConfigs.value = [{ id: 'llm', baseUrl: 'https://llm.example/v1', model: 'model', key: 'key' }]
    w.currentConfigId.value = 'llm'
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (calls === 1) return new Response('temporary failure', { status: 500 })
      return Response.json({ choices: [{ message: { content: JSON.stringify([
        { type: 'dialogue', role_name: '林夏', text_content: '我来了。' },
      ]) } }] })
    }
    await w.analyzeNovelBatch(novelId)
    assert.equal(w.currentScriptId.value, 'default')
    assert.equal((await loadWorkspaceProject(projectId)).scriptList.find(item => item.id === chapterIds[0]).data.analysisError, 'HTTP 500')
    await w.analyzeNovelBatch(novelId, { failedOnly: true })
    const stored = await loadWorkspaceProject(projectId)
    assert.equal(calls, 2)
    assert.equal(stored.scriptList.find(item => item.id === chapterIds[0]).data.scriptLines[0].text, '我来了。')
    assert.equal(stored.scriptList.find(item => item.id === chapterIds[0]).data.characters[0].voiceFile, '/server/lin.wav')
    assert.equal(stored.scriptList.find(item => item.id === chapterIds[1]).data.scriptLines.length, 0)
  } finally { globalThis.fetch = originalFetch; unmount() }
})
