<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'

export default defineComponent({
  props: { view: { type: String, required: true } },
  emits: ['edit-script', 'edit-line', 'edit-characters'],
  setup(_props, { emit }) {
    const workspace = useWorkspace()
    const { t } = useI18n()
    const defaultVoiceError = ref('')
    const defaultVoiceErrorId = ref('')
    const novelChapter = computed(() => workspace.scriptList.value.find(script => script.id === workspace.novelEditorId.value))
    const libraryVoice = (char: { voiceFile?: string }) => workspace.timbres.value.find(item => item.refPath === char.voiceFile)
    const isBookDefault = (char: { name: string; voiceFile?: string }) => {
      const novel = workspace.novels.value.find(item => item.id === novelChapter.value?.novelId)
      const timbre = libraryVoice(char)
      return !!novel && !!timbre && novel.roleTimbreIds[char.name.trim()] === timbre.id
    }
    const setBookDefault = (char: { id: string }) => {
      defaultVoiceError.value = ''
      defaultVoiceErrorId.value = char.id
      try { workspace.setChapterVoiceAsNovelDefault(char.id) }
      catch { defaultVoiceError.value = t('novel.defaultVoiceFailed') }
    }
    const dialogueRows = computed(() => workspace.scriptLines.value
      .map((line, index) => ({
        line,
        index,
        missingVoice: !workspace.characters.value.some(char => char.name === line.role && (char.voiceAssetId || char.voiceFile)),
      }))
      .filter(entry => entry.line.type === 'dialogue'))
    const pendingRows = computed(() => dialogueRows.value.filter(entry => !entry.line.audioAssetId))
    const generatedCount = computed(() => dialogueRows.value.length - pendingRows.value.length)
    const missingVoiceCount = computed(() => pendingRows.value.filter(entry => entry.missingVoice).length)

    return {
      ...workspace,
      dialogueRows,
      pendingRows,
      generatedCount,
      missingVoiceCount,
      novelChapter, libraryVoice, isBookDefault, setBookDefault, defaultVoiceError, defaultVoiceErrorId,
      openScript: () => emit('edit-script'),
      openLine: (index: number) => emit('edit-line', index),
      openCharacters: () => emit('edit-characters'),
    }
  },
})
</script>

