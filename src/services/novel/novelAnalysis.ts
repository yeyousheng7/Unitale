import type { Character, ScriptDocument, ScriptLine } from '../../types/project'
import { requestService } from '../api/client'
import { matchLibraryId } from '../audio/libraryRefs'

type LibraryItem = { id: string; name: string; [key: string]: any }

export interface NovelAnalysisOptions {
  config: { baseUrl: string; model: string; key: string; params?: string }
  promptTemplate: string
  customPrompt: boolean
  bgImageCount: number
  emotions: LibraryItem[]
  sfx: LibraryItem[]
  bgm: LibraryItem[]
  filters: LibraryItem[]
  timbres: LibraryItem[]
  roleTimbreIds: Record<string, string>
  signal: AbortSignal
}

export function applyNovelRoleBindings(
  roles: ReadonlyArray<string>, existing: ReadonlyArray<Character>,
  roleTimbreIds: Record<string, string>, timbres: ReadonlyArray<LibraryItem>,
): Character[] {
  return [...new Set(roles.map(name => name.trim()).filter(Boolean))].map(name => {
    const local = existing.find(char => char.name.trim() === name)
    const timbre = timbres.find(item => item.id === roleTimbreIds[name])
    return {
      ...local, id: local?.id || crypto.randomUUID(), name,
      voiceFile: local?.voiceFile || timbre?.refPath || '',
      voiceAssetId: local?.voiceFile ? (local.voiceAssetId || '') : (timbre?.assetId || ''),
      volume: local?.volume ?? 1,
    }
  })
}

function buildPrompt(script: ScriptDocument, options: NovelAnalysisOptions): string {
  const enabledSfx = options.sfx.filter(item => item.enabled !== false)
  const enabledBgm = options.bgm.filter(item => item.enabled !== false)
  const enabledFilters = options.filters.filter(item => item.enabled !== false)
  const sections: Record<string, string> = {
    emotionList: options.emotions.filter(item => item.enabled !== false).map(item => item.name).join(', '),
    sfxSection: enabledSfx.length
      ? `# 音效库\n${enabledSfx.map(item => `- ${item.name}: ${item.description || ''}`).join('\n')}\n仅使用以上名称。`
      : '# 音效库\n当前音效库为空，不要输出 sfx。',
    bgmSection: enabledBgm.length
      ? `# 背景音乐库\n${enabledBgm.map(item => `- ${item.name}: ${item.description || ''}`).join('\n')}\n仅使用以上名称。`
      : '# 背景音乐库\n当前库为空，不要输出 BGM 播放块。',
    filterSection: enabledFilters.length
      ? `# 滤波器库\n${enabledFilters.map(item => `- ${item.name}: ${item.description || ''}`).join('\n')}\n仅使用以上名称。`
      : '# 滤波器库\n当前库为空，不要输出 filter。',
    bgmExampleLine: enabledBgm.length ? `{"type":"bgm","action":"play","name":"${enabledBgm[0]!.name}"},` : '',
    sfxExample: enabledSfx.length ? `, "sfx": [{"name":"${enabledSfx[0]!.name}","position":0.2}]` : '',
    bgImageCount: String(options.bgImageCount),
    rawScript: `章节标题：${script.name}\n${script.data.rawScript}`,
  }
  let prompt = options.promptTemplate.replace(/\$\{(emotionList|sfxSection|bgmSection|filterSection|bgmExampleLine|sfxExample|bgImageCount|rawScript)\}/g,
    (_match, key: string) => sections[key] || '')
  if (options.bgImageCount === 0) {
    prompt = prompt.replace(/\n\s*## 7\. 背景图片块 \(bgImage\)[\s\S]*?(?=\n\s*## 小说原文:)/, '')
    prompt += '\n\n本次背景图片数量为 0。不要输出任何 type 为 bgImage 的对象。'
  } else if (options.customPrompt) {
    prompt += `\n\n请在台词之间按剧情插入且仅插入 ${options.bgImageCount} 个 type 为 bgImage 的对象。`
  }
  return prompt
}

export async function analyzeNovelChapter(script: ScriptDocument, options: NovelAnalysisOptions): Promise<{
  rawAnalysisResult: string; scriptLines: ScriptLine[]; characters: Character[]
}> {
  if (!script.data.rawScript.trim()) throw new Error('Chapter has no body text')
  const cfg = options.config
  let url = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!url.endsWith('/chat/completions')) url += '/chat/completions'
  let body: Record<string, unknown> = {
    model: cfg.model, messages: [{ role: 'user', content: buildPrompt(script, options) }], stream: false,
  }
  if (cfg.params) {
    try { body = { ...body, ...JSON.parse(cfg.params) } } catch { /* keep configured defaults */ }
  }
  const response = await requestService(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body), signal: options.signal,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content || ''
  const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/)
  const json = match ? match[0] : content.replace(/```json/g, '').replace(/```/g, '').trim()
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('Analysis response is not a JSON array')
  const items = options.bgImageCount === 0 ? parsed.filter(item => item?.type !== 'bgImage') : parsed
  if (!items.length) throw new Error('Analysis returned no content blocks')
  const roles = items.filter(item => item?.type === 'dialogue' || !item?.type)
    .map(item => String(item.role_name || item.role || '旁白'))
  const characters = applyNovelRoleBindings(roles, script.data.characters, options.roleTimbreIds, options.timbres)
  const scriptLines: ScriptLine[] = items.map(item => ({
    id: crypto.randomUUID(), type: item.type || 'dialogue',
    role: item.role_name || item.role || '旁白', text: item.text_content || item.text || item.content || '',
    emotion: item.emotion || '平静', intensity: item.intensity || '中等',
    filterId: matchLibraryId(item.filter, options.filters),
    sfx: Array.isArray(item.sfx) ? item.sfx.map((entry: any) => ({
      sfxId: matchLibraryId(entry.name, options.sfx), position: entry.position,
    })).filter((entry: any) => entry.sfxId) : [],
    break_duration: typeof item.break_duration === 'number' ? item.break_duration : 0,
    trimStart: 0, trimEnd: 1, sfxVolume: 1, dialogueVolume: 1, speed: 1, audioUrl: '',
    action: item.action || 'play', volume: 1,
    bgmId: item.type === 'bgm' && item.action === 'play'
      ? matchLibraryId(item.name || item.bgmName, options.bgm) : '',
    bgImagePrompt: item.image_prompt || item.bgImagePrompt || item.imagePrompt || item.prompt || '',
    imageUrl: '',
  }))
  return { rawAnalysisResult: content, scriptLines, characters }
}
