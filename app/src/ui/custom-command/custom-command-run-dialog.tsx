import * as React from 'react'
import {
  CustomCommandStore,
  isCustomCommandActive,
} from '../../lib/stores/custom-command-store'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Terminal } from '../terminal'

interface ICustomCommandRunDialogProps {
  readonly store: CustomCommandStore
  readonly onDismissed: () => void
}

/** A disposable view of a command owned by the application, not the dialog. */
export function CustomCommandRunDialog({
  store,
  onDismissed,
}: ICustomCommandRunDialogProps) {
  const terminal = React.useRef<Terminal>(null)
  const [task, setTask] = React.useState(store.snapshot)
  React.useEffect(() => store.subscribe(() => setTask(store.snapshot)), [store])
  React.useEffect(
    () =>
      store.subscribeOutput(chunk =>
        terminal.current?.write(Buffer.from(chunk, 'utf8'))
      ),
    [store]
  )
  const onStop = React.useCallback(() => {
    store.stop()
  }, [store])
  if (task === null) {
    return null
  }
  const active = isCustomCommandActive(task)
  const succeeded = task.status === 'succeeded'
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
        <div
          className="command-run-status"
          role="status"
          data-failed={task.status === 'failed'}
        >
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
          className="command-output"
          role="region"
          aria-label="Command output"
        >
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
            ? 'Run in background to keep working in Desktop. Interactive prompts are not supported.'
            : 'Use Custom commands > Show command output to view these logs again, or Dismiss command result to clear them.'}
        </p>
      </DialogContent>
      <DialogFooter>
        <div className="button-group">
          {active && (
            <Button
              type="button"
              onClick={onStop}
              disabled={task.status === 'stopping'}
            >
              Stop command
            </Button>
          )}
          <Button type="submit">
            {active ? 'Run in background' : 'Close'}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
