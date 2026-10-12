import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ForcePushBranchState,
  getCurrentBranchForcePushState,
} from '../../src/lib/rebase'
import { Repository } from '../../src/models/repository'
import { createTestRepositoryStateCache } from '../helpers/app-store-test-harness'

describe('force push availability', () => {
  const repository = new Repository('C:\\repo', 1, null, false)
  const { branchesState } = createTestRepositoryStateCache().get(repository)

  it('offers force push after resetting behind the upstream without local commits', () => {
    assert.equal(
      getCurrentBranchForcePushState(branchesState, { ahead: 0, behind: 1 }),
      ForcePushBranchState.Available
    )
  })

  it('still offers force push for a diverged branch', () => {
    assert.equal(
      getCurrentBranchForcePushState(branchesState, { ahead: 1, behind: 1 }),
      ForcePushBranchState.Available
    )
  })

  it('does not offer force push without an upstream or without remote commits to overwrite', () => {
    for (const aheadBehind of [
      null,
      { ahead: 0, behind: 0 },
      { ahead: 1, behind: 0 },
    ]) {
      assert.equal(
        getCurrentBranchForcePushState(branchesState, aheadBehind),
        ForcePushBranchState.NotAvailable
      )
    }
  })
})
