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
  historySearchText = ''
): React.ComponentProps<typeof CompareSidebar> {
  const compareState = new RepositoryStateCache(new TestStatsStore()).get(
    repository
  ).compareState
  const dispatcher = {
    initializeCompare: mock.fn(),
    updateCompareForm: mock.fn(),
    executeCompare: mock.fn(),
    setHistorySearchText: mock.fn(),
    setHistoryGraphEnabled: mock.fn(),
    changeCommitSelection: mock.fn(),
    loadChangedFilesForCurrentSelection: mock.fn(),
    loadNextCommitBatch: mock.fn(async () => {}),
  } as unknown as Dispatcher
  return {
    repository,
    isLocalRepository: true,
    compareState: { ...compareState, historySearchText },
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

describe('History search', () => {
  it('adds a separate author or title field while preserving branch comparison', () => {
    const props = createProps()
    const setFilter = mock.method(props.dispatcher, 'setHistorySearchText')
    render(<CompareSidebar {...props} />)
    assert.ok(screen.getByRole('textbox', { name: 'Branch filter' }))
    const input = screen.getByRole('searchbox', {
      name: 'Search commits by author, title, or description',
    })
    fireEvent.change(input, { target: { value: 'release fix' } })
    assert.deepStrictEqual(setFilter.mock.calls[0].arguments, [
      repository,
      'release fix',
    ])
  })

  it('clears the filter and displays an explicit empty result', () => {
    const props = createProps('Alice')
    const setFilter = mock.method(props.dispatcher, 'setHistorySearchText')
    render(<CompareSidebar {...props} />)
    assert.ok(screen.getByText('No commits match this search'))
    const search = screen.getByRole('searchbox', {
      name: 'Search commits by author, title, or description',
    })
    assert.ok(search instanceof HTMLInputElement)
    assert.strictEqual(screen.queryByRole('button', { name: 'Clear' }), null)
    search.value = ''
    fireEvent(search, new Event('search'))
    assert.ok(setFilter.mock.calls.some(call => call.arguments[1] === ''))
  })

  it('navigates between matching commits from the search controls and keyboard', () => {
    const props = createProps('Alice')
    const author = new CommitIdentity('Alice', 'alice@example.com', new Date(0))
    const commits = ['newer', 'middle', 'older'].map(
      sha => new Commit(sha, sha, sha, '', author, author, [], [], [])
    )
    const compareState = {
      ...props.compareState,
      commitSHAs: commits.map(commit => commit.sha),
    }
    const nextProps = {
      ...props,
      compareState,
      commitLookup: new Map(commits.map(commit => [commit.sha, commit])),
      selectedCommitShas: ['newer'],
    }
    const selection = mock.method(props.dispatcher, 'changeCommitSelection')
    const sidebarRef = React.createRef<CompareSidebar>()
    const view = render(<CompareSidebar ref={sidebarRef} {...nextProps} />)

    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Previous matching commit' })
        .getAttribute('aria-disabled'),
      'true'
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Next matching commit' })
    )
    assert.deepStrictEqual(selection.mock.calls[0].arguments, [
      repository,
      ['middle'],
      true,
    ])

    view.rerender(
      <CompareSidebar {...nextProps} selectedCommitShas={['middle']} />
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Previous matching commit' })
        .getAttribute('aria-disabled'),
      null
    )
    const search = screen.getByRole('searchbox', {
      name: 'Search commits by author, title, or description',
    })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    assert.deepStrictEqual(selection.mock.calls[1].arguments, [
      repository,
      ['older'],
      true,
    ])

    view.rerender(
      <CompareSidebar {...nextProps} selectedCommitShas={['older']} />
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Next matching commit' })
        .getAttribute('aria-disabled'),
      'true'
    )

    sidebarRef.current?.['loadChangedFilesScheduler'].clear()
    view.unmount()
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
      name: 'Search commits by author, title, or description',
    })
    assert.ok(input instanceof HTMLInputElement)
    assert.strictEqual(input.value, 'Alice')
    assert.strictEqual(input.disabled, true)
    assert.ok(screen.getByText('Ahead (5)'))
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Hide commit graph' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })

  it('labels every node and keeps merged commits on the two comparison lanes', () => {
    const props = createProps()
    const branch = new Branch(
      'develop',
      null,
      { sha: 'develop-tip' },
      BranchType.Local,
      'refs/heads/develop'
    )
    const formState = {
      kind: HistoryTabMode.Compare,
      comparisonMode: ComparisonMode.Graph,
      comparisonBranch: branch,
      mergeBase: 'base',
      aheadBehind: { ahead: 3, behind: 2 },
    } as const
    const author = new CommitIdentity('Alice', 'alice@example.com', new Date(0))
    const commits = [
      new Commit(
        'topic-tip',
        'topic',
        'Topic change',
        '',
        author,
        author,
        ['base'],
        [],
        []
      ),
      new Commit(
        'develop-tip',
        'develop',
        'Develop change',
        '',
        author,
        author,
        ['base', 'merged-tip'],
        [],
        []
      ),
      new Commit(
        'merged-tip',
        'merged',
        'Merged change',
        '',
        author,
        author,
        ['base'],
        [],
        []
      ),
      new Commit(
        'base',
        'base',
        'Shared commit',
        '',
        author,
        author,
        [],
        [],
        []
      ),
    ]
    const compareState = {
      ...props.compareState,
      formState,
      branches: [branch],
      commitSHAs: commits.map(commit => commit.sha),
      showCommitGraph: false,
    }
    const currentBranch = new Branch(
      'topic',
      null,
      { sha: 'topic-tip' },
      BranchType.Local,
      'refs/heads/topic'
    )
    const nextProps = {
      ...props,
      compareState,
      currentBranch,
      commitLookup: new Map(commits.map(commit => [commit.sha, commit])),
    }
    const executeCompare = mock.method(props.dispatcher, 'executeCompare')
    const selection = mock.method(props.dispatcher, 'changeCommitSelection')
    const sidebar = React.createRef<CompareSidebar>()
    const view = render(<CompareSidebar {...nextProps} ref={sidebar} />)
    assert.ok(screen.getByText('Behind (2)'))
    assert.ok(screen.getByText('Ahead (3)'))
    assert.ok(screen.getByText('Graph'))
    const diagram = screen.getByRole('region', {
      name: 'Branch comparison graph',
    })
    assert.ok(screen.getByText('Branches have diverged'))
    const left = screen.getByRole('group', { name: 'develop' })
    const right = screen.getByRole('group', { name: 'topic' })
    assert.ok(left.contains(screen.getByText('Develop change')))
    assert.ok(left.contains(screen.getByText('Merged change')))
    assert.ok(right.contains(screen.getByText('Topic change')))
    assert.strictEqual(left.contains(screen.getByText('Topic change')), false)
    assert.strictEqual(
      right.contains(screen.getByText('Develop change')),
      false
    )
    const shared = screen.getByRole('group', { name: 'Common ancestor' })
    assert.strictEqual(
      shared.querySelectorAll('.branch-graph-connector').length,
      2
    )
    assert.strictEqual(view.container.querySelector('.commit-list-item'), null)
    const node = screen.getByRole('button', { name: /Topic change/ })
    assert.ok(diagram.contains(node))
    assert.ok(screen.getByText('Topic change'))
    assert.ok(screen.getByText('Develop change'))
    assert.ok(
      screen.getByText('Merged change').closest('.branch-graph-color-0')
    )
    assert.ok(screen.getByText('Shared commit'))
    assert.ok(screen.getByText('Merge base'))
    assert.ok(
      shared.contains(screen.getByRole('button', { name: /Shared commit/ }))
    )
    assert.strictEqual(left.contains(screen.getByText('Shared commit')), false)
    assert.strictEqual(right.contains(screen.getByText('Shared commit')), false)
    assert.strictEqual(node.querySelector('code')?.textContent, 'topic')
    fireEvent.click(node)
    assert.deepStrictEqual(selection.mock.calls[0].arguments, [
      repository,
      ['topic-tip'],
      true,
    ])
    assert.strictEqual(
      screen.queryByRole('button', { name: 'Show commit graph' }),
      null
    )

    fireEvent.click(screen.getByText('Graph'))
    assert.deepStrictEqual(executeCompare.mock.calls[0].arguments, [
      repository,
      {
        kind: HistoryTabMode.Compare,
        branch,
        comparisonMode: ComparisonMode.Graph,
      },
    ])

    view.rerender(
      <CompareSidebar
        {...nextProps}
        ref={sidebar}
        currentBranch={
          new Branch(
            'topic',
            null,
            { sha: 'base' },
            BranchType.Local,
            'refs/heads/topic'
          )
        }
        compareState={{
          ...compareState,
          formState: { ...formState, aheadBehind: { ahead: 0, behind: 2 } },
          commitSHAs: commits.slice(1).map(commit => commit.sha),
        }}
      />
    )
    assert.ok(screen.getByText('Comparison branch contains the current branch'))
    const containedBase = screen.getByRole('group', { name: 'Common ancestor' })
    assert.strictEqual(
      containedBase.querySelectorAll('.branch-graph-connector').length,
      1
    )
    assert.ok(
      containedBase.querySelector(
        '.branch-graph-color-0.branch-graph-connector'
      )
    )
    assert.ok(
      containedBase.contains(screen.getByText('Current branch tip: topic'))
    )
    fireEvent.click(screen.getByRole('button', { name: /Shared commit/ }))
    assert.deepStrictEqual(selection.mock.calls[1].arguments, [
      repository,
      ['base'],
      true,
    ])
    sidebar.current?.['loadChangedFilesScheduler'].clear()
  })

  it('shows graph mode by default and explains the dimmed search context', () => {
    const props = createProps('fix')
    const toggle = mock.method(props.dispatcher, 'setHistoryGraphEnabled')
    const view = render(<CompareSidebar {...props} />)
    const graphToggle = screen.getByRole('button', {
      name: 'Hide commit graph',
      pressed: true,
    })
    assert.ok(graphToggle.querySelector('svg'))
    assert.strictEqual(graphToggle.textContent, '')
    fireEvent.click(graphToggle)
    assert.deepStrictEqual(toggle.mock.calls[0].arguments, [repository, false])
    view.rerender(
      <CompareSidebar
        {...props}
        compareState={{ ...props.compareState, showCommitGraph: true }}
      />
    )
    assert.ok(
      screen.getByRole('button', {
        name: 'Hide commit graph',
        pressed: true,
      })
    )
    assert.ok(screen.getByText(/Other commits remain visible/))
    const sidebar = new CompareSidebar({
      ...props,
      compareState: { ...props.compareState, showCommitGraph: true },
    })
    const list = sidebar['renderCommitList']()
    assert.strictEqual(list.props.showCommitGraph, true)
    assert.strictEqual(list.props.historySearchText, 'fix')
    assert.strictEqual(list.props.disableReordering, true)
    assert.strictEqual(typeof list.props.onCherryPick, 'function')
  })

  it('allows the commit graph to be shown again', () => {
    const props = createProps()
    const toggle = mock.method(props.dispatcher, 'setHistoryGraphEnabled')
    render(
      <CompareSidebar
        {...props}
        compareState={{ ...props.compareState, showCommitGraph: false }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show commit graph' }))
    assert.deepStrictEqual(toggle.mock.calls[0].arguments, [repository, true])
  })
})
