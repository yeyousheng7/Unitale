<script lang="ts">
import { defineComponent } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({ setup: useWorkspace })
</script>

<template>
    <div class="script-insert-actions" aria-label="插入内容块">
        <button @click="addDialogueBlock" type="button">
            <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入台词
        </button>
        <button @click="addBgmBlock" type="button">
            <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入BGM
        </button>
        <button @click="addBgImageBlock" type="button">
            <svg class="action-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>插入背景图片
        </button>
    </div>
</template>
