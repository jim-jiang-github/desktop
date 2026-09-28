import * as React from 'react'
import {
  ICustomCommandTask,
  isCustomCommandActive,
} from '../../lib/stores/custom-command-store'

/** Decorative whole-surface fill; task details are available through the task entry. */
export function CommandProgressBackground({
  task,
}: {
  readonly task?: ICustomCommandTask | null
}) {
  if (!task || (!isCustomCommandActive(task) && task.status !== 'succeeded')) {
    return null
  }
  return (
    <span
      aria-hidden="true"
      className="custom-command-fill"
      data-status={task.status}
      data-indeterminate={task.progress === undefined}
      style={{
        width: task.progress === undefined ? '35%' : `${task.progress}%`,
      }}
    />
  )
}
