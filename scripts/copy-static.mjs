import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')

await mkdir(dist, { recursive: true })
for (const directory of ['voice', 'vendor', 'assets']) {
  await cp(resolve(root, directory), resolve(dist, directory), { recursive: true })
}
