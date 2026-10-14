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
  it('clears successful background tasks and output but retains foreground results', async t => {
    const run = setup(t)
    run.output(Buffer.from('background output'))
    run.store.runInBackground(run.repository)
    await run.finish({ kind: 'exited', exitCode: 0 })
    assert.equal(run.store.getTask(run.repository), null)
    assert.equal(run.store.getAllTasks().size, 0)
    const output: string[] = []
    run.store.subscribeOutput(run.repository, text => output.push(text))()
    assert.deepEqual(output, [])
    const closing = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    assert.equal(closing.defaultPrevented, false)

    const foreground = setup(t)
    await foreground.finish({ kind: 'exited', exitCode: 0 })
    assert.equal(foreground.store.snapshot?.status, 'succeeded')
  })

  it('retains failed background tasks and output until dismissed', async t => {
    const run = setup(t)
    run.output(Buffer.from('failure details'))
    run.store.runInBackground(run.repository)
    await run.finish({ kind: 'exited', exitCode: 7 })
    assert.equal(run.store.getTask(run.repository)?.status, 'failed')
    const output: string[] = []
    run.store.subscribeOutput(run.repository, text => output.push(text))()
    assert.deepEqual(output, ['failure details'])
    run.store.dismissResult(run.repository)
    assert.equal(run.store.getTask(run.repository), null)
  })

  it('only clears the successful background task while another repository runs', async t => {
    const run = setup(t)
    const other = new Repository('C:\\other\\checkout', 2, null, false)
    let finishOther!: (result: CustomCommandResult) => void
    const result = new Promise<CustomCommandResult>(resolve => {
      finishOther = resolve
    })
    run.store.start(other, run.command, null, onOutput => {
      onOutput(Buffer.from('other output'))
      return { result, stop: async () => {} }
    })
    t.after(async () => {
      finishOther({ kind: 'cancelled' })
      await result
    })
    run.store.runInBackground(run.repository)
    await run.finish({ kind: 'exited', exitCode: 0 })
    assert.equal(run.store.getTask(run.repository), null)
    assert.equal(run.store.getTask(other)?.status, 'running')
    assert.equal(run.store.snapshot?.repository, other)
    assert.equal(run.store.getAllTasks().size, 1)
    const output: string[] = []
    run.store.subscribeOutput(other, text => output.push(text))()
    assert.deepEqual(output, ['other output'])
    const closing = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    assert.equal(closing.defaultPrevented, true)
  })
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

  it('runs commands concurrently in different repositories with isolated state and output', async t => {
    const store = new CustomCommandStore(() => {})
    const repoA = new Repository('C:\\repo\\project-a', 1, null, false)
    const repoB = new Repository('C:\\repo\\project-b', 2, null, false)
    const commandA = { id: 'cmd-a', name: 'Build A', command: 'echo a' }
    const commandB = { id: 'cmd-b', name: 'Build B', command: 'echo b' }

    let finishA!: (result: CustomCommandResult) => void
    let outputA!: (chunk: Buffer) => void
    const resultA = new Promise<CustomCommandResult>(resolve => {
      finishA = resolve
    })
    const stopA = t.mock.fn(async () => {
      finishA({ kind: 'cancelled' })
    })

    let finishB!: (result: CustomCommandResult) => void
    let outputB!: (chunk: Buffer) => void
    const resultB = new Promise<CustomCommandResult>(resolve => {
      finishB = resolve
    })
    const stopB = t.mock.fn(async () => {
      finishB({ kind: 'cancelled' })
    })

    store.start(repoA, commandA, 1000, onOutput => {
      outputA = onOutput
      return { result: resultA, stop: stopA }
    })

    // Starting in repo B while repo A is running should succeed!
    store.start(repoB, commandB, 2000, onOutput => {
      outputB = onOutput
      return { result: resultB, stop: stopB }
    })

    assert.equal(store.isAnyCommandActive(), true)
    assert.equal(store.getTask(repoA)?.status, 'running')
    assert.equal(store.getTask(repoB)?.status, 'running')
    assert.equal(store.getAllTasks().size, 2)

    // Repo A cannot start a duplicate concurrent command
    assert.throws(
      () =>
        store.start(repoA, commandA, 1000, () => ({
          result: Promise.resolve({ kind: 'exited', exitCode: 0 }),
          stop: async () => {},
        })),
      /already running/
    )

    // Output streams are isolated per repository
    const receivedA: string[] = []
    const receivedB: string[] = []
    store.subscribeOutput(repoA, chunk => receivedA.push(chunk))
    store.subscribeOutput(repoB, chunk => receivedB.push(chunk))

    outputA(Buffer.from('hello from A'))
    outputB(Buffer.from('hello from B'))

    assert.deepEqual(receivedA, ['hello from A'])
    assert.deepEqual(receivedB, ['hello from B'])

    // Stopping repo A does not affect repo B
    await store.stop(repoA)
    assert.equal(stopA.mock.callCount(), 1)
    assert.equal(stopB.mock.callCount(), 0)
    assert.equal(store.getTask(repoA)?.status, 'cancelled')
    assert.equal(store.getTask(repoB)?.status, 'running')
    assert.equal(store.isAnyCommandActive(), true)

    // Dismissing repo A result leaves repo B intact
    store.dismissResult(repoA)
    assert.equal(store.getTask(repoA), null)
    assert.equal(store.getTask(repoB)?.status, 'running')
    assert.equal(store.getAllTasks().size, 1)

    // Finish repo B
    finishB({ kind: 'exited', exitCode: 0 })
    await resultB
    assert.equal(store.getTask(repoB)?.status, 'succeeded')
    assert.equal(store.isAnyCommandActive(), false)
  })
})
