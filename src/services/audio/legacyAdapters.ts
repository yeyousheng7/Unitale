export interface FFmpegInstance {
  load(options: { coreURL: string; wasmURL: string }): Promise<void>
  writeFile(name: string, data: Uint8Array): Promise<void>
  exec(args: string[]): Promise<number>
  readFile(name: string): Promise<Uint8Array | string>
  deleteFile(name: string): Promise<void>
}

interface LegacyWindow extends Window {
  FFmpegWASM?: { FFmpeg: new () => FFmpegInstance }
  FFmpegUtil?: { toBlobURL: (url: string, mimeType: string) => Promise<string> }
  Mp4Muxer?: {
    Muxer: new (options: Record<string, unknown>) => any
    ArrayBufferTarget: new () => any
  }
}

let ffmpegLoadPromise: Promise<FFmpegInstance> | null = null
let ffmpegInstance: FFmpegInstance | null = null
let ffmpegTaskQueue: Promise<void> = Promise.resolve()

export async function ensureFFmpegLoaded(): Promise<FFmpegInstance> {
  if (ffmpegInstance) return ffmpegInstance
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const globals = window as LegacyWindow
      const FFmpegGlobal = globals.FFmpegWASM
      const FFmpegUtilGlobal = globals.FFmpegUtil
      if (!FFmpegGlobal?.FFmpeg || !FFmpegUtilGlobal?.toBlobURL) {
        throw new Error('ffmpeg.wasm 依赖加载失败')
      }
      const { FFmpeg } = FFmpegGlobal
      const { toBlobURL } = FFmpegUtilGlobal
      const ffmpeg = new FFmpeg()
      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })
      ffmpegInstance = ffmpeg
      return ffmpeg
    })()
  }
  return ffmpegLoadPromise
}

export function runFFmpegTask<T>(task: () => Promise<T>): Promise<T> {
  const scheduled = ffmpegTaskQueue.then(task, task)
  ffmpegTaskQueue = scheduled.then(() => {}, () => {})
  return scheduled
}

export function getMp4Muxer(): LegacyWindow['Mp4Muxer'] {
  return (window as LegacyWindow).Mp4Muxer
}
