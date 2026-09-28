import assert from 'node:assert/strict'
import { afterEach, beforeEach, it } from 'node:test'
import * as React from 'react'
import { ICustomCommandTask } from '../../../src/lib/stores/custom-command-store'
import { Repository } from '../../../src/models/repository'
import { CustomCommandMenuButton } from '../../../src/ui/custom-command/custom-command-menu-button'
import { fireEvent, render, screen } from '../../helpers/ui/render'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../../helpers/ui/timers'

const task: ICustomCommandTask = {
  repository: new Repository('C:\\original\\checkout', 1, null, false),
  command: { id: 'test', name: 'Build', command: 'echo test' },
  status: 'running',
  message: 'Running...',
  progress: 40,
  expectedDurationMs: 1000,
  elapsedMs: 400,
  stopError: null,
  closeWarning: false,
}

beforeEach(() => enableTestTimers(['setTimeout']))
afterEach(() => resetTestTimers())

it('keeps only the original commands menu button, with and without a task', () => {
  let menus = 0
  const props = {
    isDialogOpen: false,
    disabled: false,
    onShowMenu: () => menus++,
  }
  const view = render(<CustomCommandMenuButton {...props} />)
  const button = screen.getByRole('button', { name: 'Custom commands' })
  view.rerender(<CustomCommandMenuButton {...props} task={task} />)
  assert.equal(screen.getByRole('button', { name: 'Custom commands' }), button)
  assert.equal(screen.getAllByRole('button').length, 1)
  assert.equal(button.getAttribute('aria-haspopup'), 'menu')
  fireEvent.click(button)
  assert.equal(menus, 1)
  assert.equal(view.container.querySelector('button button'), null)
  assert.ok(screen.getByText('Run or configure'))
})

it('shows a dismissible background hint without removing or changing the menu button', () => {
  const props = { task, disabled: false, onShowMenu: () => {} }
  const view = render(
    <CustomCommandMenuButton {...props} isDialogOpen={true} />
  )
  view.rerender(<CustomCommandMenuButton {...props} isDialogOpen={false} />)
  assert.ok(screen.getByText(/Open Custom commands > Show command output/))
  assert.ok(view.container.querySelector('.custom-command-task-pulse'))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss command hint' }))
  assert.equal(screen.queryByText(/Command running in background/), null)
  assert.ok(screen.getByRole('button', { name: 'Custom commands' }))
  view.rerender(<CustomCommandMenuButton {...props} isDialogOpen={true} />)
  view.rerender(<CustomCommandMenuButton {...props} isDialogOpen={false} />)
  advanceTimersBy(7100)
  assert.equal(view.container.querySelector('.custom-command-task-hint'), null)
  assert.equal(view.container.querySelector('.custom-command-task-pulse'), null)
  assert.ok(screen.getByRole('button', { name: 'Custom commands' }))
})

it('announces a background result without adding a persistent result button', () => {
  const props = { isDialogOpen: false, disabled: false, onShowMenu: () => {} }
  const view = render(<CustomCommandMenuButton {...props} task={task} />)
  view.rerender(
    <CustomCommandMenuButton
      {...props}
      task={{ ...task, status: 'failed', message: 'Failed (exit code 7)' }}
    />
  )
  assert.ok(screen.getByText(/Failed \(exit code 7\). Open Custom commands/))
  advanceTimersBy(7100)
  assert.equal(screen.getAllByRole('button').length, 1)
  assert.ok(screen.getByText('Failed (exit code 7)'))
  view.rerender(<CustomCommandMenuButton {...props} task={null} />)
  assert.equal(screen.queryByText('Failed (exit code 7)'), null)
  assert.ok(screen.getByRole('button', { name: 'Custom commands' }))
})
