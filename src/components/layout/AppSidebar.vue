<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'

export default defineComponent({
  setup() {
    const { locale, setLocale, t } = useI18n()
    function toggleLanguage() {
      const next = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
      const target = new URL(next === 'en-US' ? 'index_en.html' : './', window.location.href)
      window.history.replaceState(window.history.state, '', target.pathname + window.location.search + window.location.hash)
      setLocale(next)
    }
    return { ...useWorkspace(), locale, t, toggleLanguage }
  },
})
</script>

<template>
<aside class="app-sidebar" :aria-label="t('nav.workspace')">
                <div class="sidebar-brand">
                    <span class="brand-mark" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><use href="../../../assets/icons/ui-icons.svg#book-open"></use></svg>
                    </span>
                    <div>
                        <div class="brand-title">Unitale AI</div>
                        <div class="brand-caption">{{ t('brand.caption') }}</div>
                    </div>
                </div>

                <nav class="sidebar-nav" :aria-label="t('nav.main')">
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">{{ t('nav.creation') }}</div>
                        <button @click="activeTab = 'script'"
                            :class="['nav-item', activeTab === 'script' ? 'is-active' : '']"
                            :aria-current="activeTab === 'script' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#file-text"></use></svg><span>{{ t('nav.script') }}</span>
                        </button>
                        <button @click="activeTab = 'novel'"
                            :class="['nav-item', activeTab === 'novel' ? 'is-active' : '']"
                            :aria-current="activeTab === 'novel' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#book-open"></use></svg><span>{{ t('nav.novel') }}</span>
                        </button>
                    </div>
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">{{ t('nav.library') }}</div>
                        <button @click="activeTab = 'timbres'"
                            :class="['nav-item', activeTab === 'timbres' ? 'is-active' : '']"
                            :aria-current="activeTab === 'timbres' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#audio-lines"></use></svg><span>{{ t('nav.timbres') }}</span>
                        </button>
                        <button @click="activeTab = 'sfx'"
                            :class="['nav-item', activeTab === 'sfx' ? 'is-active' : '']"
                            :aria-current="activeTab === 'sfx' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#sliders-horizontal"></use></svg><span>{{ t('nav.effects') }}</span>
                        </button>
                    </div>
                    <div class="sidebar-nav-group">
                        <div class="sidebar-nav-label">{{ t('nav.settings') }}</div>
                        <button @click="activeTab = 'config'"
                            :class="['nav-item', activeTab === 'config' ? 'is-active' : '']"
                            :aria-current="activeTab === 'config' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#settings"></use></svg><span>{{ t('nav.config') }}</span>
                        </button>
                        <button @click="activeTab = 'prompt'"
                            :class="['nav-item', activeTab === 'prompt' ? 'is-active' : '']"
                            :aria-current="activeTab === 'prompt' ? 'page' : undefined">
                            <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#message-square"></use></svg><span>{{ t('nav.prompt') }}</span>
                        </button>
                    </div>
                </nav>
                <button type="button" class="sidebar-language" @click="toggleLanguage"
                    :aria-label="locale === 'zh-CN' ? t('language.switchToEnglish') : t('language.switchToChinese')">
                    {{ locale === 'zh-CN' ? 'EN' : '中' }}
                </button>
                <div class="sidebar-version">v1.5</div>
            </aside>
</template>
