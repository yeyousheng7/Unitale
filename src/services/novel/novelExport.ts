import { BlobWriter, TextReader, BlobReader, ZipWriter } from '@zip.js/zip.js'
import type { ScriptDocument, ScriptLine } from '../../types/project'
import type { AssetStore } from '../storage/assetStore'
import { DecodedAudioCache, audioBufferBytes } from '../audio/decodedCache'
import { getFileExtensionFromBlob, buildDialogueAudioFilter } from '../audio/processing'
import { ensureFFmpegLoaded, runFFmpegTask } from '../audio/legacyAdapters'
import { clipAudioEvent, totalTimelineDuration } from '../audio/timeline'
import { AUDIO_EXPORT_PART_SECONDS, frameRanges, makeWavHeader } from '../audio/wav'

type LibraryItem = { id: string; assetId?: string; trimStart?: number; trimEnd?: number; volume?: number;
  type?: BiquadFilterType | 'distortion'; frequency?: number; Q?: number; gain?: number }
type DialogueEvent = { line: ScriptLine; start: number; end: number }
type SfxEvent = { assetId: string; start: number; end: number; sourceOffset: number; volume: number }
type BgmEvent = { id: string; start: number; end: number; volume: number }
export type NovelExportLibraries = { sfx: LibraryItem[]; bgm: LibraryItem[]; filters: LibraryItem[] }

export function incompleteNovelChapters(scripts: ReadonlyArray<ScriptDocument>): string[] {
  return scripts.filter(script => {
    const lines = script.data.scriptLines
    return !lines.some(line => line.type === 'dialogue' && String(line.text || '').trim()) ||
      lines.some(line => line.type === 'dialogue' && String(line.text || '').trim() && !line.audioAssetId)
  }).map(script => script.name)
}

export function formatSrtTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export function novelSrt(events: ReadonlyArray<DialogueEvent>): string {
  return events.filter(event => String(event.line.text || '').trim()).map((event, index) =>
    `${index + 1}\n${formatSrtTime(event.start)} --> ${formatSrtTime(event.end)}\n${String(event.line.text).trim()}\n`).join('\n')
}

function wavBlob(buffer: AudioBuffer): Blob {
  const frames = buffer.length
  const header = makeWavHeader(frames, buffer.sampleRate, 2)
  const pcm = new Uint8Array(frames * 4)
  const view = new DataView(pcm.buffer)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]!))
    const r = Math.max(-1, Math.min(1, right[i]!))
    view.setInt16(i * 4, l < 0 ? l * 32768 : l * 32767, true)
    view.setInt16(i * 4 + 2, r < 0 ? r * 32768 : r * 32767, true)
  }
  return new Blob([header.slice().buffer as ArrayBuffer, pcm.buffer], { type: 'audio/wav' })
}

