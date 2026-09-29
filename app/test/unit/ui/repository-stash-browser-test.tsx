import assert from 'node:assert/strict'
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
} from 'node:test'
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '../../helpers/ui/render'
import { ImageDiffType } from '../../../src/models/diff'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import {
  IRepositoryStashEntry,
  StashedChangesLoadStates,
} from '../../../src/models/stash-entry'
import { Repository } from '../../../src/models/repository'
import {
  AppFileStatusKind,
  CommittedFileChange,
} from '../../../src/models/status'
import { ConfirmDiscardStashDialog } from '../../../src/ui/stashing/confirm-discard-stash'
import { ConfirmRestoreStashDialog } from '../../../src/ui/stashing/confirm-restore-stash'
import { Popup, PopupType } from '../../../src/models/popup'
import type { IMenuItem } from '../../../src/lib/menu-item'

const loadFiles = mock.fn(
  async (_repo: Repository, entry: IRepositoryStashEntry) => [
    new CommittedFileChange(
      `${entry.stashSha}.txt`,
      { kind: AppFileStatusKind.New },
      entry.stashSha,
      ''
    ),
  ]
)
mock.module('../../../src/lib/git/stash.ts', {
  namedExports: { getRepositoryStashedFiles: loadFiles },
})
mock.module('../../../src/lib/git/diff.ts', {
  namedExports: { getCommitDiff: async () => null },
})
mock.module('../../../src/ui/diff/seamless-diff-switcher.tsx', {
  namedExports: {
    SeamlessDiffSwitcher: (props: { readonly file: CommittedFileChange }) => (
      <div data-testid="stash-preview">{props.file.path}</div>
    ),
  },
})
const showMenu = mock.fn(async (_items: ReadonlyArray<IMenuItem>) => {})
mock.module('../../../src/lib/menu-item.ts', {
  namedExports: { showContextualMenu: showMenu },
})
let RepositoryStashBrowser: typeof import('../../../src/ui/stashing/repository-stash-browser').RepositoryStashBrowser

