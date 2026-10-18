import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`archive-release: package.json version must be x.y.z, got ${JSON.stringify(version)}`)
  process.exit(1)
}

const src = resolve(root, 'dist/pay.min.js')
const destDir = resolve(root, 'versions')
const dest = resolve(destDir, `pay.${version}.min.js`)

try {
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, dest)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`archive-release: failed to copy dist/pay.min.js to versions/pay.${version}.min.js: ${message}`)
  process.exit(1)
}

console.log(`archived versions/pay.${version}.min.js`)
