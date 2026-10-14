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
export function getRepositoryKey(repository: {
  readonly path: string
}): string {
  return __WIN32__ ? repository.path.toLowerCase() : repository.path
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
    getRepositoryKey(task.repository) === getRepositoryKey(repository)
  )
}

/** Whether a task is still running (including a pending stop request). */
export function isCustomCommandActive(
  task: ICustomCommandTask | null | undefined
) {
  return task?.status === 'running' || task?.status === 'stopping'
}

interface IRepositoryExecutionState {
  task: ICustomCommandTask
  background: boolean
  execution: ICustomCommandExecution | null
  timer: number | undefined
  startedAt: number
  output: string
  decoder: StringDecoder
  outputListeners: Set<(chunk: string) => void>
}

/** Owns command executions independently per repository. */
export class CustomCommandStore {
  private readonly states = new Map<string, IRepositoryExecutionState>()
  private mostRecentKey: string | null = null
  private readonly listeners = new Set<() => void>()
  private readonly globalOutputListeners = new Set<(chunk: string) => void>()

  public constructor(private readonly onUpdate: () => void) {}

  /** The most recent task, excluding automatically cleared background successes. */
  public get snapshot() {
    return this.getTask()
  }

  /**
   * Get the command task for the specified repository, or the most recent
   * task if no repository is specified.
   */
  public getTask(
    repository?: { readonly path: string } | null
  ): ICustomCommandTask | null {
    if (repository !== undefined && repository !== null) {
      return this.states.get(getRepositoryKey(repository))?.task ?? null
    }

    if (this.mostRecentKey !== null) {
      const state = this.states.get(this.mostRecentKey)
      if (state !== undefined) {
        return state.task
      }
    }

    return null
  }

  /** Get all active or retained tasks across all repositories. */
  public getAllTasks(): ReadonlyMap<string, ICustomCommandTask> {
    const map = new Map<string, ICustomCommandTask>()
    for (const [key, state] of this.states.entries()) {
      map.set(key, state.task)
    }
    return map
  }

  /** Returns true if any repository has an active (running or stopping) command. */
  public isAnyCommandActive(): boolean {
    for (const state of this.states.values()) {
      if (isCustomCommandActive(state.task)) {
        return true
      }
    }
    return false
  }

  /** Explicitly discard a finished result; hiding a running task never calls this. */
  public dismissResult(repository?: { readonly path: string } | null) {
    const key = repository ? getRepositoryKey(repository) : this.mostRecentKey
    if (key === null) {
      return
    }

    const state = this.states.get(key)
    if (!state) {
      return
    }

    if (isCustomCommandActive(state.task)) {
      throw new Error('Stop the command before dismissing its result.')
    }

    if (state.timer !== undefined) {
      window.clearInterval(state.timer)
    }
    this.states.delete(key)
    if (this.mostRecentKey === key) {
      this.mostRecentKey = this.findNextMostRecentKey()
    }
    this.emit()
  }

  /** Hide a command, automatically discarding its result if it succeeds. */
  public runInBackground(repository?: { readonly path: string } | null) {
    const key = repository ? getRepositoryKey(repository) : this.mostRecentKey
    const state = key === null ? undefined : this.states.get(key)
    if (state === undefined) {
      return
    }
    state.background = true
    if (state.task.status === 'succeeded') {
      this.dismissResult(repository)
    }
  }

  private findNextMostRecentKey(): string | null {
    const keys = Array.from(this.states.keys())
    return keys.length > 0 ? keys[keys.length - 1] : null
  }

  /** Observe state changes, without starting or stopping the command. */
  public subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Replay bounded output, then stream only new output to this subscriber. */
  public subscribeOutput(listener: (chunk: string) => void): () => void
  public subscribeOutput(
    repository: { readonly path: string } | null | undefined,
    listener: (chunk: string) => void
  ): () => void
  public subscribeOutput(
    repoOrListener:
      | { readonly path: string }
      | null
      | undefined
      | ((chunk: string) => void),
    maybeListener?: (chunk: string) => void
  ): () => void {
    const listener =
      typeof repoOrListener === 'function' ? repoOrListener : maybeListener
    if (listener === undefined) {
      return () => {}
    }

    const repository =
      typeof repoOrListener === 'function' ? undefined : repoOrListener
    const key = repository ? getRepositoryKey(repository) : this.mostRecentKey

    if (key !== null) {
      const state = this.states.get(key)
      if (state !== undefined) {
        if (state.output.length > 0) {
          listener(state.output)
        }
        state.outputListeners.add(listener)
        return () => {
          state.outputListeners.delete(listener)
        }
      }
    }

    this.globalOutputListeners.add(listener)
    return () => {
      this.globalOutputListeners.delete(listener)
    }
  }

  private emit() {
    this.onUpdate()
    this.listeners.forEach(listener => listener())
  }

