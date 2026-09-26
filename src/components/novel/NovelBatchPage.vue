<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'
import { isEmptyNovel } from '../../services/novel/novelImport'
import { selectChapterRange, updateChapterSelection, type ChapterSelectionAction } from '../../services/novel/chapterSelection'
import { chapterProgress } from '../../services/novel/chapterProgress'
import { parseTxtNovel, type ParsedTxtNovel } from '../../services/text/txtNovelParser'
import { incompleteNovelChapters } from '../../services/novel/novelExport'
import ScriptWorkspace from '../script/ScriptWorkspace.vue'

const workspace = useWorkspace()
const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const chapterTableScroll = ref<HTMLElement | null>(null)
const file = ref<File | null>(null)
const encoding = ref('auto')
const parsed = ref<ParsedTxtNovel | null>(null)
const previewIndex = ref(0)
const previewPage = ref(0)
const previewJump = ref<number | null>(null)
const previewPageSize = 50
const loading = ref(false)
const importing = ref(false)
const error = ref('')
const importNotice = ref('')
const importNoticeNovelId = ref('')
let parseGeneration = 0

const activeNovelId = ref('')
const activeNovel = computed(() => workspace.novels.value.find(novel => novel.id === activeNovelId.value) || workspace.novels.value[0])
const novelTitleInput = ref<HTMLInputElement | null>(null)
const novelMenu = ref<HTMLDetailsElement | null>(null)
const chapterSelectionMenu = ref<HTMLDetailsElement | null>(null)
const batchActionsMenu = ref<HTMLDetailsElement | null>(null)
const renamingNovelId = ref('')
const novelTitleDraft = ref('')
const search = ref('')
const statusFilter = ref('all')
const novelView = ref<'chapters' | 'roles'>('chapters')
const selectionNotice = ref('')
const rangeStart = ref<number | null>(null)
const rangeEnd = ref<number | null>(null)
const rangeError = ref('')
let selectionNoticeTimer: ReturnType<typeof setTimeout> | null = null
const page = ref(0)
const pageSize = ref(50)
const selectionByNovel = ref<Record<string, string[]>>({})
const chapterRows = computed(() => {
  const novel = activeNovel.value
  if (!novel) return []
  const scripts = new Map(workspace.scriptList.value.map(script => [script.id, script]))
  return novel.chapterIds.map((id: string, index: number) => ({ id, index,
    number: id === novel.introScriptId ? null : index + 1 - (novel.introScriptId ? 1 : 0),
    script: scripts.get(id) }))
    .filter((row: { script: unknown }) => !!row.script)
})
const numberedRows = computed(() => chapterRows.value.filter((row: any) => row.number !== null))
const filteredRows = computed(() => chapterRows.value.filter((row: any) => {
  if (!row.script.name.toLowerCase().includes(search.value.trim().toLowerCase())) return false
  const progress = chapterProgress(row.script)
  switch (statusFilter.value) {
    case 'analysisPending': return progress.analysis === 'pending'
    case 'analysisFailed': return progress.analysis === 'failed'
    case 'analyzed': return progress.analysis === 'analyzed'
    case 'audioPending': return progress.analysis === 'analyzed' && progress.audio === 'pending'
    case 'audioPartial': return progress.audio === 'partial'
    case 'audioComplete': return progress.audio === 'complete'
    case 'audioFailed': return progress.failed > 0
    default: return true
  }
}))
const visibleRows = computed(() => filteredRows.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)))
const selectedIds = computed(() => new Set<string>(selectionByNovel.value[activeNovel.value?.id || ''] || []))
const pageIds = computed<string[]>(() => visibleRows.value.map((row: { id: string }) => row.id))
const pageAllSelected = computed(() => pageIds.value.length > 0 && pageIds.value.every(id => selectedIds.value.has(id)))
const pageSomeSelected = computed(() => pageIds.value.some(id => selectedIds.value.has(id)))
const previewChapter = computed(() => previewIndex.value === -1 ? parsed.value?.intro : parsed.value?.chapters[previewIndex.value])
const previewPageCount = computed(() => Math.max(1, Math.ceil((parsed.value?.chapters.length || 0) / previewPageSize)))
const visiblePreviewChapters = computed(() => (parsed.value?.chapters || [])
  .slice(previewPage.value * previewPageSize, (previewPage.value + 1) * previewPageSize)
  .map((chapter, offset) => ({ chapter, index: previewPage.value * previewPageSize + offset })))
