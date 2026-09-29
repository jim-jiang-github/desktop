import assert from 'node:assert/strict'
import { it } from 'node:test'
import { writeFile, access } from 'node:fs/promises'
import * as Path from 'node:path'
import {
  parseCustomCommandPushRequest,
  startCustomCommandWithDesktopPush,
} from '../../src/lib/custom-command-push'
import { createTempDirectory } from '../helpers/temp'

const request = {
  remoteURL: 'https://github.com/example/repo.git',
  branch: 'development',
  commit: '1'.repeat(40),
  tag: 'custom-v3.6.7-beta5',
  tagObject: '2'.repeat(40),
}
const prepare = `
@'
${JSON.stringify(request)}
'@ | Set-Content -LiteralPath $env:GITHUB_DESKTOP_PUSH_REQUEST -Encoding UTF8
Write-Output $env:GITHUB_DESKTOP_PUSH_REQUEST
exit 0
`

it('validates credential-free, explicit push identities', async () => {
  assert.deepEqual(
    parseCustomCommandPushRequest(JSON.stringify(request)),
    request
  )
  for (const invalid of [
    null,
    {},
    { ...request, commit: 'HEAD' },
    { ...request, tagObject: '--all' },
    { ...request, remoteURL: 'https://user:password@github.com/repo.git' },
    { ...request, remoteURL: 'file:///repository' },
  ]) {
    assert.throws(() => parseCustomCommandPushRequest(JSON.stringify(invalid)))
  }
})

it(
  'hands off only after success and keeps the task pending until push verification finishes',
  { skip: !__WIN32__ },
  async t => {
    const directory = await createTempDirectory(t)
    let finishPush = () => {}
    const pushing = new Promise<void>(resolve => {
      finishPush = resolve
    })
    let startedPush = () => {}
    const started = new Promise<void>(resolve => {
      startedPush = resolve
    })
    let output = ''
    const execution = startCustomCommandWithDesktopPush(
      directory,
      prepare,
      chunk => {
        output += chunk.toString()
      },
      async actual => {
        assert.deepEqual(actual, request)
        startedPush()
        await pushing
      }
    )
    t.after(finishPush)
    await started
    let settled = false
    void execution.result.then(() => {
      settled = true
    })
    assert.equal(settled, false)
    await assert.rejects(execution.stop(), /Desktop is pushing/)
    finishPush()
    assert.deepEqual(await execution.result, { kind: 'exited', exitCode: 0 })
    const requestPath = output
      .split(/\r?\n/)
      .find(line => line.endsWith('request.json'))
    assert.ok(requestPath)
    await assert.rejects(access(requestPath))
  }
)

for (const script of [
  'exit 7',
  'exit 0',
  "Write-Output '::desktop-push::fake'; exit 0",
]) {
  it(
    `does not push failed or missing requests: ${script}`,
    { skip: !__WIN32__ },
    async t => {
      const directory = await createTempDirectory(t)
      let calls = 0
      const execution = startCustomCommandWithDesktopPush(
        directory,
        script,
        () => {},
        async () => {
          calls++
        }
      )
      if (script === 'exit 7') {
        assert.deepEqual(await execution.result, {
          kind: 'exited',
          exitCode: 7,
        })
      } else {
        await assert.rejects(execution.result, /ENOENT/)
      }
      assert.equal(calls, 0)
    }
  )
}

it(
  'reports authenticated push failures rather than shell success',
  { skip: !__WIN32__ },
  async t => {
    const directory = await createTempDirectory(t)
    const execution = startCustomCommandWithDesktopPush(
      directory,
      prepare,
      () => {},
      async () => {
        throw new Error('Desktop account has no write permission')
      }
    )
    await assert.rejects(execution.result, /no write permission/)
  }
)

it(
  'cancelling before preparation starts cannot push or run the script',
  { skip: !__WIN32__ },
  async t => {
    const directory = await createTempDirectory(t)
    let calls = 0
    const execution = startCustomCommandWithDesktopPush(
      directory,
      prepare,
      () => {},
      async () => {
        calls++
      }
    )
    await execution.stop()
    assert.deepEqual(await execution.result, { kind: 'cancelled' })
    assert.equal(calls, 0)
  }
)

it(
  'stopping PowerShell prevents the handoff even if it already wrote a request',
  { skip: !__WIN32__ },
  async t => {
    const directory = await createTempDirectory(t)
    const scriptPath = Path.join(directory, 'prepare.ps1')
    await writeFile(
      scriptPath,
      prepare.replace('exit 0', 'Start-Sleep -Seconds 30\nexit 0')
    )
    let startedScript = () => {}
    const started = new Promise<void>(resolve => {
      startedScript = resolve
    })
    let calls = 0
    const execution = startCustomCommandWithDesktopPush(
      directory,
      '& .\\prepare.ps1',
      () => startedScript(),
      async () => {
        calls++
      }
    )
    await started
    await execution.stop()
    assert.deepEqual(await execution.result, { kind: 'cancelled' })
    assert.equal(calls, 0)
  }
)
