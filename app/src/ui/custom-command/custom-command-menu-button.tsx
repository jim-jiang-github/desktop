import * as React from 'react'
import {
  ICustomCommandTask,
  isCustomCommandActive,
} from '../../lib/stores/custom-command-store'
import { ToolbarButton } from '../toolbar/button'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface ICustomCommandMenuButtonProps {
  readonly task?: ICustomCommandTask | null
  readonly isDialogOpen: boolean
  readonly onShowMenu: () => void
  readonly disabled: boolean
}

/** The existing commands menu, with a finite background-task cue and optional hint. */
export function CustomCommandMenuButton({
  task,
  isDialogOpen,
  onShowMenu,
  disabled,
}: ICustomCommandMenuButtonProps) {
  const [notice, setNotice] = React.useState<{
    id: number
    message: string
  } | null>(null)
  const sequence = React.useRef(0)
  const previous = React.useRef({
    isDialogOpen,
    status: task?.status,
    closeWarning: task?.closeWarning,
  })
  const active = isCustomCommandActive(task)
  React.useEffect(() => {
    const old = previous.current
    if (!task) {
      setNotice(null)
      previous.current = {
        isDialogOpen,
        status: undefined,
        closeWarning: undefined,
      }
      return
    }
    const wasHidden = old.isDialogOpen && !isDialogOpen
    const finished = old.status !== task.status && !active && !isDialogOpen
    const blockedClose = task.closeWarning && !old.closeWarning && !isDialogOpen
    if (wasHidden || finished || blockedClose) {
      setNotice({
        id: ++sequence.current,
        message: blockedClose
          ? 'Stop the command before closing GitHub Desktop.'
          : active
          ? 'Command running in background. Open Custom commands > Show command output.'
          : `${task.message}. Open Custom commands > Show command output.`,
      })
    } else if (isDialogOpen) {
      setNotice(null)
    }
    previous.current = {
      isDialogOpen,
      status: task.status,
      closeWarning: task.closeWarning,
    }
  }, [isDialogOpen, task?.status, task?.closeWarning, task?.message, active])
  React.useEffect(() => {
    if (notice === null) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const onDismissNotice = React.useCallback(() => setNotice(null), [])
  return (
    <div className="custom-command-menu-container">
      <ToolbarButton
        className="custom-command-button"
        icon={octicons.terminal}
        title="Custom commands"
        description="Run or configure"
        tooltip={
          task
            ? `${task.command.name} — ${task.message}\n${task.repository.path}\nOpen menu to show command output`
            : undefined
        }
        ariaLabel="Custom commands"
        ariaHaspopup="menu"
        disabled={disabled}
        onClick={onShowMenu}
      >
        {notice !== null && (
          <span
            key={notice.id}
            className="custom-command-task-pulse"
            aria-hidden="true"
          />
        )}
      </ToolbarButton>
      <span className="sr-only" role="status">
        {task?.message}
      </span>
      {notice !== null && (
        <div className="custom-command-task-hint">
          <span role="status">{notice.message}</span>
          <Button
            ariaLabel="Dismiss command hint"
            tooltip="Hide this hint; the command and its output are kept"
            onClick={onDismissNotice}
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </div>
      )}
    </div>
  )
}
