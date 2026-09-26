export type ChapterSelectionAction = 'all' | 'invert' | 'clear' | 'page'

/** Keep selection in source order; page actions only touch the visible page. */
export function updateChapterSelection<T extends string | number>(
  allIds: ReadonlyArray<T>, selectedIds: ReadonlySet<T>, action: ChapterSelectionAction,
  pageIds: ReadonlyArray<T> = [],
): T[] {
  if (action === 'all') return [...allIds]
  if (action === 'clear') return []
  if (action === 'invert') return allIds.filter(id => !selectedIds.has(id))

  const next = new Set(selectedIds)
  const visible = new Set(pageIds)
  const pageIsSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  for (const id of allIds) {
    if (!visible.has(id)) continue
    if (pageIsSelected) next.delete(id)
    else next.add(id)
  }
  return allIds.filter(id => next.has(id))
}