<template>
<div v-show="view === 'characters' || view === 'production'" :class="['script-inspector', { 'is-production': view === 'production' }]">
                <div v-show="view === 'production'" class="production-status-strip" aria-live="polite">
                    <span>{{ $t('已有音频') }} <strong>{{ generatedCount }} / {{ dialogueRows.length }}</strong> {{ $t('条') }}</span>
                    <span>{{ $t('待生成') }} <strong>{{ pendingRows.length }}</strong> {{ $t('条') }}</span>
                    <span>{{ $t('待生成且角色未绑定音色') }} <strong>{{ missingVoiceCount }}</strong> {{ $t('条') }}</span>
                    <span v-if="isGeneratingAll" class="production-running">{{ $t("正在批量生成") }}</span>
                </div>
                <!-- 配音/生成/播放 -->
                <div v-show="view === 'production'" class="inspector-panel voice-panel">
                    <h3>{{ $t("生成与试听") }}</h3>
                    <div class="production-setup-row">
                        <div class="production-tts-field">
                            <label class="field-label" for="script-tts-config">{{ $t("TTS 服务") }}</label>
                            <select id="script-tts-config" v-model="currentTtsConfigId"
                                class="voice-service-select"
                                :title='$t("选择用于生成的 TTS 服务")'>
                                <option value="" disabled>{{ $t("-- 选择 TTS 模型 --") }}</option>
                                <option v-for="conf in ttsConfigs" :key="conf.id" :value="conf.id">
                                    {{ conf.name }}
                                </option>
                            </select>
                        </div>
                        <div class="production-scope-field">
                            <span class="field-label">{{ $t("生成与播放起点") }}</span>
                            <div class="production-scope-value">
                                <span>{{ selectedLineIndex > 0 ? $t('第 {index} 块', { index: Number(selectedLineIndex) + 1 }) : $t('全篇') }}</span>
                                <button v-if="selectedLineIndex > 0" type="button" @click="selectedLineIndex = -1">{{ $t("改为全篇") }}</button>
                                <button v-if="selectedLineIndex > 0" type="button" @click="openScript">{{ $t("返回台本调整") }}</button>
                            </div>
                        </div>
                    </div>
                    <div class="voice-actions">
                        <button @click="generateAllLines" :disabled="isSequencePlaying"
                            :class="['voice-generate-button', isGeneratingAll ? 'is-stopping' : '']">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg>
                            {{ isGeneratingAll ? $t('停止生成') : (selectedLineIndex > 0 ? $t('从第 {index} 块开始生成', { index: Number(selectedLineIndex) + 1 }) : $t('一键生成配音')) }}
                        </button>
                        <div class="voice-secondary-actions">
                            <button v-if="!isSequencePlaying" @click="playScriptSequentially" class="secondary-action">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#play"></use></svg>
                                {{ selectedLineIndex > 0 ? $t('从第 {index} 块播放', { index: Number(selectedLineIndex) + 1 }) : $t('顺序播放') }}
                            </button>
                            <button v-else @click="stopScriptSequentially" class="secondary-action is-danger">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#square"></use></svg>{{ $t("停止播放") }}
                            </button>
                            <button @click="clearAllGeneratedAudio" :disabled="isSequencePlaying || isGeneratingAll" class="secondary-action is-danger">{{ $t("清空配音") }}</button>
                        </div>
                    </div>
                    <p class="voice-status" v-if="isGeneratingAll">{{ $t("正在生成当前脚本的配音…") }}</p>
                </div>
                <div v-show="view === 'production'" class="inspector-panel production-pending-panel">
                    <div class="production-panel-heading">
                        <div>
                            <h3>{{ $t("待处理台词") }}</h3>
                        </div>
                        <span class="production-pending-count">{{ $t('{count} 条', { count: pendingRows.length }) }}</span>
                    </div>
                    <p v-if="dialogueRows.length === 0" class="production-empty">{{ $t("当前脚本没有台词。请先在原文分析或台本编辑中添加内容。") }}</p>
                    <p v-else-if="pendingRows.length === 0" class="production-empty">{{ $t("所有台词都已有音频，请试听确认后再导出。") }}</p>
                    <div v-else class="production-pending-list">
                        <div v-for="entry in pendingRows" :key="entry.line.id" class="production-pending-row">
                            <span class="production-pending-index">{{ $t('第 {index} 块', { index: entry.index + 1 }) }}</span>
                            <div class="production-pending-copy">
                                <strong>{{ entry.line.role ? $displayBuiltIn(entry.line.role) : $t('未分配角色') }}</strong>
                                <span>{{ entry.line.text?.trim() || $t('（空台词）') }}</span>
                            </div>
                            <span :class="['production-pending-status', { 'is-missing-voice': entry.missingVoice }]">
                                {{ entry.line.isGenerating ? $t('生成中') : entry.missingVoice ? $t('角色未绑定音色') : $t('待生成') }}
                            </span>
                            <button type="button" class="production-edit-link"
                                @click="entry.missingVoice ? openCharacters() : openLine(entry.index)">
                                {{ entry.missingVoice ? $t('去绑定') : $t('去编辑') }}
                            </button>
                        </div>
                    </div>
                </div>
                <div v-show="view === 'production'" class="inspector-panel production-export-panel">
                    <h3>{{ $t("导出") }}</h3>
                    <div class="production-export-actions">
                        <button @click="exportAudio" :disabled="isExportingAudio" class="toolbar-button">
                            <svg v-if="isExportingAudio" class="animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
                            <svg v-else aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>
                            {{ isExportingAudio ? (exportStatus || $t('处理中...')) : $t('导出音频') }}
                        </button>
                        <button @click="exportSRT" :disabled="isExportingAudio" class="toolbar-button">{{ $t("导出 SRT 字幕") }}</button>
                    </div>
                    <div class="production-video-actions">
                        <label for="production-video-resolution">{{ $t("视频画面比例") }}</label>
                        <select id="production-video-resolution" v-model="videoResolution" class="toolbar-select">
                            <option value="1920x1080">{{ $t("横屏 16:9") }}</option>
                            <option value="1080x1920">{{ $t("竖屏 9:16") }}</option>
                            <option value="1280x960">{{ $t("横屏 4:3") }}</option>
                            <option value="960x1280">{{ $t("竖屏 3:4") }}</option>
                        </select>
                        <button @click="generateVideo" :disabled="isExportingAudio || isSequencePlaying || isGeneratingVideo" class="toolbar-button">
                            <svg v-if="isGeneratingVideo" class="animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
                            {{ isGeneratingVideo ? (exportStatus || $t('生成视频...')) : $t('生成视频') }}
                        </button>
                    </div>
                    <p class="production-summary-note">{{ $t("“已有音频”仅表示音频文件存在。修改台词或音色后，请在台本中重新生成对应音频。") }}</p>
                </div>
                <!-- 角色音色设置 -->
                <div v-show="view === 'characters'" class="inspector-panel character-panel">
                    <h3 class="inspector-heading">
                        {{ $t("角色与音色") }}
                        <button @click="addCharacter"
                            class="inspector-add-button"><svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>{{ $t("新增") }}</button>
                    </h3>
                    <div class="character-list" role="region" :aria-label='$t("角色音色与音量设置")' tabindex="0">
                        <div v-for="char in characters" :key="char.id"
                            class="character-card">
                            <div class="flex justify-between items-center">
                                <input v-model="char.name"
                                    class="font-bold text-slate-800 w-2/3 bg-transparent border-b border-transparent focus:border-blue-500 outline-none px-1"
                                    :placeholder='$t("角色名")'>
                                <button @click="deleteCharacter(char.id)"
                                    class="character-delete" :aria-label="$t('删除角色{name}', { name: char.name })" :title='$t("删除角色")'><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#x"></use></svg></button>
                            </div>

                            <div>
                                <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音色选择") }}</label>
                                <div class="flex gap-1">
                                    <select v-model="char.voiceFile" @change="bindCharacterTimbre(char)"
                                        class="flex-1 px-2 py-1.5 border rounded-md text-xs bg-white outline-none focus:ring-1 focus:ring-blue-500">
                                        <option value="">{{ $t("-- 请选择音色 --") }}</option>
                                        <option v-for="timbre in timbres" :key="timbre.id" :value="timbre.refPath">
                                            {{ timbre.name }}
                                        </option>
                                    </select>
                                    <button @click="playPreview({ assetId: char.voiceAssetId, filename: char.voiceFile })" :disabled="!char.voiceFile"
                                        class="character-preview"
                                        :title='$t("试听当前音色")' :aria-label="$t('试听{name}的音色', { name: char.name })">
                                        <svg v-if="previewPlayingFile === (char.voiceAssetId ? `asset:${char.voiceAssetId}` : char.voiceFile)" class="h-4 w-4 text-green-600"
                                            xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                                                clip-rule="evenodd" />
                                        </svg>
                                        <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                                                clip-rule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                                <div v-if="novelChapter?.novelId" class="mt-2 text-xs">
                                    <span v-if="isBookDefault(char)" class="text-green-700">{{ $t('novel.currentDefault') }}</span>
                                    <button v-else type="button" :disabled="!char.name?.trim() || !libraryVoice(char) || isGeneratingAll || isSequencePlaying" class="font-medium text-blue-700 disabled:text-slate-400" @click="setBookDefault(char)">{{ $t('novel.useAsDefault') }}</button>
                                    <p v-if="char.voiceFile && !libraryVoice(char)" class="mt-1 text-slate-500">{{ $t('novel.defaultRequiresLibraryVoice') }}</p>
                                    <p v-if="defaultVoiceError && defaultVoiceErrorId === char.id" role="alert" class="mt-1 text-red-700">{{ defaultVoiceError }}</p>
                                </div>
                            </div>
                            <div class="mt-2 pt-2 border-t border-slate-100">
                                <div class="flex justify-between items-center mb-1">
                                    <span class="text-[10px] font-bold text-slate-500 uppercase">{{ $t("角色音量") }}</span>
                                    <span class="text-[10px] text-slate-500 font-mono">{{ Math.round((char.volume ?? 1) * 100) }}%</span>
                                </div>
                                <input type="range" v-model.number="char.volume" min="0" max="2" step="0.05" class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 block">
                            </div>

                            <div class="mt-2 pt-2 border-t border-slate-100 space-y-2">
                                <textarea v-model="char.voiceDescription" rows="2"
                                    class="w-full px-2 py-1.5 text-[10px] border rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 outline-none resize-none text-slate-600"
                                    :placeholder='$t("音色描述 (例如: 甜美少女音)")'></textarea>
                                <div class="flex gap-1">
                                    <button @click="analyzeCharacterVoice(char)"
                                        :class="['flex-1 px-2 py-1.5 border rounded text-[10px] font-bold transition-colors flex justify-center items-center gap-1', char.isAnalyzing ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100']">
                                        <svg v-if="char.isAnalyzing" class="ui-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>{{ char.isAnalyzing ? $t('停止分析') : $t('AI分析音色') }}
                                    </button>
                                    <button @click="generateQwenVoice(char)"
                                        :class="['flex-1 px-2 py-1.5 border rounded text-[10px] font-bold transition-colors flex justify-center items-center gap-1', char.isGeneratingVoice ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100']">
                                        <svg v-if="char.isGeneratingVoice" class="ui-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>{{ char.isGeneratingVoice ? $t('停止生成') : $t('Qwen生成音色') }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div v-if="characters.length === 0" class="text-center text-xs text-slate-400 py-4">{{ $t("暂无角色，请点击新增") }}
                        </div>
                    </div>
                </div>
            </div>
</template>
