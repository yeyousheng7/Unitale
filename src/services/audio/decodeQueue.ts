/** Limit simultaneous audio decodes and share work requested for the same asset. */
export function createAudioDecodeQueue<T>(limit = 2) {
  const inFlight = new Map<string, Promise<T>>()
  const waiting: Array<() => void> = []
  let active = 0

  const startNext = () => {
    while (active < limit && waiting.length) {
      active++
      waiting.shift()!()
    }
  }

  return (key: string, decode: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key)
    if (existing) return existing
    const task = new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        Promise.resolve().then(decode).then(resolve, reject).finally(() => {
          active--
          startNext()
        })
      })
      startNext()
    })
    inFlight.set(key, task)
    void task.finally(() => { inFlight.delete(key) }).catch(() => {})
    return task
  }
}
