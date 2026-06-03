import { spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const pluginId = 'listen2papers@listen2papers.com'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultPluginRoot = resolve(scriptDir, '..')

export function buildZoteroArgs(profilePath) {
  return [
    '--headless',
    '--no-remote',
    '--new-instance',
    '--profile',
    profilePath,
    '-purgecaches',
    '-ZoteroDebugText',
  ]
}

export function smokeTimeoutMsFromEnv(env = process.env) {
  const timeoutMs = Number(env.ZOTERO_SMOKE_TIMEOUT_MS)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000
}

export function evaluateSmokeEvidence({ logText, extensionsJsonText }) {
  const errors = []
  const startupCalled = logText.includes(
    `Calling bootstrap method 'startup' for plugin ${pluginId}`
  )
  const startupError =
    logText.includes('Error running bootstrap method') ||
    logText.includes('listen2papersPlugin is undefined')

  let addon = null
  try {
    const parsed = JSON.parse(extensionsJsonText)
    addon =
      parsed.addons?.find((candidate) => candidate?.id === pluginId) || null
  } catch (_error) {
    errors.push('Could not parse Zotero extensions.json')
  }

  const extensionActive =
    addon?.active === true &&
    addon?.userDisabled === false &&
    addon?.appDisabled === false

  if (!startupCalled) {
    errors.push('Zotero did not call the plugin startup hook')
  }
  if (startupError) {
    errors.push('Zotero reported a plugin startup error')
  }
  if (!addon) {
    errors.push('Zotero did not discover the listen2papers extension')
  } else if (!extensionActive) {
    errors.push('Zotero discovered the extension but did not mark it active')
  }

  return {
    ok: errors.length === 0,
    errors,
    startupCalled,
    startupError,
    extensionActive,
    addon: addon
      ? {
          id: addon.id,
          version: addon.version,
          active: addon.active,
          userDisabled: addon.userDisabled,
          appDisabled: addon.appDisabled,
          signedState: addon.signedState,
        }
      : null,
  }
}

function defaultZoteroBin() {
  if (process.env.ZOTERO_BIN) return process.env.ZOTERO_BIN
  if (process.platform === 'darwin') {
    return '/Applications/Zotero.app/Contents/MacOS/zotero'
  }
  return 'zotero'
}

function createTempProfile() {
  const base = existsSync('/private/tmp') ? '/private/tmp' : tmpdir()
  return mkdtempSync(`${base}/listen2papers-zotero-profile.`)
}

export function writeProfile(
  profilePath,
  { pluginRoot = defaultPluginRoot, pluginXpi = null } = {}
) {
  const extensionsDir = resolve(profilePath, 'extensions')
  const dataDir = resolve(profilePath, 'zotero-data')
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  if (pluginXpi) {
    copyFileSync(pluginXpi, resolve(extensionsDir, `${pluginId}.xpi`))
  } else {
    writeFileSync(resolve(extensionsDir, pluginId), pluginRoot)
  }
  writeFileSync(
    resolve(profilePath, 'user.js'),
    [
      'user_pref("extensions.listen2papers.apiBaseUrl", "https://listen2papers.test");',
      'user_pref("extensions.listen2papers.token", "plugin-token");',
      'user_pref("extensions.zotero.useDataDir", true);',
      `user_pref("extensions.zotero.dataDir", ${JSON.stringify(dataDir)});`,
      'user_pref("extensions.autoDisableScopes", 0);',
      'user_pref("extensions.enabledScopes", 15);',
      'user_pref("extensions.startupScanScopes", 15);',
      '',
    ].join('\n')
  )
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    let killTimer = null

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      resolvePromise({
        output,
        timedOut,
        exitCode: null,
        signal: null,
        spawnError: error.message,
      })
    })

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      resolvePromise({
        output,
        timedOut,
        exitCode,
        signal,
        spawnError: null,
      })
    })
  })
}

export async function runHeadlessSmoke({
  zoteroBin = defaultZoteroBin(),
  pluginRoot = defaultPluginRoot,
  pluginXpi = null,
  timeoutMs = 30_000,
  keepProfile = false,
} = {}) {
  const profilePath = createTempProfile()
  writeProfile(profilePath, { pluginRoot, pluginXpi })

  try {
    const commandResult = await runCommand(
      zoteroBin,
      buildZoteroArgs(profilePath),
      timeoutMs
    )
    if (commandResult.spawnError) {
      return {
        ok: false,
        errors: [commandResult.spawnError],
        profilePath,
        ...commandResult,
      }
    }

    const extensionsJsonPath = resolve(profilePath, 'extensions.json')
    const extensionsJsonText = existsSync(extensionsJsonPath)
      ? readFileSync(extensionsJsonPath, 'utf8')
      : '{}'
    const evidence = evaluateSmokeEvidence({
      logText: commandResult.output,
      extensionsJsonText,
    })

    return {
      ...evidence,
      profilePath,
      timedOut: commandResult.timedOut,
      exitCode: commandResult.exitCode,
      signal: commandResult.signal,
    }
  } finally {
    if (!keepProfile) {
      rmSync(profilePath, { recursive: true, force: true })
    }
  }
}

async function main() {
  const zoteroBin = defaultZoteroBin()
  if (!existsSync(zoteroBin)) {
    console.error(`Zotero binary not found: ${zoteroBin}`)
    process.exit(77)
  }

  const xpiFlagIndex = process.argv.indexOf('--xpi')
  const pluginXpi =
    xpiFlagIndex !== -1 ? resolve(process.argv[xpiFlagIndex + 1] || '') : null
  if (xpiFlagIndex !== -1 && !process.argv[xpiFlagIndex + 1]) {
    console.error('Missing XPI path after --xpi')
    process.exit(2)
  }
  if (pluginXpi && !existsSync(pluginXpi)) {
    console.error(`Plugin XPI not found: ${pluginXpi}`)
    process.exit(77)
  }

  const result = await runHeadlessSmoke({
    zoteroBin,
    pluginXpi,
    timeoutMs: smokeTimeoutMsFromEnv(),
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
