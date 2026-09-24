<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
<aside class="script-inspector">
                <!-- 配音/生成/播放 -->
                <div class="inspector-panel voice-panel">
                    <h3>配音与播放</h3>
                    <label class="field-label" for="script-tts-config">TTS 服务</label>
                    <select id="script-tts-config" v-model="currentTtsConfigId"
                        class="voice-service-select"
                        title="选择用于生成的 TTS 服务">
                        <option value="" disabled>-- 选择 TTS 模型 --</option>
                        <option v-for="conf in ttsConfigs" :key="conf.id" :value="conf.id">
                            {{ conf.name }}
                        </option>
                    </select>

                    <div class="voice-actions">
                        <button @click="generateAllLines" :disabled="isSequencePlaying"
                            :class="['voice-generate-button', isGeneratingAll ? 'is-stopping' : '']">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg>
                            {{ isGeneratingAll ? '停止生成' : (selectedLineIndex !== -1 ? '从选中行开始生成' : '一键生成配音(跳过已生成)') }}
                        </button>
                        <div class="voice-secondary-actions">
                            <button v-if="!isSequencePlaying" @click="playScriptSequentially" class="secondary-action">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#play"></use></svg>
                                {{ selectedLineIndex !== -1 ? '从选中位置播放' : '顺序播放' }}
                            </button>
                            <button v-else @click="stopScriptSequentially" class="secondary-action is-danger">
                                <svg class="secondary-action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#square"></use></svg>停止播放
                            </button>
                            <button @click="clearAllGeneratedAudio" :disabled="isSequencePlaying || isGeneratingAll" class="secondary-action is-danger">清空配音</button>
                        </div>
                    </div>
                    <p class="voice-status" v-if="isGeneratingAll">正在生成当前脚本的配音…</p>
                </div>
                <!-- 角色音色设置 -->
                <div class="inspector-panel character-panel">
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
                                    class="character-delete" :aria-label="'删除角色' + char.name" title="删除角色">×</button>
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
                                        <span v-if="char.isAnalyzing" class="animate-spin">⏳</span>{{ char.isAnalyzing ? '停止分析' : 'AI分析音色' }}
                                    </button>
                                    <button @click="generateQwenVoice(char)"
                                        :class="['flex-1 px-2 py-1.5 border rounded text-[10px] font-bold transition-colors flex justify-center items-center gap-1', char.isGeneratingVoice ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' : 'bg-pink-50 text-pink-600 border-pink-100 hover:bg-pink-100']">
                                        <span v-if="char.isGeneratingVoice" class="animate-spin">⏳</span>{{ char.isGeneratingVoice ? '停止生成' : 'Qwen生成音色' }}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div v-if="characters.length === 0" class="text-center text-xs text-slate-400 py-4">暂无角色，请点击新增
                        </div>
                    </div>
                </div>
            </aside>
</template>
