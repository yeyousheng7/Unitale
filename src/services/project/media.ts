export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64.split(',')[1]!)
  const buffer = new ArrayBuffer(byteString.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
  return new Blob([buffer], { type: mimeType })
}

interface MediaMarker {
  key: '_fileData' | 'audioBase64' | 'imageBase64'
  marker: string
}

export async function extractMediaJsonFromFileStream(file: File): Promise<{
  tinyJsonStr: string
  extractedBlobs: string[]
}> {
  if (!file?.stream) throw new Error('当前浏览器不支持大文件流式读取。')

  const markers: MediaMarker[] = [
    { key: '_fileData', marker: '"_fileData":"' },
    { key: '_fileData', marker: '"_fileData": "' },
    { key: 'audioBase64', marker: '"audioBase64":"' },
    { key: 'audioBase64', marker: '"audioBase64": "' },
    { key: 'imageBase64', marker: '"imageBase64":"' },
    { key: 'imageBase64', marker: '"imageBase64": "' },
  ]
  const maxMarkerLength = Math.max(...markers.map((item) => item.marker.length))

  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const tinyJsonParts: string[] = []
  const extractedBlobs: string[] = []
  let pending = ''
  let capturing: { key: MediaMarker['key']; value: string } | null = null

  const findEarliestMarker = (text: string): (MediaMarker & { idx: number }) | null => {
    let earliest: (MediaMarker & { idx: number }) | null = null
    for (const item of markers) {
      const idx = text.indexOf(item.marker)
      if (idx !== -1 && (!earliest || idx < earliest.idx)) earliest = { idx, ...item }
    }
    return earliest
  }

  while (true) {
    const { value, done } = await reader.read()
    pending += decoder.decode(value || new Uint8Array(), { stream: !done })

    let shouldContinue = true
    while (shouldContinue) {
      if (capturing) {
        const endQuoteIndex = pending.indexOf('"')
        if (endQuoteIndex === -1) {
          capturing.value += pending
          pending = ''
          shouldContinue = false
        } else {
          capturing.value += pending.slice(0, endQuoteIndex)
          extractedBlobs.push(capturing.value)
          tinyJsonParts.push(`"${capturing.key}":"__EXTRACTED_BASE64_${extractedBlobs.length - 1}__"`)
          pending = pending.slice(endQuoteIndex + 1)
          capturing = null
        }
      } else {
        const found = findEarliestMarker(pending)
        if (!found) {
          const keepLength = done ? 0 : Math.max(0, maxMarkerLength - 1)
          if (pending.length > keepLength) {
            tinyJsonParts.push(pending.slice(0, pending.length - keepLength))
            pending = pending.slice(pending.length - keepLength)
          }
          shouldContinue = false
        } else {
          tinyJsonParts.push(pending.slice(0, found.idx))
          pending = pending.slice(found.idx + found.marker.length)
          capturing = { key: found.key, value: '' }
        }
      }
    }
    if (done) break
  }

  pending += decoder.decode()
  if (capturing) throw new Error(`流式读取时在 ${capturing.key} 字段遇到意外 EOF`)
  if (pending) tinyJsonParts.push(pending)
  return { tinyJsonStr: tinyJsonParts.join(''), extractedBlobs }
}
