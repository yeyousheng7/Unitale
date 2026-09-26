<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'
import { isEmptyNovel } from '../../services/novel/novelImport'
import { parseTxtNovel, type ParsedTxtNovel } from '../../services/text/txtNovelParser'
import ScriptWorkspace from '../script/ScriptWorkspace.vue'

const workspace = useWorkspace()
const { t } = useI18n()
const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const encoding = ref('auto')
const parsed = ref<ParsedTxtNovel | null>(null)
const selectedIndexes = ref<number[]>([])
const includeIntro = ref(false)
const previewIndex = ref(0)
const loading = ref(false)
const importing = ref(false)
const error = ref('')
let parseGeneration = 0

const activeNovelId = ref('')
const activeNovel = computed(() => workspace.novels.value.find(novel => novel.id === activeNovelId.value) || workspace.novels.value[0])
const search = ref('')
const page = ref(0)
const pageSize = 50
const chapterRows = computed(() => {
  const novel = activeNovel.value
  if (!novel) return []
  const scripts = new Map(workspace.scriptList.value.map(script => [script.id, script]))
  return novel.chapterIds.map((id: string, index: number) => ({ id, index, script: scripts.get(id) }))
    .filter((row: { script: unknown }) => !!row.script)
})
const filteredRows = computed(() => chapterRows.value.filter((row: any) =>
  row.script.name.toLowerCase().includes(search.value.trim().toLowerCase())))
