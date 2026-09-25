<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { useWorkspace } from '../../context/workspace'

export default defineComponent({
  props: {
    line: { type: Object as PropType<any>, required: true },
    index: { type: Number, required: true },
  },
  setup: useWorkspace,
})
</script>

<template>
  <div :class="['script-line-card script-dialogue-card group cursor-pointer border',
    selectedLineIndex === index ? 'bg-blue-50 border-blue-300 shadow-md' : 'bg-white border-slate-200 shadow-sm hover:bg-slate-50',
    currentSequenceIndex === index ? 'ring-2 ring-green-500' : '']">
    <div class="dialogue-order-rail">
      <button @click.stop="moveLineUp(index)" class="dialogue-order-button" :title='$t("上移")' :aria-label='$t("上移")'>
        <svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-up"></use></svg>
      </button>
      <span>{{ index + 1 }}</span>
      <button @click.stop="moveLineDown(index)" class="dialogue-order-button" :title='$t("下移")' :aria-label='$t("下移")'>
        <svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#chevron-down"></use></svg>
      </button>
    </div>

    <div class="dialogue-main">
      <div class="dialogue-card-actions">
        <span v-if="line.audioAssetId" class="line-audio-status is-ready">{{ $t("已生成") }}</span>
        <span v-else class="line-audio-status">{{ $t("待生成") }}</span>
        <button @click.stop="generateLineAudio(line)" class="dialogue-icon-button"
          :class="line.isGenerating ? 'is-generating' : ''"
          :title="line.isGenerating ? $t('停止生成') : $t('生成音频')"
          :aria-label="line.isGenerating ? $t('停止生成音频') : $t('生成音频')">
          <svg v-if="line.isGenerating" class="ui-icon animate-spin" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#loader-circle"></use></svg>
          <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
          </svg>
        </button>
        <button @click="removeScriptLine(index)" class="dialogue-icon-button is-remove"
          :title='$t("删除台词")' :aria-label='$t("删除台词")'>
          <svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#x"></use></svg>
        </button>
      </div>

      <textarea v-model="line.text"
        :rows="Math.min(10, Math.max(2, Math.ceil((line.text || '').length / 42)))"
        class="line-textarea dialogue-textarea" :aria-label='$t("台词内容")'
        @input="autoResizeTextarea($event)"></textarea>

      <div class="dialogue-parameters">
        <label class="dialogue-field">
          <span>{{ $t("角色") }}</span>
          <select v-model="line.role">
            <option v-for="roleName in availableRoles" :key="roleName" :value="roleName">{{ $displayBuiltIn(roleName) }}</option>
          </select>
        </label>
        <label class="dialogue-field">
          <span>{{ $t("滤波器") }}</span>
          <select v-model="line.filterId">
            <option value="">{{ $t("无滤波器") }}</option>
            <option v-for="f in filterLibrary" :key="f.id" :value="f.id">{{ $displayBuiltIn(f.name) }}</option>
          </select>
        </label>
        <label class="dialogue-field">
          <span>{{ $t("情绪") }}</span>
          <select v-model="line.emotion">
            <option value="" disabled>{{ $t("选择情绪") }}</option>
            <option v-for="preset in emotionPresets" :key="preset.id" :value="preset.name">{{ $displayBuiltIn(preset.name) }}</option>
          </select>
        </label>
        <label v-if="isSystemEmotion(line.emotion)" class="dialogue-field">
          <span>{{ $t("情绪强度") }}</span>
          <select v-model="line.intensity">
            <option value="微弱">{{ $t("微弱 (0.2)") }}</option>
            <option value="稍弱">{{ $t("稍弱 (0.35)") }}</option>
            <option value="中等">{{ $t("中等 (0.5)") }}</option>
            <option value="较强">{{ $t("较强 (0.75)") }}</option>
            <option value="强烈">{{ $t("强烈 (1.0)") }}</option>
          </select>
        </label>
        <label class="dialogue-field is-pause">
          <span>{{ $t("停顿(s)") }}</span>
          <input type="number" v-model="line.break_duration" step="0.1" min="0" placeholder="0">
        </label>
        <div class="dialogue-sfx">
          <div v-for="(sfx, sIdx) in line.sfx" :key="sIdx" class="dialogue-sfx-chip">
            <select v-model="sfx.sfxId" :aria-label='$t("音效名称")'>
              <option v-for="libSfx in sfxLibrary" :key="libSfx.id" :value="libSfx.id">{{ libSfx.name }}</option>
            </select>
            <span aria-hidden="true">@</span>
            <input type="number" v-model="sfx.position" step="0.1" min="0" max="1"
              :title='$t("插入位置 (0.0 - 1.0)")' :aria-label='$t("音效插入位置")'>
            <button @click="removeLineSfx(line, sIdx)" class="dialogue-sfx-remove"
              :title='$t("移除音效")' :aria-label='$t("移除音效")'><svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#x"></use></svg></button>
          </div>
          <button @click="addLineSfx(line)" class="dialogue-add-sfx">
            <svg class="ui-icon" aria-hidden="true"><use href="../../../assets/icons/ui-icons.svg#plus"></use></svg>{{ $t("音效") }}
          </button>
        </div>
      </div>

      <div v-if="line.audioAssetId" class="dialogue-audio-panel">
        <div class="dialogue-range-grid">
          <label class="dialogue-range-field">
            <span><b>{{ $t("台词音量") }}</b><output>{{ Math.round((line.dialogueVolume ?? 1) * 100) }}%</output></span>
            <input type="range" v-model.number="line.dialogueVolume" min="0" max="2" step="0.05" class="accent-blue-600">
          </label>
          <label class="dialogue-range-field">
            <span><b>{{ $t("音效音量") }}</b><output>{{ Math.round((line.sfxVolume || 0.5) * 100) }}%</output></span>
            <input type="range" v-model="line.sfxVolume" min="0" max="2" step="0.05" class="accent-indigo-600">
          </label>
          <label class="dialogue-range-field">
            <span><b>{{ $t("语速") }}</b><output>{{ (line.speed || 1).toFixed(1) }}x</output></span>
            <input type="range" v-model.number="line.speed" min="0.2" max="2" step="0.1" class="accent-green-600">
          </label>
        </div>

        <div class="dialogue-waveform">
          <div class="dialogue-waveform-heading"><span>{{ $t("音频剪辑") }}</span><span>{{ Math.round(((line.trimEnd || 1) - (line.trimStart || 0)) * 100) }}%</span></div>
          <div :key="line.audioAssetId" class="dialogue-waveform-track select-none group/wave">
            <canvas :ref="(el) => drawWaveform(el, line)" width="192" height="32" class="w-full h-full block opacity-60"></canvas>
            <div class="absolute inset-0 pointer-events-none">
              <div class="absolute top-0 bottom-0 left-0 bg-slate-500/30 border-r border-blue-500"
                :style="{ width: (line.trimStart || 0) * 100 + '%' }"></div>
              <div class="absolute top-0 bottom-0 right-0 bg-slate-500/30 border-l border-red-500"
                :style="{ width: (1 - (line.trimEnd || 1)) * 100 + '%' }"></div>
              <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-blue-500/10 transition-colors flex justify-center group/handle"
                :style="{ left: (line.trimStart || 0) * 100 + '%' }" @mousedown.stop="startDragTrim($event, line, 'start')">
                <div class="w-0.5 h-full bg-blue-500 group-hover/handle:w-1 transition-all"></div>
              </div>
              <div class="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize pointer-events-auto hover:bg-red-500/10 transition-colors flex justify-center group/handle"
                :style="{ left: (line.trimEnd || 1) * 100 + '%' }" @mousedown.stop="startDragTrim($event, line, 'end')">
                <div class="w-0.5 h-full bg-red-500 group-hover/handle:w-1 transition-all"></div>
              </div>
              <div v-if="isAuditioningId === line.id" class="absolute top-0 bottom-0 w-0.5 bg-green-500 z-20 pointer-events-none shadow-[0_0_4px_rgba(34,197,94,0.8)]"
                :style="{ left: (playbackProgress * 100) + '%' }"></div>
            </div>
          </div>
        </div>

        <div class="dialogue-audio-actions">
          <button @click.stop="playLineAudio(line)" :title='$t("播放")' :aria-label='$t("播放音频")' class="dialogue-icon-button">
            <svg v-if="isAuditioningId === line.id" class="h-4 w-4 animate-pulse text-green-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <svg v-else class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
            </svg>
          </button>
          <button @click.stop="clearLineAudio(line)" :title='$t("清除音频")' :aria-label='$t("清除音频")' class="dialogue-icon-button is-remove">
            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
