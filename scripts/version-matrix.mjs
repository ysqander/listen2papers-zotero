import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(scriptDir, '..')
const repoRoot = resolve(pluginRoot, '..', '..')

export const defaultSupportMatrix = [
  {
    zoteroVersion: '7.0.30',
    expectedSupported: true,
    runtimeEvidence: 'headless-smoke-passed',
    evidence:
      'Source-proxy headless startup smoke passed on 2026-06-01 against Zotero 7.0.30.',
  },
  {
    zoteroVersion: '8.0.5',
    expectedSupported: true,
    runtimeEvidence: 'headless-smoke-passed',
    evidence:
      'Packed-XPI headless startup smoke passed on 2026-06-02 against the official Zotero 8.0.5 macOS DMG.',
  },
  {
    zoteroVersion: '9.0.4',
    expectedSupported: true,
    runtimeEvidence: 'gui-and-packed-xpi-smoke-passed',
    evidence:
      'Packed-XPI headless startup and isolated GUI upload smoke passed on 2026-06-02.',
  },
  {
    zoteroVersion: '9.1.0',
    expectedSupported: false,
    runtimeEvidence: 'outside-declared-range',
    evidence:
      'The strict maximum version is 9.0.*, so future Zotero 9.1+ releases need fresh QA before support is claimed.',
  },
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function cleanVersion(version) {
  const trimmed = String(version ?? '').trim()
  const match = trimmed.match(/\d+(?:\.\d+){0,2}/)
  if (!match) {
    throw new Error(`Invalid Zotero version: ${version}`)
  }
  return match[0]
}

function parseVersion(version, { allowWildcard = false } = {}) {
  const normalized = allowWildcard ? String(version ?? '').trim() : cleanVersion(version)
  if (!normalized) {
    throw new Error(`Invalid Zotero version: ${version}`)
  }

  const parts = normalized.split('.').map((part) => {
    if (part === '*') {
      if (!allowWildcard) {
        throw new Error(`Wildcard is not allowed in version: ${version}`)
      }
      return '*'
    }
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid Zotero version segment: ${version}`)
    }
    return Number(part)
  })

  if (parts.length > 3) {
    throw new Error(`Unsupported Zotero version precision: ${version}`)
  }

  while (parts.length < 3) {
    parts.push(0)
  }

  return parts
}

function compareNumericVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

function wildcardUpperExclusive(parts) {
  const wildcardIndex = parts.indexOf('*')
  if (wildcardIndex === -1) return null
  if (wildcardIndex === 0) {
    return null
  }

  const upper = parts.map((part) => (part === '*' ? 0 : part))
  const incrementIndex = wildcardIndex - 1
  upper[incrementIndex] += 1
  for (let index = incrementIndex + 1; index < upper.length; index += 1) {
    upper[index] = 0
  }
  return upper
}

export function versionMatchesZoteroRange(version, strictMinVersion, strictMaxVersion) {
  const actual = parseVersion(version)
  const min = parseVersion(strictMinVersion)
  const max = parseVersion(strictMaxVersion, { allowWildcard: true })

  if (compareNumericVersions(actual, min) < 0) {
    return false
  }

  const maxUpperExclusive = wildcardUpperExclusive(max)
  if (maxUpperExclusive) {
    return compareNumericVersions(actual, maxUpperExclusive) < 0
  }

  return compareNumericVersions(actual, max) <= 0
}

export function readManifestCompatibility({ root = repoRoot } = {}) {
  const manifestPath = resolve(root, 'integrations/zotero-plugin/manifest.json')
  const updatesPath = resolve(root, 'client/public/zotero/updates.json')
  const manifest = readJson(manifestPath)
  const addonId = manifest.applications?.zotero?.id
  const update = readJson(updatesPath).addons?.[addonId]?.updates?.[0]

  const compatibility = {
    strict_min_version: manifest.applications.zotero.strict_min_version,
    strict_max_version: manifest.applications.zotero.strict_max_version,
  }
  const updateCompatibility = update?.applications?.zotero ?? null

  return {
    addonId,
    pluginVersion: manifest.version,
    updateVersion: update?.version ?? null,
    updateUrl: manifest.applications.zotero.update_url,
    compatibility,
    updateCompatibility,
    consistent:
      manifest.version === update?.version &&
      compatibility.strict_min_version ===
        updateCompatibility?.strict_min_version &&
      compatibility.strict_max_version ===
        updateCompatibility?.strict_max_version,
  }
}

export function readInstalledZoteroVersion({
  appPath = '/Applications/Zotero.app',
} = {}) {
  const infoPlist = resolve(appPath, 'Contents/Info.plist')
  if (process.platform !== 'darwin' || !existsSync(infoPlist)) {
    return null
  }

  try {
    return execFileSync('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      infoPlist,
    ])
      .toString()
      .trim()
  } catch (_error) {
    return null
  }
}

export function evaluateSupportMatrix({
  compatibility,
  installedZoteroVersion = null,
  matrix = defaultSupportMatrix,
} = {}) {
  if (!compatibility) {
    compatibility = readManifestCompatibility().compatibility
  }

  const installedCleanVersion = installedZoteroVersion
    ? cleanVersion(installedZoteroVersion)
    : null

  const rows = matrix.map((row) => {
    const declaredSupported = versionMatchesZoteroRange(
      row.zoteroVersion,
      compatibility.strict_min_version,
      compatibility.strict_max_version
    )
    const runtimePassed = row.runtimeEvidence.endsWith('-passed')
    const requiresRuntimeEvidence = declaredSupported && !runtimePassed

    return {
      ...row,
      declaredSupported,
      installedLocally: installedCleanVersion === row.zoteroVersion,
      requiresRuntimeEvidence,
      expectationMatchesDeclaration:
        declaredSupported === row.expectedSupported,
    }
  })

  return {
    compatibility,
    rows,
    allExpectationsMatch: rows.every(
      (row) => row.expectationMatchesDeclaration
    ),
    unverifiedSupportedVersions: rows
      .filter((row) => row.requiresRuntimeEvidence)
      .map((row) => row.zoteroVersion),
  }
}

export function buildSupportReport({
  installedZoteroVersion = readInstalledZoteroVersion(),
} = {}) {
  const manifestCompatibility = readManifestCompatibility()
  const matrix = evaluateSupportMatrix({
    compatibility: manifestCompatibility.compatibility,
    installedZoteroVersion,
  })

  return {
    addonId: manifestCompatibility.addonId,
    pluginVersion: manifestCompatibility.pluginVersion,
    updateVersion: manifestCompatibility.updateVersion,
    updateUrl: manifestCompatibility.updateUrl,
    compatibility: manifestCompatibility.compatibility,
    updateCompatibility: manifestCompatibility.updateCompatibility,
    declarationsConsistent: manifestCompatibility.consistent,
    installedZoteroVersion,
    ...matrix,
  }
}

async function main() {
  const report = buildSupportReport()
  console.log(JSON.stringify(report, null, 2))

  if (!report.declarationsConsistent || !report.allExpectationsMatch) {
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
