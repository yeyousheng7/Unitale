<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'

export default defineComponent({
  setup() {
    const workspace = useWorkspace()
    const productionPage = computed(() => workspace.activeTab.value === 'script' || workspace.activeTab.value === 'novel')
    const modelSwitchBusy = computed(() => workspace.novelBatch.value.running || workspace.isAnalyzingScript.value ||
      workspace.isGeneratingAll.value || workspace.isExportingProject.value ||
      workspace.scriptLines.value.some(line => !!line.isGenerating) ||
      workspace.characters.value.some(character => !!character.isAnalyzing || !!character.isGeneratingVoice))
    return { ...workspace, productionPage, modelSwitchBusy, t: useI18n().t }
  },
})
</script>

<template>
<header class="workspace-toolbar">
                    <div class="workspace-heading">
                        <h1>{{ activeTab === 'script' ? t('page.script') : activeTab === 'novel' ? t('page.novel') : activeTab === 'config' ? t('page.config') : activeTab === 'timbres' ? t('page.timbres') : activeTab === 'sfx' ? t('page.effects') : t('page.prompt') }}</h1>
                    </div>

                    <div v-if="productionPage" class="toolbar-models" role="group" :aria-label="t('toolbar.currentModels')">
                        <label class="toolbar-model-field" for="toolbar-llm-model">
                            <span>{{ t('toolbar.analysisModel') }}</span>
                            <select id="toolbar-llm-model" v-model="currentConfigId" :disabled="modelSwitchBusy || !llmConfigs.length" :title="t('toolbar.analysisModel')">
                                <option value="" disabled>{{ llmConfigs.length ? t('toolbar.selectAnalysisModel') : t('toolbar.noAnalysisModel') }}</option>
                                <option v-for="config in llmConfigs" :key="config.id" :value="config.id">{{ config.name }}</option>
                            </select>
                        </label>
                        <label class="toolbar-model-field" for="toolbar-tts-model">
                            <span>{{ t('toolbar.voiceService') }}</span>
                            <select id="toolbar-tts-model" v-model="currentTtsConfigId" :disabled="modelSwitchBusy || !ttsConfigs.length" :title="t('toolbar.voiceService')">
                                <option value="" disabled>{{ ttsConfigs.length ? t('toolbar.selectVoiceService') : t('toolbar.noVoiceService') }}</option>
                                <option v-for="config in ttsConfigs" :key="config.id" :value="config.id">{{ config.name }}</option>
                            </select>
                        </label>
                        <button type="button" class="toolbar-model-settings" @click="navigateToTab('config')">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#settings"></use></svg>{{ t('toolbar.manageModels') }}
                        </button>
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