  private append(key: string, text: string) {
    if (text.length === 0) {
      return
    }

    const state = this.states.get(key)
    if (!state) {
      return
    }

    // Cap lines and bytes, including commands which never produce a newline.
    state.output = (state.output + text).split('\n').slice(-2000).join('\n')
    if (Buffer.byteLength(state.output, 'utf8') > 1024 * 1024) {
      const bytes = Buffer.from(state.output, 'utf8')
      let start = bytes.length - 1024 * 1024
      while ((bytes[start] & 0xc0) === 0x80) {
        start++
      }
      state.output = bytes.subarray(start).toString('utf8')
    }

    state.outputListeners.forEach(listener => listener(text))
    this.globalOutputListeners.forEach(listener => listener(text))
  }

  private preventClose = (event: BeforeUnloadEvent) => {
    let hasActive = false
    for (const [key, state] of this.states.entries()) {
      if (isCustomCommandActive(state.task)) {
        hasActive = true
        this.update(key, { closeWarning: true })
      }
    }

    if (hasActive) {
      event.preventDefault()
      event.returnValue = ''
    }
  }

  private update(key: string, change: Partial<ICustomCommandTask>) {
    const state = this.states.get(key)
    if (!state) {
      return
    }
    state.task = { ...state.task, ...change }
    this.emit()
  }

  /** Start execution for the specified repository. */
  public start(
    repository: Repository,
    command: ICustomCommand,
    expectedDurationMs: number | null,
    execute: (onOutput: (chunk: Buffer) => void) => ICustomCommandExecution
  ) {
    const key = getRepositoryKey(repository)
    const existing = this.states.get(key)
    if (existing && isCustomCommandActive(existing.task)) {
      throw new Error(
        'A custom command is already running for this repository. View or stop it before starting another.'
      )
    }

    if (existing?.timer !== undefined) {
      window.clearInterval(existing.timer)
    }

    const task: ICustomCommandTask = {
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

    const state: IRepositoryExecutionState = {
      task,
      background: false,
      execution: null,
      timer: undefined,
      startedAt: performance.now(),
      output: '',
      decoder: new StringDecoder('utf8'),
      outputListeners: new Set(),
    }

    this.states.set(key, state)
    this.mostRecentKey = key

    window.removeEventListener('beforeunload', this.preventClose)
    window.addEventListener('beforeunload', this.preventClose)

    state.timer = window.setInterval(() => {
      const current = this.states.get(key)
      if (current && isCustomCommandActive(current.task)) {
        const elapsedMs = performance.now() - current.startedAt
        this.update(key, {
          elapsedMs,
          progress: getCustomCommandProgress(elapsedMs, expectedDurationMs),
        })
      }
    }, 100)

    this.emit()

    try {
      state.execution = execute(chunk =>
        this.append(key, state.decoder.write(chunk))
      )
      state.execution.result.then(
        result => this.finish(key, result),
        error => this.finishError(key, error)
      )
    } catch (error) {
      this.finishError(key, error)
    }
  }

  private finish(key: string, result: CustomCommandResult) {
    const state = this.states.get(key)
    const status =
      result.kind === 'cancelled'
        ? 'cancelled'
        : result.exitCode === 0
        ? 'succeeded'
        : 'failed'
    this.complete(key, {
      status,
      message:
        result.kind === 'cancelled'
          ? 'Stopped'
          : result.exitCode === 0
          ? 'Completed successfully'
          : `Failed (exit code ${result.exitCode})`,
      progress: status === 'succeeded' ? 100 : state?.task.progress,
    })
  }

  private finishError(key: string, error: unknown) {
    log.error(
      'Custom command failed',
      error instanceof Error ? error : new Error(String(error))
    )
    this.complete(key, {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  private complete(key: string, change: Partial<ICustomCommandTask>) {
    const state = this.states.get(key)
    if (state) {
      if (state.timer !== undefined) {
        window.clearInterval(state.timer)
        state.timer = undefined
      }
      state.execution = null
      this.append(key, state.decoder.end())
      state.task = {
        ...state.task,
        ...change,
        elapsedMs: performance.now() - state.startedAt,
      }
      if (state.background && state.task.status === 'succeeded') {
        this.states.delete(key)
        if (this.mostRecentKey === key) {
          this.mostRecentKey = this.findNextMostRecentKey()
        }
      }
    }

    if (!this.isAnyCommandActive()) {
      window.removeEventListener('beforeunload', this.preventClose)
    }
    this.emit()
  }

  /** Stop only the execution for the given repository (or most recent). */
  public async stop(repository?: { readonly path: string } | null) {
    const key = repository ? getRepositoryKey(repository) : this.mostRecentKey
    if (key === null) {
      return
    }

    const state = this.states.get(key)
    if (!state || state.task.status !== 'running' || state.execution === null) {
      return
    }

    this.update(key, {
      status: 'stopping',
      message: 'Stopping...',
      stopError: null,
    })

    try {
      await state.execution.stop()
    } catch (error) {
      log.error('Failed to stop custom command', error)
      const current = this.states.get(key)
      if (current && isCustomCommandActive(current.task)) {
        this.update(key, {
          status: 'running',
          message: 'Running...',
          stopError: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
