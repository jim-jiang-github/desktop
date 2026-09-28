import assert from 'node:assert/strict'
import { it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import {
  ICustomCommandTask,
  commandBelongsToRepository,
} from '../../../src/lib/stores/custom-command-store'
import { CommandProgressBackground } from '../../../src/ui/custom-command/command-progress-background'
import { RepositoryListItem } from '../../../src/ui/repositories-list/repository-list-item'
import { ToolbarDropdown } from '../../../src/ui/toolbar/dropdown'
import { render } from '../../helpers/ui/render'

it('updates the entire toolbar and repository row from one snapshot without losing indicators', () => {
  const repository = new Repository('C:\\one', 1, null, false)
  const other = new Repository('C:\\two', 2, null, false)
  const task: ICustomCommandTask = {
    repository,
    command: { id: 'one', name: 'One', command: 'echo one' },
    expectedDurationMs: 1000,
    elapsedMs: 420,
    progress: 42,
    status: 'running',
    message: 'Running...',
    stopError: null,
    closeWarning: false,
  }
  const makeView = (snapshot: ICustomCommandTask, selected: Repository) => (
    <>
      <ToolbarDropdown
        title={selected.name}
        dropdownState="closed"
        onDropdownStateChanged={() => {}}
        dropdownContentRenderer={() => null}
        buttonClassName="repository-command-progress"
      >
        <CommandProgressBackground
          task={
            commandBelongsToRepository(snapshot, selected) ? snapshot : null
          }
        />
      </ToolbarDropdown>
      {[repository, other].map(repo => (
        <RepositoryListItem
          key={repo.id}
          repository={repo}
          needsDisambiguation={false}
          matches={{ title: [], subtitle: [] }}
          aheadBehind={null}
          changedFilesCount={1}
          customCommandTask={snapshot}
        />
      ))}
    </>
  )
  const view = render(makeView(task, repository))
  const fills = () =>
    Array.from(
      view.container.querySelectorAll<HTMLElement>('.custom-command-fill')
    )
  assert.deepEqual(
    fills().map(fill => fill.style.width),
    ['42%', '42%']
  )
  assert.equal(
    view.container.querySelectorAll('.change-indicator-wrapper').length,
    2
  )
  view.rerender(makeView({ ...task, progress: 71 }, repository))
  assert.deepEqual(
    fills().map(fill => fill.style.width),
    ['71%', '71%']
  )
  view.rerender(makeView({ ...task, progress: 71 }, other))
  assert.deepEqual(
    fills().map(fill => fill.style.width),
    ['71%']
  )
  assert.equal(
    view.container.querySelector(
      '.repository-command-progress .custom-command-fill'
    ),
    null
  )
  view.rerender(makeView({ ...task, progress: undefined }, repository))
  assert.ok(fills().every(fill => fill.dataset.indeterminate === 'true'))
  view.rerender(makeView({ ...task, status: 'failed' }, repository))
  assert.equal(fills().length, 0)
  view.rerender(
    makeView({ ...task, status: 'succeeded', progress: 100 }, repository)
  )
  assert.deepEqual(
    fills().map(fill => fill.style.width),
    ['100%', '100%']
  )
})

it('retains worktree task ownership on the repository row, but not a different checkout title', () => {
  const repository = new Repository('C:\\repo\\worktree-one', 1, null, false)
  const selected = new Repository('C:\\repo\\worktree-two', 1, null, false)
  const task: ICustomCommandTask = {
    repository,
    command: { id: 'one', name: 'One', command: 'echo one' },
    expectedDurationMs: null,
    elapsedMs: 0,
    progress: undefined,
    status: 'running',
    message: 'Running...',
    stopError: null,
    closeWarning: false,
  }
  assert.equal(commandBelongsToRepository(task, selected), false)
  const view = render(
    <RepositoryListItem
      repository={selected}
      needsDisambiguation={false}
      matches={{ title: [], subtitle: [] }}
      aheadBehind={null}
      changedFilesCount={0}
      customCommandTask={task}
    />
  )
  assert.ok(view.container.querySelector('.custom-command-fill'))
})
