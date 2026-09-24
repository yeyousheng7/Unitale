<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
<header class="workspace-toolbar">
                    <div class="workspace-heading">
                        <h1>{{ activeTab === 'script' ? '创作台' : activeTab === 'config' ? '模型配置' : activeTab === 'timbres' ? '音色资源库' : activeTab === 'sfx' ? '音效与滤波器' : 'Prompt 模板' }}</h1>
                    </div>

                    <!-- 全局功能栏 (导出/导入) -->
                    <div class="toolbar-actions">
                <button @click="triggerImport" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#upload"></use></svg>{{ isExportingProject ? '请等待...' : '导入完整工程' }}
                </button>
                <button @click="exportScriptState" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>{{ isExportingProject ? exportStatus : '导出完整工程' }}
                </button>
                <input type="file" ref="importFileRef" @change="handleImportFile" accept=".json" class="hidden">
                <input type="file" ref="importTxtRef" @change="handleImportTxt" accept=".txt" class="hidden">
                <input type="file" ref="bgImagePickerRef" @change="handleBgImageFileChange" accept="image/*" class="hidden">
                    </div>
                </header>
</template>
