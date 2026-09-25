export interface AudioTimelineEvent {
  start: number
  end: number
  sourceOffset?: number
}

export interface AudioTimelineClip {
  start: number
  duration: number
  offset: number
}

/** Intersect a sound's own timeline with a rendered part. Both ranges are half-open. */
export function clipAudioEvent(event: AudioTimelineEvent, partStart: number, partEnd: number): AudioTimelineClip | null {
  const start = Math.max(event.start, partStart)
  const end = Math.min(event.end, partEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return {
    start,
    duration: end - start,
    offset: (event.sourceOffset ?? 0) + start - event.start,
  }
}

/** Keep audio and video exports long enough to include sounds after the final dialogue. */
export function totalTimelineDuration(contentEnd: number, effects: ReadonlyArray<Pick<AudioTimelineEvent, 'end'>>, tailPadding: number): number {
  return Math.max(contentEnd, ...effects.map(effect => effect.end)) + tailPadding
}
