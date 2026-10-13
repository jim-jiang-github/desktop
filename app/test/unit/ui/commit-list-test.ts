import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as React from 'react'
import { GitResetMode } from '../../../src/lib/git/reset'
import { IMenuItem } from '../../../src/lib/menu-item'
import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { CommitList } from '../../../src/ui/history/commit-list'

type CommitListTestInstance = {
  props: React.ComponentProps<typeof CommitList>
  getContextMenuForSingleCommit: (
    row: number,
    commit: Commit
  ) => ReadonlyArray<IMenuItem>
}

describe('CommitList', () => {
  it('allows soft resetting to a previous published commit', () => {
    const commit = new Commit(
      'target-sha',
      'target',
      'Previous commit',
      '',
      new CommitIdentity('Author', 'author@example.com', new Date()),
      new CommitIdentity('Committer', 'committer@example.com', new Date()),
      [],
      [],
      []
    )
    let resetCall: { commit: Commit; mode?: GitResetMode } | null = null
    const list = new CommitList({
      gitHubRepository: null,
      commitSHAs: ['head-sha', commit.sha],
      commitLookup: new Map([[commit.sha, commit]]),
      selectedSHAs: [commit.sha],
      canResetToCommits: true,
      localCommitSHAs: [],
      emoji: new Map(),
      isLocalRepository: false,
      accounts: [],
      preferAbsoluteDates: true,
      disableReordering: false,
      isMultiCommitOperationInProgress: false,
      onResetToCommit: (c, m) => {
        resetCall = { commit: c, mode: m }
      },
    } as React.ComponentProps<typeof CommitList>) as unknown as CommitListTestInstance

    const softResetItem = list
      .getContextMenuForSingleCommit(1, commit)
      .find(
        item =>
          item.label === 'Soft reset to commit…' ||
          item.label === 'Soft Reset to Commit…'
      )

    assert.equal(softResetItem?.enabled, true)
    softResetItem?.action?.()
    assert.deepEqual(resetCall, { commit, mode: GitResetMode.Soft })

    const hardResetItem = list
      .getContextMenuForSingleCommit(1, commit)
      .find(
        item =>
          item.label === 'Hard reset to commit…' ||
          item.label === 'Hard Reset to Commit…'
      )

    assert.equal(hardResetItem?.enabled, true)
    resetCall = null
    hardResetItem?.action?.()
    assert.deepEqual(resetCall, { commit, mode: GitResetMode.Hard })
  })
})
