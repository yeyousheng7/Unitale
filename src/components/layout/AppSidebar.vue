<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
<aside class="app-sidebar" aria-label="工作区导航">
                <div class="sidebar-brand">
                    <span class="brand-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><use href="../../../assets/icons/ui-icons.svg#book-open"></use></svg>
                    </span>
                    <div>
                        <div class="brand-title">Unitale AI</div>
                        <div class="brand-caption">有声书创作工作台</div>
                    </div>
                </div>

                <nav class="sidebar-nav" aria-label="主导航">
                <button @click="activeTab = 'config'"
                    :class="['nav-item', activeTab === 'config' ? 'is-active' : '']">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#settings"></use></svg><span>模型配置</span>
                </button>
                <button @click="activeTab = 'timbres'"
                    :class="['nav-item', activeTab === 'timbres' ? 'is-active' : '']">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg><span>音色资源库</span>
                </button>
                <button @click="activeTab = 'sfx'"
                    :class="['nav-item', activeTab === 'sfx' ? 'is-active' : '']">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#sliders-horizontal"></use></svg><span>音效与滤波器</span>
                </button>
                <button @click="activeTab = 'script'"
                    :class="['nav-item', activeTab === 'script' ? 'is-active' : '']">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#file-text"></use></svg><span>脚本制作</span>
                </button>
                <button @click="activeTab = 'prompt'"
                    :class="['nav-item', activeTab === 'prompt' ? 'is-active' : '']">
                    <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#message-square"></use></svg><span>Prompt 管理</span>
                </button>
                </nav>

                <div v-if="activeTab === 'script'" class="sidebar-scripts">
                    <div class="sidebar-section-title">脚本</div>
                    <div class="script-nav-list">
                        <div v-for="script in scriptList" :key="script.id"
                            @click="switchScript(script.id)"
                            @dblclick="startEditingScript(script.id)"
                            :class="['script-nav-item group', currentScriptId === script.id ? 'is-active' : '']">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#file-text"></use></svg>
                            <span v-if="editingScriptId !== script.id" class="script-nav-name">{{ script.name }}</span>
                            <input v-else v-model="script.name" @click.stop @blur="stopEditingScript" @keyup.enter="stopEditingScript" :ref="el => { if(el) scriptNameInputRefs[script.id] = el }" class="script-nav-input" />
                            <button @click.stop="deleteScriptTab(script.id)" class="script-nav-delete" :aria-label="'删除' + script.name" title="删除脚本">×</button>
                        </div>
                    </div>
                    <button @click="addScript" class="add-script-button"><svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>新增脚本</button>
                </div>
                <div class="sidebar-version">v1.5</div>
            </aside>
</template>
