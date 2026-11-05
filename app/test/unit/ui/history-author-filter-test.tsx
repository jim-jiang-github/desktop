import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as React from 'react'
import { fireEvent, render, screen } from '../../helpers/ui/render'
import { CompareSidebar } from '../../../src/ui/history/compare'
import { CommitList } from '../../../src/ui/history/commit-list'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { Repository } from '../../../src/models/repository'
import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { RepositoryStateCache } from '../../../src/lib/stores/repository-state-cache'
import { AheadBehindStore } from '../../../src/lib/stores/ahead-behind-store'
import { TestStatsStore } from '../../helpers/test-stats-store'
import { HistoryTabMode, ComparisonMode } from '../../../src/lib/app-state'
import { Branch, BranchType } from '../../../src/models/branch'

const repository = new Repository(__dirname, 1, null, false)
const originalResizeObserver = window.ResizeObserver

function createProps(
  authorFilterText = ''
): React.ComponentProps<typeof CompareSidebar> {
  const compareState = new RepositoryStateCache(new TestStatsStore()).get(
    repository
  ).compareState
  const dispatcher = {
    initializeCompare: mock.fn(),
    updateCompareForm: mock.fn(),
    setHistoryAuthorFilter: mock.fn(),
    changeCommitSelection: mock.fn(),
    loadChangedFilesForCurrentSelection: mock.fn(),
  } as unknown as Dispatcher
  return {
    repository,
    isLocalRepository: true,
    compareState: { ...compareState, authorFilterText },
    emoji: new Map(),
    commitLookup: new Map(),
    localCommitSHAs: [],
    askForConfirmationOnCheckoutCommit: true,
    dispatcher,
    currentBranch: null,
    selectedCommitShas: [],
    onRevertCommit: () => {},
    onAmendCommit: () => {},
    onViewCommitOnGitHub: () => {},
    onCompareListScrolled: () => {},
    onCherryPick: () => {},
    localTags: null,
    tagsToPush: null,
    aheadBehindStore: new AheadBehindStore(),
    shasToHighlight: [],
    accounts: [],
    preferAbsoluteDates: false,
  }
}

beforeEach(() => {
  window.ResizeObserver = globalThis.ResizeObserver
})
afterEach(() => {
  window.ResizeObserver = originalResizeObserver
  mock.restoreAll()
})

describe('History author filter', () => {
  it('adds a separate author field while preserving branch comparison', () => {
    const props = createProps()
    const setFilter = mock.method(props.dispatcher, 'setHistoryAuthorFilter')
    render(<CompareSidebar {...props} />)
    assert.ok(screen.getByRole('textbox', { name: 'Branch filter' }))
    const input = screen.getByRole('searchbox', {
      name: 'Filter commits by author',
    })
    fireEvent.change(input, { target: { value: 'alice@example.com' } })
    assert.deepStrictEqual(setFilter.mock.calls[0].arguments, [
      repository,
      'alice@example.com',
    ])
  })

  it('clears the filter and displays an explicit empty result', () => {
    const props = createProps('Alice')
    const setFilter = mock.method(props.dispatcher, 'setHistoryAuthorFilter')
    render(<CompareSidebar {...props} />)
    assert.ok(screen.getByText('No commits match this author'))
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    assert.ok(setFilter.mock.calls.some(call => call.arguments[1] === ''))
  })

  it('keeps cherry-pick available but disables position-dependent history actions', () => {
    const sidebar = new CompareSidebar(createProps('Alice'))
    const list: React.ReactElement<React.ComponentProps<typeof CommitList>> =
      sidebar['renderCommitList']()
    assert.strictEqual(list.props.canUndoCommits, false)
    assert.strictEqual(list.props.canAmendCommits, false)
    assert.strictEqual(list.props.reorderingEnabled, false)
    assert.strictEqual(list.props.disableSquashing, true)
    assert.strictEqual(list.props.disableReordering, true)
    assert.strictEqual(typeof list.props.onCherryPick, 'function')

    const unfiltered = new CompareSidebar(createProps())['renderCommitList']()
    assert.strictEqual(unfiltered.props.canUndoCommits, true)
    assert.strictEqual(unfiltered.props.canAmendCommits, true)
  })

  it('does not treat adjacent filtered commits as a contiguous unfiltered diff', () => {
    const props = createProps('Alice')
    const selection = mock.method(props.dispatcher, 'changeCommitSelection')
    const sidebar = new CompareSidebar(props)
    const author = new CommitIdentity('Alice', 'alice@example.com', new Date(0))
    const commits = ['newer', 'older'].map(
      sha => new Commit(sha, sha, sha, '', author, author, [], [], [])
    )
    sidebar['onCommitsSelected'](commits, true)
    assert.deepStrictEqual(selection.mock.calls[0].arguments, [
      repository,
      ['newer', 'older'],
      false,
    ])
    sidebar['onCommitsSelected']([commits[0]], true)
    assert.strictEqual(selection.mock.calls[1].arguments[2], true)
    sidebar['loadChangedFilesScheduler'].clear()
  })

  it('applies the author field in branch comparisons and disables it during multi-commit operations', () => {
    const props = createProps('Alice')
    const branch = new Branch(
      'topic',
      null,
      { sha: 'tip' },
      BranchType.Local,
      'refs/heads/topic'
    )
    render(
      <CompareSidebar
        {...props}
        isMultiCommitOperationInProgress={true}
        compareState={{
          ...props.compareState,
          formState: {
            kind: HistoryTabMode.Compare,
            comparisonMode: ComparisonMode.Ahead,
            comparisonBranch: branch,
            aheadBehind: { ahead: 5, behind: 0 },
          },
        }}
      />
    )
    const input = screen.getByRole('searchbox', {
      name: 'Filter commits by author',
    })
    assert.ok(input instanceof HTMLInputElement)
    assert.strictEqual(input.value, 'Alice')
    assert.strictEqual(input.disabled, true)
    assert.ok(screen.getByText('Ahead (5)'))
  })
})
