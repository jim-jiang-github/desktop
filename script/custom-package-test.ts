import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join, resolve } from 'path'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { createTempDirectory } from '../app/test/helpers/temp'
import { getBundleID, getProductName } from '../app/package-info'
import {
  getDistPath,
  getDistRoot,
  getExecutableName,
  getOutPath,
  getWindowsIdentifierName,
  getWindowsInstallerName,
  getWindowsStandaloneName,
  isPublishable,
  shouldMakeDelta,
  getWindowsIconPath,
} from './dist-info'

describe('local Custom packaging', () => {
  const root = resolve(__dirname, '..')

  function mockEnv(
    t: { after: (fn: () => void) => void },
    overrides: Record<string, string | undefined>
  ) {
    const previous: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(overrides)) {
      previous[key] = process.env[key]
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    })
  }

  it('isolates custom resources and installer identity without publishing', t => {
    mockEnv(t, {
      NODE_ENV: 'production',
      RELEASE_CHANNEL: 'custom',
      npm_config_arch: 'x64',
    })
    assert.equal(getProductName(), 'GitHub Desktop Custom')
    assert.equal(
      getWindowsIconPath(),
      join(root, 'app', 'static', 'logos', 'custom', 'icon-logo.ico')
    )
    assert.equal(getBundleID(), 'com.github.GitHubClientCustom')
    assert.equal(getWindowsIdentifierName(), 'GitHubDesktopCustom')
    assert.equal(getWindowsInstallerName(), 'GitHubDesktopCustomSetup-x64.msi')
    assert.equal(getWindowsStandaloneName(), 'GitHubDesktopCustomSetup-x64.exe')
    assert.equal(getOutPath(), join(root, '.custom-build', 'out'))
    assert.equal(getDistRoot(), join(root, '.custom-build', 'dist'))
    assert.equal(
      getDistPath(),
      join(getDistRoot(), `${getExecutableName()}-${process.platform}-x64`)
    )
    assert.equal(isPublishable(), false)
    assert.equal(shouldMakeDelta(), false)
  })

  it('leaves official production packaging unchanged', t => {
    mockEnv(t, {
      NODE_ENV: 'production',
      RELEASE_CHANNEL: 'production',
    })
    assert.equal(getProductName(), 'GitHub Desktop')
    assert.equal(
      getWindowsIconPath(),
      join(root, 'app', 'static', 'logos', 'prod', 'icon-logo.ico')
    )
    assert.equal(getWindowsIdentifierName(), 'GitHubDesktop')
    assert.equal(getBundleID(), 'com.github.GitHubClient')
    assert.equal(getOutPath(), join(root, 'out'))
    assert.equal(getDistRoot(), join(root, 'dist'))
    assert.equal(isPublishable(), true)
    assert.equal(shouldMakeDelta(), true)
  })

  it('leaves development packaging unchanged', t => {
    mockEnv(t, {
      NODE_ENV: 'development',
      RELEASE_CHANNEL: 'development',
    })
    assert.equal(getProductName(), 'GitHub Desktop-dev')
    assert.equal(
      getWindowsIconPath(),
      join(root, 'app', 'static', 'logos', 'dev', 'icon-logo.ico')
    )
    assert.equal(getBundleID(), 'com.github.GitHubClientDev')
    assert.equal(getOutPath(), join(root, 'out'))
    assert.equal(getDistRoot(), join(root, 'dist'))
    assert.equal(isPublishable(), false)
    assert.equal(shouldMakeDelta(), false)
  })

  it(
    'stages and checksums every Custom release asset using the published filenames',
    { skip: process.platform !== 'win32' },
    async t => {
      const workflow = await readFile(
        join(root, '.github', 'workflows', 'custom-release.yml'),
        'utf8'
      )
      const stagingScript = workflow
        .split('      - name: Stage release files and SHA256 checksums')[1]
        .split('      - uses: actions/upload-artifact')[0]
        .split('        run: |')[1]
        .split('\n')
        .map(line => line.replace(/^ {10}/, ''))
        .join('\n')
      const fixture = await createTempDirectory(t)
      await mkdir(join(fixture, 'app'))
      const dist = join(fixture, '.custom-build', 'dist')
      await mkdir(dist, { recursive: true })
      await writeFile(
        join(fixture, 'app', 'package.json'),
        JSON.stringify({ version: '3.6.7-beta9' })
      )
      const packageName = 'GitHubDesktopCustom-3.6.7-beta9-full.nupkg'
      await writeFile(
        join(dist, 'GitHubDesktopCustom-3.6.7-beta9-x64-full.nupkg'),
        'package'
      )
      await writeFile(join(dist, 'RELEASES'), `hash ${packageName} 7`)
      for (const ext of ['exe', 'msi']) {
        await writeFile(join(dist, `GitHubDesktopCustomSetup-x64.${ext}`), ext)
      }
      await writeFile(
        join(fixture, 'stage.ps1'),
        `$ErrorActionPreference = 'Stop'\n${stagingScript}`
      )
      await promisify(execFile)(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'stage.ps1'],
        { cwd: fixture, windowsHide: true }
      )
      const assets = join(fixture, 'release-assets')
      assert.equal(await readFile(join(assets, packageName), 'utf8'), 'package')
      assert.equal(
        await readFile(join(assets, 'RELEASES'), 'utf8'),
        `hash ${packageName} 7`
      )
      const checksums = await readFile(join(assets, 'SHA256SUMS.txt'), 'utf8')
      for (const name of [
        'GitHubDesktopCustomSetup-x64.exe',
        'GitHubDesktopCustomSetup-x64.msi',
        packageName,
        'RELEASES',
      ]) {
        const hash = createHash('sha256')
          .update(await readFile(join(assets, name)))
          .digest('hex')
        assert.ok(
          checksums.includes(`${hash}  ${name}`),
          `Incorrect or missing checksum: ${name}`
        )
      }
      assert.ok(workflow.includes('release-assets/* \\'))
    }
  )

  for (const buildExitCode of [0, 17]) {
    it(
      `handles redirected native warnings and build exit code ${buildExitCode}`,
      { skip: process.platform !== 'win32' },
      async t => {
        const fixture = await createTempDirectory(t)
        await mkdir(join(fixture, 'script'))
        await mkdir(join(fixture, 'vendor'))
        await copyFile(
          join(__dirname, 'package-custom.ps1'),
          join(fixture, 'script', 'package-custom.ps1')
        )
        await writeFile(join(fixture, '.nvmrc'), process.version)
        await writeFile(
          join(fixture, 'vendor', 'yarn-1.21.1.js'),
          `
const fs = require('fs')
console.error('non-fatal native warning')
fs.appendFileSync('tasks.txt', process.argv[2] + '\\n')
if (process.argv[2] === 'build:prod') {
  process.exit(${buildExitCode})
}
fs.mkdirSync('.custom-build/dist', { recursive: true })
for (const ext of ['exe', 'msi']) {
  fs.writeFileSync('.custom-build/dist/GitHubDesktopCustomSetup-x64.' + ext, 'fixture')
}
`
        )
        const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
        const result = promisify(execFile)(
          join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
          ),
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `& .\\script\\package-custom.ps1 -NodePath ${quote(
              process.execPath
            )} *> build.log; exit $LASTEXITCODE`,
          ],
          { cwd: fixture, windowsHide: true }
        )
        if (buildExitCode === 0) {
          await result
        } else {
          await assert.rejects(
            result,
            /Yarn build:prod failed \(exit code 17\)/
          )
        }
        assert.equal(
          await readFile(join(fixture, 'tasks.txt'), 'utf8'),
          buildExitCode === 0 ? 'build:prod\npackage\n' : 'build:prod\n'
        )
        const output = await readFile(join(fixture, 'build.log'), 'utf16le')
        assert.ok(output.includes('non-fatal native warning'))
        assert.equal(
          output.includes('Done. Installers are unsigned.'),
          buildExitCode === 0
        )
      }
    )
  }
})
