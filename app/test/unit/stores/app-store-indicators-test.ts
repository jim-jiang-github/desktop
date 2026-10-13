import assert from 'node:assert'
import { after, before, describe, it, mock } from 'node:test'
import type { AppStore } from '../../../src/lib/stores/app-store'
import type { TestStatsDatabase } from '../../helpers/databases/test-stats-database'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'dugite'
import { Branch, BranchType } from '../../../src/models/branch'
import { TipState } from '../../../src/models/tip'
import { CloningRepository } from '../../../src/models/cloning-repository'
import { Repository } from '../../../src/models/repository'
import {
  IRepositoryStashEntry,
  StashedChangesLoadStates,
} from '../../../src/models/stash-entry'

describe('AppStore repository indicators', () => {
  let appStore: AppStore
  let statsDb: TestStatsDatabase | undefined
  let getStashes: typeof import('../../../src/lib/git/stash').getStashes
  let setupEmptyRepository: typeof import('../../helpers/repositories').setupEmptyRepository
  let restoreTimeout: () => void

  after(() => {
    statsDb?.close()
    mock.restoreAll()
  })

  before(async () => {
    mock.module('../../../src/ui/main-process-proxy', {
      namedExports: {
        ...(await import('../../../src/ui/main-process-proxy')),
        getAppMenu: () => {},
        updateMenuState: () => {},
      },
    })
    const { AppStore } = await import('../../../src/lib/stores/app-store')
    const { AliveStore } = await import('../../../src/lib/stores/alive-store')
    const { CopilotStore } = await import(
      '../../../src/lib/stores/copilot-store'
    )
    const { NotificationsStore } = await import(
      '../../../src/lib/stores/notifications-store'
    )
    const { PullRequestCoordinator } = await import(
      '../../../src/lib/stores/pull-request-coordinator'
    )
    const { createTestStores } = await import(
      '../../helpers/app-store-test-harness'
    )
    const { StatsStore } = await import('../../../src/lib/stats')
    const { TestStatsDatabase } = await import(
      '../../helpers/databases/test-stats-database'
    )
    const { TestActivityMonitor } = await import(
      '../../helpers/test-activity-monitor'
    )
    const { fakePost } = await import('../../fake-stats-post')
    ;({ getStashes } = await import('../../../src/lib/git/stash'))
    ;({ setupEmptyRepository } = await import('../../helpers/repositories'))
    const timeoutMock = mock.method(window, 'setTimeout', () => 0)
    restoreTimeout = () => timeoutMock.mock.restore()
    mock.method(window, 'addEventListener', () => {})

    const stores = createTestStores()
    statsDb = new TestStatsDatabase()
    await statsDb.reset()
    const statsStore = new StatsStore(
      statsDb,
      new TestActivityMonitor(),
      fakePost
    )
    const pullRequestCoordinator = new PullRequestCoordinator(
      stores.pullRequestStore,
      stores.repositoriesStore
    )
    const notificationsStore = new NotificationsStore(
      stores.accountsStore,
      new AliveStore(stores.accountsStore),
      pullRequestCoordinator,
      statsStore
    )
    appStore = new AppStore(
      stores.gitHubUserStore,
      stores.cloningRepositoriesStore,
      stores.issuesStore,
      statsStore,
      stores.signInStore,
      stores.accountsStore,
      stores.repositoriesStore,
      pullRequestCoordinator,
      stores.repositoryStateCache,
      stores.apiRepositoriesStore,
      notificationsStore,
      new CopilotStore(stores.accountsStore)
    )
  })

  it('excludes the selected repository when its instance has changed', () => {
    const repository = new Repository('/repositories/selected', 1, null, false)
    const updatedRepository = new Repository(
      repository.path,
      repository.id,
      null,
      false,
      'Updated alias'
    )
    const otherRepository = new Repository(
      '/repositories/other',
      2,
      null,
      false
    )
    appStore['repositories'] = [updatedRepository, otherRepository]
    appStore['selectedRepository'] = repository

    assert.notStrictEqual(repository, updatedRepository)
    assert.notStrictEqual(repository.hash, updatedRepository.hash)
    assert.deepStrictEqual(
      appStore['repositoryIndicatorUpdater']['getRepositories'](),
      [otherRepository]
    )
  })

  it('excludes the selected repository when its instance is unchanged', () => {
    const repository = new Repository('/repositories/selected', 1, null, false)
    appStore['repositories'] = [repository]
    appStore['selectedRepository'] = repository

    assert.deepStrictEqual(
      appStore['repositoryIndicatorUpdater']['getRepositories'](),
      []
    )
  })

  it('returns a copy of all repositories when none is selected', () => {
    const repositories = [
      new Repository('/repositories/first', 1, null, false),
      new Repository('/repositories/second', 2, null, false),
    ]
    appStore['repositories'] = repositories
    appStore['selectedRepository'] = null

    const result = appStore['repositoryIndicatorUpdater']['getRepositories']()

    assert.deepStrictEqual(result, repositories)
    assert.notStrictEqual(result, repositories)
  })

  it('keeps local repositories when a cloning repository is selected', () => {
    const selectedRepository = new CloningRepository(
      '/repositories/cloning',
      'https://github.com/desktop/cloning.git'
    )
    const repositories = [
      new Repository('/repositories/local', selectedRepository.id, null, false),
    ]
    appStore['repositories'] = repositories
    appStore['selectedRepository'] = selectedRepository

    assert.deepStrictEqual(
      appStore['repositoryIndicatorUpdater']['getRepositories'](),
      repositories
    )
  })

  it('synchronizes all repository stashes into the state used by the stash tab', t => {
    const repository = new Repository(
      'C:\\repositories\\stashes',
      10,
      null,
      false
    )
    const gitStore = appStore['gitStoreCache'].get(repository)
    const entry: IRepositoryStashEntry = {
      name: 'refs/stash@{0}',
      stashSha: '1'.repeat(40),
      branchName: 'development',
      message: 'On development: saved changes',
      createdAt: Date.now(),
      isDesktopStash: true,
      tree: '2'.repeat(40),
      parents: ['3'.repeat(40)],
      files: { kind: StashedChangesLoadStates.NotLoaded },
    }
    const entries: ReadonlyArray<IRepositoryStashEntry> = [entry]
    const stashes = t.mock.getter(gitStore, 'repositoryStashes', () => entries)
    appStore['onGitStoreUpdated'](repository, gitStore)
    assert.deepStrictEqual(
      appStore['repositoryStateCache'].get(repository).changesState
        .repositoryStashes,
      entries
    )

    stashes.mock.mockImplementation(() => [])
    appStore['onGitStoreUpdated'](repository, gitStore)
    assert.deepStrictEqual(
      appStore['repositoryStateCache'].get(repository).changesState
        .repositoryStashes,
      []
    )
  })

  it('creates multiple stashes on the same branch without replacing earlier entries or prompting', async t => {
    restoreTimeout()
    const repository = await setupEmptyRepository(t, 'main')
    await writeFile(join(repository.path, 'file.txt'), 'initial')
    assert.equal(
      (await exec(['add', '--', 'file.txt'], repository.path)).exitCode,
      0
    )
    assert.equal(
      (await exec(['commit', '-m', 'initial'], repository.path)).exitCode,
      0
    )
    const { stdout } = await exec(['rev-parse', 'HEAD'], repository.path)
    const branch = new Branch(
      'main',
      null,
      { sha: stdout.trim() },
      BranchType.Local,
      'refs/heads/main'
    )
    appStore['repositoryStateCache'].updateBranchesState(repository, () => ({
      tip: { kind: TipState.Valid, branch },
    }))
    t.mock.method(appStore, '_refreshRepository', async () => {
      const stashes = await getStashes(repository)
      appStore['repositoryStateCache'].updateChangesState(repository, () => ({
        stashEntry: stashes.desktopEntries[0] ?? null,
        repositoryStashes: stashes.allEntries,
      }))
    })
    const showPopup = t.mock.method(appStore, '_showPopup', async () => {})

    await writeFile(join(repository.path, 'file.txt'), 'first stash')
    assert.equal(await appStore._createStashForCurrentBranch(repository), true)
    const first = (await getStashes(repository)).allEntries[0]
    await writeFile(join(repository.path, 'file.txt'), 'second stash')
    assert.equal(await appStore._createStashForCurrentBranch(repository), true)

    const { allEntries } = await getStashes(repository)
    assert.equal(allEntries.length, 2)
    assert.equal(allEntries[1].stashSha, first.stashSha)
    assert.deepEqual(
      appStore['repositoryStateCache']
        .get(repository)
        .changesState.repositoryStashes.map(entry => entry.stashSha),
      allEntries.map(entry => entry.stashSha)
    )
    for (const [entry, contents] of [
      [allEntries[0], 'second stash'],
      [allEntries[1], 'first stash'],
    ] as const) {
      assert.equal(
        (
          await exec(
            ['show', `${entry.stashSha}:file.txt`, '--'],
            repository.path
          )
        ).stdout,
        contents
      )
    }

    assert.equal((await exec(['branch', 'other'], repository.path)).exitCode, 0)
    await writeFile(join(repository.path, 'file.txt'), 'stash before switching')
    const { getStatusOrThrow } = await import('../../helpers/status')
    const { workingDirectory } = await getStatusOrThrow(repository)
    appStore['repositoryStateCache'].updateChangesState(repository, () => ({
      workingDirectory,
    }))
    const target = new Branch(
      'other',
      null,
      branch.tip,
      BranchType.Local,
      'refs/heads/other'
    )
    await appStore['checkoutAndLeaveChanges'](repository, target, null)
    const afterCheckout = await getStashes(repository)
    assert.equal(afterCheckout.allEntries.length, 3)
    assert.deepEqual(
      afterCheckout.allEntries.slice(1).map(entry => entry.stashSha),
      allEntries.map(entry => entry.stashSha)
    )
    assert.equal(afterCheckout.desktopEntries[0].branchName, 'main')
    assert.equal(
      (await exec(['branch', '--show-current'], repository.path)).stdout.trim(),
      'other'
    )
    assert.equal(showPopup.mock.callCount(), 0)
  })
})
