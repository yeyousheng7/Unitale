<script lang="ts">
import { defineComponent, onBeforeUpdate } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({
  setup() {
    const workspace = useWorkspace()
    onBeforeUpdate(() => { workspace.lineRefs.value = [] })
    return workspace
  },
})
</script>

<template>
<div class="script-editor">

                <div class="script-source-panel">
                    <div class="flex justify-between items-center mb-4">
                        <h3>原文</h3>
                    </div>

                    <textarea v-model="rawScript"
                        class="script-source-textarea"
                        placeholder="请粘贴小说内容或剧本原文..."></textarea>
                    <div class="script-prep-grid">
                        <!-- AI 拆分/分析 -->
                        <div class="script-prep-panel analysis-panel">
                            <div class="script-prep-title">AI 深度分析</div>
                            <select v-model="currentConfigId"
                                class="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white w-full"
                                title="选择用于分析的 LLM 模型">
                                <option value="" disabled>-- 选择LLM模型 --</option>
                                <option v-for="conf in llmConfigs" :key="conf.id" :value="conf.id">
                                    {{ conf.name }}
                                </option>
                            </select>
                            <button @click="analyzeScript"
                                :class="['w-full px-3 py-2 text-white rounded-lg text-sm font-bold transition-all flex items-center justify-center', isAnalyzingScript ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50']">
                                <svg v-if="!isAnalyzingScript" class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg>
                                <span v-if="isAnalyzingScript" class="animate-spin mr-2">⏳</span>
                                {{ isAnalyzingScript ? '停止分析' : 'AI 深度分析' }}
                            </button>
                        </div>

                        <!-- 插入控制块 -->
                        <div class="script-prep-panel insert-panel">
                            <div class="script-prep-title">插入控制块</div>
                            <div class="flex flex-wrap gap-2">
                                <button @click="addDialogueBlock"
                                    class="px-2 py-2 bg-blue-100 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-200 transition-all">
                                    <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入台词
                                </button>
                                <button @click="addBgmBlock"
                                    class="px-2 py-2 bg-purple-100 text-purple-600 rounded-lg text-sm font-bold hover:bg-purple-200 transition-all">
                                    <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入BGM
                                </button>
                                <button @click="addBgImageBlock"
                                    class="px-2 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-200 transition-all">
                                    <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入背景图片
                                </button>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 px-2 py-2 bg-white border border-slate-200 rounded-lg">
                                <label class="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">背景图片数量</label>
                                <input type="number" v-model.number="bgImageCount" min="0" max="100"
                                    class="w-20 px-2 py-1 border rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                                    title="LLM 将严格插入的 bgImage 块数量" />
                                <span class="text-[10px] text-slate-400 whitespace-nowrap">张</span>
                                <span class="text-[10px] text-slate-400 ml-2">（若需关闭，可从Prompt管理中删除背景图片块相关提示词）</span>
                            </div>
                        </div>

                    </div>
                </div>

                <!-- 拆分结果列表 -->
                <div v-if="scriptLines.length > 0"
                    class="script-lines-panel"
                    :style="stageBgUrl ? {
                        backgroundImage: `linear-gradient(to bottom, rgba(255,255,255,0.76), rgba(255,255,255,0.58)), url(${stageBgUrl})`,
                        backgroundRepeat: 'no-repeat, no-repeat',
                        backgroundPosition: 'center center, center center',
                        backgroundSize: '100% 100%, contain'
                    } : {}">
                    <div class="script-lines-heading">
                        <h3>台词编辑</h3><span>{{ scriptLines.length }} 个内容块</span>
                    </div>
                    <div ref="scriptListContainer" class="script-line-list">
                        <div v-for="(line, index) in scriptLines" :key="line.id" @click="toggleLineSelection(index, $event)"
                            :ref="el => { if (el) lineRefs[index] = el }"
                            class="transition-all duration-200">

                            <!-- BGM 控制块 -->
                            <div v-if="line.type === 'bgm'"
                                :class="['script-line-card script-bgm-card flex flex-wrap items-center gap-3 p-3 rounded-lg border mb-2 transition-all', selectedLineIndex === index ? 'border-purple-500 bg-purple-50 shadow-md' : 'bg-purple-50/50 border-purple-200', currentSequenceIndex === index ? 'ring-2 ring-green-500' : '']">
                                <div
                                    class="flex flex-col items-center justify-center gap-1 w-8 flex-shrink-0 border-r border-purple-200 pr-2">
                                    <button @click.stop="moveLineUp(index)"
                                        class="text-purple-400 hover:text-purple-700 p-0.5 hover:bg-purple-100 rounded"
                                        title="上移">▲</button>
                                    <div class="text-xs font-bold text-purple-500 select-none">{{ Number(index) + 1 }}</div>
                                    <button @click.stop="moveLineDown(index)"
                                        class="text-purple-400 hover:text-purple-700 p-0.5 hover:bg-purple-100 rounded"
                                        title="下移">▼</button>
                                </div>
                                <div
                                    class="w-24 flex-shrink-0 font-bold text-xs text-purple-600 uppercase tracking-wider flex items-center justify-center border-r border-purple-200 pr-3">
                                    BGM 控制
                                </div>
                                <select v-model="line.action"
                                    class="w-24 px-2 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-purple-500 outline-none font-bold text-purple-700">
                                    <option value="play">▶ 播放</option>
                                    <option value="stop">停止</option>
                                </select>
                                <div class="flex-1 min-w-[220px] flex items-center gap-2">
                                    <select v-if="line.action === 'play'" v-model="line.bgmName"
                                        class="flex-1 px-2 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-purple-500 outline-none font-bold text-purple-700">
                                        <option value="" disabled>-- 选择背景音乐 --</option>
                                        <option v-for="s in bgmLibrary" :key="s.id" :value="s.name">{{ s.name }}</option>
                                    </select>
                                    <div v-else class="flex-1 text-xs text-slate-400 italic py-1.5 px-2">
                                        停止当前播放的所有背景音乐
                                    </div>
                                </div>
                                <div v-if="line.action === 'play'" class="w-28 flex-shrink-0 space-y-1">
                                    <div class="text-[10px] font-bold text-slate-400 uppercase text-center leading-tight">
                                        BGM音量
                                    </div>
                                    <input type="range" v-model="line.volume" min="0" max="2" step="0.05"
                                        class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600">
                                </div>
                                <button @click="removeScriptLine(index)"
                                    class="text-slate-300 hover:text-red-500 p-2">
                                    <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </button>
                            </div>

                            <!-- 背景图片块 -->
                            <div v-else-if="line.type === 'bgImage'"
                                :class="['script-line-card script-image-card flex flex-col gap-2 p-3 rounded-lg mb-2 transition-all group cursor-pointer border', selectedLineIndex === index ? 'bg-emerald-50 border-emerald-300 shadow-md' : 'bg-emerald-50/50 border-emerald-200', currentSequenceIndex === index ? 'ring-2 ring-green-500' : '']">
                                <div class="flex flex-wrap items-start gap-3">
                                    <div
                                        class="flex flex-col items-center justify-center gap-1 w-8 flex-shrink-0 border-r border-emerald-200 pr-2">
                                        <button @click.stop="moveLineUp(index)"
                                            class="text-emerald-400 hover:text-emerald-700 p-0.5 hover:bg-emerald-100 rounded"
                                            title="上移">▲</button>
                                        <div class="text-xs font-bold text-emerald-500 select-none">{{ Number(index) + 1 }}</div>
                                        <button @click.stop="moveLineDown(index)"
                                            class="text-emerald-400 hover:text-emerald-700 p-0.5 hover:bg-emerald-100 rounded"
                                            title="下移">▼</button>
                                    </div>

                                    <div class="flex-1 min-w-[260px]">
                                        <div class="flex items-center justify-between gap-2 mb-2">
                                            <div class="font-bold text-xs text-emerald-700 uppercase tracking-wider">
                                                背景图片块
                                            </div>
                                            <button @click="removeScriptLine(index)"
                                                class="text-slate-300 hover:text-red-500 p-2"
                                                title="删除"><svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                                <path fill-rule="evenodd"
                                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                                    clip-rule="evenodd" />
                                            </svg></button>
                                        </div>

                                        <div class="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
                                            <!-- 图片展示 -->
                                            <div class="space-y-2">
                                                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                    图片预览
                                                </div>
                                                <div class="w-full bg-white border border-emerald-200 rounded-lg overflow-hidden">
                                                    <img v-if="line.imageUrl"
                                                        :src="line.imageUrl"
                                                        @click.stop="openImagePreview(line.imageUrl)"
                                                        class="w-full h-[90px] object-cover bg-white cursor-zoom-in" />
                                                    <div v-else
                                                        class="w-full h-[90px] flex items-center justify-center bg-white/50 border-dashed text-[10px] text-emerald-600 border border-emerald-200">
                                                        未选择
                                                    </div>
                                                </div>
                                                <button @click.stop="openBgImagePicker(index)" type="button"
                                                    class="w-full px-2 py-1.5 bg-emerald-100 text-emerald-700 text-[11px] border border-emerald-200 rounded hover:bg-emerald-200 transition-all font-bold">
                                                    选择图片（保存）
                                                </button>
                                            </div>

                                            <!-- LLM 提示词展示 -->
                                            <div class="space-y-2 min-w-0">
                                                <div class="flex items-center justify-between gap-2">
                                                    <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                        LLM 图片提示词（中文）
                                                    </div>
                                                    <button @click.stop="copyBgImagePrompt(line)" type="button"
                                                        class="px-2 py-1 bg-white text-emerald-700 text-[11px] border border-emerald-200 rounded hover:bg-emerald-50 transition-all font-bold">
                                                        复制
                                                    </button>
                                                </div>
                                                <textarea v-model="line.bgImagePrompt"
                                                    rows="3"
                                                    class="w-full bg-white border border-emerald-200 rounded px-2 py-1.5 text-[11px] text-emerald-900 focus:ring-0 outline-none resize-none"
                                                    placeholder="由 AI 分析后生成的中文图片提示词"></textarea>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 台词块 -->
                            <div v-else
                                :class="['script-line-card script-dialogue-card flex flex-col gap-2 p-3 rounded-lg mb-2 transition-all group cursor-pointer border', selectedLineIndex === index ? 'bg-blue-50 border-blue-300 shadow-md' : 'bg-white border-slate-200 shadow-sm hover:bg-slate-50', currentSequenceIndex === index ? 'ring-2 ring-green-500' : '']">
                                <div class="flex flex-wrap items-stretch gap-3">
                                    <div
                                        class="flex flex-col items-center justify-center gap-1 w-8 flex-shrink-0 border-r border-slate-100 pr-2">
                                        <button @click.stop="moveLineUp(index)"
                                            class="text-slate-400 hover:text-blue-600 p-0.5 hover:bg-slate-100 rounded"
                                            title="上移">▲</button>
                                        <div class="text-xs font-bold text-slate-400 select-none">{{ Number(index) + 1 }}</div>
                                        <button @click.stop="moveLineDown(index)"
                                            class="text-slate-400 hover:text-blue-600 p-0.5 hover:bg-slate-100 rounded"
                                            title="下移">▼</button>
                                    </div>

                                    <!-- 角色选择 -->
                                    <div class="w-24 flex-shrink-0 flex flex-col justify-center gap-1">
                                        <select v-model="line.role"
                                            class="w-full px-2 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-blue-500 outline-none font-bold text-slate-700">
                                            <option v-for="roleName in availableRoles" :key="roleName"
                                                :value="roleName">{{ roleName }}</option>
                                        </select>
                                        <!-- 滤波器选择 -->
                                        <select v-model="line.filter"
                                            class="w-full px-2 py-1 text-[10px] border rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 outline-none text-slate-500"
                                            title="音频滤波器">
                                            <option value="">无滤波器</option>
                                            <option v-for="f in filterLibrary" :key="f.id" :value="f.name">{{ f.name }}
                                            </option>
                                        </select>
                                    </div>

                                    <!-- 情绪描述 -->
                                    <div class="w-36 flex-shrink-0 space-y-1 flex flex-col justify-center">
                                        <select v-model="line.emotion"
                                            class="w-full px-2 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-blue-500 outline-none text-slate-700 font-bold">
                                            <option value="" disabled>选择情绪</option>
                                            <option v-for="preset in emotionPresets" :key="preset.id"
                                                :value="preset.name">{{ preset.name }}</option>
                                        </select>
                                        <select v-model="line.intensity" v-if="isSystemEmotion(line.emotion)"
                                            class="w-full px-2 py-1 text-xs border rounded bg-slate-50 focus:ring-1 focus:ring-blue-500 outline-none text-slate-600">
                                            <option value="微弱">微弱 (0.2)</option>
                                            <option value="稍弱">稍弱 (0.35)</option>
                                            <option value="中等">中等 (0.5)</option>
                                            <option value="较强">较强 (0.75)</option>
                                            <option value="强烈">强烈 (1.0)</option>
                                        </select>
                                    </div>

                                    <!-- 停顿间隔 -->
                                    <div class="w-16 flex-shrink-0 space-y-1 flex flex-col justify-center">
                                        <div
                                            class="text-[10px] font-bold text-slate-400 uppercase text-center leading-tight">
                                            停顿(s)</div>
                                        <input type="number" v-model="line.break_duration" step="0.1" min="0"
                                            class="w-full px-1 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-blue-500 outline-none text-center font-mono text-slate-600"
                                            placeholder="0">
                                    </div>

                                    <span v-if="line.audioUrl" class="line-audio-status is-ready">已生成</span>
                                    <span v-else class="line-audio-status">待生成</span>

                                    <div class="flex-grow"></div>

                                    <!-- 右侧控制区 -->
                                    <div class="flex flex-col items-end gap-2">
                                        <div class="flex items-center gap-3">
                                            <!-- 音量控制 (加宽) -->
                                            <div v-if="line.audioUrl"
                                                class="w-48 flex-shrink-0 flex flex-col justify-center gap-2 px-2 border-r border-slate-200">
                                                <div class="w-full">
                                                    <div class="flex justify-between items-center mb-0.5">
                                                        <span
                                                            class="text-[8px] font-bold text-slate-400 uppercase">台词音量</span>
                                                        <span class="text-[8px] text-slate-400 font-mono">{{
                                                            Math.round((line.dialogueVolume ?? 1) * 100) }}%</span>
                                                    </div>
                                                    <input type="range" v-model.number="line.dialogueVolume" min="0" max="2"
                                                        step="0.05"
                                                        class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 block">
                                                </div>
                                                <div class="w-full">
                                                    <div class="flex justify-between items-center mb-0.5">
                                                        <span
                                                            class="text-[8px] font-bold text-slate-400 uppercase">音效音量</span>
                                                        <span class="text-[8px] text-slate-400 font-mono">{{
                                                            Math.round((line.sfxVolume || 0.5) * 100) }}%</span>
                                                    </div>
                                                    <input type="range" v-model="line.sfxVolume" min="0" max="2"
                                                        step="0.05"
                                                        class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 block">
                                                </div>
                                                <div class="w-full">
                                                    <div class="flex justify-between items-center mb-0.5">
                                                        <span class="text-[8px] font-bold text-slate-400 uppercase">语速</span>
                                                        <span class="text-[8px] text-slate-400 font-mono">{{ (line.speed || 1).toFixed(1) }}x</span>
                                                    </div>
                                                    <input type="range" v-model.number="line.speed" min="0.2" max="2" step="0.1"
                                                        class="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-green-600 block">
                                                </div>
                                            </div>

                                            <!-- 音频波形剪辑条 -->
                                            <div v-if="line.audioUrl" class="w-48 flex-shrink-0 flex flex-col gap-1">
                                                <div class="flex justify-between items-center px-0.5">
                                                    <span
                                                        class="text-[8px] font-bold text-slate-400 uppercase">音频剪辑</span>
                                                    <span class="text-[8px] text-slate-400 font-mono">{{
                                                        Math.round(((line.trimEnd||1) - (line.trimStart||0)) * 100)
                                                        }}%</span>
                                                </div>
                                                <div :key="line.audioUrl"
                                                    class="relative w-full bg-slate-100 rounded border border-slate-200 overflow-hidden select-none group/wave"
                                                    style="height: 32px;">
                                                    <canvas :ref="(el) => drawWaveform(el, line)" width="192"
                                                        height="32" class="w-full h-full block opacity-60"></canvas>

                                                    <!-- 遮罩层与手柄 -->
                                                    <div class="absolute inset-0 pointer-events-none">
                                                        <!-- 阴影遮罩 (被剪掉的部分) -->
                                                        <div class="absolute top-0 bottom-0 left-0 bg-slate-500/30 border-r border-blue-500"
                                                            :style="{ width: (line.trimStart || 0) * 100 + '%' }"></div>
                                                        <div class="absolute top-0 bottom-0 right-0 bg-slate-500/30 border-l border-red-500"
                                                            :style="{ width: (1 - (line.trimEnd || 1)) * 100 + '%' }">
                                                        </div>

                                                        <!-- 交互手柄 (扩大点击区域) -->
                                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-blue-500/10 transition-colors flex justify-center group/handle"
                                                            :style="{ left: (line.trimStart || 0) * 100 + '%' }"
                                                            @mousedown.stop="startDragTrim($event, line, 'start')">
                                                            <div
                                                                class="w-0.5 h-full bg-blue-500 group-hover/handle:w-1 transition-all">
                                                            </div>
                                                        </div>
                                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-red-500/10 transition-colors flex justify-center group/handle"
                                                            :style="{ left: (line.trimEnd || 1) * 100 + '%' }"
                                                            @mousedown.stop="startDragTrim($event, line, 'end')">
                                                            <div
                                                                class="w-0.5 h-full bg-red-500 group-hover/handle:w-1 transition-all">
                                                            </div>
                                                        </div>

                                                        <!-- 播放进度条 -->
                                                        <div v-if="isAuditioningId === line.id"
                                                            class="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none shadow-[0_0_4px_rgba(34,197,94,0.8)]"
                                                            :style="{ left: (playbackProgress * 100) + '%' }"></div>
                                                    </div>
                                                </div>
                                            </div>

                                            <!-- 按钮组 -->
                                            <div class="flex items-center gap-1">
                                                <button @click.stop="generateLineAudio(line)"
                                                    :title="line.isGenerating ? '停止生成' : '生成音频'"
                                                    :class="['p-2', line.isGenerating ? 'text-red-500 hover:text-red-700' : 'text-slate-400 hover:text-indigo-600 disabled:text-slate-300 disabled:cursor-wait']">
                                                    <svg v-if="line.isGenerating" class="animate-spin h-4 w-4"
                                                        xmlns="http://www.w3.org/2000/svg" fill="none"
                                                        viewBox="0 0 24 24">
                                                        <circle class="opacity-25" cx="12" cy="12" r="10"
                                                            stroke="currentColor" stroke-width="4"></circle>
                                                        <path class="opacity-75" fill="currentColor"
                                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                                        </path>
                                                    </svg>
                                                    <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 20 20" fill="currentColor">
                                                        <path fill-rule="evenodd"
                                                            d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                                                            clip-rule="evenodd" />
                                                    </svg>
                                                </button>
                                                <button v-if="line.audioUrl" @click.stop="playLineAudio(line)"
                                                    title="播放" class="text-slate-400 hover:text-green-600 p-2">
                                                    <svg v-if="isAuditioningId === line.id"
                                                        class="h-4 w-4 animate-pulse text-green-600"
                                                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
                                                        fill="currentColor">
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
                                                <button v-if="line.audioUrl" @click.stop="clearLineAudio(line)" title="清除音频"
                                                    class="text-slate-400 hover:text-red-600 p-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
                                                        viewBox="0 0 20 20" fill="currentColor">
                                                        <path fill-rule="evenodd"
                                                            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                                            clip-rule="evenodd" />
                                                    </svg>
                                                </button>
                                                <button @click="removeScriptLine(index)" title="删除"
                                                    class="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2">
                                                    <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 20 20" fill="currentColor">
                                                        <path fill-rule="evenodd"
                                                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                                            clip-rule="evenodd" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                            </div>

                                <!-- 音效管理条 -->
                                <div class="flex flex-wrap items-center gap-2 w-full">
                                    <div v-for="(sfx, sIdx) in line.sfx" :key="sIdx"
                                        class="flex items-center bg-blue-50 border border-blue-100 rounded px-2 py-1 text-xs">
                                        <span class="mr-1"></span>
                                        <select v-model="sfx.name"
                                            class="bg-transparent outline-none border-b border-transparent hover:border-blue-300 text-blue-700 font-medium max-w-[100px] cursor-pointer">
                                            <option v-for="libSfx in sfxLibrary" :key="libSfx.id" :value="libSfx.name">
                                                {{ libSfx.name }}</option>
                                        </select>
                                        <span class="mx-1 text-slate-400">@</span>
                                        <input type="number" v-model="sfx.position" step="0.1" min="0" max="1"
                                            class="w-10 bg-transparent text-center outline-none border-b border-transparent hover:border-blue-300"
                                            title="插入位置 (0.0 - 1.0)">
                                        <button @click="removeLineSfx(line, sIdx)"
                                            class="ml-2 text-slate-400 hover:text-red-500 font-bold">×</button>
                                    </div>
                                    <button @click="addLineSfx(line)"
                                        class="text-[10px] text-slate-400 hover:text-blue-600 border border-dashed border-slate-300 rounded px-2 py-1 hover:border-blue-400 transition-colors flex items-center gap-1">+
                                        音效</button>
                                </div>

                                <!-- 文本与音效区域 -->
                                <div class="w-full flex flex-col gap-2 min-w-0">
                                    <textarea v-model="line.text" rows="2"
                                        class="line-textarea w-full h-full bg-transparent border-none focus:ring-0 text-sm text-slate-700 resize-none leading-relaxed py-1.5"
                                        @input="autoResizeTextarea($event)"></textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 调试：显示原始 JSON -->
                <details v-if="rawAnalysisResult" class="analysis-debug">
                    <summary>AI 原始输出 <span>调试信息</span></summary>
                    <pre
                        class="bg-slate-800 text-slate-200 p-4 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-64">{{ rawAnalysisResult }}</pre>
                </details>
            </div>
</template>
