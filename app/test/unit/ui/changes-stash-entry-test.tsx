import assert from 'node:assert/strict'
import { afterEach, before, describe, it, mock } from 'node:test'
import * as React from 'react'
import { render, screen, fireEvent } from '../../helpers/ui/render'
import { createState } from '../../helpers/changes-state-helper'
import { Repository } from '../../../src/models/repository'
import {
  IStashEntry,
  StashedChangesLoadStates,
} from '../../../src/models/stash-entry'
import type { Dispatcher } from '../../../src/ui/dispatcher'

mock.module('../../../src/ui/changes/commit-message-avatar.tsx', {
  namedExports: { CommitMessageAvatar: () => null },
})
let FilterChangesList: typeof import('../../../src/ui/changes/filter-changes-list').FilterChangesList

const stashEntry: IStashEntry = {
  name: 'refs/stash@{0}',
  branchName: 'main',
  stashSha: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  parents: [],
  files: { kind: StashedChangesLoadStates.NotLoaded },
}

function createProps(
  dispatcher: Dispatcher
): React.ComponentProps<typeof FilterChangesList> {
  const state = createState({})
  return {
    ...state,
    repository: new Repository('C:\\test-repository', 1, null, false),
    repositoryAccount: null,
    mostRecentLocalCommit: null,
    rebaseConflictState: null,
    selectedFileIDs: [],
    onFileSelectionChanged: () => {},
    onIncludeChanged: () => {},
    onCreateCommit: async () => false,
    onDiscardChanges: () => {},
    askForConfirmationOnDiscardChanges: true,
    askForConfirmationOnCommitFilteredChanges: true,
    focusCommitMessage: false,
    isShowingModal: false,
    isShowingFoldout: false,
    onDiscardChangesFromFiles: () => {},
    onChangesListScrolled: () => {},
    onOpenItem: () => {},
    onOpenItemInExternalEditor: () => {},
    branch: 'main',
    commitAuthor: null,
    dispatcher,
    availableWidth: 300,
    isCommitting: false,
    hookProgress: null,
    isGeneratingCommitMessage: false,
    shouldShowGenerateCommitMessageCallOut: false,
    commitToAmend: null,
    aheadBehind: null,
    autocompletionProviders: [],
    onIgnoreFile: () => {},
    onIgnorePattern: () => {},
    isShowingStashEntry: false,
    shouldNudgeToCommit: false,
    commitSpellcheckEnabled: false,
    showCommitLengthWarning: false,
    accounts: [],
    showChangesFilter: false,
    skipCommitHooks: false,
    signOffCommits: false,
    allowEmptyCommit: false,
    onUpdateCommitOptions: () => {},
  }
}

describe('Changes sidebar stash entry', () => {
  before(async () => {
    ;({ FilterChangesList } = await import(
      '../../../src/ui/changes/filter-changes-list'
    ))
  })
  const channel = __RELEASE_CHANNEL__
  const observer = window.ResizeObserver
  afterEach(() => {
    Object.defineProperty(globalThis, '__RELEASE_CHANNEL__', {
      value: channel,
      configurable: true,
    })
    Object.assign(window, { ResizeObserver: observer })
  })

  for (const releaseChannel of ['custom', 'production']) {
    for (const hasStash of [false, true]) {
      it(`${releaseChannel}: ${hasStash ? 'with' : 'without'} a stash`, () => {
        Object.defineProperty(globalThis, '__RELEASE_CHANNEL__', {
          value: releaseChannel,
          configurable: true,
        })
        Object.assign(window, {
          ResizeObserver: globalThis.ResizeObserver,
        })
        let selected = 0
        const dispatcher: Pick<
          Dispatcher,
          'selectStashedFile' | 'incrementMetric' | 'setCommitMessage'
        > = {
          selectStashedFile: async () => {
            selected++
          },
          incrementMetric: async () => {},
          setCommitMessage: async () => {},
        }
        const props = {
          ...createProps(dispatcher as Dispatcher),
          stashEntry: hasStash ? stashEntry : null,
        }
        const view = render(<FilterChangesList {...props} />)
        const button = screen.queryByRole('button', {
          name: /^Stashed Changes/,
        })
        if (releaseChannel === 'custom' || !hasStash) {
          assert.ok(
            button === null,
            'The old stash button must not be rendered'
          )
          assert.ok(
            view.container.querySelector('.stashed-changes-button') === null
          )
        } else {
          assert.ok(button)
          assert.equal(button.tabIndex, 0)
          fireEvent.click(button)
          assert.equal(selected, 1)
        }
        assert.ok(view.container.querySelector('.summary-field input'))
        assert.ok(screen.getByPlaceholderText('Description'))
      })
    }
  }
})
