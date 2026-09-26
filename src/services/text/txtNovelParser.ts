export interface TxtChapter {
  /** Trimmed heading, or fallbackTitle when no heading was found. */
  title: string
  /** Source text between heading lines; excludes the heading line and its newline. */
  content: string
}

export interface ParsedTxtNovel {
  chapters: TxtChapter[]
  /** Non-whitespace text before the first heading, including its original spacing. */
  intro: TxtChapter | null
  /** Decoder used. Auto-detected GBK-compatible bytes are reported as 'gb18030'. */
  encoding: string
}

export interface TxtParseOptions {
  /** 'auto' tries strict UTF-8, then GB18030. Other TextDecoder labels can be selected manually. */
  encoding?: string
  /** Used only when the text has no recognized chapter headings. */
  fallbackTitle?: string
}

interface Heading {
  offset: number
  contentOffset: number
  title: string
}

const NUMBER = '[0-9０-９零〇○一二三四五六七八九十百千万两]+'
const TITLE_BOUNDARY = '(?=$|[\\s\\u3000:：、·.．—–－（(-])'
const CHINESE_CHAPTER = new RegExp(`^第[\\s\\u3000]*${NUMBER}[\\s\\u3000]*[章回]${TITLE_BOUNDARY}`)
const ENGLISH_CHAPTER = new RegExp(`^Chapter[\\s\\u3000]+[0-9]+${TITLE_BOUNDARY}`, 'i')
const SPECIAL_CHAPTER = new RegExp(`^(?:序章|楔子|番外|后记)${TITLE_BOUNDARY}`)
const MAX_HEADING_LENGTH = 100

function chapterTitle(line: string): string | null {
  const title = line.trim()
  if (!title || title.length > MAX_HEADING_LENGTH) return null
  return CHINESE_CHAPTER.test(title) || ENGLISH_CHAPTER.test(title) || SPECIAL_CHAPTER.test(title)
    ? title : null
}

function findHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  let lineStart = 0

  while (lineStart < text.length) {
    let lineEnd = lineStart
    while (lineEnd < text.length && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') lineEnd++

    let nextLineStart = lineEnd
    if (text[nextLineStart] === '\r') nextLineStart++
    if (text[nextLineStart] === '\n') nextLineStart++

    const title = chapterTitle(text.slice(lineStart, lineEnd))
    if (title) headings.push({ offset: lineStart, contentOffset: nextLineStart, title })
    lineStart = nextLineStart
  }

  return headings
}

function splitTxt(text: string, fallbackTitle: string): Pick<ParsedTxtNovel, 'chapters' | 'intro'> {
  const headings = findHeadings(text)
  if (headings.length === 0) return { chapters: [{ title: fallbackTitle, content: text }], intro: null }

  const prefix = text.slice(0, headings[0]!.offset)
  const intro = prefix.trim() ? { title: '简介', content: prefix } : null
  const chapters = headings.map((heading, index) => ({
    title: heading.title,
    content: text.slice(heading.contentOffset, headings[index + 1]?.offset ?? text.length),
  }))
  return { chapters, intro }
}

function decodeTxt(bytes: Uint8Array, requestedEncoding: string): { text: string; encoding: string } {
  const selected = requestedEncoding.trim() || 'auto'
  if (selected.toLowerCase() === 'auto') {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      return { text: decoder.decode(bytes), encoding: decoder.encoding }
    } catch {
      const decoder = new TextDecoder('gb18030', { fatal: true })
      return { text: decoder.decode(bytes), encoding: decoder.encoding }
    }
  }

  const decoder = new TextDecoder(selected, { fatal: true })
  return { text: decoder.decode(bytes), encoding: decoder.encoding }
}

/**
 * Parse a local TXT file without touching Vue, storage, or Script state.
 * An empty or whitespace-only file retains one fallback chapter; callers can
 * distinguish it from a title-only chapter by checking the title and content.
 */
export async function parseTxtNovel(
  input: Blob | ArrayBuffer | Uint8Array,
  options: TxtParseOptions = {},
): Promise<ParsedTxtNovel> {
  let bytes: Uint8Array
  if (input instanceof Uint8Array) bytes = input
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input)
  else if (input instanceof Blob) bytes = new Uint8Array(await input.arrayBuffer())
  else throw new TypeError('TXT input must be a Blob, ArrayBuffer, or Uint8Array')

  const { text, encoding } = decodeTxt(bytes, options.encoding ?? 'auto')
  return { ...splitTxt(text, options.fallbackTitle?.trim() || '正文'), encoding }
}
