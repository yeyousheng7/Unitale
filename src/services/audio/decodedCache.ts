export const DEFAULT_DECODED_BUDGET = 128 * 1024 * 1024

export function audioBufferBytes(buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels'>): number {
  return buffer.length * buffer.numberOfChannels * 4
}

interface CacheEntry<T> {
  value: T
  bytes: number
  onEvict?: (value: T) => void
  pins: number
}

/** A shared byte budget for original and processed decoded audio. */
export class DecodedAudioCache {
  private entries = new Map<string, CacheEntry<unknown>>()
  private used = 0
  constructor(readonly budget = DEFAULT_DECODED_BUDGET) {}

  get byteLength(): number { return this.used }
  get size(): number { return this.entries.size }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value as T
  }

  has(key: string): boolean { return this.entries.has(key) }

  set<T>(key: string, value: T, bytes: number, onEvict?: (value: T) => void): boolean {
    this.delete(key)
    if (!Number.isFinite(bytes) || bytes > this.budget || bytes < 0) return false
    this.entries.set(key, { value, bytes, onEvict: onEvict as ((value: unknown) => void) | undefined, pins: 0 })
    this.used += bytes
    this.trim()
    return this.entries.has(key)
  }

  pin(key: string): () => void {
    const entry = this.entries.get(key)
    if (entry) entry.pins++
    return () => {
      if (entry) entry.pins = Math.max(0, entry.pins - 1)
      this.trim()
    }
  }

  pinBuffer(buffer: AudioBuffer): () => void {
    for (const [key, entry] of this.entries) {
      if (entry.value === buffer || (entry.value as { buffer?: AudioBuffer })?.buffer === buffer) return this.pin(key)
    }
    return () => {}
  }

  delete(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.used -= entry.bytes
    entry.onEvict?.(entry.value)
  }

  deletePrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.delete(key)
  }

  values<T>(prefix: string): T[] {
    return [...this.entries].filter(([key]) => key.startsWith(prefix)).map(([, entry]) => entry.value as T)
  }

  private trim(): void {
    if (this.used <= this.budget) return
    for (const [key, entry] of this.entries) {
      if (this.used <= this.budget) break
      if (!entry.pins) this.delete(key)
    }
  }
}
