import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as React from 'react'
import { ipcRenderer } from 'electron'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { Popup, PopupType } from '../../../src/models/popup'
import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  CommittedFileChange,
} from '../../../src/models/status'
import { ImageDiffType } from '../../../src/models/diff'
import { ISerializableMenuItem } from '../../../src/lib/menu-item'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { ConfirmRevertFileChangesDialog } from '../../../src/ui/history/confirm-revert-file-changes'
import { SelectedCommits } from '../../../src/ui/history/selected-commits'
import { RevealInFileManagerLabel } from '../../../src/ui/lib/context-menu'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'

const repository = new Repository(__dirname, 1, null, false)

function createCommit(parents: ReadonlyArray<string> = ['parent']) {
  const identity = new CommitIdentity(
    'Author',
    'author@example.com',
    new Date(0)
  )
  return new Commit(
    '1234567890abcdef',
    '1234567',
    'Change this file',
    '',
    identity,
    identity,
    parents,
    [],
    []
  )
}

function createFile(commit: Commit, deleted = false) {
  return new CommittedFileChange(
    'file.txt',
    { kind: deleted ? AppFileStatusKind.Deleted : AppFileStatusKind.Modified },
    commit.sha,
    'parent'
  )
}

const originalSend = ipcRenderer.send
const originalResizeObserver = window.ResizeObserver
const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
)
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
)
beforeEach(() => {
  ipcRenderer.send = () => {}
  window.ResizeObserver = globalThis.ResizeObserver
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(() => {
  mock.restoreAll()
  ipcRenderer.send = originalSend
  window.ResizeObserver = originalResizeObserver
  for (const [name, descriptor] of [
    ['showModal', showModalDescriptor],
    ['close', closeDescriptor],
  ] as const) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLDialogElement.prototype, name)
    } else {
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
    }
  }
})

describe('ConfirmRevertFileChangesDialog', () => {
  it('shows the selected file and commit and only reverts after confirmation', async () => {
    const commit = createCommit()
    const file = createFile(commit)
    const onRevert = mock.fn(async () => {})
    const onDismissed = mock.fn()
    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmRevertFileChangesDialog
          repository={repository}
          commit={commit}
          file={file}
          onRevert={onRevert}
          onDismissed={onDismissed}
        />
      </DialogStackContext.Provider>
    )
    const dialog = screen.getByRole('alertdialog', { hidden: true })
    assert.strictEqual(
      dialog.getAttribute('aria-describedby'),
      'revert-file-changes-description'
    )
    assert.ok(screen.getByText('file.txt'))
    assert.ok(screen.getByText('1234567'))
    assert.ok(screen.getByText(/No commit will be created automatically/))
    assert.strictEqual(onRevert.mock.callCount(), 0)

    fireEvent.click(
      screen.getByRole('button', { name: 'Revert changes', hidden: true })
    )
    await waitFor(() => assert.strictEqual(onDismissed.mock.callCount(), 1))
    assert.deepStrictEqual(onRevert.mock.calls[0].arguments, [
      repository,
      commit,
      file,
    ])
  })

  it('does not revert when cancelled', { timeout: 5000 }, async () => {
    const commit = createCommit()
    const onRevert = mock.fn(async () => {})
    const onDismissed = mock.fn()
    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmRevertFileChangesDialog
          repository={repository}
          commit={commit}
          file={createFile(commit)}
          onRevert={onRevert}
          onDismissed={onDismissed}
        />
      </DialogStackContext.Provider>
    )
    const dialog = screen.getByRole('alertdialog', { hidden: true })
    await new Promise<void>(resolve => {
      dialog.addEventListener('dialog-appeared', () => resolve(), {
        once: true,
      })
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel', hidden: true })
    )
    assert.strictEqual(onRevert.mock.callCount(), 0)
    assert.strictEqual(onDismissed.mock.callCount(), 1)
  })

  it('explains the first parent for merges and disables actions while reverting', async () => {
    const commit = createCommit(['first', 'second'])
    let complete: (() => void) | undefined
    const onRevert = mock.fn(
      () =>
        new Promise<void>(resolve => {
          complete = resolve
        })
    )
    const onDismissed = mock.fn()
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmRevertFileChangesDialog
          repository={repository}
          commit={commit}
          file={createFile(commit)}
          onRevert={onRevert}
          onDismissed={onDismissed}
        />
      </DialogStackContext.Provider>
    )
    assert.ok(screen.getByText(/first parent/))
    fireEvent.click(
      screen.getByRole('button', { name: 'Revert changes', hidden: true })
    )
    assert.strictEqual(view.container.querySelector('fieldset')?.disabled, true)
    assert.strictEqual(onDismissed.mock.callCount(), 0)
    assert.ok(complete)
    complete()
    await waitFor(() => assert.strictEqual(onDismissed.mock.callCount(), 1))
    assert.strictEqual(onRevert.mock.callCount(), 1)
  })
})

