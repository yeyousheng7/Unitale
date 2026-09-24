export const WAV_MAX_DATA_BYTES = 0xffffffff - 36
export const AUDIO_EXPORT_PART_SECONDS = 120

export function makeWavHeader(frames: number, sampleRate: number, channels: number): Uint8Array {
  const dataBytes = frames * channels * 2
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 0 || dataBytes > WAV_MAX_DATA_BYTES) {
    throw new Error('WAV exceeds the 4 GiB format limit')
  }
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < 4; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  tag(0, 'RIFF'); view.setUint32(4, dataBytes + 36, true); tag(8, 'WAVE')
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, dataBytes, true)
  return bytes
}

export function frameRanges(totalFrames: number, framesPerPart: number): Array<{ start: number; count: number }> {
  if (!Number.isSafeInteger(totalFrames) || totalFrames < 0 || !Number.isSafeInteger(framesPerPart) || framesPerPart < 1) {
    throw new Error('Invalid export frame count')
  }
  const parts = []
  for (let start = 0; start < totalFrames; start += framesPerPart) {
    parts.push({ start, count: Math.min(framesPerPart, totalFrames - start) })
  }
  return parts
}
