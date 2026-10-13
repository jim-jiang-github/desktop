import assert from 'node:assert/strict'
import { it, mock } from 'node:test'
import * as React from 'react'
import { Branch, BranchType } from '../../../src/models/branch'
import { Repository } from '../../../src/models/repository'
import type { Popup } from '../../../src/models/popup'
import { UncommittedChangesStrategy } from '../../../src/models/uncommitted-changes-strategy'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { StashAndSwitchBranch } from '../../../src/ui/stash-changes/stash-and-switch-branch-dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

it('switches branches with the chosen stash strategy without an overwrite confirmation', async t => {
  const { ipcRenderer } = await import('electron')
  const send = ipcRenderer.send
  ipcRenderer.send = () => {}
  t.after(() => {
    ipcRenderer.send = send
  })
  for (const name of ['showModal', 'close'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      name
    )
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = name === 'showModal'
      },
    })
    t.after(() => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(HTMLDialogElement.prototype, name)
      } else {
        Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      }
    })
  }
  const repository = new Repository('C:\\test-repository', 1, null, false)
  const branch = new Branch(
    'main',
    null,
    { sha: 'a'.repeat(40) },
    BranchType.Local,
    'refs/heads/main'
  )
  const target = new Branch(
    'other',
    null,
    branch.tip,
    BranchType.Local,
    'refs/heads/other'
  )
  const checkoutBranch = mock.fn(
    async (
      _repository: Repository,
      _branch: Branch,
      _strategy?: UncommittedChangesStrategy
    ) => repository
  )
  const showPopup = mock.fn(async (_popup: Popup) => {})
  const dispatcher: Pick<Dispatcher, 'checkoutBranch' | 'showPopup'> = {
    checkoutBranch,
    showPopup,
  }
  const dismissed = mock.fn()
  const view = render(
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <StashAndSwitchBranch
        repository={repository}
        dispatcher={dispatcher as Dispatcher}
        currentBranch={branch}
        branchToCheckout={target}
        onDismissed={dismissed}
      />
    </DialogStackContext.Provider>
  )
  t.after(() => view.unmount())

  assert.equal(screen.queryByText(/overwrit/i), null)
  fireEvent.click(screen.getByRole('button', { name: 'Switch branch' }))
  await waitFor(() => assert.equal(dismissed.mock.callCount(), 1))
  assert.deepEqual(checkoutBranch.mock.calls[0].arguments, [
    repository,
    target,
    UncommittedChangesStrategy.StashOnCurrentBranch,
  ])
  assert.equal(showPopup.mock.callCount(), 0)
})
