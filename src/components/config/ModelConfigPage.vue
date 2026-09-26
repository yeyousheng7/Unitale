<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
<div class="config-page">
            <div class="config-page-intro">
                <span class="config-eyebrow">{{ $t("工作区设置") }}</span>
                <h2>{{ $t("连接创作服务") }}</h2>
                <p>{{ $t("分别管理文本分析模型和语音合成服务，保存后可在制作页面顶部选择。") }}</p>
            </div>

            <section class="config-section" aria-labelledby="llm-config-title">
                <div class="config-section-header">
                    <span class="config-section-number">01</span>
                    <div>
                        <h3 id="llm-config-title">{{ $t("文本分析模型") }}</h3>
                        <p>{{ $t("OpenAI 兼容接口，用于原文分析与台词整理。") }}</p>
                    </div>
                </div>
                <div class="config-section-grid">
                    <div class="config-saved-panel">
                        <div class="config-panel-heading"><h4>{{ $t("已保存的模型") }}</h4><span>{{ llmConfigs.length }}</span></div>
                        <div class="config-list">
                            <div v-for="conf in llmConfigs" :key="conf.id" class="config-list-item">
                                <div class="config-list-item-main">
                                    <strong>{{ conf.name }}</strong>
                                    <span>{{ conf.model }}</span>
                                    <small>{{ conf.baseUrl }}</small>
                                </div>
                                <div class="config-item-actions">
                                    <button @click="editConfig(conf)">{{ $t("编辑") }}</button>
                                    <button @click="deleteConfig(conf.id)" class="is-danger">{{ $t("删除") }}</button>
                                </div>
                            </div>
                            <div v-if="llmConfigs.length === 0" class="config-empty">{{ $t("尚未添加文本分析模型") }}</div>
                        </div>
                    </div>

                    <div class="config-editor-panel">
                        <div class="config-panel-heading"><h4>{{ isEditing ? $t('编辑模型配置') : $t('添加模型配置') }}</h4></div>
                        <div class="config-fields config-fields-two">
                            <div class="config-field">
                                <label for="llm-config-name">{{ $t("配置名称") }}</label>
                                <input id="llm-config-name" v-model="form.name" class="config-input" :placeholder='$t("例如：Google Gemini")'>
                            </div>
                            <div class="config-field">
                                <label for="llm-config-model">{{ $t("模型名称") }}</label>
                                <input id="llm-config-model" v-model="form.model" class="config-input" placeholder="gemini-2.5-flash">
                            </div>
                            <div class="config-field config-field-full">
                                <label for="llm-config-url">Base URL</label>
                                <input id="llm-config-url" v-model="form.baseUrl" class="config-input" placeholder="https://generativelanguage.googleapis.com/v1beta/openai">
                            </div>
                            <div class="config-field config-field-full">
                                <label for="llm-config-key">API Key</label>
                                <input id="llm-config-key" v-model="form.key" type="password" class="config-input" placeholder="sk-...">
                            </div>
                            <div class="config-field config-field-full">
                                <label for="llm-config-params">{{ $t("额外参数") }} <span>{{ $t("JSON，可选") }}</span></label>
                                <input id="llm-config-params" v-model="form.params" class="config-input" :placeholder='$t("例如：{\"temperature\": 0.7, \"max_tokens\": 2000}")'>
                            </div>
                        </div>
                        <div class="config-form-actions">
                            <button type="button" @click.prevent="saveConfig" class="config-save-button">{{ $t("保存配置") }}</button>
                            <button type="button" v-if="isEditing" @click="resetForm" class="config-cancel-button">{{ $t("取消") }}</button>
                        </div>
                    </div>
                </div>
            </section>

            <section class="config-section" aria-labelledby="tts-config-title">
                <div class="config-section-header">
                    <span class="config-section-number">02</span>
                    <div>
                        <h3 id="tts-config-title">{{ $t("语音合成服务") }}</h3>
                        <p>{{ $t("配置 TTS 服务地址，用于生成角色台词音频。") }}</p>
                    </div>
                </div>
                <div class="config-section-grid">
                    <div class="config-saved-panel">
                        <div class="config-panel-heading"><h4>{{ $t("已保存的服务") }}</h4><span>{{ ttsConfigs.length }}</span></div>
                        <div class="config-list">
                            <div v-for="conf in ttsConfigs" :key="conf.id" class="config-list-item">
                                <div class="config-list-item-main">
                                    <strong>{{ conf.name }}</strong>
                                    <small>{{ conf.baseUrl }}</small>
                                </div>
                                <div class="config-item-actions">
                                    <button @click="editTtsConfig(conf)">{{ $t("编辑") }}</button>
                                    <button @click="deleteTtsConfig(conf.id)" class="is-danger">{{ $t("删除") }}</button>
                                </div>
                            </div>
                            <div v-if="ttsConfigs.length === 0" class="config-empty">{{ $t("尚未添加语音合成服务") }}</div>
                        </div>
                    </div>

                    <div class="config-editor-panel">
                        <div class="config-panel-heading"><h4>{{ isEditingTts ? $t('编辑服务配置') : $t('添加服务配置') }}</h4></div>
                        <div class="config-fields">
                            <div class="config-field">
                                <label for="tts-config-name">{{ $t("配置名称") }}</label>
                                <input id="tts-config-name" v-model="ttsForm.name" class="config-input" :placeholder='$t("例如：IndexTTS 2")'>
                            </div>
                            <div class="config-field">
                                <label for="tts-config-url">Base URL</label>
                                <input id="tts-config-url" v-model="ttsForm.baseUrl" class="config-input" placeholder="http://127.0.0.1:8300">
                            </div>
                        </div>
                        <div class="config-form-actions">
                            <button type="button" @click.prevent="saveTtsConfig" class="config-save-button">{{ $t("保存配置") }}</button>
                            <button type="button" v-if="isEditingTts" @click="resetTtsForm" class="config-cancel-button">{{ $t("取消") }}</button>
                        </div>
                    </div>
                </div>
            </section>
            <section class="config-section" aria-labelledby="storage-diagnostics-title">
                <div class="config-section-header">
                    <span class="config-section-number">03</span>
                    <div>
                        <h3 id="storage-diagnostics-title">{{ $t('storage.diagnostics') }}</h3>
                        <p>{{ $t('storage.diagnosticsHint') }}</p>
                    </div>
                </div>
                <div class="config-saved-panel p-5">
                    <div class="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                        <strong>{{ $t('storage.mode') }}：</strong>
                        <span>{{ storageBackend === 'directory' ? $t('storage.directory') : $t('storage.indexedDb') }}</span>
                        <span v-if="directoryName">{{ directoryName }}</span>
                    </div>
                    <p v-if="directoryError" class="mb-3 text-sm text-red-600" role="alert">{{ directoryError }}</p>
                    <p v-if="lastStorageError" class="mb-3 text-sm text-red-600" role="alert">{{ $t('storage.lastError') }}：{{ lastStorageError }}</p>
                    <div v-if="directoryModeAvailable" class="mb-3 flex flex-wrap gap-2">
                        <button v-if="storageBackend === 'indexeddb'" type="button" class="toolbar-button" @click="migrateToDirectory">{{ $t('storage.migrate') }}</button>
                        <button type="button" class="toolbar-button" @click="openDirectoryProject">{{ $t('storage.openDirectory') }}</button>
                    </div>
                    <p v-if="directoryModeAvailable" class="mb-4 text-sm text-slate-500">{{ $t('storage.directoryHint') }}</p>
                    <p v-else class="mb-4 text-sm text-slate-500">{{ $t('storage.directoryUnavailable') }}</p>
                    <button type="button" class="toolbar-button" @click="refreshStorageAudit">{{ $t('storage.refresh') }}</button>
                    <button type="button" class="toolbar-button ml-2" @click="clearLegacyDatabase">{{ $t('storage.legacyClear') }}</button>
                    <p v-if="storageAudit?.error" class="mt-3 text-sm text-red-600">{{ storageAudit.error }}</p>
                    <div v-else-if="storageAudit" class="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                        <span>{{ $t('storage.assets') }}：{{ storageAudit.assetCount }}</span>
                        <span>{{ $t('storage.assetBytes') }}：{{ (storageAudit.totalBytes / 1048576).toFixed(1) }} MiB</span>
                        <span>{{ $t('storage.orphans') }}：{{ storageAudit.orphanCount }}（{{ (storageAudit.orphanBytes / 1048576).toFixed(1) }} MiB）</span>
                        <span :class="storageAudit.missingCount ? 'text-red-600' : ''">{{ $t('storage.missing') }}：{{ storageAudit.missingCount }}</span>
                        <span>{{ $t('storage.decoded') }}：{{ (storageAudit.decodedBytes / 1048576).toFixed(1) }} MiB</span>
                        <span v-if="storageAudit.originUsage !== null">{{ $t('storage.originUsage') }}：{{ (storageAudit.originUsage / 1048576).toFixed(1) }} MiB</span>
                        <span v-if="storageAudit.originQuota !== null">{{ $t('storage.originQuota') }}：{{ (storageAudit.originQuota / 1048576).toFixed(1) }} MiB</span>
                    </div>
                </div>
            </section>
        </div>
</template>