const editorChapter = computed(() => workspace.scriptList.value.find(script => script.id === workspace.novelEditorId.value))
const editorIndex = computed(() => activeNovel.value?.chapterIds.indexOf(workspace.novelEditorId.value || '') ?? -1)
const previousChapterId = computed(() => editorIndex.value > 0 ? activeNovel.value?.chapterIds[editorIndex.value - 1] : null)
const nextChapterId = computed(() => editorIndex.value >= 0 ? activeNovel.value?.chapterIds[editorIndex.value + 1] : null)
const chapterTitleInput = ref<HTMLInputElement | null>(null)
const editingChapterTitle = ref(false)
const chapterTitleDraft = ref('')
let savedTableScroll = 0
let savedWindowScroll = 0
const selectedRows = computed(() => chapterRows.value.filter((row: any) => selectedIds.value.has(row.id)))
const selectedAnalysisFailures = computed(() => selectedRows.value.filter((row: any) => chapterProgress(row.script).analysis === 'failed').length)
const selectedTtsFailures = computed(() => selectedRows.value.reduce((count: number, row: any) => count + chapterProgress(row.script).failed, 0))
const incompleteExport = computed(() => incompleteNovelChapters(chapterRows.value
  .filter((row: any) => selectedIds.value.has(row.id)).map((row: any) => row.script)))
const novelRoles = computed<string[]>(() => [...new Set<string>(chapterRows.value.flatMap((row: any) =>
  (row.script.data.characters || []).map((character: any) => String(character.name || '').trim())).filter(Boolean))].sort())
const batchRunning = computed(() => workspace.novelBatch.value.running)
const analyzedCount = computed(() => numberedRows.value.filter((row: any) => chapterProgress(row.script).analysis === 'analyzed').length)
const voicedCount = computed(() => numberedRows.value.filter((row: any) => chapterProgress(row.script).audio === 'complete').length)
const currentBatch = computed(() => workspace.novelBatch.value.novelId === activeNovel.value?.id ? workspace.novelBatch.value : null)
function batchPhaseLabel(phase: string) {
  return phase === 'analysis' ? t('novel.taskPhase.analysis') : phase === 'tts'
    ? t('novel.taskPhase.tts') : t('novel.taskPhase.export')
}

function showSelectionNotice(message: string) {
  selectionNotice.value = message
  if (selectionNoticeTimer) clearTimeout(selectionNoticeTimer)
  selectionNoticeTimer = setTimeout(() => { selectionNotice.value = '' }, 3500)
}
watch([search, statusFilter], () => {
  page.value = 0
  if (selectedIds.value.size && activeNovel.value) {
    selectionByNovel.value[activeNovel.value.id] = []
    showSelectionNotice(t('novel.selectionClearedByFilter'))
  }
})
watch(pageSize, () => { page.value = 0 })
watch(pageCount, count => { if (page.value >= count) page.value = count - 1 })
watch(activeNovelId, () => {
  if (novelMenu.value) novelMenu.value.open = false
  if (renamingNovelId.value && renamingNovelId.value !== activeNovelId.value) cancelNovelRename()
  if (importNoticeNovelId.value !== activeNovelId.value) importNotice.value = ''
  search.value = ''
  statusFilter.value = 'all'
  novelView.value = 'chapters'
  page.value = 0
})
watch(batchRunning, running => {
  if (!running) return
  if (novelMenu.value) novelMenu.value.open = false
  if (chapterSelectionMenu.value) chapterSelectionMenu.value.open = false
  if (batchActionsMenu.value) batchActionsMenu.value.open = false
})
watch(() => workspace.novels.value.map(novel => novel.id).join(','), () => {
  if (!workspace.novels.value.some(novel => novel.id === activeNovelId.value)) {
    activeNovelId.value = workspace.novels.value[0]?.id || ''
  }
}, { immediate: true })

async function parseSelectedFile(nextFile: File, nextEncoding = 'auto') {
  const generation = ++parseGeneration
  loading.value = true
  error.value = ''
  try {
    const result = await parseTxtNovel(nextFile, { encoding: nextEncoding })
    if (generation !== parseGeneration) return
    parsed.value = result
    previewPage.value = 0
    previewJump.value = null
    previewIndex.value = 0
  } catch (cause) {
    if (generation === parseGeneration) { parsed.value = null; error.value = String(cause) }
  } finally {
    if (generation === parseGeneration) loading.value = false
  }
}