const visibleRows = computed(() => filteredRows.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
const selectedIds = computed(() => new Set<string>(activeNovel.value?.selectedChapterIds || []))
const previewChapter = computed(() => previewIndex.value === -1 ? parsed.value?.intro : parsed.value?.chapters[previewIndex.value])
const editorChapter = computed(() => workspace.scriptList.value.find(script => script.id === workspace.novelEditorId.value))
const analysisFailures = computed(() => chapterRows.value.filter((row: any) => !!row.script.data.analysisError).length)
const ttsFailures = computed(() => chapterRows.value.reduce((count: number, row: any) =>
  count + row.script.data.scriptLines.filter((line: any) => !!line.ttsError).length, 0))
const novelRoles = computed<string[]>(() => [...new Set<string>(chapterRows.value.flatMap((row: any) =>
  (row.script.data.characters || []).map((character: any) => String(character.name || '').trim())).filter(Boolean))].sort())
const batchRunning = computed(() => workspace.novelBatch.value.running && workspace.novelBatch.value.novelId === activeNovel.value?.id)

watch([search, activeNovelId], () => { page.value = 0 })
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
    selectedIndexes.value = result.chapters.flatMap((chapter, index) => chapter.content.trim() ? [index] : [])
    includeIntro.value = false
    previewIndex.value = result.intro ? -1 : 0
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
  encoding.value = 'auto'
  void parseSelectedFile(nextFile)
}
function changeEncoding() { if (file.value) void parseSelectedFile(file.value, encoding.value) }
function cancelPreview() {
  if (importing.value) return
  parseGeneration++
  parsed.value = null
  file.value = null
  error.value = ''
  loading.value = false
}
function togglePreviewIndex(index: number) {
  selectedIndexes.value = selectedIndexes.value.includes(index)
    ? selectedIndexes.value.filter(value => value !== index)
    : [...selectedIndexes.value, index]
}
async function confirmImport() {
  if (!file.value || !parsed.value || importing.value) return
  importing.value = true
  error.value = ''
  try {
    const id = await workspace.commitNovelImport(file.value.name, parsed.value, selectedIndexes.value, includeIntro.value)
    activeNovelId.value = id
    cancelPreview()
  } catch (cause) { error.value = String(cause) }
  finally { importing.value = false }
}
function toggleChapter(id: string) {
  if (!activeNovel.value) return
  const next = new Set<string>(activeNovel.value.selectedChapterIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  workspace.setNovelSelection(activeNovel.value.id, [...next])
}
async function runAnalysis(failedOnly = false, rerun = false) {
  if (!activeNovel.value) return
  if (rerun && !window.confirm(t('novel.rerunConfirm'))) return
  error.value = ''
  try { await workspace.analyzeNovelBatch(activeNovel.value.id, { failedOnly, rerun }) }
  catch (cause) { error.value = String(cause) }
}
async function runTts(failedOnly = false, rerun = false) {
  if (!activeNovel.value) return
  if (rerun && !window.confirm(t('novel.regenerateConfirm'))) return
  error.value = ''
  try { await workspace.generateNovelBatch(activeNovel.value.id, { failedOnly, rerun }) }
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
  if (!workspace.openNovelChapter(id)) error.value = t('novel.busy')
}
function closeChapter() {
  if (!workspace.closeNovelChapter()) error.value = t('novel.busy')
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && workspace.novelEditorId.value) { event.preventDefault(); closeChapter() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="space-y-5" aria-label="小说批量处理">
    <input ref="fileInput" type="file" accept=".txt,text/plain" class="hidden" @change="onFileChange">

    <div v-if="!activeNovel && !parsed" class="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
      <h2 class="text-2xl font-bold text-slate-900">{{ t('novel.importTitle') }}</h2>
      <p class="mt-3 text-slate-500">{{ t('novel.importHint') }}</p>
      <button type="button" class="mt-8 rounded-xl bg-blue-600 px-7 py-3 font-semibold text-white hover:bg-blue-700" @click="chooseFile">{{ t('novel.chooseTxt') }}</button>
      <p class="mt-4 text-sm text-slate-500">{{ t('novel.encodingHint') }}</p>
    </div>

    <template v-if="activeNovel">
      <div class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <label class="mr-3 text-sm text-slate-500" for="novel-select">{{ t('novel.currentNovel') }}</label>
            <select id="novel-select" v-model="activeNovelId" class="rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-800">
              <option v-for="novel in workspace.novels.value" :key="novel.id" :value="novel.id">{{ novel.title }}</option>
            </select>
            <span class="ml-3 text-sm text-slate-500">{{ activeNovel.chapterIds.length }} {{ t('novel.chapters') }} · {{ activeNovel.encoding }}</span>
          </div>
          <button type="button" class="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-blue-700 hover:bg-blue-50" @click="chooseFile">{{ t('novel.importAnother') }}</button>
        </div>
        <p class="mt-3 text-sm text-slate-500">{{ activeNovel.sourceFileName }} · {{ t('novel.selectedCount') }} {{ activeNovel.selectedChapterIds.length }}</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 bg-white p-4"><span class="text-sm text-slate-500">{{ t('novel.total') }}</span><strong class="mt-1 block text-2xl text-slate-900">{{ chapterRows.length }}</strong></div>
        <div class="rounded-xl border border-slate-200 bg-white p-4"><span class="text-sm text-slate-500">{{ t('novel.selectedCount') }}</span><strong class="mt-1 block text-2xl text-slate-900">{{ activeNovel.selectedChapterIds.length }}</strong></div>
        <div class="rounded-xl border border-slate-200 bg-white p-4"><span class="text-sm text-slate-500">{{ t('novel.analyzed') }}</span><strong class="mt-1 block text-2xl text-slate-900">{{ chapterRows.filter((row: any) => row.script.data.scriptLines?.length).length }}</strong></div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h2 class="text-lg font-bold text-slate-900">{{ t('novel.batchAnalysis') }}</h2><p class="text-sm text-slate-500">{{ t('novel.analysisHint') }}</p></div>
          <span v-if="analysisFailures" class="rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">{{ t('novel.failed') }} {{ analysisFailures }}</span>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button v-if="!batchRunning" type="button" class="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700" @click="runAnalysis()">{{ t('novel.analyzeSelected') }}</button>
          <button v-if="!batchRunning" type="button" class="rounded-lg border border-slate-300 px-4 py-2" @click="runAnalysis(true)">{{ t('novel.retryFailed') }}</button>
          <button v-if="!batchRunning" type="button" class="rounded-lg border border-slate-300 px-4 py-2" @click="runAnalysis(false, true)">{{ t('novel.rerunSelected') }}</button>
          <button v-if="batchRunning" type="button" class="rounded-lg border border-red-300 px-4 py-2 text-red-700" @click="workspace.stopNovelBatch()">{{ t('novel.stopTask') }}</button>
          <span v-if="batchRunning" class="text-sm text-slate-600">{{ workspace.novelBatch.value.current }} / {{ workspace.novelBatch.value.total }}</span>
        </div>
      </div>

      <div v-if="novelRoles.length" class="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 class="text-lg font-bold text-slate-900">{{ t('novel.roleVoices') }}</h2>
        <p class="mt-1 text-sm text-slate-500">{{ t('novel.roleHint') }}</p>
        <div class="mt-4 grid gap-3 md:grid-cols-2">
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

      <div class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h2 class="text-lg font-bold text-slate-900">{{ t('novel.batchTts') }}</h2><p class="text-sm text-slate-500">{{ t('novel.ttsHint') }}</p></div>
          <span v-if="ttsFailures" class="rounded-full bg-red-50 px-3 py-1 text-sm text-red-700">{{ t('novel.failed') }} {{ ttsFailures }}</span>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" :disabled="batchRunning" class="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-40" @click="runTts()">{{ t('novel.generateMissing') }}</button>
          <button type="button" :disabled="batchRunning" class="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" @click="runTts(true)">{{ t('novel.retryTts') }}</button>
          <button type="button" :disabled="batchRunning" class="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-40" @click="runTts(false, true)">{{ t('novel.regenerateAll') }}</button>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-bold text-slate-900">{{ t('novel.chapterList') }}</h2>
          <input v-model="search" type="search" :placeholder="t('novel.search')" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64">
        </div>
        <div class="max-h-[58vh] overflow-auto rounded-lg border border-slate-200">
          <table class="w-full min-w-[650px] text-left text-sm">
            <thead class="sticky top-0 bg-slate-50 text-slate-500"><tr><th class="p-3">{{ t('novel.select') }}</th><th class="p-3">#</th><th class="p-3">{{ t('novel.title') }}</th><th class="p-3">{{ t('novel.characters') }}</th><th class="p-3">{{ t('novel.status') }}</th><th class="p-3">{{ t('novel.action') }}</th></tr></thead>
            <tbody>
              <tr v-for="row in visibleRows" :key="row.id" class="border-t border-slate-100 hover:bg-blue-50/40">
                <td class="p-3"><input type="checkbox" :checked="selectedIds.has(row.id)" :aria-label="`${t('novel.select')} ${row.script.name}`" @change="toggleChapter(row.id)"></td>
                <td class="p-3 text-slate-500">{{ row.index + 1 }}</td>
                <td class="p-3 font-medium text-slate-800">{{ row.script.name }}</td>
                <td class="p-3 text-slate-500">{{ row.script.data.rawScript.length }}</td>
                <td class="p-3 text-slate-500" :title="row.script.data.analysisError || row.script.data.scriptLines.find((line: any) => line.ttsError)?.ttsError || ''">{{ row.script.data.analysisError || row.script.data.scriptLines.some((line: any) => line.ttsError) ? t('novel.failed') : row.script.data.scriptLines.some((line: any) => line.type === 'dialogue' && line.audioAssetId) ? t('novel.voiced') : row.script.data.scriptLines.length ? t('novel.analyzed') : t('novel.pending') }}</td>
                <td class="p-3"><button type="button" class="font-semibold text-blue-700 hover:underline" @click="openChapter(row.id)">{{ t('novel.editChapter') }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mt-3 flex items-center justify-end gap-3 text-sm text-slate-500">
          <button type="button" :disabled="page === 0" class="disabled:opacity-40" @click="page--">{{ t('novel.previous') }}</button>
          <span>{{ page + 1 }} / {{ pageCount }}</span>
          <button type="button" :disabled="page + 1 >= pageCount" class="disabled:opacity-40" @click="page++">{{ t('novel.next') }}</button>
        </div>
      </div>
    </template>

    <p v-if="error && !parsed" role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>

    <div v-if="file" class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-3" @click.self="cancelPreview">
      <div role="dialog" aria-modal="true" :aria-label="t('novel.previewTitle')" class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header class="flex items-center justify-between border-b border-slate-200 p-5">
          <div><h2 class="text-xl font-bold text-slate-900">{{ t('novel.previewTitle') }}</h2><p class="text-sm text-slate-500">{{ file.name }} · {{ parsed?.chapters.length || 0 }} {{ t('novel.chapters') }}</p></div>
          <button type="button" :aria-label="t('novel.cancel')" class="text-2xl text-slate-500" @click="cancelPreview">×</button>
        </header>
        <div class="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3 text-sm">
          <label for="novel-encoding">{{ t('novel.encoding') }}</label>
          <select id="novel-encoding" v-model="encoding" class="rounded-lg border border-slate-300 px-3 py-2" @change="changeEncoding">
            <option value="auto">{{ t('novel.autoEncoding') }}</option><option value="utf-8">UTF-8</option><option value="gbk">GBK</option><option value="gb18030">GB18030</option>
          </select>
          <span v-if="parsed" class="text-slate-500">{{ t('novel.usedEncoding') }}: {{ parsed.encoding }}</span>
          <span v-if="loading">{{ t('novel.parsing') }}</span>
        </div>
        <p v-if="error" role="alert" class="mx-5 mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
        <template v-if="parsed">
          <p v-if="isEmptyNovel(parsed)" class="mx-5 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{{ t('novel.emptyFile') }}</p>
          <p v-else-if="parsed.chapters.length === 1 && parsed.chapters[0]?.title === '正文'" class="mx-5 mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{{ t('novel.singleChapter') }}</p>
          <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-2">
            <div class="min-h-0 overflow-auto rounded-lg border border-slate-200">
              <div v-if="parsed.intro" class="flex items-center gap-2 border-b border-slate-100 p-3">
                <input v-model="includeIntro" type="checkbox" :aria-label="t('novel.intro')"><button type="button" class="flex-1 text-left" @click="previewIndex = -1">{{ t('novel.intro') }} · {{ parsed.intro.content.length }} {{ t('novel.characters') }}</button>
              </div>
              <div v-for="(chapter, index) in parsed.chapters" :key="index" class="flex items-center gap-2 border-b border-slate-100 p-3" :class="previewIndex === index ? 'bg-blue-50' : ''">
                <input type="checkbox" :checked="selectedIndexes.includes(index)" :aria-label="`${t('novel.select')} ${chapter.title}`" @change="togglePreviewIndex(index)">
                <button type="button" class="flex-1 text-left" @click="previewIndex = index">{{ chapter.title }} <span class="text-slate-400">· {{ chapter.content.length }} {{ t('novel.characters') }}</span></button>
              </div>
            </div>
            <div class="min-h-0 overflow-auto rounded-lg border border-slate-200 p-4">
              <h3 class="mb-3 font-bold text-slate-900">{{ previewChapter?.title }}</h3>
              <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-700">{{ previewChapter?.content }}</pre>
            </div>
          </div>
        </template>
        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-5">
          <span class="text-sm text-slate-500">{{ t('novel.noChangeBeforeConfirm') }}</span>
          <div class="flex gap-3"><button type="button" class="rounded-lg border border-slate-300 px-4 py-2" @click="cancelPreview">{{ t('novel.cancel') }}</button><button type="button" :disabled="!parsed || loading || importing || isEmptyNovel(parsed) || (!selectedIndexes.length && !includeIntro)" class="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-40" @click="confirmImport">{{ importing ? t('novel.importing') : t('novel.importSelected') }}</button></div>
        </footer>
      </div>
    </div>

    <div v-if="workspace.novelEditorId.value" class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/55 p-2 sm:p-5">
      <div role="dialog" aria-modal="true" :aria-label="t('novel.editChapter')" class="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header class="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 class="font-bold text-slate-900">{{ t('novel.editChapter') }} · {{ editorChapter?.name }}</h2><button type="button" class="rounded-lg border border-slate-300 px-3 py-1.5" @click="closeChapter">{{ t('novel.close') }}</button></header>
        <div class="min-h-0 overflow-auto bg-slate-50 p-4"><ScriptWorkspace embedded /></div>
      </div>
    </div>
  </section>
</template>
