<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '../../context/workspace'
import { useI18n } from '../../i18n'
import ScriptEditor from './ScriptEditor.vue'
import ScriptInspector from './ScriptInspector.vue'

type WorkspaceView = 'source' | 'script' | 'characters' | 'production'

const workspace = useWorkspace()
const { t } = useI18n()
const { scriptList, currentScriptId, editingScriptId, scriptNameInputRefs } = workspace
const activeView = ref<WorkspaceView>(workspace.scriptLines.value.length ? 'script' : 'source')
const scriptMenuRef = ref<HTMLDetailsElement | null>(null)
const openActionId = ref<string | null>(null)
const currentScriptName = computed(() => workspace.scriptList.value.find(
  script => script.id === workspace.currentScriptId.value,
)?.name || t('未命名脚本'))

function closeScriptMenu(restoreFocus = false) {
  if (!scriptMenuRef.value) return
  scriptMenuRef.value.open = false
  openActionId.value = null
  if (restoreFocus) scriptMenuRef.value.querySelector('summary')?.focus()
}

function selectScript(id: string) {
  workspace.switchScript(id)
  closeScriptMenu(true)
}

function createScript() {
  workspace.addScript()
  closeScriptMenu(true)
}

function renameScript(id: string) {
  openActionId.value = null
  workspace.startEditingScript(id)
}

function deleteScript(id: string) {
  openActionId.value = null
  workspace.deleteScriptTab(id)
}

function handleOutsidePointerDown(event: PointerEvent) {
  if (scriptMenuRef.value && !scriptMenuRef.value.contains(event.target as Node)) closeScriptMenu()
}

async function openLine(index: number) {
  workspace.selectedLineIndex.value = index
  activeView.value = 'script'
  await nextTick()
  const container = workspace.scriptListContainer.value as HTMLElement | null
  const row = (workspace.lineRefs.value[index] || container?.children[index]) as HTMLElement | undefined
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  row?.querySelector<HTMLTextAreaElement>('.dialogue-textarea')?.focus({ preventScroll: true })
}

onMounted(() => document.addEventListener('pointerdown', handleOutsidePointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutsidePointerDown))

watch(() => workspace.currentScriptId.value, () => {
  activeView.value = workspace.scriptLines.value.length ? 'script' : 'source'
}, { flush: 'post' })

watch(() => workspace.scriptLines.value.length, (length, previousLength) => {
  if (length > 0 && previousLength === 0 && activeView.value === 'source') activeView.value = 'script'
  if (length === 0 && activeView.value === 'script') activeView.value = 'source'
})
</script>

<template>
  <div class="script-page">
    <div class="script-workspace-header">
      <div class="script-workspace-identity">
        <div class="script-workspace-switch-row">
          <span class="script-workspace-eyebrow">{{ $t("当前脚本") }}</span>
          <details ref="scriptMenuRef" class="script-switcher" @keydown.esc.prevent.stop="closeScriptMenu(true)"
            @toggle="openActionId = null">
            <summary class="script-switcher-trigger" :aria-label='$t("选择当前脚本")'>
              <span>{{ currentScriptName }}</span>
              <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-down"></use></svg>
            </summary>
            <div class="script-switcher-menu">
              <div class="script-switcher-list" role="group" :aria-label='$t("脚本列表")'>
                <div v-for="script in scriptList" :key="script.id"
                  :class="['script-switcher-row', { 'is-active': currentScriptId === script.id }]">
                  <div class="script-switcher-row-main">
                    <button v-if="editingScriptId !== script.id" type="button" class="script-switcher-option"
                      :aria-current="currentScriptId === script.id ? 'true' : undefined"
                      @click="selectScript(script.id)">
                      <svg v-if="currentScriptId === script.id" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#check"></use></svg>
                      <span v-else class="script-switcher-check-space" aria-hidden="true"></span>
                      <span class="script-switcher-option-name">{{ script.name }}</span>
                    </button>
                    <input v-else v-model="script.name" class="script-switcher-input" :aria-label='$t("脚本名称")'
                      :ref="el => { if (el) scriptNameInputRefs[script.id] = el }"
                      @blur="workspace.stopEditingScript" @keyup.enter="workspace.stopEditingScript"
                      @keydown.esc.stop="workspace.stopEditingScript" />
                    <button type="button" class="script-switcher-more" :aria-label="$t('管理脚本：{name}', { name: script.name })"
                      :aria-expanded="openActionId === script.id" @click="openActionId = openActionId === script.id ? null : script.id">
                      <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#ellipsis"></use></svg>
                    </button>
                  </div>
                  <div v-if="openActionId === script.id" class="script-switcher-row-actions">
                    <button type="button" @click="renameScript(script.id)">{{ $t("重命名") }}</button>
                    <button type="button" class="is-danger" @click="deleteScript(script.id)">{{ $t("删除脚本") }}</button>
                  </div>
                </div>
              </div>
              <button type="button" class="script-switcher-create" @click="createScript">
                <svg aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>{{ $t("新建脚本") }}
              </button>
            </div>
          </details>
          <span class="script-workspace-count">{{ $t('{count} 个内容块', { count: workspace.scriptLines.value.length }) }}</span>
        </div>
        <p>{{ $t("从原文分析开始，绑定角色音色，编辑台本，再完成配音导出。") }}</p>
      </div>
    </div>

    <nav class="script-view-nav" :aria-label='$t("当前脚本工作区")'>
      <button type="button" :class="['script-view-link', { 'is-active': activeView === 'source' }]"
        :aria-current="activeView === 'source' ? 'page' : undefined" @click="activeView = 'source'">{{ $t("原文分析") }}</button>
      <button type="button" :class="['script-view-link', { 'is-active': activeView === 'characters' }]"
        :aria-current="activeView === 'characters' ? 'page' : undefined" @click="activeView = 'characters'">{{ $t("脚本角色") }}</button>
      <button type="button" :class="['script-view-link', { 'is-active': activeView === 'script' }]"
        :aria-current="activeView === 'script' ? 'page' : undefined" @click="activeView = 'script'">{{ $t("台本编辑") }}</button>
      <button type="button" :class="['script-view-link', { 'is-active': activeView === 'production' }]"
        :aria-current="activeView === 'production' ? 'page' : undefined" @click="activeView = 'production'">{{ $t("配音和导出") }}</button>
    </nav>

    <div class="script-workspace-content">
      <ScriptEditor :view="activeView" @analysis-complete="activeView = 'characters'" />
      <ScriptInspector :view="activeView" @edit-script="activeView = 'script'" @edit-line="openLine"
        @edit-characters="activeView = 'characters'" />
    </div>
  </div>
</template>
