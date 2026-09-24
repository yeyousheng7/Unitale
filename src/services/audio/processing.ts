export async function getAudioBlobFromUrl(audioUrl: string): Promise<Blob> {
  const response = await fetch(audioUrl)
  if (!response.ok) throw new Error('读取原始音频失败')
  return await response.blob()
}

export function getFileExtensionFromBlob(blob: Blob | null | undefined): string {
  const mime = (blob?.type || '').toLowerCase()
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mp4')) return 'm4a'
  return 'wav'
}

export function buildAtempoFilterChain(speed: number): string {
  const filters: string[] = []
  let remaining = Math.max(0.2, Math.min(2, Number(speed) || 1))
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  while (remaining > 2) {
    filters.push('atempo=2.0')
    remaining /= 2.0
  }
  filters.push(`atempo=${remaining.toFixed(3)}`)
  return filters.join(',')
}

export function buildDialogueAudioFilter(startSec: number, endSec: number, speed: number): string {
  const parts = [
    `atrim=start=${startSec.toFixed(4)}:end=${endSec.toFixed(4)}`,
    'asetpts=PTS-STARTPTS',
  ]
  const atempoChain = buildAtempoFilterChain(speed)
  if (atempoChain) parts.push(atempoChain)
  return parts.join(',')
}