describe('repository stash browser', () => {
  before(async () => {
    ;({ RepositoryStashBrowser } = await import(
      '../../../src/ui/stashing/repository-stash-browser'
    ))
  })
  const showModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    'showModal'
  )
  const close = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    'close'
  )
  let restoreSend: () => void
  let sidebarHost: HTMLDivElement
  const originalGlobalObserver = globalThis.ResizeObserver
  const originalWindowObserver = window.ResizeObserver
  const offsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth'
  )
  const offsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  )
  beforeEach(async () => {
    Object.defineProperties(HTMLElement.prototype, {
      offsetWidth: { configurable: true, get: () => 300 },
      offsetHeight: { configurable: true, get: () => 600 },
    })
    class ListResizeObserver implements ResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}
      public observe(target: Element) {
        Object.defineProperties(target, {
          offsetWidth: { configurable: true, value: 300 },
          offsetHeight: { configurable: true, value: 600 },
        })
        this.callback(
          [
            {
              target,
              contentRect: new DOMRect(0, 0, 300, 600),
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
    Object.assign(globalThis, { ResizeObserver: ListResizeObserver })
    Object.assign(window, { ResizeObserver: ListResizeObserver })
    sidebarHost = document.createElement('div')
    document.body.append(sidebarHost)
    const { ipcRenderer } = await import('electron')
    const send = ipcRenderer.send
    ipcRenderer.send = () => {}
    restoreSend = () => {
      ipcRenderer.send = send
    }
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true
      },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false
      },
    })
  })
  afterEach(() => {
    restoreSend()
    sidebarHost.remove()
    Object.assign(globalThis, { ResizeObserver: originalGlobalObserver })
    if (originalWindowObserver === undefined) {
      Reflect.deleteProperty(window, 'ResizeObserver')
    } else {
      Object.assign(window, { ResizeObserver: originalWindowObserver })
    }
  })
  after(() => {
    for (const [name, descriptor] of [
      ['offsetWidth', offsetWidth],
      ['offsetHeight', offsetHeight],
    ] as const) {
      if (descriptor !== undefined) {
        Object.defineProperty(HTMLElement.prototype, name, descriptor)
      }
    }
    for (const [name, descriptor] of [
      ['showModal', showModal],
      ['close', close],
    ] as const) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(HTMLDialogElement.prototype, name)
      } else {
        Object.defineProperty(HTMLDialogElement.prototype, name, descriptor)
      }
    }
  })

  async function setup() {
    const repository = new Repository('C:\\test\\checkout', 1, null, false)
    const entries: ReadonlyArray<IRepositoryStashEntry> = [
      'first',
      'second',
    ].map((sha, index) => ({
      stashSha: sha,
      name: `refs/stash@{${index}}`,
      branchName: 'branch',
      message: sha,
      createdAt: 1700000000000,
      isDesktopStash: false,
      tree: '',
      parents: [],
      files: { kind: StashedChangesLoadStates.NotLoaded },
    }))
    const dispatcher = {
      selectStashedFile: mock.fn(async () => {}),
      setStashedFilesWidth: mock.fn(async () => {}),
      resetStashedFilesWidth: mock.fn(async () => {}),
      dropStash: mock.fn(async () => {}),
      showPopup: mock.fn(async (_popup: Popup) => {}),
      setConfirmDiscardStashSetting: mock.fn(async () => {}),
      popStash: mock.fn(async () => {}),
      postError: mock.fn(async () => {}),
      refreshRepositoryStashes: mock.fn(async () => {}),
      applyRepositoryStash: mock.fn(
        async (_repository: Repository, _sha: string) => {}
      ),
      deleteRepositoryStash: mock.fn(
        async (_repository: Repository, _sha: string) => {}
      ),
      selectWorkingDirectoryFiles: mock.fn(async () => {}),
    }
    const element = (
      items: ReadonlyArray<IRepositoryStashEntry>,
      repo = repository
    ) => (
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <RepositoryStashBrowser
          key={repo.path}
          repository={repo}
          entries={items}
          dispatcher={dispatcher}
          imageDiffType={ImageDiffType.TwoUp}
          sidebarHost={sidebarHost}
          sidebarWidth={300}
          showSideBySideDiff={false}
          onOpenBinaryFile={() => {}}
          onChangeImageDiffType={() => {}}
          onHideWhitespaceInDiffChanged={() => {}}
          onOpenSubmodule={() => {}}
          onOpenInExternalEditor={() => {}}
        />
      </DialogStackContext.Provider>
    )
    const view = render(element(entries))
    await waitFor(() =>
      assert.equal(screen.getByTestId('stash-preview').textContent, 'first.txt')
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('option', { name: /^second,/ }))
    )
    return { repository, entries, dispatcher, view, element }
  }

  it('lists every stash and previews a selected entry without applying it', async () => {
    const { entries, dispatcher } = await setup()
    assert.equal(
      sidebarHost.querySelectorAll('.repository-stash-row').length,
      2
    )
    fireEvent.mouseDown(screen.getByRole('option', { name: /^second,/ }), {
      button: 0,
    })
    await waitFor(() =>
      assert.equal(
        screen.getByTestId('stash-preview').textContent,
        `${entries[1].stashSha}.txt`
      )
    )
    assert.equal(sidebarHost.querySelectorAll('.file-list').length, 1)
    assert.equal(
      document.querySelector('#repository-stash-detail .file-list'),
      null
    )
    assert.equal(dispatcher.applyRepositoryStash.mock.callCount(), 0)
  })

  it('restores only the selection and clearly reports that the stash is kept', async () => {
    const { dispatcher, repository, entries, view } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Restore…' }))
    assert.equal(dispatcher.applyRepositoryStash.mock.callCount(), 0)
    assert.deepEqual(dispatcher.showPopup.mock.calls[0].arguments, [
      {
        type: PopupType.ConfirmRestoreRepositoryStash,
        repository,
        stash: entries[0],
      },
    ])
    view.unmount()
    const dismissed = mock.fn()
    const confirmation = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmRestoreStashDialog
          repository={repository}
          stash={entries[0]}
          dispatcher={dispatcher}
          onDismissed={dismissed}
        />
      </DialogStackContext.Provider>
    )
    assert.ok(screen.getByText(repository.path))
    assert.ok(screen.getByText(/The stash will be kept/))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => assert.equal(dismissed.mock.callCount(), 1))
    assert.deepEqual(dispatcher.applyRepositoryStash.mock.calls[0].arguments, [
      repository,
      'first',
    ])
    assert.equal(dispatcher.deleteRepositoryStash.mock.callCount(), 0)
    confirmation.unmount()
  })

  it('requires confirmation before deleting and leaves cancellation untouched', async () => {
    const { dispatcher, repository, entries, view } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'More stash actions' }))
    const items =
      showMenu.mock.calls[showMenu.mock.calls.length - 1].arguments[0]
    assert.equal(items[0].label, 'Delete stash…')
    items[0].action?.()
    assert.deepEqual(dispatcher.showPopup.mock.calls[0].arguments, [
      {
        type: PopupType.ConfirmDiscardStash,
        repository,
        stash: entries[0],
        allStashes: true,
      },
    ])
    view.unmount()
    const dismissed = mock.fn()
    const dialog = (
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmDiscardStashDialog
          allStashes={true}
          dispatcher={dispatcher}
          repository={repository}
          stash={entries[0]}
          askForConfirmationOnDiscardStash={false}
          onDismissed={dismissed}
        />
      </DialogStackContext.Provider>
    )
    const confirmation = render(dialog)
    assert.ok(
      screen.getByRole('alertdialog', { name: 'Delete selected stash?' })
    )
    assert.equal(screen.queryByRole('checkbox'), null)
    assert.equal(dispatcher.deleteRepositoryStash.mock.callCount(), 0)
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      assert.equal(dismissed.mock.callCount(), 1)
    })
    assert.equal(dispatcher.deleteRepositoryStash.mock.callCount(), 0)
    assert.equal(dismissed.mock.callCount(), 1)
    confirmation.unmount()
    const reopened = render(dialog)
    fireEvent.click(screen.getByRole('button', { name: 'Delete stash' }))
    await waitFor(() =>
      assert.equal(dispatcher.deleteRepositoryStash.mock.callCount(), 1)
    )
    assert.deepEqual(dispatcher.deleteRepositoryStash.mock.calls[0].arguments, [
      repository,
      'first',
    ])
    reopened.unmount()
  })

  it('preserves selection across index changes and handles external removal and empty lists', async () => {
    const { entries, view, element } = await setup()
    fireEvent.mouseDown(screen.getByRole('option', { name: /^second,/ }), {
      button: 0,
    })
    view.rerender(element([...entries].reverse()))
    assert.equal(
      screen
        .getByRole('option', { name: /^second,/ })
        .getAttribute('aria-selected'),
      'true'
    )
    view.rerender(element([entries[0]]))
    await waitFor(() =>
      assert.equal(
        screen
          .getByRole('option', { name: /^first,/ })
          .getAttribute('aria-selected'),
        'true'
      )
    )
    view.rerender(element([]))
    assert.ok(screen.getByText('No stashed changes'))
  })

  it('resets preview when changing checkouts', async () => {
    const { view, element } = await setup()
    view.rerender(
      element([], new Repository('C:\\test\\another', 2, null, false))
    )
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(screen.queryByTestId('stash-preview'), null)
  })

  it('reports failed restore without deleting the stash', async () => {
    const { dispatcher, repository, entries, view } = await setup()
    view.unmount()
    dispatcher.applyRepositoryStash.mock.mockImplementation(async () => {
      throw new Error('conflict')
    })
    const dismissed = mock.fn()
    const confirmation = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmRestoreStashDialog
          repository={repository}
          stash={entries[0]}
          dispatcher={dispatcher}
          onDismissed={dismissed}
        />
      </DialogStackContext.Provider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      assert.match(
        screen.getByRole('status').textContent ?? '',
        /stash was kept/i
      )
    )
    assert.equal(screen.getByRole('alert').textContent, 'conflict')
    assert.equal(dispatcher.postError.mock.callCount(), 0)
    assert.equal(dispatcher.deleteRepositoryStash.mock.callCount(), 0)
    assert.equal(dismissed.mock.callCount(), 0)
    confirmation.unmount()
  })

  it('supports keyboard resizing with bounded stash and file pane heights', async () => {
    await setup()
    const divider = screen.getByRole('separator', {
      name: 'Stash and file list divider',
    })
    assert.equal(divider.getAttribute('aria-valuenow'), '220')
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    assert.equal(divider.getAttribute('aria-valuenow'), '236')
    fireEvent.keyDown(divider, { key: 'Home' })
    assert.equal(divider.getAttribute('aria-valuenow'), '112')
    fireEvent.keyDown(divider, { key: 'End' })
    assert.equal(divider.getAttribute('aria-valuenow'), '420')
  })

  it('keeps a failed deletion confirmation open with an accessible inline error', async () => {
    const { dispatcher, repository, entries, view } = await setup()
    view.unmount()
    dispatcher.deleteRepositoryStash.mock.mockImplementation(async () => {
      throw new Error('The stash is locked by another Git operation')
    })
    const dismissed = mock.fn()
    const confirmation = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ConfirmDiscardStashDialog
          allStashes={true}
          dispatcher={dispatcher}
          repository={repository}
          stash={entries[0]}
          askForConfirmationOnDiscardStash={true}
          onDismissed={dismissed}
        />
      </DialogStackContext.Provider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete stash' }))
    await waitFor(() =>
      assert.match(
        screen.getByRole('alert').textContent ?? '',
        /locked by another/
      )
    )
    assert.equal(dismissed.mock.callCount(), 0)
    assert.equal(dispatcher.postError.mock.callCount(), 0)
    confirmation.unmount()
  })
})
