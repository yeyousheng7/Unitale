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
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">创作</div>
                        <button @click="activeTab = 'script'"
                            :class="['nav-item', activeTab === 'script' ? 'is-active' : '']"
                            :aria-current="activeTab === 'script' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#file-text"></use></svg><span>创作台</span>
                        </button>
                    </div>
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">资源库</div>
                        <button @click="activeTab = 'timbres'"
                            :class="['nav-item', activeTab === 'timbres' ? 'is-active' : '']"
                            :aria-current="activeTab === 'timbres' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg><span>音色</span>
                        </button>
                        <button @click="activeTab = 'sfx'"
                            :class="['nav-item', activeTab === 'sfx' ? 'is-active' : '']"
                            :aria-current="activeTab === 'sfx' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#sliders-horizontal"></use></svg><span>音效与滤波器</span>
                        </button>
                    </div>
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">设置</div>
                        <button @click="activeTab = 'config'"
                            :class="['nav-item', activeTab === 'config' ? 'is-active' : '']"
                            :aria-current="activeTab === 'config' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#settings"></use></svg><span>模型配置</span>
                        </button>
                        <button @click="activeTab = 'prompt'"
                            :class="['nav-item', activeTab === 'prompt' ? 'is-active' : '']"
                            :aria-current="activeTab === 'prompt' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#message-square"></use></svg><span>Prompt 模板</span>
                        </button>
                    </div>
                </nav>
                <div class="sidebar-version">v1.5</div>
            </aside>
</template>
