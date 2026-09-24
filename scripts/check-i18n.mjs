import { readFileSync } from 'node:fs'
import ts from 'typescript'

function readCatalog(path, name) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const messages = new Map()

  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      let value = node.initializer
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression
      if (!ts.isObjectLiteralExpression(value)) return
      for (const property of value.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) &&
            ts.isStringLiteral(property.initializer)) {
          messages.set(property.name.text, property.initializer.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  if (messages.size === 0) throw new Error(`No messages found in ${path}`)
  return messages
}

const zh = readCatalog('src/i18n/messages/zh-CN.ts', 'zhCN')
const en = readCatalog('src/i18n/messages/en-US.ts', 'enUS')
const errors = []
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')

for (const [key, value] of en) {
  if (!zh.has(key)) errors.push(`English key missing in Chinese catalog: ${key}`)
  else if (placeholders(value) !== placeholders(zh.get(key))) {
    errors.push(`Placeholder mismatch: ${key}`)
  }
}

// The workspace is still JavaScript with checkJs disabled; verify its message IDs here.
const path = 'src/composables/useUnitaleWorkspace.js'
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'translateMessage') {
    const key = node.arguments[0]
    if (!key || !ts.isStringLiteral(key) || !zh.has(key.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      errors.push(`Unknown message ID at ${path}:${line}`)
    }
  }
  ts.forEachChild(node, visit)
}
visit(source)

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`i18n catalogs checked: ${zh.size} Chinese messages, ${en.size} English messages`)
}
