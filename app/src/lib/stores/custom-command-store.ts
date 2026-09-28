import { StringDecoder } from 'string_decoder'
import { Repository } from '../../models/repository'
import {
  CustomCommandResult,
  ICustomCommand,
  ICustomCommandExecution,
  getCustomCommandProgress,
} from '../custom-command'

/** A command's immutable execution snapshot, shared by every progress surface. */
export interface ICustomCommandTask {
  readonly repository: Repository
  readonly command: ICustomCommand
  readonly expectedDurationMs: number | null
  readonly elapsedMs: number
  readonly progress: number | undefined
  readonly status: 'running' | 'stopping' | 'succeeded' | 'failed' | 'cancelled'
  readonly message: string
  readonly stopError: string | null
  readonly closeWarning: boolean
}

/** Match the exact checkout, not the shared GitHub remote or repository name. */
export function commandBelongsToRepository(
  task: ICustomCommandTask | null | undefined,
  repository: { readonly path: string } | null
) {
  return (
    task !== null &&
    task !== undefined &&
    repository !== null &&
    (__WIN32__
      ? task.repository.path.toLowerCase() === repository.path.toLowerCase()
      : task.repository.path === repository.path)
  )
}

/** Whether a task is still running (including a pending stop request). */
export function isCustomCommandActive(
  task: ICustomCommandTask | null | undefined
) {
  return task?.status === 'running' || task?.status === 'stopping'
}

/** Owns the single command independently of any mounted dialog or repository view. */
export class CustomCommandStore {
  private task: ICustomCommandTask | null = null
  private execution: ICustomCommandExecution | null = null
  private timer: number | undefined
  private startedAt = 0
  private output = ''
  private decoder = new StringDecoder('utf8')
  private readonly listeners = new Set<() => void>()
  private readonly outputListeners = new Set<(chunk: string) => void>()

  public constructor(private readonly onUpdate: () => void) {}

  /** The most recent task, retained after completion until replaced explicitly. */
  public get snapshot() {
    return this.task
  }

  /** Explicitly discard a finished result; hiding a running task never calls this. */
  public dismissResult() {
    if (isCustomCommandActive(this.task)) {
      throw new Error('Stop the command before dismissing its result.')
    }
    this.task = null
    this.output = ''
    this.emit()
  }

  /** Observe state changes, without starting or stopping the command. */
  public subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Replay bounded output, then stream only new output to this subscriber. */
  public subscribeOutput(listener: (chunk: string) => void) {
    if (this.output.length > 0) {
      listener(this.output)
    }
    this.outputListeners.add(listener)
    return () => {
      this.outputListeners.delete(listener)
    }
  }

  private emit() {
    this.onUpdate()
    this.listeners.forEach(listener => listener())
  }

  private append(text: string) {
    if (text.length === 0) {
      return
    }
    // Cap lines and bytes, including commands which never produce a newline.
    this.output = (this.output + text).split('\n').slice(-2000).join('\n')
    if (Buffer.byteLength(this.output, 'utf8') > 1024 * 1024) {
      const bytes = Buffer.from(this.output, 'utf8')
      let start = bytes.length - 1024 * 1024
      while ((bytes[start] & 0xc0) === 0x80) {
        start++
      }
      this.output = bytes.subarray(start).toString('utf8')
    }
    this.outputListeners.forEach(listener => listener(text))
  }

  private preventClose = (event: BeforeUnloadEvent) => {
    if (!isCustomCommandActive(this.task)) {
      return
    }
    event.preventDefault()
    event.returnValue = ''
    this.update({ closeWarning: true })
  }

  private update(change: Partial<ICustomCommandTask>) {
    if (this.task === null) {
      return
    }
    this.task = { ...this.task, ...change }
    this.emit()
  }

  /** Start exactly once; all UI mounts merely observe this execution. */
  public start(
    repository: Repository,
    command: ICustomCommand,
    expectedDurationMs: number | null,
    execute: (onOutput: (chunk: Buffer) => void) => ICustomCommandExecution
  ) {
    if (isCustomCommandActive(this.task)) {
      throw new Error(
        'A custom command is already running. View or stop it before starting another.'
      )
    }
    this.output = ''
    this.decoder = new StringDecoder('utf8')
    this.startedAt = performance.now()
    this.task = {
      repository,
      command: { ...command },
      expectedDurationMs,
      elapsedMs: 0,
      progress: getCustomCommandProgress(0, expectedDurationMs),
      status: 'running',
      message: 'Running...',
      stopError: null,
      closeWarning: false,
    }
    window.addEventListener('beforeunload', this.preventClose)
    this.timer = window.setInterval(() => {
      const elapsedMs = performance.now() - this.startedAt
      this.update({
        elapsedMs,
        progress: getCustomCommandProgress(elapsedMs, expectedDurationMs),
      })
    }, 100)
    this.emit()
    try {
      this.execution = execute(chunk => this.append(this.decoder.write(chunk)))
      this.execution.result.then(
        result => this.finish(result),
        error => this.finishError(error)
      )
    } catch (error) {
      this.finishError(error)
    }
  }

  private finish(result: CustomCommandResult) {
    const status =
      result.kind === 'cancelled'
        ? 'cancelled'
        : result.exitCode === 0
        ? 'succeeded'
        : 'failed'
    this.complete({
      status,
      message:
        result.kind === 'cancelled'
          ? 'Stopped'
          : result.exitCode === 0
          ? 'Completed successfully'
          : `Failed (exit code ${result.exitCode})`,
      progress: status === 'succeeded' ? 100 : this.task?.progress,
    })
  }

  private finishError(error: unknown) {
    log.error(
      'Custom command failed',
      error instanceof Error ? error : new Error(String(error))
    )
    this.complete({
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  private complete(change: Partial<ICustomCommandTask>) {
    window.clearInterval(this.timer)
    window.removeEventListener('beforeunload', this.preventClose)
    this.execution = null
    this.append(this.decoder.end())
    this.update({ ...change, elapsedMs: performance.now() - this.startedAt })
  }

  /** Stop only the owned execution; stop failures remain visible and retryable. */
  public async stop() {
    if (this.task?.status !== 'running' || this.execution === null) {
      return
    }
    this.update({ status: 'stopping', message: 'Stopping...', stopError: null })
    try {
      await this.execution.stop()
    } catch (error) {
      log.error('Failed to stop custom command', error)
      if (isCustomCommandActive(this.task)) {
        this.update({
          status: 'running',
          message: 'Running...',
          stopError: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
