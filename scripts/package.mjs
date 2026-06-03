import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const distDir = resolve(repoRoot, 'dist')
const output = resolve(distDir, 'listen2papers-zotero.xpi')
const updatesOutput = resolve(distDir, 'updates.json')
const checksumsOutput = resolve(distDir, 'SHA256SUMS.txt')

mkdirSync(distDir, { recursive: true })
rmSync(output, { force: true })

execFileSync(
  'zip',
  [
    '-r',
    output,
    'manifest.json',
    'bootstrap.js',
    'prefs.js',
    'defaults',
    'locale',
    '-x',
    'dist/*',
    '-x',
    '.git/*',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  }
)

const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'manifest.json'), 'utf8'))
const addonId = manifest.applications.zotero.id
const xpiHash = createHash('sha256').update(readFileSync(output)).digest('hex')
const updatesManifest = {
  addons: {
    [addonId]: {
      updates: [
        {
          version: manifest.version,
          update_link:
            'https://listen2papers.com/zotero/listen2papers-zotero.xpi',
          update_hash: `sha256:${xpiHash}`,
          applications: {
            zotero: {
              strict_min_version:
                manifest.applications.zotero.strict_min_version,
              strict_max_version:
                manifest.applications.zotero.strict_max_version,
            },
          },
        },
      ],
    },
  },
}

writeFileSync(updatesOutput, `${JSON.stringify(updatesManifest, null, 2)}\n`)
writeFileSync(
  checksumsOutput,
  `${xpiHash}  listen2papers-zotero.xpi\n`
)

copyFileSync(output, resolve(distDir, `listen2papers-zotero-${manifest.version}.xpi`))

console.log(output)
console.log(updatesOutput)
console.log(checksumsOutput)
