<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
<header class="workspace-toolbar">
                    <div class="workspace-heading">
                        <h1>{{ activeTab === 'script' ? '创作台' : activeTab === 'config' ? '模型配置' : activeTab === 'timbres' ? '音色资源库' : activeTab === 'sfx' ? '音效与滤波器' : 'Prompt 管理' }}</h1>
                        <span v-if="activeTab === 'script'" class="current-script-label">当前脚本：{{ scriptList.find((s: any) => s.id === currentScriptId)?.name || '' }}</span>
                    </div>

                    <!-- 全局功能栏 (导出/导入) -->
                    <div class="toolbar-actions">
                <button @click="triggerImportTxt" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#upload"></use></svg>导入TXT
                </button>
                <button @click="triggerImport" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#upload"></use></svg>{{ isExportingProject ? '请等待...' : '导入完整工程' }}
                </button>
                <button @click="exportScriptState" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>{{ isExportingProject ? exportStatus : '导出完整工程' }}
                </button>
                <button @click="exportAudio" :disabled="isExportingAudio"
                    class="toolbar-button toolbar-button-primary">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>{{ isExportingAudio ? (exportStatus || '⏳ 处理中...') : '导出音频' }}
                </button>
                <details class="more-export">
                    <summary class="toolbar-button">更多导出<svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-down"></use></svg></summary>
                    <div class="more-export-panel">
                        <button @click="exportSRT" :disabled="isExportingAudio" class="toolbar-button">导出SRT字幕</button>
                        <div class="video-export-group">
                            <select v-model="videoResolution" aria-label="视频画面比例" class="toolbar-select">
                                <option value="1920x1080">横屏 16:9</option>
                                <option value="1080x1920">竖屏 9:16</option>
                                <option value="1280x960">横屏 4:3</option>
                                <option value="960x1280">竖屏 3:4</option>
                            </select>
                            <button @click="generateVideo" :disabled="isExportingAudio || isSequencePlaying || isGeneratingVideo" class="toolbar-button">
                                {{ isGeneratingVideo ? (exportStatus || '⏳ 生成视频...') : '生成视频' }}
                            </button>
                        </div>
                    </div>
                </details>
                <input type="file" ref="importFileRef" @change="handleImportFile" accept=".json" class="hidden">
                <input type="file" ref="importTxtRef" @change="handleImportTxt" accept=".txt" class="hidden">
                <input type="file" ref="bgImagePickerRef" @change="handleBgImageFileChange" accept="image/*" class="hidden">
                    </div>
                </header>
</template>
