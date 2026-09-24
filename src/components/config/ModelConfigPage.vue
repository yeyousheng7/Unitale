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
                <p>{{ $t("分别管理文本分析模型和语音合成服务，保存后可在脚本制作页选择。") }}</p>
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
        </div>
</template>
