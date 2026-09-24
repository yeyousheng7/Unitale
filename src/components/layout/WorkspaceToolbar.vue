<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'

export default defineComponent({
  setup() {
    return { ...useWorkspace(), t: useI18n().t }
  },
})
</script>

<template>
<header class="workspace-toolbar">
                    <div class="workspace-heading">
                        <h1>{{ activeTab === 'script' ? t('page.script') : activeTab === 'config' ? t('page.config') : activeTab === 'timbres' ? t('page.timbres') : activeTab === 'sfx' ? t('page.effects') : t('page.prompt') }}</h1>
                    </div>

                    <!-- 全局功能栏 (导出/导入) -->
                    <div class="toolbar-actions">
                <button @click="triggerImport" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#upload"></use></svg>{{ isExportingProject ? t('toolbar.wait') : t('toolbar.importProject') }}
                </button>
                <button @click="exportScriptState" :disabled="isExportingProject"
                    class="toolbar-button">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#download"></use></svg>{{ isExportingProject ? exportStatus : t('toolbar.exportProject') }}
                </button>
                <button v-if="hasMoreArchiveParts" @click="downloadNextArchivePart" :disabled="isExportingProject"
                    class="toolbar-button">{{ t('storage.nextPart') }}</button>
                <input type="file" ref="importFileRef" @change="handleImportFile" accept=".zip,application/zip" multiple class="hidden">
                <input type="file" ref="importTxtRef" @change="handleImportTxt" accept=".txt" class="hidden">
                <input type="file" ref="bgImagePickerRef" @change="handleBgImageFileChange" accept="image/*" class="hidden">
                    </div>
                </header>
</template>