describe('History file revert menu', () => {
  for (const multiple of [false, true]) {
    it(`${
      multiple
        ? 'disables the action for multiple commits'
        : 'offers the action for a deleted file'
    }`, async () => {
      mock.getter(HTMLElement.prototype, 'offsetWidth', () => 300)
      mock.getter(HTMLElement.prototype, 'offsetHeight', () => 300)
      window.ResizeObserver = class implements ResizeObserver {
        public constructor(private readonly callback: ResizeObserverCallback) {}

        public observe(target: Element) {
          this.callback(
            [
              {
                target,
                contentRect: target.getBoundingClientRect(),
                borderBoxSize: [],
                contentBoxSize: [],
                devicePixelContentBoxSize: [],
              },
            ],
            this
          )
        }

        public unobserve() {}

        public disconnect() {}
      }
      const commit = createCommit()
      const file = createFile(commit, true)
      const popups = new Array<Popup>()
      const dispatcher = {
        showPopup: async (popup: Popup) => {
          popups.push(popup)
        },
      } as Dispatcher
      let menu: ReadonlyArray<ISerializableMenuItem> | undefined
      mock.method(
        ipcRenderer,
        'invoke',
        async (
          channel: string,
          items: ReadonlyArray<ISerializableMenuItem>
        ) => {
          if (channel === 'show-contextual-menu') {
            menu = items
            const index = items.findIndex(item =>
              item.label?.includes('Revert')
            )
            return multiple ? null : [index]
          }
          return undefined
        }
      )
      render(
        <SelectedCommits
          repository={repository}
          dispatcher={dispatcher}
          emoji={new Map()}
          selectedCommits={multiple ? [commit, createCommit()] : [commit]}
          shasInDiff={[commit.sha]}
          localCommitSHAs={[]}
          changesetData={{ files: [file], linesAdded: 0, linesDeleted: 1 }}
          selectedFile={null}
          currentDiff={null}
          commitSummaryWidth={{ value: 300, min: 100, max: 600 }}
          selectedDiffType={ImageDiffType.TwoUp}
          onOpenInExternalEditor={() => {}}
          onViewCommitOnGitHub={() => {}}
          hideWhitespaceInDiff={false}
          showSideBySideDiff={false}
          onOpenBinaryFile={() => {}}
          onOpenSubmodule={() => {}}
          onChangeImageDiffType={() => {}}
          onDiffOptionsOpened={() => {}}
          showDragOverlay={false}
          isContiguous={true}
          accounts={[]}
        />
      )
      const row = await screen.findByText('file.txt')
      fireEvent.contextMenu(row)
      await waitFor(() => assert.ok(menu))
      assert.ok(menu)
      const revertItem = menu.find(item => item.label?.includes('Revert'))
      assert.ok(revertItem)
      assert.strictEqual(revertItem.enabled, !multiple)
      assert.strictEqual(
        menu.find(item => item.label === RevealInFileManagerLabel)?.enabled,
        false
      )
      if (!multiple) {
        await waitFor(() => assert.strictEqual(popups.length, 1))
        assert.deepStrictEqual(popups[0], {
          type: PopupType.ConfirmRevertFileChanges,
          repository,
          commit,
          file,
        })
      } else {
        assert.strictEqual(popups.length, 0)
      }
    })
  }
})
