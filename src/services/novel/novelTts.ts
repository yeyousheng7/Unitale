import type { AssetStore } from '../storage/assetStore'
import { requestService } from '../api/client'
import type { Character, ScriptLine } from '../../types/project'

type Emotion = { name: string; vector?: number[] }
type Timbre = { refPath?: string; assetId?: string }

const intensity: Record<string, number> = { 微弱: 0.2, 稍弱: 0.35, 中等: 0.5, 较强: 0.75, 强烈: 1 }
const systemEmotions = new Set(['高兴', '生气', '伤心', '害怕', '厌恶', '低落', '惊喜', '平静'])

export function missingNovelVoices(lines: ReadonlyArray<ScriptLine>, characters: ReadonlyArray<Character>): string[] {
  return [...new Set(lines.filter(line => line.type === 'dialogue' && String(line.text || '').trim())
    .map(line => String(line.role || '')).filter(role => !characters.some(char => char.name === role && char.voiceFile)))]
}

/** Synthesizes one line using explicit chapter state; the caller owns the resulting Blob. */
export async function synthesizeNovelLine(options: {
  line: ScriptLine; characters: Character[]; emotions: Emotion[]; timbres: Timbre[]
  config: { baseUrl: string }; store: AssetStore; signal: AbortSignal
}): Promise<Blob> {
  const { line, characters, emotions, timbres, config, store, signal } = options
  const role = String(line.role || '')
  const voicePath = (value: unknown) => typeof value === 'string' ? value : ''
  const char = characters.find(item => item.name === role)
  if (!char?.voiceFile) throw new Error(`角色 ${line.role} 未绑定音色`)
  const emotionName = String(line.emotion || '')
  const scale = systemEmotions.has(emotionName) ? (intensity[String(line.intensity || '')] || 0.5) : 1
  const emotion = emotions.find(item => item.name === emotionName)
  const vector = emotion?.vector?.map(value => value * scale) || [0, 0, 0, 0, 0, 0, 0, 0]
  const selected = timbres.find(item => item.refPath === voicePath(char.voiceFile))
  if (selected) char.voiceAssetId = selected.assetId || ''
  let baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  if (baseUrl.endsWith('/v1')) baseUrl = baseUrl.slice(0, -3)
  if (typeof char.voiceAssetId === 'string' && char.voiceAssetId) {
    const voiceBlob = await store.get(char.voiceAssetId)
    if (voiceBlob) {
      const check = await requestService(`${baseUrl}/v1/check/audio?file_name=${encodeURIComponent(voicePath(char.voiceFile))}`, { signal })
      const exists = check.ok && (await check.json()).exists
      if (!exists) {
        const form = new FormData()
        form.append('audio', new File([voiceBlob], voicePath(char.voiceFile), { type: voiceBlob.type }), voicePath(char.voiceFile))
        form.append('full_path', voicePath(char.voiceFile))
        const upload = await requestService(`${baseUrl}/v1/upload_audio`, { method: 'POST', body: form, signal })
        if (!upload.ok) throw new Error(`音色上传失败: HTTP ${upload.status}`)
      }
    }
  }
  const response = await requestService(`${baseUrl}/v2/synthesize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ text: line.text, audio_path: char.voiceFile, emo_vector: vector }),
  })
  if (!response.ok) throw new Error(`语音合成失败: ${await response.text()}`)
  return response.blob()
}
