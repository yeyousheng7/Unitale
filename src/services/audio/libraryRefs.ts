export interface NamedLibraryEntry {
  id: string
  name: string
}

/** Resolve an LLM name once when importing analysis; stored script references use the ID. */
export function matchLibraryId(name: unknown, library: ReadonlyArray<NamedLibraryEntry>): string {
  if (typeof name !== 'string' || !name.trim()) return ''
  const query = name.trim().toLowerCase()
  const exact = library.find(entry => entry.name.toLowerCase() === query)
  if (exact) return exact.id
  const candidates = library.filter(entry => {
    const normalized = entry.name.toLowerCase()
    return normalized.includes(query) || query.includes(normalized)
  })
  candidates.sort((a, b) => Math.abs(a.name.length - query.length) - Math.abs(b.name.length - query.length))
  return candidates[0]?.id || ''
}
