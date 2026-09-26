export type ChapterSelectionAction = 'result' | 'clear' | 'page'

/** Keep selection in source order; result and page use explicit visible scopes. */
export function updateChapterSelection<T extends string | number>(
  allIds: ReadonlyArray<T>, selectedIds: ReadonlySet<T>, action: ChapterSelectionAction,
  scopeIds: ReadonlyArray<T> = [],
): T[] {
  if (action === 'clear') return []
  if (action === 'result') {
    const scope = new Set(scopeIds)
    return allIds.filter(id => scope.has(id))
  }

  const next = new Set(selectedIds)
  const visible = new Set(scopeIds)
  const pageIsSelected = scopeIds.length > 0 && scopeIds.every(id => selectedIds.has(id))
  for (const id of allIds) {
    if (!visible.has(id)) continue
    if (pageIsSelected) next.delete(id)
    else next.add(id)
  }
  return allIds.filter(id => next.has(id))
}

/** One-based inclusive range over numbered chapters; front matter is excluded by the caller. */
export function selectChapterRange<T extends string | number>(chapterIds: ReadonlyArray<T>, start: number, end: number): T[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > chapterIds.length) {
    throw new RangeError('Invalid chapter range')
  }
  return chapterIds.slice(start - 1, end)
}
