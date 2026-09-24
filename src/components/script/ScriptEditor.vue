<script lang="ts">
import { defineComponent, nextTick, onBeforeUpdate, ref, watch } from 'vue'
import { useWorkspace } from '../../context/workspace'
import ScriptInsertActions from './ScriptInsertActions.vue'
import ScriptDialogueCard from './ScriptDialogueCard.vue'

export default defineComponent({
  components: { ScriptInsertActions, ScriptDialogueCard },
  setup() {
    const workspace = useWorkspace()
    const sourceExpanded = ref(true)
    const scriptLinesPanelRef = ref<HTMLElement | null>(null)

    watch(() => workspace.scriptLines.value, (lines) => {
      sourceExpanded.value = lines.length === 0
    }, { immediate: true, flush: 'post' })

    const handleAnalyzeScript = async () => {
      const stopping = workspace.isAnalyzingScript.value
      if (!stopping && workspace.scriptLines.value.length > 0 &&
          !window.confirm('重新分析会覆盖当前台词编辑结果，确定继续吗？')) return

      const previousLines = workspace.scriptLines.value
      await workspace.analyzeScript()
      if (!stopping && workspace.scriptLines.value !== previousLines && workspace.scriptLines.value.length > 0) {
        await nextTick()
        scriptLinesPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    onBeforeUpdate(() => { workspace.lineRefs.value = [] })
    return { ...workspace, sourceExpanded, scriptLinesPanelRef, handleAnalyzeScript }
  },
})
</script>

<template>
<div class="script-editor">

                <div class="script-source-panel" :class="{ 'is-compact': scriptLines.length > 0 && !sourceExpanded }">
                    <div class="script-source-heading">
                        <div class="script-source-title">
                            <h3>原文</h3>
                            <span v-if="rawScript.trim()">{{ rawScript.trim().length }} 字</span>
                        </div>
                        <button v-if="scriptLines.length > 0" type="button"
                            class="script-source-toggle" :aria-expanded="sourceExpanded"
                            @click="sourceExpanded = !sourceExpanded">
                            {{ sourceExpanded ? '收起原文' : '展开编辑原文' }}
                        </button>
                    </div>

                    <textarea v-if="sourceExpanded || scriptLines.length === 0" v-model="rawScript"
                        class="script-source-textarea"
                        placeholder="请粘贴小说内容或剧本原文..."></textarea>
                    <p v-else class="script-source-excerpt">{{ rawScript.trim() || '暂无原文，可展开补充。' }}</p>

                    <div class="script-analysis-toolbar">
                        <div class="script-analysis-model">
                            <label for="script-analysis-model">分析模型</label>
                            <select id="script-analysis-model" v-model="currentConfigId"
                                title="选择用于分析的 LLM 模型">
                                <option value="" disabled>-- 选择LLM模型 --</option>
                                <option v-for="conf in llmConfigs" :key="conf.id" :value="conf.id">
                                    {{ conf.name }}
                                </option>
                            </select>
                        </div>
                        <label class="script-image-count-setting">
                            <span>背景图片</span>
                            <input type="number" v-model.number="bgImageCount" min="0" max="100"
                                title="下次 AI 分析时插入的背景图片块数量；0 表示不插入" />
                            <span>张</span>
                        </label>
                        <button @click="handleAnalyzeScript" type="button"
                            :class="['script-analyze-button', isAnalyzingScript ? 'is-stopping' : '']">
                            <svg v-if="!isAnalyzingScript" class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg>
                            <svg v-if="isAnalyzingScript" class="action-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
                            {{ isAnalyzingScript ? '停止分析' : (scriptLines.length ? '重新分析' : 'AI 深度分析') }}
                        </button>
                    </div>
                    <p v-if="bgImageCount === 0" class="script-analysis-hint">0 张时不自动插入背景图片块；已有图片块需手动删除。</p>
                    <div v-if="scriptLines.length === 0" class="script-manual-start">
                        <span>或从空白内容块开始</span>
                        <ScriptInsertActions />
                    </div>
                </div>

                <!-- 拆分结果列表 -->
                <div v-if="scriptLines.length > 0" ref="scriptLinesPanelRef"
                    class="script-lines-panel"
                    :style="stageBgUrl ? {
                        backgroundImage: `linear-gradient(to bottom, rgba(255,255,255,0.76), rgba(255,255,255,0.58)), url(${stageBgUrl})`,
                        backgroundRepeat: 'no-repeat, no-repeat',
                        backgroundPosition: 'center center, center center',
                        backgroundSize: '100% 100%, contain'
                    } : {}">
                    <div class="script-lines-heading">
                        <div class="script-lines-title"><h3>台词编辑</h3><span>{{ scriptLines.length }} 个内容块</span></div>
                        <ScriptInsertActions />
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
                                        title="上移" aria-label="上移"><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-up"></use></svg></button>
                                    <div class="text-xs font-bold text-purple-500 select-none">{{ Number(index) + 1 }}</div>
                                    <button @click.stop="moveLineDown(index)"
                                        class="text-purple-400 hover:text-purple-700 p-0.5 hover:bg-purple-100 rounded"
                                        title="下移" aria-label="下移"><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-down"></use></svg></button>
                                </div>
                                <div
                                    class="w-24 flex-shrink-0 font-bold text-xs text-purple-600 uppercase tracking-wider flex items-center justify-center border-r border-purple-200 pr-3">
                                    BGM 控制
                                </div>
                                <select v-model="line.action"
                                    class="w-24 px-2 py-1.5 text-xs border rounded bg-white focus:ring-1 focus:ring-purple-500 outline-none font-bold text-purple-700">
                                    <option value="play">播放</option>
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
                                            title="上移" aria-label="上移"><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-up"></use></svg></button>
                                        <div class="text-xs font-bold text-emerald-500 select-none">{{ Number(index) + 1 }}</div>
                                        <button @click.stop="moveLineDown(index)"
                                            class="text-emerald-400 hover:text-emerald-700 p-0.5 hover:bg-emerald-100 rounded"
                                            title="下移" aria-label="下移"><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-down"></use></svg></button>
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
                            <ScriptDialogueCard v-else :line="line" :index="index" />
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
