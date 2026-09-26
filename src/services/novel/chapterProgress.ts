import type { ScriptDocument } from '../../types/project'

export function chapterProgress(script: ScriptDocument) {
  const lines = script.data.scriptLines || []
  const dialogue = lines.filter(line => line.type === 'dialogue' && String(line.text || '').trim())
  const total = dialogue.length
  const generated = dialogue.filter(line => !!line.audioAssetId).length
  const failed = dialogue.filter(line => !!line.ttsError).length
  return {
    analysis: script.data.analysisError ? 'failed' : lines.length ? 'analyzed' : 'pending',
    audio: !total ? 'none' : generated === total ? 'complete' : generated ? 'partial' : 'pending',
    total, generated, failed,
  } as const
}
