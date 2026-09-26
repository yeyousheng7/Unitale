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

/** A transient summary for the selected chapters; nothing here is saved with the novel. */
export function selectedChapterProgress(scripts: ReadonlyArray<ScriptDocument>) {
  let unanalyzed = 0
  let emptyBody = 0
  let noDialogue = 0
  let missingAudio = 0
  let retainedAnalysisFailures = 0
  for (const script of scripts) {
    const hasScript = !!script.data.scriptLines?.length
    if (!hasScript) {
      if (script.data.rawScript?.trim()) unanalyzed++
      else emptyBody++
      continue
    }
    // A failed reanalysis leaves the previous usable script in place.
    if (script.data.analysisError) retainedAnalysisFailures++
    const progress = chapterProgress(script)
    if (!progress.total) noDialogue++
    missingAudio += progress.total - progress.generated
  }
  const stage = !scripts.length ? 'select' : unanalyzed ? 'analysis' : emptyBody ? 'review'
    : missingAudio ? 'tts' : noDialogue ? 'review' : 'export'
  return { stage, selected: scripts.length, unanalyzed, emptyBody, noDialogue, missingAudio, retainedAnalysisFailures } as const
}
