import * as React from 'react'
import {
  CustomCommandStore,
  isCustomCommandActive,
} from '../../lib/stores/custom-command-store'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Terminal } from '../terminal'
import { writeClipboardText } from '../main-process-proxy'

interface ICustomCommandRunDialogProps {
  readonly store: CustomCommandStore
  readonly repository?: Repository | null
  readonly onDismissed: () => void
}

/** A disposable view of a command owned by the application, not the dialog. */
export function CustomCommandRunDialog({
  store,
  repository,
  onDismissed,
}: ICustomCommandRunDialogProps) {
  const terminal = React.useRef<Terminal>(null)
  const [task, setTask] = React.useState(store.getTask(repository))
  const [copied, setCopied] = React.useState(false)
  const copyTimeout = React.useRef<number | null>(null)

  React.useEffect(
    () => store.subscribe(() => setTask(store.getTask(repository))),
    [store, repository]
  )
  React.useEffect(
    () =>
      store.subscribeOutput(repository, chunk =>
        terminal.current?.write(Buffer.from(chunk, 'utf8'))
      ),
    [store, repository]
  )

  React.useEffect(
    () => () => {
      if (copyTimeout.current !== null) {
        window.clearTimeout(copyTimeout.current)
      }
    },
    []
  )

  const onStop = React.useCallback(() => {
    store.stop(repository)
  }, [store, repository])

  const onCopyOutput = React.useCallback(async () => {
    const contents = terminal.current?.getBufferContents()
    if (contents !== undefined && (await writeClipboardText(contents))) {
      setCopied(true)
      if (copyTimeout.current !== null) {
        window.clearTimeout(copyTimeout.current)
      }
      copyTimeout.current = window.setTimeout(() => {
        copyTimeout.current = null
        setCopied(false)
      }, 2000)
    }
  }, [])

  if (task === null) {
    return null
  }

  const active = isCustomCommandActive(task)
  const succeeded = task.status === 'succeeded'
  const failed = task.status === 'failed'

  return (
    <Dialog
      id="custom-command-run"
      title={task.command.name}
      loading={active}
      backdropDismissable={false}
      onDismissed={onDismissed}
      onSubmit={onDismissed}
    >
      <DialogContent>
        <div className="command-run-status" role="status" data-failed={failed}>
          {task.message}
        </div>
        <p className="command-working-directory">
          Working directory: <code>{task.repository.path}</code>
        </p>
        {(active || succeeded) && (
          <div className="command-progress">
            <progress
              aria-label={
                succeeded ? 'Command complete' : 'Estimated command progress'
              }
              max={100}
              value={task.progress}
            />
            <p>
              {succeeded
                ? '100% - completed'
                : task.expectedDurationMs === null
                ? 'Learning duration from this run...'
                : `Estimated progress: ${
                    task.progress
                  }% (last successful run: ${(
                    task.expectedDurationMs / 1000
                  ).toFixed(1)}s)`}{' '}
              {(task.elapsedMs / 1000).toFixed(1)}s elapsed.
            </p>
            {active &&
              task.expectedDurationMs !== null &&
              task.elapsedMs >= task.expectedDurationMs && (
                <p>
                  Taking longer than last time. Waiting for the command to
                  finish...
                </p>
              )}
          </div>
        )}
        <div
          className="command-output selectable-text"
          role="region"
          aria-label="Command output"
        >
          <div className="command-output-toolbar">
            <Button
              type="button"
              className="command-output-copy-button"
              ariaLabel="Copy command output"
              tooltip={copied ? 'Copied!' : 'Copy command output'}
              onClick={onCopyOutput}
            >
              <Octicon symbol={copied ? octicons.check : octicons.copy} />
            </Button>
            <AriaLiveContainer
              message={copied ? 'Copied!' : ''}
              trackedUserInput={copied}
            />
          </div>
          <Terminal
            ref={terminal}
            hideCursor={true}
            disableStdin={true}
            scrollback={2000}
            cols={80}
            rows={16}
          />
        </div>
        {task.stopError !== null && <p role="alert">{task.stopError}</p>}
        {task.closeWarning && active && (
          <p role="alert">Stop the command before closing GitHub Desktop.</p>
        )}
        <p className="command-run-hint">
          {active
            ? 'Output appears as the command produces it. Interactive prompts are not supported. Run in background to keep working in Desktop.'
            : 'Use Custom commands > Show command output to view these logs again, or Dismiss command result to clear them.'}
        </p>
      </DialogContent>
      <DialogFooter>
        <div className="button-group">
          {active && (
            <Button
              type="button"
              className="command-action-icon-button"
              ariaLabel="Stop command"
              tooltip={
                task.status === 'stopping'
                  ? 'Stopping command...'
                  : 'Stop command'
              }
              onClick={onStop}
              disabled={task.status === 'stopping'}
            >
              <Octicon symbol={octicons.squareFill} />
            </Button>
          )}
          <Button
            type="submit"
            className="command-action-icon-button"
            ariaLabel={active ? 'Run in background' : 'Close'}
            tooltip={active ? 'Run in background' : 'Close'}
          >
            <Octicon symbol={active ? octicons.dash : octicons.x} />
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
