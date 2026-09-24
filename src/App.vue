<script lang="ts">
import { defineComponent, provide } from 'vue'
import { useUnitaleWorkspace } from './composables/useUnitaleWorkspace'
import { workspaceKey, type WorkspaceContext } from './context/workspace'
import AppSidebar from './components/layout/AppSidebar.vue'
import WorkspaceToolbar from './components/layout/WorkspaceToolbar.vue'
import ModelConfigPage from './components/config/ModelConfigPage.vue'
import ScriptWorkspace from './components/script/ScriptWorkspace.vue'

export default defineComponent({
  components: { AppSidebar, WorkspaceToolbar, ModelConfigPage, ScriptWorkspace },
  setup() {
    const workspace = useUnitaleWorkspace() as WorkspaceContext
    provide(workspaceKey, workspace)
    return workspace
  },
})
</script>

<template>
    <div class="unitale-app">
        <div v-if="previewImageUrl" @click="closeImagePreview"
            class="fixed inset-0 z-[10000] bg-slate-950/78 backdrop-blur-sm flex items-center justify-center p-4">
            <button @click.stop="closeImagePreview"
                class="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-white/15 text-white text-sm font-bold hover:bg-white/25 transition-all">
                {{ $t("关闭") }}
            </button>
            <img :src="previewImageUrl" :alt='$t("背景图片大图预览")' @click.stop
                class="max-w-[95vw] max-h-[92vh] object-contain rounded-xl shadow-2xl bg-white">
        </div>
        <div class="app-shell">
            <AppSidebar />

            <div class="app-main">
                <WorkspaceToolbar />
                <main class="workspace-content">

        <!-- 页面 1: 模型配置 (LLM & TTS) -->
        <ModelConfigPage v-if="activeTab === 'config'" />

        <!-- 页面 4: 音色资源库 -->
        <div v-if="activeTab === 'timbres'" class="space-y-8">
            <!-- 音色管理区域 -->
            <section class="space-y-6">
                <h2 class="text-lg font-bold text-slate-800 border-b pb-2">{{ $t("音色管理") }}</h2>
                <!-- 添加/编辑表单 -->
                <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 class="text-sm font-bold text-slate-700 mb-4">{{ isEditingTimbre ? $t('编辑音色') : $t('添加新音色') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音色名称") }}</label>
                            <input v-model="timbreForm.name"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 旁白 / 少年音")'>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音色描述 (用于 AI 自动匹配)") }}</label>
                            <input v-model="timbreForm.description"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 声音低沉，适合反派或中年男性")'>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("参考音频文件") }}</label>
                            <div class="flex gap-2 items-center">
                                <input type="file" ref="timbreFileRef" @change="handleTimbreFileUpload"
                                    accept=".wav,.mp3" class="hidden">
                                <button type="button" @click="($refs.timbreFileRef as HTMLInputElement).click()"
                                    class="whitespace-nowrap px-3 py-2 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg text-xs hover:bg-slate-200 transition-colors">{{ $t("选择文件") }}</button>
                                <input v-model="timbreForm.refPath"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    :placeholder='$t("选择一个音频文件作为音色参考")'>
                            </div>
                            <p class="text-[10px] text-slate-400 mt-1">{{ $t("提示：选择的音频文件将保存在本地，生成音频时会自动上传。") }}</p>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" @click.prevent="saveTimbre"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all">{{ $t("保存音色") }}</button>
                        <button type="button" v-if="isEditingTimbre" @click="resetTimbreForm"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("取消") }}</button>
                    </div>
                </div>

                <!-- 音色列表 -->
                <div class="grid gap-3">
                    <div v-for="timbre in timbres" :key="timbre.id"
                        class="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-lg">
                                {{ timbre.name.charAt(0) }}
                            </div>
                            <div>
                                <div class="font-bold text-slate-800 text-sm">{{ timbre.name }}</div>
                                <div v-if="timbre.description" class="text-xs text-slate-500 mt-0.5">{{
                                    timbre.description }}</div>
                                <div class="text-xs text-slate-400 mt-1">{{ timbre.refPath }}</div>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button @click="playPreview(timbre.refPath)"
                                class="text-xs text-slate-400 hover:text-green-600 mr-1" :title='$t("试听")'>
                                <svg v-if="previewPlayingFile === timbre.refPath" class="h-4 w-4 text-green-600"
                                    xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                                        clip-rule="evenodd" />
                                </svg>
                                <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                                        clip-rule="evenodd" />
                                </svg>
                            </button>
                            <button @click="editTimbre(timbre)"
                                class="text-xs text-blue-600 hover:underline font-medium">{{ $t("编辑") }}</button>
                            <button @click="deleteTimbre(timbre.id)"
                                class="text-xs text-red-500 hover:underline font-medium">{{ $t("删除") }}</button>
                        </div>
                    </div>
                    <div v-if="timbres.length === 0" class="text-center py-8 text-slate-400 text-sm">
                        {{ $t("暂无音色，请在上方添加") }}
                    </div>
                </div>
            </section>

            <!-- 情绪向量预设区域 -->
            <section class="space-y-6">
                <h2 class="text-lg font-bold text-slate-800 border-b pb-2">{{ $t("情绪描述预设") }}</h2>
                <!-- 添加/编辑情绪表单 -->
                <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 class="text-sm font-bold text-slate-700 mb-4">{{ isEditingEmotion ? $t('编辑情绪预设') : $t('添加新情绪预设') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("情绪名称") }}</label>
                            <input v-model="emotionForm.name"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 开心 / 愤怒")'>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-2">{{ $t("8维情感向量 (对应: 高兴, 生气, 伤心, 害怕, 厌恶, 低落, 惊喜, 平静)") }} <span
                                    class="text-slate-400 font-normal ml-2 normal-case">{{ $t("提示：所有值必须在 0.0 到 1.0 之间") }}</span></label>
                            <div class="grid grid-cols-4 md:grid-cols-8 gap-2">
                                <div v-for="(val, idx) in 8" :key="idx" class="flex flex-col items-center">
                                    <span class="text-[8px] text-slate-400 mb-1">{{
                                        [$t('高兴'),$t('生气'),$t('伤心'),$t('害怕'),$t('厌恶'),$t('低落'),$t('惊喜'),$t('平静')][idx] }}</span>
                                    <input type="number" step="0.1" min="0" max="1"
                                        v-model.number="emotionForm.vector[idx]"
                                        class="w-full px-1 py-1 border rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                        placeholder="0">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" @click.prevent="saveEmotion"
                            class="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-all">{{ $t("保存情绪") }}</button>
                        <button type="button" v-if="isEditingEmotion" @click="resetEmotionForm"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("取消") }}</button>
                    </div>
                </div>

                <!-- 情绪列表 -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div v-for="emo in emotionPresets.filter((e: any) => !isSystemEmotion(e.name))" :key="emo.id"
                        class="p-3 bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <input type="checkbox" v-model="emo.enabled"
                                class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                :title='$t("启用/禁用此情绪")'>
                            <div>
                                <div class="font-bold text-slate-800 text-sm">{{ emo.name }}</div>
                                <div class="text-[8px] text-slate-400 mt-1 font-mono tracking-tighter"
                                    v-if="emo.vector">[{{ emo.vector.join(',') }}]</div>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button @click="editEmotion(emo)" class="text-xs text-blue-600 hover:underline">{{ $t("编辑") }}</button>
                            <button @click="deleteEmotion(emo.id)"
                                class="text-xs text-red-500 hover:underline">{{ $t("删除") }}</button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <!-- 页面 6: 音效素材库 -->
        <div v-if="activeTab === 'sfx'" class="space-y-8">
            <section class="space-y-6">
                <h2 class="text-lg font-bold text-slate-800 border-b pb-2">{{ $t("音效素材管理") }}</h2>
                <p>{{ $t("音效和背景音乐可以自行使用其他的AI模型生成，或者前往在线免费音效网站下载：") }}<a style="color: blue;" href="https://pixabay.com/zh/sound-effects">{{ $t("Pixabay在线音效库") }}</a></p>
                <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 class="text-sm font-bold text-slate-700 mb-4">{{ isEditingSfx ? $t('编辑音效') : $t('添加新音效') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音效名称") }}</label>
                            <input v-model="sfxForm.name"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 开门声 / 雷声")'>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音效描述 (用于 AI 判断插入)") }}</label>
                            <input v-model="sfxForm.description"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 沉重的木门被用力关上")'>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音频文件名 / 路径") }}</label>
                            <div class="flex gap-2 items-center">
                                <input type="file" ref="sfxFileRef" @change="handleSfxFileUpload" accept=".wav,.mp3"
                                    class="hidden">
                                <button type="button" @click="($refs.sfxFileRef as HTMLInputElement).click()"
                                    class="whitespace-nowrap px-3 py-2 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg text-xs hover:bg-slate-200 transition-colors">{{ $t("选择文件") }}</button>
                                <input v-model="sfxForm.filename"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    :placeholder='$t("例如: door_slam.wav")'>
                            </div>
                            <p class="text-[10px] text-slate-400 mt-1"></p>
                        </div>
                        <div class="md:col-span-2 border-t border-slate-200 pt-4 mt-2">
                            <div class="flex items-center gap-4 mb-4">
                                <span class="text-[10px] font-bold text-slate-500 uppercase w-16">{{ $t("默认音量") }}</span>
                                <input type="range" v-model.number="sfxForm.volume" min="0" max="2" step="0.05" class="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600">
                                <span class="text-xs text-slate-500 font-mono w-10 text-right">{{ Math.round((sfxForm.volume ?? 1) * 100) }}%</span>
                                <button type="button" @click="playPreview(sfxForm)" :disabled="!sfxForm.filename" class="text-xs text-slate-400 hover:text-green-600 ml-2 disabled:opacity-30 disabled:cursor-not-allowed" :title='$t("试听")'>
                                    <svg v-if="previewPlayingFile === sfxForm.filename" class="h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                    </svg>
                                    <svg v-else class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                            </div>

                            <div v-if="sfxForm.filename">
                                <div class="flex justify-between items-center px-0.5 mb-1">
                                    <span class="text-[10px] font-bold text-slate-500 uppercase">{{ $t("音频剪辑 (预览)") }}</span>
                                    <span class="text-[10px] text-slate-400 font-mono">{{ Math.round(((sfxForm.trimEnd ?? 1) - (sfxForm.trimStart ?? 0)) * 100) }}%</span>
                                </div>
                                <div :key="sfxForm.filename" class="relative w-full bg-slate-100 rounded border border-slate-200 overflow-hidden select-none group/wave" style="height: 40px;">
                                    <canvas :ref="(el) => drawWaveform(el, sfxForm)" width="300" height="40" class="w-full h-full block opacity-60"></canvas>
                                    <div class="absolute inset-0 pointer-events-none">
                                        <div class="absolute top-0 bottom-0 left-0 bg-slate-500/30 border-r border-blue-500" :style="{ width: (sfxForm.trimStart ?? 0) * 100 + '%' }"></div>
                                        <div class="absolute top-0 bottom-0 right-0 bg-slate-500/30 border-l border-red-500" :style="{ width: (1 - (sfxForm.trimEnd ?? 1)) * 100 + '%' }"></div>
                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-blue-500/10 transition-colors flex justify-center group/handle" :style="{ left: (sfxForm.trimStart ?? 0) * 100 + '%' }" @mousedown.stop="startDragTrim($event, sfxForm, 'start')">
                                            <div class="w-0.5 h-full bg-blue-500 group-hover/handle:w-1 transition-all"></div>
                                        </div>
                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-red-500/10 transition-colors flex justify-center group/handle" :style="{ left: (sfxForm.trimEnd ?? 1) * 100 + '%' }" @mousedown.stop="startDragTrim($event, sfxForm, 'end')">
                                            <div class="w-0.5 h-full bg-red-500 group-hover/handle:w-1 transition-all"></div>
                                        </div>
                                        <div v-if="previewPlayingFile === sfxForm.filename" class="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none shadow-[0_0_4px_rgba(34,197,94,0.8)]" :style="{ left: (playbackProgress * 100) + '%' }"></div>
                                    </div>
                                </div>
                                <div class="text-[10px] text-slate-400 mt-1 text-right">{{ $t("提示：拖动红蓝线条裁剪音频，点击保存后生效") }}</div>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" @click.prevent="saveSfx"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all">{{ $t("保存音效") }}</button>
                        <button type="button" v-if="isEditingSfx" @click="resetSfxForm"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("取消") }}</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
                    <div v-for="sfx in sfxLibrary" :key="sfx.id" class="bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow flex flex-col">
                        <div class="flex items-start justify-between p-4">
                            <div class="flex items-start gap-3">
                                <input type="checkbox" v-model="sfx.enabled" class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer mt-1 flex-shrink-0" :title='$t("启用/禁用此资源")'>
                                <div>
                                    <div class="font-bold text-slate-800 text-sm">{{ sfx.name }}</div>
                                    <div class="text-xs text-slate-500 mt-0.5">{{ sfx.description }}</div>
                                    <div class="text-xs text-slate-400 mt-1">{{ sfx.filename }}</div>
                                </div>
                            </div>
                            <div class="flex gap-2 flex-shrink-0 ml-2">
                                <button @click="playPreview(sfx)" class="text-xs text-slate-400 hover:text-green-600 mr-1" :title='$t("试听")'>
                                    <svg v-if="previewPlayingFile === sfx.filename" class="h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                    </svg>
                                    <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                                <button @click="editSfx(sfx)" class="text-xs text-blue-600 hover:underline font-medium">{{ $t("编辑") }}</button>
                                <button @click="deleteSfx(sfx.id)" class="text-xs text-red-500 hover:underline font-medium">{{ $t("删除") }}</button>
                            </div>
                        </div>
                    </div>
                    <div v-if="sfxLibrary.length === 0" class="col-span-full text-center py-8 text-slate-400 text-sm">{{ $t("暂无音效素材") }}</div>
                </div>
            </section>

            <section class="space-y-6 border-t border-slate-200 pt-6">
                <h2 class="text-lg font-bold text-slate-800 border-b pb-2">{{ $t("背景音乐管理 (BGM)") }}</h2>
                <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 class="text-sm font-bold text-slate-700 mb-4">{{ isEditingBgm ? $t('编辑 BGM') : $t('添加新 BGM') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("BGM 名称") }}</label>
                            <input v-model="bgmForm.name"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 悲伤钢琴 / 战斗激昂")'>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("BGM 描述 (用于 AI 判断)") }}</label>
                            <input v-model="bgmForm.description"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 适合悲伤场景的钢琴曲")'>
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("音频文件名 / 路径") }}</label>
                            <div class="flex gap-2 items-center">
                                <input type="file" ref="bgmFileRef" @change="handleBgmFileUpload" accept=".wav,.mp3"
                                    class="hidden">
                                <button type="button" @click="($refs.bgmFileRef as HTMLInputElement).click()"
                                    class="whitespace-nowrap px-3 py-2 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg text-xs hover:bg-slate-200 transition-colors">{{ $t("选择文件") }}</button>
                                <input v-model="bgmForm.filename"
                                    class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    :placeholder='$t("例如: sad_piano.mp3")'>
                            </div>
                            <p class="text-[10px] text-slate-400 mt-1"></p>
                        </div>
                        <div class="md:col-span-2 border-t border-slate-200 pt-4 mt-2">
                            <div class="flex items-center gap-4 mb-4">
                                <span class="text-[10px] font-bold text-slate-500 uppercase w-16">{{ $t("默认音量") }}</span>
                                <input type="range" v-model.number="bgmForm.volume" min="0" max="2" step="0.05" class="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600">
                                <span class="text-xs text-slate-500 font-mono w-10 text-right">{{ Math.round((bgmForm.volume ?? 1) * 100) }}%</span>
                                <button type="button" @click="playPreview(bgmForm)" :disabled="!bgmForm.filename" class="text-xs text-slate-400 hover:text-green-600 ml-2 disabled:opacity-30 disabled:cursor-not-allowed" :title='$t("试听")'>
                                    <svg v-if="previewPlayingFile === bgmForm.filename" class="h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                    </svg>
                                    <svg v-else class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                            </div>

                            <div v-if="bgmForm.filename">
                                <div class="flex justify-between items-center px-0.5 mb-1">
                                    <span class="text-[10px] font-bold text-slate-500 uppercase">{{ $t("音频剪辑 (预览)") }}</span>
                                    <span class="text-[10px] text-slate-400 font-mono">{{ Math.round(((bgmForm.trimEnd ?? 1) - (bgmForm.trimStart ?? 0)) * 100) }}%</span>
                                </div>
                                <div :key="bgmForm.filename" class="relative w-full bg-slate-100 rounded border border-slate-200 overflow-hidden select-none group/wave" style="height: 40px;">
                                    <canvas :ref="(el) => drawWaveform(el, bgmForm)" width="300" height="40" class="w-full h-full block opacity-60"></canvas>
                                    <div class="absolute inset-0 pointer-events-none">
                                        <div class="absolute top-0 bottom-0 left-0 bg-slate-500/30 border-r border-blue-500" :style="{ width: (bgmForm.trimStart ?? 0) * 100 + '%' }"></div>
                                        <div class="absolute top-0 bottom-0 right-0 bg-slate-500/30 border-l border-red-500" :style="{ width: (1 - (bgmForm.trimEnd ?? 1)) * 100 + '%' }"></div>
                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-blue-500/10 transition-colors flex justify-center group/handle" :style="{ left: (bgmForm.trimStart ?? 0) * 100 + '%' }" @mousedown.stop="startDragTrim($event, bgmForm, 'start')">
                                            <div class="w-0.5 h-full bg-blue-500 group-hover/handle:w-1 transition-all"></div>
                                        </div>
                                        <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-red-500/10 transition-colors flex justify-center group/handle" :style="{ left: (bgmForm.trimEnd ?? 1) * 100 + '%' }" @mousedown.stop="startDragTrim($event, bgmForm, 'end')">
                                            <div class="w-0.5 h-full bg-red-500 group-hover/handle:w-1 transition-all"></div>
                                        </div>
                                        <div v-if="previewPlayingFile === bgmForm.filename" class="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none shadow-[0_0_4px_rgba(34,197,94,0.8)]" :style="{ left: (playbackProgress * 100) + '%' }"></div>
                                    </div>
                                </div>
                                <div class="text-[10px] text-slate-400 mt-1 text-right">{{ $t("提示：拖动红蓝线条裁剪音频，点击保存后生效") }}</div>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" @click.prevent="saveBgm"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all">{{ $t("保存 BGM") }}</button>
                        <button type="button" v-if="isEditingBgm" @click="resetBgmForm"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("取消") }}</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
                    <div v-for="bgm in bgmLibrary" :key="bgm.id" class="bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow flex flex-col">
                        <div class="flex items-start justify-between p-4">
                            <div class="flex items-start gap-3">
                                <input type="checkbox" v-model="bgm.enabled" class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer mt-1 flex-shrink-0" :title='$t("启用/禁用此资源")'>
                                <div>
                                    <div class="font-bold text-slate-800 text-sm">{{ bgm.name }}</div>
                                    <div class="text-xs text-slate-500 mt-0.5">{{ bgm.description }}</div>
                                    <div class="text-xs text-slate-400 mt-1">{{ bgm.filename }}</div>
                                </div>
                            </div>
                            <div class="flex gap-2 flex-shrink-0 ml-2">
                                <button @click="playPreview(bgm)" class="text-xs text-slate-400 hover:text-green-600 mr-1" :title='$t("试听")'>
                                    <svg v-if="previewPlayingFile === bgm.filename" class="h-4 w-4 text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                    </svg>
                                    <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                                    </svg>
                                </button>
                                <button @click="editBgm(bgm)" class="text-xs text-blue-600 hover:underline font-medium">{{ $t("编辑") }}</button>
                                <button @click="deleteBgm(bgm.id)" class="text-xs text-red-500 hover:underline font-medium">{{ $t("删除") }}</button>
                            </div>
                        </div>
                    </div>
                    <div v-if="bgmLibrary.length === 0" class="col-span-full text-center py-8 text-slate-400 text-sm">{{ $t("暂无 BGM 素材") }}</div>
                </div>
            </section>

            <section class="space-y-6 border-t border-slate-200 pt-6">
                <h2 class="text-lg font-bold text-slate-800 border-b pb-2">{{ $t("音频滤波器管理") }}</h2>
                <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                    <h3 class="text-sm font-bold text-slate-700 mb-4">{{ isEditingFilter ? $t('编辑滤波器') : $t('添加新滤波器') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("滤波器名称") }}</label>
                            <input v-model="filterForm.name"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 电话音 / 水下")'>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("滤波器描述 (用于 AI 判断)") }}</label>
                            <input v-model="filterForm.description"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                :placeholder='$t("例如: 声音通过电话传输，频段变窄")'>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("滤波器类型") }}</label>
                            <select v-model="filterForm.type"
                                class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                                <option value="lowpass">{{ $t("低通 (Lowpass) - 适合水下/闷声") }}</option>
                                <option value="highpass">{{ $t("高通 (Highpass) - 适合收音机/尖锐") }}</option>
                                <option value="bandpass">{{ $t("带通 (Bandpass) - 适合电话/对讲机") }}</option>
                                <option value="distortion">{{ $t("失真 (Distortion) - 适合机器人/损坏设备") }}</option>
                            </select>
                        </div>
                        <div v-if="filterForm.type !== 'distortion'">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("频率 (Hz):") }} {{
                                filterForm.frequency }}</label>
                            <input type="range" v-model.number="filterForm.frequency" min="20" max="20000" step="10"
                                class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600">
                        </div>
                        <div v-if="filterForm.type !== 'distortion'">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("Q 值 (共振峰):") }} {{
                                filterForm.Q }}</label>
                            <input type="range" v-model.number="filterForm.Q" min="0.1" max="20" step="0.1"
                                class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600">
                        </div>
                        <div v-if="filterForm.type === 'distortion'">
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">{{ $t("失真度 (Amount):") }} {{
                                filterForm.gain }}</label>
                            <input type="range" v-model.number="filterForm.gain" min="0" max="1000" step="10"
                                class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-red-600">
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button type="button" @click.prevent="saveFilter"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all">{{ $t("保存滤波器") }}</button>
                        <button type="button" v-if="isEditingFilter" @click="resetFilterForm"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("取消") }}</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div v-for="filter in filterLibrary" :key="filter.id"
                        class="p-4 bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow flex justify-between items-center">
                        <div class="flex items-center gap-3">
                            <input type="checkbox" v-model="filter.enabled"
                                class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                :title='$t("启用/禁用此资源")'>
                            <div>
                                <div class="font-bold text-slate-800 text-sm">{{ $displayBuiltIn(filter.name) }}</div>
                                <div class="text-xs text-slate-500 mt-0.5">{{ $displayBuiltIn(filter.description) }}</div>
                                <div class="text-[10px] text-slate-400 mt-1 font-mono">{{ filter.type }} | {{
                                    filter.type === 'distortion' ? `Amt:${filter.gain}` : `Freq:${filter.frequency}Hz`
                                    }}</div>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            <button @click="editFilter(filter)"
                                class="text-xs text-blue-600 hover:underline font-medium">{{ $t("编辑") }}</button>
                            <button @click="deleteFilter(filter.id)"
                                class="text-xs text-red-500 hover:underline font-medium">{{ $t("删除") }}</button>
                        </div>
                    </div>
                    <div v-if="filterLibrary.length === 0"
                        class="col-span-full text-center py-8 text-slate-400 text-sm">{{ $t("暂无滤波器，请添加") }}</div>
                </div>
            </section>
        </div>

        <!-- 当前脚本的内容与制作工作区 -->
        <ScriptWorkspace v-if="activeTab === 'script'" />

        <!-- 页面 7: Prompt 管理 -->
        <div v-if="activeTab === 'prompt'" class="space-y-6">
            <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-bold text-slate-700">{{ $t("自定义 Prompt 模板") }}</h3>
                    <div class="space-x-2">
                        <button @click="savePrompt"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all">{{ $t("保存设置") }}</button>
                        <button @click="resetPrompt"
                            class="px-4 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all">{{ $t("恢复默认") }}</button>
                    </div>
                </div>

                <div class="mb-6 rounded-lg border border-slate-200 bg-white p-4">
                    <label for="generation-language" class="mb-2 block text-sm font-bold text-slate-700">{{ $t('generation.languageLabel') }}</label>
                    <select id="generation-language" v-model="generationLanguage"
                        class="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                        <option value="zh">{{ $t('generation.chinese') }}</option>
                        <option value="en">{{ $t('generation.english') }}</option>
                    </select>
                    <p class="mt-2 text-xs leading-5 text-slate-500">{{ $t('generation.languageHint') }}</p>
                </div>

                <h4 class="text-sm font-bold text-slate-600 mb-2">{{ $t("1. 剧本拆分与分析 Prompt") }}</h4>
                <div class="flex items-center gap-2 mb-4 bg-white p-3 rounded-lg border border-slate-200">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" v-model="useCustomPrompt" class="sr-only peer">
                        <div
                            class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600">
                        </div>
                        <span class="ml-3 text-sm font-bold text-slate-700">{{ $t("启用自定义 Prompt") }}</span>
                    </label>
                    <span class="text-xs text-slate-400 ml-2">{{ $t("(关闭时将使用系统内置的默认 Prompt)") }}</span>
                </div>

                <textarea v-model="customPromptTemplate" :disabled="!useCustomPrompt"
                    :class="['w-full h-[60vh] p-3 text-xs font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mb-3', !useCustomPrompt ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700']"
                    spellcheck="false"></textarea>
                <div class="mt-2 text-xs text-slate-500">
                    <span class="font-bold">{{ $t("可用变量:") }}</span> ${sfxSection}, ${bgmSection}, ${bgmExampleLine}, ${sfxExample},
                    ${rawScript}
                </div>

                <hr class="my-6 border-slate-200">

                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-sm font-bold text-slate-600">{{ $t("2. 角色音色分析 Prompt") }}</h4>
                    <div class="space-x-2">
                        <button @click="saveVoicePrompt"
                            class="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-200 transition-all">{{ $t("保存音色Prompt") }}</button>
                        <button @click="resetVoicePrompt"
                            class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all">{{ $t("恢复默认") }}</button>
                    </div>
                </div>
                <div class="flex items-center gap-2 mb-4 bg-white p-3 rounded-lg border border-slate-200">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" v-model="useCustomVoicePrompt" class="sr-only peer">
                        <div
                            class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600">
                        </div>
                        <span class="ml-3 text-sm font-bold text-slate-700">{{ $t("启用自定义音色分析 Prompt") }}</span>
                    </label>
                    <span class="text-xs text-slate-400 ml-2">{{ $t("(关闭时将使用系统内置的默认 Prompt)") }}</span>
                </div>
                <textarea v-model="customVoicePromptTemplate" :disabled="!useCustomVoicePrompt"
                    :class="['w-full h-48 p-3 text-xs font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mb-3', !useCustomVoicePrompt ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700']"
                    spellcheck="false"></textarea>
                <div class="mt-2 text-xs text-slate-500">
                    <span class="font-bold">{{ $t("可用变量:") }}</span> ${charName}, ${rawScript}
                </div>

                <hr class="my-6 border-slate-200">

                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-sm font-bold text-slate-600">{{ $t("3. Qwen 音色生成参考音频 文本模板") }}</h4>
                    <div class="space-x-2">
                        <button @click="saveQwenVoiceText"
                            class="px-3 py-1.5 bg-pink-100 text-pink-700 rounded-lg text-xs font-bold hover:bg-pink-200 transition-all">{{ $t("保存生成文本") }}</button>
                        <button @click="resetQwenVoiceText"
                            class="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all">{{ $t("恢复默认") }}</button>
                    </div>
                </div>
                <div class="flex items-center gap-2 mb-4 bg-white p-3 rounded-lg border border-slate-200">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" v-model="useCustomQwenVoiceText" class="sr-only peer">
                        <div
                            class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600">
                        </div>
                        <span class="ml-3 text-sm font-bold text-slate-700">{{ $t("启用自定义生成文本") }}</span>
                    </label>
                    <span class="text-xs text-slate-400 ml-2">{{ $t("(关闭时将使用系统内置的默认文本)") }}</span>
                </div>
                <textarea v-model="customQwenVoiceTextTemplate" :disabled="!useCustomQwenVoiceText"
                    :class="['w-full h-24 p-3 text-xs font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none mb-3', !useCustomQwenVoiceText ? 'bg-slate-100 text-slate-400' : 'bg-white text-slate-700']"
                    spellcheck="false"></textarea>
                <div class="mt-2 text-xs text-slate-500">
                    <span class="font-bold">{{ $t("可用变量:") }}</span> ${charName}
                </div>
            </div>
        </div>

        <p class="workspace-footer">
            {{ $t("基于") }} <a href="https://github.com/sdsds222/Unitale" target="_blank" rel="noopener noreferrer">sdsds222/Unitale</a> {{ $t("二次开发 ·") }} <a href="https://github.com/yeyousheng7/Unitale" target="_blank" rel="noopener noreferrer">{{ $t("当前项目仓库") }}</a>
        </p>

                </main>
            </div>
        </div>
    </div>
</template>