export async function exportNovelChaptersZip(options: {
  scripts: ScriptDocument[]; libraries: NovelExportLibraries; store: AssetStore; cache: DecodedAudioCache;
  decode: (blob: Blob) => Promise<AudioBuffer>; signal?: AbortSignal;
  onProgress?: (chapter: number, total: number) => void;
  writer?: WritableStream<Uint8Array>
}): Promise<Blob | void> {
  const { scripts, libraries, store, cache, decode, signal, onProgress } = options
  const incomplete = incompleteNovelChapters(scripts)
  if (incomplete.length) throw new Error(`未完成配音：${incomplete.slice(0, 12).join('、')}${incomplete.length > 12 ? ` 等 ${incomplete.length} 章` : ''}`)
  const abort = () => { if (signal?.aborted) throw new DOMException('Export stopped', 'AbortError') }
  const getSource = async (assetId: string): Promise<AudioBuffer> => {
    const key = `novel-export:source:${assetId}`
    const cached = cache.get<AudioBuffer>(key)
    if (cached) return cached
    const blob = await store.get(assetId)
    if (!blob) throw new Error(`Missing media asset ${assetId}`)
    abort()
    const buffer = await decode(blob)
    cache.set(key, buffer, audioBufferBytes(buffer))
    return buffer
  }
  const getDialogue = async (line: ScriptLine): Promise<AudioBuffer> => {
    const id = String(line.audioAssetId)
    const trimStart = Math.max(0, Math.min(1, Number(line.trimStart) || 0))
    const trimEnd = Math.max(trimStart, Math.min(1, Number(line.trimEnd ?? 1)))
    const speed = Math.max(0.2, Math.min(2, Number(line.speed) || 1))
    if (trimStart === 0 && trimEnd === 1 && speed === 1) return getSource(id)
    const key = `novel-export:processed:${id}:${trimStart}:${trimEnd}:${speed}`
    const cached = cache.get<AudioBuffer>(key)
    if (cached) return cached
    const source = await getSource(id)
    const blob = await store.get(id)
    if (!blob) throw new Error(`Missing media asset ${id}`)
    const ffmpeg = await ensureFFmpegLoaded()
    const input = `novel_${crypto.randomUUID()}.${getFileExtensionFromBlob(blob)}`
    const output = `novel_${crypto.randomUUID()}.wav`
    const bytes = await runFFmpegTask(async () => {
      try {
        await ffmpeg.writeFile(input, new Uint8Array(await blob.arrayBuffer()))
        await ffmpeg.exec(['-i', input, '-af', buildDialogueAudioFilter(source.duration * trimStart,
          Math.max(source.duration * trimStart + 0.01, source.duration * trimEnd), speed), '-vn', '-acodec', 'pcm_s16le', output])
        return await ffmpeg.readFile(output)
      } finally {
        try { await ffmpeg.deleteFile(input) } catch { /* retain original error */ }
        try { await ffmpeg.deleteFile(output) } catch { /* retain original error */ }
      }
    })
    if (typeof bytes === 'string') throw new Error('Unexpected audio processing output')
    abort()
    const processed = await decode(new Blob([bytes.slice().buffer], { type: 'audio/wav' }))
    cache.set(key, processed, audioBufferBytes(processed))
    return processed
  }
  const zip = new ZipWriter(options.writer || new BlobWriter('application/zip'))
  try {
    for (let chapterIndex = 0; chapterIndex < scripts.length; chapterIndex++) {
      abort()
      const script = scripts[chapterIndex]!
      const dialogue: DialogueEvent[] = []
      const bgm: BgmEvent[] = []
      const sfx: SfxEvent[] = []
      let time = 0
      let playing: Omit<BgmEvent, 'end'> | null = null
      for (const line of script.data.scriptLines) {
        abort()
        if (line.type === 'bgm') {
          if (line.action === 'play') {
            if (playing) bgm.push({ ...playing, end: time })
            playing = { id: String(line.bgmId || ''), start: time, volume: Number(line.volume ?? 1) }
          } else if (line.action === 'stop' && playing) {
            bgm.push({ ...playing, end: time }); playing = null
          }
        } else if (line.type === 'dialogue') {
          const buffer = await getDialogue(line)
          time += 0.05
          const event = { line, start: time, end: time + buffer.duration }
          dialogue.push(event)
          time = event.end
          for (const effect of Array.isArray(line.sfx) ? line.sfx : []) {
            const item = libraries.sfx.find(value => value.id === effect.sfxId)
            if (!item?.assetId) continue
            const sound = await getSource(item.assetId)
            const startFraction = Math.max(0, Math.min(1, Number(item.trimStart) || 0))
            const endFraction = Math.max(startFraction, Math.min(1, Number(item.trimEnd ?? 1)))
            const start = event.start + buffer.duration * Math.max(0, Math.min(1, Number(effect.position) || 0))
            sfx.push({ assetId: item.assetId, start, end: start + sound.duration * (endFraction - startFraction),
              sourceOffset: sound.duration * startFraction, volume: Number(line.sfxVolume ?? 0.5) * Number(item.volume ?? 1) })
          }
          time += Number(line.break_duration) || 0
        }
      }
      const totalDuration = totalTimelineDuration(time, sfx, 1.02)
      if (playing) bgm.push({ ...playing, end: totalDuration })
      const path = `${String(chapterIndex + 1).padStart(4, '0')}_${script.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 70) || '章节'}`
      await zip.add(`${path}/subtitles.srt`, new TextReader(novelSrt(dialogue)))
      const sampleRate = 44100
      const ranges = frameRanges(Math.ceil(totalDuration * sampleRate), AUDIO_EXPORT_PART_SECONDS * sampleRate)
      for (let part = 0; part < ranges.length; part++) {
        abort()
        const range = ranges[part]!
        const start = range.start / sampleRate
        const end = (range.start + range.count) / sampleRate
        const ctx = new OfflineAudioContext(2, range.count, sampleRate)
        for (const segment of bgm) {
          if (segment.end <= start || segment.start >= end) continue
          const item = libraries.bgm.find(value => value.id === segment.id)
          if (!item?.assetId) continue
          const buffer = await getSource(item.assetId)
          const overlap = Math.max(start, segment.start)
          const stop = Math.min(end, segment.end)
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.loop = true
          source.loopStart = buffer.duration * Math.max(0, Math.min(1, Number(item.trimStart) || 0))
          source.loopEnd = buffer.duration * Math.max(Math.max(0, Math.min(1, Number(item.trimStart) || 0)),
            Math.min(1, Number(item.trimEnd ?? 1)))
          const loopLength = Math.max(0.01, source.loopEnd - source.loopStart)
          const gain = ctx.createGain()
          gain.gain.value = segment.volume * Number(item.volume ?? 1)
          source.connect(gain).connect(ctx.destination)
          source.start(overlap - start, source.loopStart + (overlap - segment.start) % loopLength)
          source.stop(stop - start)
        }
        for (const event of dialogue) {
          const clip = clipAudioEvent({ start: event.start, end: event.end }, start, end)
          if (!clip) continue
          const buffer = await getDialogue(event.line)
          const source = ctx.createBufferSource()
          source.buffer = buffer
          let node: AudioNode = source
          const setting = libraries.filters.find(value => value.id === event.line.filterId)
          if (setting?.type && setting.type !== 'distortion') {
            const filter = ctx.createBiquadFilter()
            filter.type = setting.type
            filter.frequency.value = Number(setting.frequency) || 350
            filter.Q.value = Number(setting.Q) || 1
            node.connect(filter); node = filter
          } else if (setting?.type === 'distortion') {
            const shape = ctx.createWaveShaper()
            const amount = Number(setting.gain) || 50
            const curve = new Float32Array(44100)
            for (let i = 0; i < curve.length; i++) { const x = i * 2 / curve.length - 1; curve[i] = (3 + amount) * x * 20 * Math.PI / 180 / (Math.PI + amount * Math.abs(x)) }
            shape.curve = curve as Float32Array<ArrayBuffer>
            node.connect(shape); node = shape
          }
          const gain = ctx.createGain()
          const character = script.data.characters.find(value => value.name === event.line.role)
          gain.gain.value = Number(event.line.dialogueVolume ?? 1) * Number(character?.volume ?? 1)
          node.connect(gain).connect(ctx.destination)
          source.start(clip.start - start, clip.offset, clip.duration)
        }
        for (const effect of sfx) {
          const clip = clipAudioEvent(effect, start, end)
          if (!clip) continue
          const source = ctx.createBufferSource()
          source.buffer = await getSource(effect.assetId)
          const gain = ctx.createGain()
          gain.gain.value = effect.volume
          source.connect(gain).connect(ctx.destination)
          source.start(clip.start - start, clip.offset, clip.duration)
        }
        abort()
        const wav = wavBlob(await ctx.startRendering())
        await zip.add(`${path}/audio_${String(part + 1).padStart(3, '0')}-of-${String(ranges.length).padStart(3, '0')}.wav`, new BlobReader(wav), { level: 0 })
      }
      onProgress?.(chapterIndex + 1, scripts.length)
    }
    return await zip.close()
  } catch (error) {
    try { await zip.close() } catch { /* preserve rendering failure */ }
    throw error
  } finally {
    cache.deletePrefix('novel-export:')
  }
}
