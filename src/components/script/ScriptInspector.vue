<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({
  props: { view: { type: String, required: true } },
  emits: ['edit-script', 'edit-line', 'edit-characters'],
  setup(_props, { emit }) {
    const workspace = useWorkspace()
    const dialogueRows = computed(() => workspace.scriptLines.value
      .map((line, index) => ({
        line,
        index,
        missingVoice: !workspace.characters.value.some(char => char.name === line.role && char.voiceFile),
      }))
      .filter(entry => entry.line.type === 'dialogue'))
    const pendingRows = computed(() => dialogueRows.value.filter(entry => !entry.line.audioUrl))
    const generatedCount = computed(() => dialogueRows.value.length - pendingRows.value.length)
    const missingVoiceCount = computed(() => pendingRows.value.filter(entry => entry.missingVoice).length)

    return {
      ...workspace,
      dialogueRows,
      pendingRows,
      generatedCount,
      missingVoiceCount,
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
                    <span>已有音频 <strong>{{ generatedCount }} / {{ dialogueRows.length }}</strong> 条</span>
                    <span>待生成 <strong>{{ pendingRows.length }}</strong> 条</span>
                    <span>待生成且角色未绑定音色 <strong>{{ missingVoiceCount }}</strong> 条</span>
                    <span v-if="isGeneratingAll" class="production-running">正在批量生成</span>
                </div>
                <!-- 配音/生成/播放 -->
                <div v-show="view === 'production'" class="inspector-panel voice-panel">
                    <h3>生成与试听</h3>
                    <div class="production-setup-row">
                        <div class="production-tts-field">
                            <label class="field-label" for="script-tts-config">TTS 服务</label>
                            <select id="script-tts-config" v-model="currentTtsConfigId"
                                class="voice-service-select"
                                title="选择用于生成的 TTS 服务">
                                <option value="" disabled>-- 选择 TTS 模型 --</option>
                                <option v-for="conf in ttsConfigs" :key="conf.id" :value="conf.id">
                                    {{ conf.name }}
                                </option>
                            </select>
                        </div>
                        <div class="production-scope-field">
                            <span class="field-label">生成与播放起点</span>
                            <div class="production-scope-value">
                                <span>{{ selectedLineIndex > 0 ? `第 ${Number(selectedLineIndex) + 1} 块` : '全篇' }}</span>
                                <button v-if="selectedLineIndex > 0" type="button" @click="selectedLineIndex = -1">改为全篇</button>
                                <button v-if="selectedLineIndex > 0" type="button" @click="openScript">返回台本调整</button>
                            </div>
                        </div>
                    </div>
                    <div class="voice-actions">
                        <button @click="generateAllLines" :disabled="isSequencePlaying"
                            :class="['voice-generate-button', isGeneratingAll ? 'is-stopping' : '']">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg>
                            {{ isGeneratingAll ? '停止生成' : (selectedLineIndex > 0 ? `从第 ${Number(selectedLineIndex) + 1} 块开始生成` : '一键生成配音') }}
                        </button>
                        <div class="voice-secondary-actions">
                            <button v-if="!isSequencePlaying" @click="playScriptSequentially" class="secondary-action">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#play"></use></svg>
                                {{ selectedLineIndex > 0 ? `从第 ${Number(selectedLineIndex) + 1} 块播放` : '顺序播放' }}
                            </button>
                            <button v-else @click="stopScriptSequentially" class="secondary-action is-danger">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#square"></use></svg>停止播放
                            </button>
                            <button @click="clearAllGeneratedAudio" :disabled="isSequencePlaying || isGeneratingAll" class="secondary-action is-danger">清空配音</button>
                        </div>
                    </div>
                    <p class="voice-status" v-if="isGeneratingAll">正在生成当前脚本的配音…</p>
                </div>
                <div v-show="view === 'production'" class="inspector-panel production-pending-panel">
                    <div class="production-panel-heading">
                        <div>
                            <h3>待处理台词</h3>
                        </div>
                        <span class="production-pending-count">{{ pendingRows.length }} 条</span>
                    </div>
                    <p v-if="dialogueRows.length === 0" class="production-empty">当前脚本没有台词。请先在原文分析或台本编辑中添加内容。</p>
                    <p v-else-if="pendingRows.length === 0" class="production-empty">所有台词都已有音频，请试听确认后再导出。</p>
                    <div v-else class="production-pending-list">
                        <div v-for="entry in pendingRows" :key="entry.line.id" class="production-pending-row">
                            <span class="production-pending-index">第 {{ entry.index + 1 }} 块</span>
                            <div class="production-pending-copy">
                                <strong>{{ entry.line.role || '未分配角色' }}</strong>
                                <span>{{ entry.line.text?.trim() || '（空台词）' }}</span>
                            </div>
                            <span :class="['production-pending-status', { 'is-missing-voice': entry.missingVoice }]">
                                {{ entry.line.isGenerating ? '生成中' : entry.missingVoice ? '角色未绑定音色' : '待生成' }}
                            </span>
                            <button type="button" class="production-edit-link"
                                @click="entry.missingVoice ? openCharacters() : openLine(entry.index)">
                                {{ entry.missingVoice ? '去绑定' : '去编辑' }}
                            </button>
                        </div>
                    </div>
                </div>
                <div v-show="view === 'production'" class="inspector-panel production-export-panel">
                    <h3>导出</h3>
                    <div class="production-export-actions">
                        <button @click="exportAudio" :disabled="isExportingAudio" class="toolbar-button">
                            <svg v-if="isExportingAudio" class="animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
                            <svg v-else aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>
                            {{ isExportingAudio ? (exportStatus || '处理中...') : '导出音频' }}
                        </button>
                        <button @click="exportSRT" :disabled="isExportingAudio" class="toolbar-button">导出 SRT 字幕</button>
                    </div>
                    <div class="production-video-actions">
                        <label for="production-video-resolution">视频画面比例</label>
                        <select id="production-video-resolution" v-model="videoResolution" class="toolbar-select">
                            <option value="1920x1080">横屏 16:9</option>
                            <option value="1080x1920">竖屏 9:16</option>
                            <option value="1280x960">横屏 4:3</option>
                            <option value="960x1280">竖屏 3:4</option>
                        </select>
                        <button @click="generateVideo" :disabled="isExportingAudio || isSequencePlaying || isGeneratingVideo" class="toolbar-button">
                            <svg v-if="isGeneratingVideo" class="animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
                            {{ isGeneratingVideo ? (exportStatus || '生成视频...') : '生成视频' }}
                        </button>
                    </div>
                    <p class="production-summary-note">“已有音频”仅表示音频文件存在。修改台词或音色后，请在台本中重新生成对应音频。</p>
                </div>
                <!-- 角色音色设置 -->
                <div v-show="view === 'characters'" class="inspector-panel character-panel">
                    <h3 class="inspector-heading">
                        角色与音色
                        <button @click="addCharacter"
                            class="inspector-add-button"><svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>新增</button>
                    </h3>
                    <div class="character-list" role="region" aria-label="角色音色与音量设置" tabindex="0">
                        <div v-for="char in characters" :key="char.id"
                            class="character-card">
                            <div class="flex justify-between items-center">
                                <input v-model="char.name"
                                    class="font-bold text-slate-800 w-2/3 bg-transparent border-b border-transparent focus:border-blue-500 outline-none px-1"
                                    placeholder="角色名">
                                <button @click="deleteCharacter(char.id)"
                                    class="character-delete" :aria-label="'删除角色' + char.name" title="删除角色"><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#x"></use></svg></button>
                            </div>

                            <div>
                                <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">音色选择</label>
                                <div class="flex gap-1">
                                    <select v-model="char.voiceFile"
                                        class="flex-1 px-2 py-1.5 border rounded-md text-xs bg-white outline-none focus:ring-1 focus:ring-blue-500">
                                        <option value="">-- 请选择音色 --</option>
                                        <option v-for="timbre in timbres" :key="timbre.id" :value="timbre.refPath">
                                            {{ timbre.name }}
                                        </option>
                                    </select>
                                    <button @click="playPreview(char.voiceFile)" :disabled="!char.voiceFile"
                                        class="character-preview"
                                        title="试听当前音色" :aria-label="'试听' + char.name + '的音色'">
                                        <svg v-if="previewPlayingFile === char.voiceFile" class="h-4 w-4 text-green-600"
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
                            </div>
                            <div class="mt-2 pt-2 border-t border-slate-100">
                                <div class="flex justify-between items-center mb-1">
                                    <span class="text-[10px] font-bold text-slate-500 uppercase">角色音量</span>
                                    <span class="text-[10px] text-slate-500 font-mono">{{ Math.round((char.volume ?? 1) * 100) }}%</span>
                                </div>
                                <input type="range" v-model.number="char.volume" min="0" max="2" step="0.05" class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 block">
                            </div>

                            <div class="mt-2 pt-2 border-t border-slate-100 space-y-2">
                                <textarea v-model="char.voiceDescription" rows="2"
                                    class="w-full px-2 py-1.5 text-[10px] border rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 outline-none resize-none text-slate-600"
                                    placeholder="音色描述 (例如: 甜美少女音)"></textarea>
                                <div class="flex gap-1">
                                    <button @click="analyzeCharacterVoice(char)"
                                        :class="['flex-1 px-2 py-1.5 border rounded text-[10px] font-bold transition-colors flex justify-center items-center gap-1', char.isAnalyzing ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100']">
                                        <svg v-if="char.isAnalyzing" class="ui-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>{{ char.isAnalyzing ? '停止分析' : 'AI分析音色' }}
                                    </button>
                                    <button @click="generateQwenVoice(char)"
                                        :class="['flex-1 px-2 py-1.5 border rounded text-[10px] font-bold transition-colors flex justify-center items-center gap-1', char.isGeneratingVoice ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100']">
                                        <svg v-if="char.isGeneratingVoice" class="ui-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>{{ char.isGeneratingVoice ? '停止生成' : 'Qwen生成音色' }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div v-if="characters.length === 0" class="text-center text-xs text-slate-400 py-4">暂无角色，请点击新增
                        </div>
                    </div>
                </div>
            </div>
</template>
