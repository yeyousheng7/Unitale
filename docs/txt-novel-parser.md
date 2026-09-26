# TXT 小说解析器接口

解析器位于 `src/services/text/txtNovelParser.ts`，不依赖 Vue、存储或 Script 工作流。

```ts
const result = await parseTxtNovel(file, { encoding: 'auto' })
// { chapters: [{ title, content }], intro: { title, content } | null, encoding }

// 预览中允许用户改选编码后，用原文件重新解析：
const corrected = await parseTxtNovel(file, { encoding: 'gbk' })
```

输入接受 `Blob` / `File`、`ArrayBuffer` 或 `Uint8Array`（包括非零偏移的 `subarray()`）。`encoding` 默认 `auto`：先用严格 UTF-8 解码，失败后尝试 GB18030；也可手动传 `utf-8`、`gbk`、`gb18030` 等 `TextDecoder` 标签。两次自动解码都失败、或手动标签无效时会抛错。返回的 `encoding` 是**实际使用的解码器名称**，不是原文件编码的置信度；自动处理 GBK 字节通常返回 `gb18030`。

支持独立行上的 `第一章`、`第十二章`、`第1章`、`第 12 章`、`第一回`、`第1回`、`序章`、`楔子`、`番外`、`后记`、`Chapter 1` 等标题，可在章号后使用空白、标点或左括号。标题会 `trim()`。`content` 不包含标题行及其换行；它由解码后的原文直接切片，保留正文内的空行、缩进、标点与换行符。

首章之前只要有非空白文本，就作为 `intro` 返回，原始前缀也由切片保留。首章前只有空白时，这段前缀会舍弃。没有识别到标题时，全文原样放进一个章节，标题默认为“正文”，可由 `fallbackTitle` 指定。空文件、纯空白文件、只有 UTF-8 BOM 的文件也遵循这条 fallback 规则，返回一个内容为空或纯空白的章节。后续预览 UI 应提示这类输入，不能仅用 `chapters.length > 0` 判断文件有正文；只有标题、正文为空的已识别章节仍应允许预览。

返回值用于章节预览与后续转换，**不是整个 TXT 文件的无损重建格式**：标题行被独立提取，标题行后的换行不在 `content` 中，纯空白的首章前缀会被舍弃，UTF-8 BOM 由解码器移除。解析器不处理目录去重、卷层级、特殊网文标题或 AI 分章，也不创建 Script。
