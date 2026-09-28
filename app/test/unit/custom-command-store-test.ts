import assert from 'node:assert/strict'
import { describe, it, TestContext } from 'node:test'
import { CustomCommandResult } from '../../src/lib/custom-command'
import {
  CustomCommandStore,
  commandBelongsToRepository,
} from '../../src/lib/stores/custom-command-store'
import { Repository } from '../../src/models/repository'

function setup(t: TestContext, expectedDurationMs: number | null = null) {
  const store = new CustomCommandStore(() => {})
  const repository = new Repository('C:\\one\\checkout', 1, null, false)
  const command = { id: 'one', name: 'One', command: 'Write-Output hello' }
  let finish!: (result: CustomCommandResult) => void
  let output!: (chunk: Buffer) => void
  const result = new Promise<CustomCommandResult>(resolve => {
    finish = resolve
  })
  const stop = t.mock.fn(async () => {
    finish({ kind: 'cancelled' })
  })
  const execute = t.mock.fn((onOutput: (chunk: Buffer) => void) => {
    output = onOutput
    return { result, stop }
  })
  store.start(repository, command, expectedDurationMs, execute)
  t.after(async () => {
    finish({ kind: 'cancelled' })
    await result
  })
  return {
    store,
    repository,
    command,
    execute,
    stop,
    output: (text: Buffer) => output(text),
    finish: async (value: CustomCommandResult) => {
      finish(value)
      await result
    },
  }
}

describe('application-owned custom command', () => {
  it('only explicitly clears finished results and their retained output', async t => {
    const run = setup(t)
    run.output(Buffer.from('retained log'))
    assert.throws(() => run.store.dismissResult(), /Stop the command/)
    assert.equal(run.store.snapshot?.status, 'running')
    await run.finish({ kind: 'exited', exitCode: 0 })
    run.store.dismissResult()
    assert.equal(run.store.snapshot, null)
    const output: string[] = []
    run.store.subscribeOutput(text => output.push(text))()
    assert.deepEqual(output, [])
  })
  it('rejects concurrency and keeps command and checkout snapshots', async t => {
    const run = setup(t)
    run.command.command = 'changed'
    assert.equal(run.store.snapshot?.command.command, 'Write-Output hello')
    assert.throws(
      () => run.store.start(run.repository, run.command, null, run.execute),
      /already running/
    )
    assert.equal(run.execute.mock.callCount(), 1)
    assert.equal(
      commandBelongsToRepository(
        run.store.snapshot,
        new Repository('C:\\other', 1, null, false)
      ),
      false
    )
    assert.equal(
      commandBelongsToRepository(
        run.store.snapshot,
        new Repository('C:\\ONE\\checkout', 2, null, false)
      ),
      true
    )
    await run.finish({ kind: 'exited', exitCode: 0 })
  })

  it('retains UTF-8 split across chunks while hidden and subscribes only once per view', async t => {
    const run = setup(t)
    const bytes = Buffer.from('hello \u4e2d\u6587 \ud83d\ude00')
    run.output(bytes.subarray(0, 7))
    run.output(bytes.subarray(7))
    for (let i = 0; i < 3; i++) {
      const received: string[] = []
      const dispose = run.store.subscribeOutput(text => received.push(text))
      assert.equal(received.join(''), bytes.toString())
      dispose()
      run.output(Buffer.from(''))
      assert.equal(received.length, 1)
    }
    assert.equal(run.execute.mock.callCount(), 1)
    assert.equal(run.stop.mock.callCount(), 0)
    await run.finish({ kind: 'exited', exitCode: 0 })
  })

  it('caps replay by lines and UTF-8 bytes without splitting a code point', async t => {
    const run = setup(t)
    run.output(Buffer.from('line\n'.repeat(3000)))
    let replay = ''
    run.store.subscribeOutput(text => {
      replay = text
    })()
    assert.ok(replay.split('\n').length <= 2000)
    run.output(Buffer.from('\u4e2d\ud83d\ude00'.repeat(300000)))
    run.store.subscribeOutput(text => {
      replay = text
    })()
    assert.ok(Buffer.byteLength(replay) <= 1024 * 1024)
    assert.equal(replay.includes('\ufffd'), false)
    await run.finish({ kind: 'exited', exitCode: 0 })
  })

  it('keeps the exit guard with no observers and releases it after stop', async t => {
    const run = setup(t, 1)
    const event = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(run.store.snapshot?.closeWarning, true)
    await run.store.stop()
    assert.equal(run.stop.mock.callCount(), 1)
    assert.equal(run.store.snapshot?.status, 'cancelled')
    assert.notEqual(run.store.snapshot?.progress, 100)
    const after = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    assert.equal(after.defaultPrevented, false)
  })

  it('never promotes a failed result to 100 percent', async t => {
    const run = setup(t, 100)
    await run.finish({ kind: 'exited', exitCode: 7 })
    assert.equal(run.store.snapshot?.status, 'failed')
    assert.notEqual(run.store.snapshot?.progress, 100)
    const received: string[] = []
    run.store.subscribeOutput(text => received.push(text))()
    run.store.start(run.repository, run.command, 100, () => ({
      result: Promise.resolve({ kind: 'exited', exitCode: 0 }),
      stop: async () => {},
    }))
    await Promise.resolve()
    assert.equal(run.store.snapshot?.progress, 100)
  })
})