function chooseFile() { fileInput.value?.click() }
function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const nextFile = input.files?.[0]
  input.value = ''
  if (!nextFile) return
  file.value = nextFile
  importNotice.value = ''
  encoding.value = 'auto'
  void parseSelectedFile(nextFile)
}
function changeEncoding() { if (file.value) void parseSelectedFile(file.value, encoding.value) }
function resetPreview() {
  parseGeneration++
  parsed.value = null
  file.value = null
  error.value = ''
  loading.value = false
}
function cancelPreview() {
  if (importing.value) return
  resetPreview()
}
function changePreviewPage(next: number) {
  previewPage.value = Math.max(0, Math.min(previewPageCount.value - 1, next))
  previewIndex.value = previewPage.value * previewPageSize
}
function jumpToPreviewChapter() {
  const number = Number(previewJump.value)
  if (!Number.isInteger(number) || number < 1 || number > (parsed.value?.chapters.length || 0)) return
  previewIndex.value = number - 1
  previewPage.value = Math.floor(previewIndex.value / previewPageSize)
}
async function confirmImport() {
  if (!file.value || !parsed.value || importing.value) return
  importing.value = true
  error.value = ''
  try {
    const id = await workspace.commitNovelImport(file.value.name, parsed.value)
    activeNovelId.value = id
    importNoticeNovelId.value = id
    importNotice.value = t('novel.importedNotice', { count: parsed.value.chapters.length })
    resetPreview()
  } catch (cause) { error.value = String(cause) }
  finally { importing.value = false }
}
function toggleChapter(id: string) {
  if (!activeNovel.value || batchRunning.value) return
  const next = new Set<string>(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectionByNovel.value[activeNovel.value.id] = activeNovel.value.chapterIds.filter((chapterId: string) => next.has(chapterId))
}
function changeNovelSelection(action: ChapterSelectionAction) {
  if (!activeNovel.value || batchRunning.value) return
  const scope = action === 'result' ? filteredRows.value.map((row: { id: string }) => row.id) : pageIds.value
  selectionByNovel.value[activeNovel.value.id] = updateChapterSelection(activeNovel.value.chapterIds, selectedIds.value, action, scope)
  if (chapterSelectionMenu.value) chapterSelectionMenu.value.open = false
}
function chooseChapterRange() {
  if (!activeNovel.value || batchRunning.value) return
  try {
    selectionByNovel.value[activeNovel.value.id] = selectChapterRange(
      numberedRows.value.map((row: { id: string }) => row.id), Number(rangeStart.value), Number(rangeEnd.value))
    rangeError.value = ''
    if (chapterSelectionMenu.value) chapterSelectionMenu.value.open = false
  } catch {
    rangeError.value = t('novel.rangeError', { count: numberedRows.value.length })
  }
}
function closeNovelMenu() { if (novelMenu.value) novelMenu.value.open = false }
function startNovelRename() {
  if (!activeNovel.value || batchRunning.value) return
  closeNovelMenu()
  renamingNovelId.value = activeNovel.value.id
  novelTitleDraft.value = activeNovel.value.title
  void nextTick(() => { novelTitleInput.value?.focus(); novelTitleInput.value?.select() })
}
function cancelNovelRename() { renamingNovelId.value = ''; novelTitleDraft.value = '' }
function saveNovelRename() {
  if (!renamingNovelId.value) return
  try {
    workspace.renameNovel(renamingNovelId.value, novelTitleDraft.value)
    cancelNovelRename()
  } catch (cause) { error.value = String(cause) }
}
function deleteActiveNovel() {
  const novel = activeNovel.value
  if (!novel || batchRunning.value) return
  closeNovelMenu()
  if (!window.confirm(t('novel.deleteConfirm', { name: novel.title, count: novel.chapterIds.length }))) return
  try {
    workspace.deleteNovel(novel.id)
    cancelNovelRename()
    activeNovelId.value = workspace.novels.value[0]?.id || ''
    error.value = ''
  } catch (cause) { error.value = String(cause) }
}
async function runAnalysis(failedOnly = false, rerun = false) {
  if (!activeNovel.value) return
  if (batchActionsMenu.value) batchActionsMenu.value.open = false
  if (rerun && !window.confirm(t('novel.rerunConfirm'))) return
  error.value = ''
  try { await workspace.analyzeNovelBatch(activeNovel.value.id, [...selectedIds.value], { failedOnly, rerun }) }
  catch (cause) { error.value = String(cause) }
}
async function runTts(failedOnly = false, rerun = false) {
  if (!activeNovel.value) return
  if (batchActionsMenu.value) batchActionsMenu.value.open = false
  if (rerun && !window.confirm(t('novel.regenerateConfirm'))) return
  error.value = ''
  try { await workspace.generateNovelBatch(activeNovel.value.id, [...selectedIds.value], { failedOnly, rerun }) }
  catch (cause) { error.value = String(cause) }
}
async function exportSelected() {
  if (!activeNovel.value) return
  error.value = ''
  try { await workspace.exportNovelBatch(activeNovel.value.id, [...selectedIds.value]) }
  catch (cause) { error.value = String(cause) }
}
function setRoleTimbre(role: string, event: Event, overwrite = false) {
  if (!activeNovel.value) return
  const id = (event.target as HTMLSelectElement).value
  try { workspace.setNovelRoleTimbre(activeNovel.value.id, role, id, overwrite) }
  catch (cause) { error.value = String(cause) }
}
function syncRole(role: string) {
  if (!activeNovel.value) return
  if (!window.confirm(t('novel.syncRoleConfirm'))) return
  try { workspace.setNovelRoleTimbre(activeNovel.value.id, role, activeNovel.value.roleTimbreIds[role] || '', true) }
  catch (cause) { error.value = String(cause) }
}
function openChapter(id: string) {
  savedTableScroll = chapterTableScroll.value?.scrollTop || 0
  savedWindowScroll = window.scrollY
  if (!workspace.openNovelChapter(id)) { error.value = t('novel.busy'); return }
  error.value = ''
  void nextTick(() => window.scrollTo({ top: 0 }))
}
function closeChapter() {
  if (editingChapterTitle.value) { saveChapterRename(); if (editingChapterTitle.value) return }
  if (!workspace.closeNovelChapter()) { error.value = t('novel.busy'); return }
  editingChapterTitle.value = false
  error.value = ''
  void nextTick(() => {
    if (chapterTableScroll.value) chapterTableScroll.value.scrollTop = savedTableScroll
    window.scrollTo({ top: savedWindowScroll })
  })
}
function switchChapter(id: string | null | undefined) {
  if (editingChapterTitle.value) { saveChapterRename(); if (editingChapterTitle.value) return }
  if (!id || !workspace.switchNovelChapter(id)) { error.value = t('novel.busy'); return }
  editingChapterTitle.value = false
  error.value = ''
  void nextTick(() => window.scrollTo({ top: 0 }))
}
function startChapterRename() {
  if (!editorChapter.value) return
  chapterTitleDraft.value = editorChapter.value.name
  editingChapterTitle.value = true
  void nextTick(() => { chapterTitleInput.value?.focus(); chapterTitleInput.value?.select() })
}
function cancelChapterRename() { editingChapterTitle.value = false; chapterTitleDraft.value = '' }
function saveChapterRename() {
  if (!editingChapterTitle.value || !editorChapter.value) return
  try {
    workspace.renameNovelChapter(editorChapter.value.id, chapterTitleDraft.value)
    cancelChapterRename()
    error.value = ''
  } catch (cause) { error.value = String(cause) }
}
function onDocumentPointerDown(event: PointerEvent) {
  for (const menu of [novelMenu.value, chapterSelectionMenu.value, batchActionsMenu.value]) {
    if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => {
  if (selectionNoticeTimer) clearTimeout(selectionNoticeTimer)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  if (workspace.novelEditorId.value) workspace.closeNovelChapter()
})
</script>

<template>
  <section class="space-y-5" :aria-label="t('page.novel')">
    <input ref="fileInput" type="file" accept=".txt,text/plain" class="hidden" @change="onFileChange">

    <div v-if="!activeNovel && !parsed" class="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
      <h2 class="text-2xl font-bold text-slate-900">{{ t('novel.importTitle') }}</h2>
      <p class="mt-3 text-slate-500">{{ t('novel.importHint') }}</p>
      <button type="button" class="mt-8 rounded-xl bg-blue-600 px-7 py-3 font-semibold text-white hover:bg-blue-700" @click="chooseFile">{{ t('novel.chooseTxt') }}</button>
      <p class="mt-4 text-sm text-slate-500">{{ t('novel.encodingHint') }}</p>
    </div>

    <template v-if="activeNovel">
      <div v-show="!workspace.novelEditorId.value" class="space-y-4">
        <p v-if="importNotice && importNoticeNovelId === activeNovel.id" role="status" class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{{ importNotice }}</p>
        <div class="rounded-2xl border border-slate-200 bg-white p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <label for="novel-select" class="text-sm text-slate-500">{{ t('novel.currentNovel') }}</label>
                <input v-if="renamingNovelId === activeNovel.id" id="novel-select" ref="novelTitleInput" v-model="novelTitleDraft" type="text" :aria-label="t('novel.rename')" class="rounded-lg border border-blue-400 bg-white px-3 py-2 font-semibold text-slate-800" @keydown.enter.stop.prevent="saveNovelRename" @keydown.esc.stop.prevent="cancelNovelRename" @blur="saveNovelRename">
                <select v-else id="novel-select" v-model="activeNovelId" :disabled="batchRunning" class="max-w-72 rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800">
                  <option v-for="novel in workspace.novels.value" :key="novel.id" :value="novel.id">{{ novel.title }}</option>
                </select>
                <button v-if="renamingNovelId === activeNovel.id" type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" @click="saveNovelRename">{{ t('novel.saveName') }}</button>
              </div>
              <p class="mt-2 text-sm text-slate-500">{{ numberedRows.length }} {{ t('novel.chapters') }} · {{ t('novel.analyzed') }} {{ analyzedCount }} · {{ t('novel.audioComplete') }} {{ voicedCount }} · {{ activeNovel.encoding }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" :disabled="batchRunning" class="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40" @click="chooseFile">{{ t('novel.importAnother') }}</button>
              <details ref="novelMenu" class="relative" :class="batchRunning ? 'pointer-events-none opacity-40' : ''" :aria-disabled="batchRunning">
                <summary :aria-label="t('novel.manage')" class="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-300 text-xl leading-none text-slate-600 hover:bg-slate-50">···</summary>
                <div class="absolute right-0 z-30 mt-1 min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <button type="button" :disabled="batchRunning" class="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40" @click="startNovelRename">{{ t('novel.rename') }}</button>
                  <button type="button" :disabled="batchRunning" class="block w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-40" @click="deleteActiveNovel">{{ t('novel.delete') }}</button>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div v-if="currentBatch?.running" role="status" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span>{{ t('novel.taskRunning', { phase: batchPhaseLabel(currentBatch.phase), title: activeNovel.title }) }} · {{ currentBatch.chapterTitle || '—' }} · {{ currentBatch.current }} / {{ currentBatch.total }}<span v-if="currentBatch.phase === 'tts' && currentBatch.chapterTotal"> · {{ t('novel.chapterLineProgress', { current: currentBatch.chapterCurrent, total: currentBatch.chapterTotal }) }}</span></span>
          <button type="button" class="rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-700" @click="workspace.stopNovelBatch()">{{ t('novel.stopTask') }}</button>
        </div>

        <div class="border-b border-slate-200">
          <div class="flex gap-6">
            <button type="button" class="border-b-2 px-1 py-3 text-sm font-semibold" :class="novelView === 'chapters' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600'" @click="novelView = 'chapters'">{{ t('novel.chaptersTab') }}</button>
            <button type="button" class="border-b-2 px-1 py-3 text-sm font-semibold" :class="novelView === 'roles' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600'" @click="novelView = 'roles'">{{ t('novel.roleVoices') }}</button>
          </div>
        </div>

        <div v-show="novelView === 'chapters'" class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <input v-model="search" type="search" :disabled="batchRunning" :placeholder="t('novel.search')" class="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">
              <label class="flex items-center gap-2 text-sm text-slate-600">{{ t('novel.status') }}
                <select v-model="statusFilter" :disabled="batchRunning" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40">
                  <option value="all">{{ t('novel.statusAll') }}</option>
                  <option value="analysisPending">{{ t('novel.pending') }}</option>
                  <option value="analysisFailed">{{ t('novel.analysisFailed') }}</option>
                  <option value="analyzed">{{ t('novel.analyzed') }}</option>
                  <option value="audioPending">{{ t('novel.audioPending') }}</option>
                  <option value="audioPartial">{{ t('novel.audioPartial') }}</option>
                  <option value="audioComplete">{{ t('novel.audioComplete') }}</option>
                  <option value="audioFailed">{{ t('novel.audioFailed') }}</option>
                </select>
              </label>
            </div>
            <details ref="chapterSelectionMenu" class="relative" :class="batchRunning ? 'pointer-events-none opacity-40' : ''" :aria-disabled="batchRunning">
              <summary :aria-label="t('novel.selectionScope')" class="cursor-pointer list-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">{{ t('novel.selectionScope') }} ▾</summary>
              <div class="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg">
                <button type="button" :disabled="!filteredRows.length" class="block w-full rounded-md px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-40" @click="changeNovelSelection('result')">{{ t('novel.selectAllResults') }}</button>
                <form class="border-y border-slate-100 px-2 py-3" @submit.prevent="chooseChapterRange">
                  <label class="block font-medium text-slate-700">{{ t('novel.selectByNumber') }}</label>
                  <div class="mt-2 flex items-center gap-2">
                    <input v-model.number="rangeStart" type="number" min="1" :max="numberedRows.length" :aria-label="t('novel.rangeStart')" class="w-20 rounded-md border border-slate-300 px-2 py-1">
                    <span>–</span>
                    <input v-model.number="rangeEnd" type="number" min="1" :max="numberedRows.length" :aria-label="t('novel.rangeEnd')" class="w-20 rounded-md border border-slate-300 px-2 py-1">
                    <button type="submit" class="font-medium text-blue-700">{{ t('novel.apply') }}</button>
                  </div>
                  <p v-if="rangeError" role="alert" class="mt-2 text-xs text-red-700">{{ rangeError }}</p>
                </form>
                <button type="button" class="block w-full rounded-md px-2 py-2 text-left hover:bg-slate-50" @click="changeNovelSelection('clear')">{{ t('novel.clearSelection') }}</button>
              </div>
            </details>
          </div>
          <p v-if="selectionNotice" role="status" class="mb-3 text-sm text-amber-700">{{ selectionNotice }}</p>
          <div ref="chapterTableScroll" class="max-h-[62vh] overflow-auto rounded-lg border border-slate-200">
            <table class="w-full min-w-[740px] text-left text-sm">
              <thead class="sticky top-0 z-10 bg-slate-50 text-slate-500">
                <tr>
                  <th class="p-3"><label class="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" :checked="pageAllSelected" :indeterminate="pageSomeSelected && !pageAllSelected" :disabled="batchRunning || !visibleRows.length" @change="changeNovelSelection('page')">{{ t('novel.selectPage') }}</label></th>
                  <th class="p-3">{{ t('novel.number') }}</th><th class="p-3">{{ t('novel.title') }}</th><th class="p-3">{{ t('novel.characters') }}</th>
                  <th class="p-3">{{ t('novel.analysisColumn') }}</th><th class="p-3">{{ t('novel.audioColumn') }}</th><th class="p-3">{{ t('novel.action') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in visibleRows" :key="row.id" class="border-t border-slate-100 hover:bg-blue-50/40" :class="selectedIds.has(row.id) ? 'bg-blue-50/60' : ''">
                  <td class="p-3"><input type="checkbox" :checked="selectedIds.has(row.id)" :disabled="batchRunning" :aria-label="t('novel.select') + ' ' + row.script.name" @change="toggleChapter(row.id)"></td>
                  <td class="p-3 text-slate-500">{{ row.number ?? '—' }}</td>
                  <td class="p-3 font-medium text-slate-800">{{ row.number === null ? t('novel.intro') : row.script.name }}</td>
                  <td class="p-3 text-slate-500">{{ row.script.data.rawScript.length }}</td>
                  <td class="p-3" :title="row.script.data.analysisError || ''">
                    <span :class="chapterProgress(row.script).analysis === 'failed' ? 'text-red-700' : chapterProgress(row.script).analysis === 'analyzed' ? 'text-green-700' : 'text-slate-500'">{{ chapterProgress(row.script).analysis === 'failed' ? t('novel.analysisFailed') : chapterProgress(row.script).analysis === 'analyzed' ? t('novel.analyzed') : t('novel.pending') }}</span>
                  </td>
                  <td class="p-3">
                    <span v-if="chapterProgress(row.script).audio === 'none'" class="text-slate-400">{{ chapterProgress(row.script).analysis === 'analyzed' ? t('novel.noDialogue') : '—' }}</span>
                    <span v-else :class="chapterProgress(row.script).audio === 'complete' ? 'text-green-700' : 'text-slate-600'">{{ chapterProgress(row.script).audio === 'complete' ? t('novel.audioComplete') : chapterProgress(row.script).audio === 'pending' ? t('novel.audioPending') : t('novel.audioPartial') }} {{ chapterProgress(row.script).generated }}/{{ chapterProgress(row.script).total }}</span>
                    <span v-if="chapterProgress(row.script).failed" class="ml-1 text-red-700">{{ t('novel.failedLines', { count: chapterProgress(row.script).failed }) }}</span>
                  </td>
                  <td class="p-3"><button type="button" :disabled="batchRunning" :title="batchRunning ? t('novel.busy') : undefined" class="font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40" @click="openChapter(row.id)">{{ t('novel.openChapter') }}</button></td>
                </tr>
                <tr v-if="!visibleRows.length"><td colspan="7" class="p-8 text-center text-slate-500">{{ t('novel.noMatchingChapters') }}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
            <label class="flex items-center gap-2" for="novel-page-size">{{ t('novel.pageSize') }}
              <select id="novel-page-size" v-model.number="pageSize" class="rounded-md border border-slate-300 bg-white px-2 py-1">
                <option v-for="size in [20, 50, 100, 200]" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <div class="flex items-center gap-3">
              <button type="button" :disabled="page === 0" class="disabled:opacity-40" @click="page--">{{ t('novel.previous') }}</button>
              <span>{{ page + 1 }} / {{ pageCount }}</span>
              <button type="button" :disabled="page + 1 >= pageCount" class="disabled:opacity-40" @click="page++">{{ t('novel.next') }}</button>
            </div>
          </div>
        </div>

        <div v-show="novelView === 'chapters'" class="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 shadow-lg">
          <div class="flex items-center gap-3 text-sm">
            <strong class="text-slate-800">{{ t('novel.selectedCountValue', { count: selectedIds.size }) }}</strong>
            <button type="button" :disabled="!selectedIds.size || batchRunning" class="font-medium text-blue-700 disabled:opacity-40" @click="changeNovelSelection('clear')">{{ t('novel.clear') }}</button>
            <span v-if="!selectedIds.size" class="text-slate-500">{{ t('novel.chooseToProcess') }}</span>
            <span v-else-if="incompleteExport.length" class="text-amber-800">{{ t('novel.exportIncompleteCount', { count: incompleteExport.length }) }}</span>
          </div>
          <div v-if="!batchRunning" class="flex flex-wrap items-center gap-2">
            <button type="button" :disabled="!selectedIds.size" class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40" @click="runAnalysis()">{{ t('novel.analyzeSelected') }}</button>
            <button type="button" :disabled="!selectedIds.size" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40" @click="runTts()">{{ t('novel.generateMissing') }}</button>
            <button type="button" :disabled="!selectedIds.size || incompleteExport.length > 0" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40" @click="exportSelected">{{ t('novel.exportZip') }}</button>
            <details ref="batchActionsMenu" class="relative">
              <summary :aria-label="t('novel.moreActions')" class="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">{{ t('novel.moreActions') }} ▾</summary>
              <div class="absolute bottom-full right-0 z-30 mb-1 min-w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg">
                <button type="button" :disabled="!selectedIds.size || !selectedAnalysisFailures" class="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40" @click="runAnalysis(true)">{{ t('novel.retrySelectedAnalysis') }}</button>
                <button type="button" :disabled="!selectedIds.size || !selectedTtsFailures" class="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40" @click="runTts(true)">{{ t('novel.retrySelectedAudio') }}</button>
                <button type="button" :disabled="!selectedIds.size" class="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40" @click="runAnalysis(false, true)">{{ t('novel.rerunSelected') }}</button>
                <button type="button" :disabled="!selectedIds.size" class="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40" @click="runTts(false, true)">{{ t('novel.regenerateAll') }}</button>
              </div>
            </details>
          </div>
        </div>

        <div v-show="novelView === 'roles'" class="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 class="text-lg font-bold text-slate-900">{{ t('novel.roleVoices') }}</h2>
          <p class="mt-1 text-sm text-slate-500">{{ t('novel.roleHint') }}</p>
          <p v-if="!novelRoles.length" class="mt-6 text-sm text-slate-500">{{ t('novel.noRoles') }}</p>
          <div v-else class="mt-4 grid gap-3 md:grid-cols-2">
            <div v-for="role in novelRoles" :key="role" class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3">
              <strong class="min-w-20 text-sm text-slate-800">{{ role }}</strong>
              <select :value="activeNovel.roleTimbreIds[role] || ''" :disabled="batchRunning" class="min-w-40 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" @change="setRoleTimbre(role, $event)">
                <option value="">{{ t('novel.unbound') }}</option>
                <option v-if="activeNovel.roleTimbreIds[role] && !workspace.timbres.value.some(item => item.id === activeNovel.roleTimbreIds[role])" :value="activeNovel.roleTimbreIds[role]">{{ t('novel.missingTimbre') }}</option>
                <option v-for="timbre in workspace.timbres.value" :key="timbre.id" :value="timbre.id">{{ timbre.name }}</option>
              </select>
              <button type="button" :disabled="batchRunning || !activeNovel.roleTimbreIds[role]" class="text-sm font-semibold text-blue-700 disabled:opacity-40" @click="syncRole(role)">{{ t('novel.applyAll') }}</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <p v-if="error && !parsed" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>

    <div v-if="file" class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-3" @click.self="cancelPreview">
      <div role="dialog" aria-modal="true" :aria-label="t('novel.previewTitle')" class="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h2 class="text-xl font-bold text-slate-900">{{ t('novel.previewTitle') }}</h2><p class="text-sm text-slate-500">{{ file.name }} · {{ parsed?.chapters.length || 0 }} {{ t('novel.chapters') }} · {{ parsed?.encoding || '—' }}</p></div>
          <div class="flex items-center gap-3 text-sm">
            <label for="novel-encoding">{{ t('novel.encoding') }}</label>
            <select id="novel-encoding" v-model="encoding" :disabled="importing" class="rounded-lg border border-slate-300 px-3 py-2" @change="changeEncoding">
              <option value="auto">{{ t('novel.autoEncoding') }}</option><option value="utf-8">UTF-8</option><option value="gbk">GBK</option><option value="gb18030">GB18030</option>
            </select>
            <span v-if="loading">{{ t('novel.parsing') }}</span>
            <button type="button" :aria-label="t('novel.cancel')" class="ml-2 text-2xl text-slate-500" @click="cancelPreview">×</button>
          </div>
        </header>
        <p v-if="error" role="alert" class="mx-5 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
        <template v-if="parsed">
          <p v-if="isEmptyNovel(parsed)" class="mx-5 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{{ t('novel.emptyFile') }}</p>
          <p v-else-if="parsed.chapters.length === 1 && parsed.chapters[0]?.title === '正文'" class="mx-5 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{{ t('novel.singleChapter') }}</p>
          <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div class="flex min-h-0 flex-col rounded-lg border border-slate-200">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-2 text-sm">
                <strong class="text-slate-800">{{ t('novel.detectedChapters') }}</strong>
                <form class="flex items-center gap-1" @submit.prevent="jumpToPreviewChapter">
                  <input v-model.number="previewJump" type="number" min="1" :max="parsed.chapters.length" :aria-label="t('novel.jumpNumber')" :placeholder="t('novel.jumpNumber')" class="w-20 rounded-md border border-slate-300 px-2 py-1">
                  <button type="submit" class="rounded-md border border-slate-300 px-2 py-1 text-blue-700">{{ t('novel.jump') }}</button>
                </form>
              </div>
              <button v-if="parsed.intro" type="button" class="border-b border-slate-100 px-3 py-2 text-left text-sm" :class="previewIndex === -1 ? 'bg-blue-50 text-blue-700' : 'text-slate-700'" @click="previewIndex = -1">
                {{ t('novel.intro') }} <span class="text-slate-400">· {{ parsed.intro.content.length }} {{ t('novel.characters') }}</span>
              </button>
              <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
                <span class="w-6 text-right">#</span><span>{{ t('novel.title') }}</span>
              </div>
              <div class="min-h-0 flex-1 overflow-auto">
                <div v-for="row in visiblePreviewChapters" :key="row.index" class="flex items-center gap-2 border-b border-slate-100 px-3 py-2" :class="previewIndex === row.index ? 'bg-blue-50' : ''">
                  <span class="w-6 shrink-0 text-right text-xs text-slate-400">{{ row.index + 1 }}</span>
                  <button type="button" class="min-w-0 flex-1 truncate text-left text-sm" @click="previewIndex = row.index">{{ row.chapter.title }} <span class="text-slate-400">· {{ row.chapter.content.length }} {{ t('novel.characters') }}</span><span v-if="!row.chapter.content.trim()" class="ml-1 text-amber-700">{{ t('novel.emptyBody') }}</span></button>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-2 text-sm text-slate-500">
                <span>{{ t('novel.pageSize') }} 50</span>
                <div class="flex items-center gap-2">
                  <button type="button" :disabled="previewPage === 0" class="disabled:opacity-40" @click="changePreviewPage(previewPage - 1)">{{ t('novel.previous') }}</button>
                  <span>{{ previewPage + 1 }} / {{ previewPageCount }}</span>
                  <button type="button" :disabled="previewPage + 1 >= previewPageCount" class="disabled:opacity-40" @click="changePreviewPage(previewPage + 1)">{{ t('novel.next') }}</button>
                </div>
              </div>
            </div>
            <div class="min-h-0 overflow-auto rounded-lg border border-slate-200 p-4">
              <h3 class="mb-3 font-bold text-slate-900">{{ previewChapter?.title }}</h3>
              <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-700">{{ previewChapter?.content }}</pre>
            </div>
          </div>
        </template>
        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5">
          <span class="text-sm text-slate-500">{{ t('novel.importAllHint') }}</span>
          <div class="flex gap-3"><button type="button" :disabled="importing" class="rounded-lg border border-slate-300 px-4 py-2" @click="cancelPreview">{{ t('novel.cancel') }}</button><button type="button" :disabled="!parsed || loading || importing || isEmptyNovel(parsed)" class="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-40" @click="confirmImport">{{ importing ? t('novel.importing') : t('novel.importWhole') }}</button></div>
        </footer>
      </div>
    </div>

    <div v-if="workspace.novelEditorId.value && activeNovel" class="space-y-4">
      <div class="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <button type="button" class="font-medium text-blue-700" @click="closeChapter">← {{ t('novel.backToChapters') }}</button>
            <span class="text-slate-300">/</span><span class="text-sm text-slate-500">{{ activeNovel.title }}</span>
            <input v-if="editingChapterTitle" ref="chapterTitleInput" v-model="chapterTitleDraft" type="text" :aria-label="t('novel.chapterTitle')" class="min-w-48 rounded-lg border border-blue-400 px-2 py-1 font-semibold" @keydown.enter.stop.prevent="saveChapterRename" @keydown.esc.stop.prevent="cancelChapterRename" @blur="saveChapterRename">
            <strong v-else class="min-w-0 text-slate-900">{{ editorChapter?.name }}</strong>
            <button v-if="!editingChapterTitle" type="button" class="text-sm text-blue-700" @click="startChapterRename">{{ t('novel.renameChapter') }}</button>
          </div>
          <div class="flex items-center gap-2 text-sm">
            <button type="button" :disabled="!previousChapterId" class="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40" @click="switchChapter(previousChapterId)">{{ t('novel.previousChapter') }}</button>
            <button type="button" :disabled="!nextChapterId" class="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40" @click="switchChapter(nextChapterId)">{{ t('novel.nextChapter') }}</button>
          </div>
        </div>
      </div>
      <ScriptWorkspace embedded />
    </div>
  </section>
</template>
