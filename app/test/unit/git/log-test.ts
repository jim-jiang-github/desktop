import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../../src/models/repository'
import {
  getChangedFiles,
  getCommits,
  getAuthorFilterArgs,
  git,
} from '../../../src/lib/git'
import {
  setupEmptyRepository,
  setupFixtureRepository,
} from '../../helpers/repositories'
import { AppFileStatusKind } from '../../../src/models/status'
import { setupLocalConfig } from '../../helpers/local-config'

describe('git/log', () => {
  describe('author filtering', () => {
    it('matches author names and emails case-insensitively and paginates matching commits', async t => {
      const repository = await setupEmptyRepository(t)
      for (const [author, message] of [
        ['Alice Example <alice+dev@example.com>', 'alice first'],
        ['Bob Example <bob@example.com>', 'bob first'],
        ['Alice Example <alice+dev@example.com>', 'alice second'],
        ['Bob Example <bob@example.com>', 'bob second'],
        ['Alice Example <alice+dev@example.com>', 'alice third'],
      ]) {
        await git(
          ['commit', '--allow-empty', `--author=${author}`, '-m', message],
          repository.path,
          'test'
        )
      }
      const firstPage = await getCommits(
        repository,
        'HEAD',
        2,
        0,
        getAuthorFilterArgs('ALICE')
      )
      const secondPage = await getCommits(
        repository,
        'HEAD',
        2,
        2,
        getAuthorFilterArgs('alice+dev@example.com')
      )
      assert.deepStrictEqual(
        firstPage.map(commit => commit.summary),
        ['alice third', 'alice second']
      )
      assert.deepStrictEqual(
        secondPage.map(commit => commit.summary),
        ['alice first']
      )
      assert.ok(
        firstPage.every(
          commit => commit.author.email === 'alice+dev@example.com'
        )
      )

      assert.strictEqual(
        (
          await getCommits(
            repository,
            'HEAD',
            10,
            0,
            getAuthorFilterArgs('missing')
          )
        ).length,
        0
      )
      assert.strictEqual(
        (await getCommits(repository, 'HEAD', 10, 0, getAuthorFilterArgs('  ')))
          .length,
        5
      )
    })

    it('treats regular expression characters and leading dashes as literal text', async t => {
      const repository = await setupEmptyRepository(t)
      for (const author of [
        'A.*[team](dev) <a+dev@example.com>',
        'A-other-team <aXdev@exampleXcom>',
        '-Dash <dash@example.com>',
      ]) {
        await git(
          ['commit', '--allow-empty', `--author=${author}`, '-m', author],
          repository.path,
          'test'
        )
      }
      for (const query of ['A.*[team](dev)', 'a+dev@example.com', '-Dash']) {
        const commits = await getCommits(
          repository,
          'HEAD',
          10,
          0,
          getAuthorFilterArgs(query)
        )
        assert.strictEqual(commits.length, 1)
        assert.ok(commits[0].summary.includes(query))
      }
    })

    it('filters by the author rather than the committer or co-author trailers', async t => {
      const repository = await setupEmptyRepository(t)
      await git(
        [
          'commit',
          '--allow-empty',
          '--author=Alice <alice@example.com>',
          '-m',
          'Shared work\n\nCo-authored-by: Bob <bob@example.com>',
        ],
        repository.path,
        'test'
      )
      assert.strictEqual(
        (
          await getCommits(
            repository,
            'HEAD',
            10,
            0,
            getAuthorFilterArgs('Bob')
          )
        ).length,
        0
      )
      assert.strictEqual(
        (
          await getCommits(
            repository,
            'HEAD',
            10,
            0,
            getAuthorFilterArgs('alice')
          )
        ).length,
        1
      )
    })

    it('preserves revision range boundaries when filtering comparisons', async t => {
      const repository = await setupEmptyRepository(t)
      await git(
        [
          'commit',
          '--allow-empty',
          '--author=Alice <alice@example.com>',
          '-m',
          'before range',
        ],
        repository.path,
        'test'
      )
      const [base] = await getCommits(repository, 'HEAD', 1)
      await git(
        [
          'commit',
          '--allow-empty',
          '--author=Bob <bob@example.com>',
          '-m',
          'bob in range',
        ],
        repository.path,
        'test'
      )
      await git(
        [
          'commit',
          '--allow-empty',
          '--author=Alice <alice@example.com>',
          '-m',
          'alice in range',
        ],
        repository.path,
        'test'
      )
      const commits = await getCommits(
        repository,
        `${base.sha}..HEAD`,
        10,
        0,
        getAuthorFilterArgs('Alice')
      )
      assert.deepStrictEqual(
        commits.map(commit => commit.summary),
        ['alice in range']
      )
    })
  })

  describe('getCommits', () => {
    it('loads history', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'test-repo-with-tags'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const commits = await getCommits(repository, 'HEAD', 100)
      assert.equal(commits.length, 5)

      const firstCommit = commits[commits.length - 1]
      assert.equal(firstCommit.summary, 'first')
      assert.equal(firstCommit.sha, '7cd6640e5b6ca8dbfd0b33d0281ebe702127079c')
      assert.equal(firstCommit.shortSha, '7cd6640')
    })

    it('handles repository with HEAD file on disk', async t => {
      const path = await setupFixtureRepository(t, 'repository-with-HEAD-file')
      const repo = new Repository(path, 1, null, false)
      const commits = await getCommits(repo, 'HEAD', 100)
      assert.equal(commits.length, 2)
    })

    it('handles repository with signed commit and log.showSignature set', async t => {
      const path = await setupFixtureRepository(t, 'just-doing-some-signing')
      const repository = new Repository(path, 1, null, false)

      // ensure the default config is to try and show signatures
      // this should be overriden by the `getCommits` function as it may not
      // have a valid GPG agent configured
      await setupLocalConfig(repository, [['log.showSignature', 'true']])

      const commits = await getCommits(repository, 'HEAD', 100)

      assert.equal(commits.length, 1)
      assert.equal(commits[0].sha, '415e4987158c49c383ce7114e0ef00ebf4b070c1')
      assert.equal(commits[0].shortSha, '415e498')
    })

    it('parses tags', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'test-repo-with-tags'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const commits = await getCommits(repository, 'HEAD', 100)
      assert.equal(commits.length, 5)

      assert.deepStrictEqual(commits[0].tags, ['important'])
      assert.deepStrictEqual(commits[1].tags, ['tentative', 'less-important'])
      assert.equal(commits[2].tags.length, 0)
    })
  })

  describe('getChangedFiles', () => {
    it('loads the files changed in the commit', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'test-repo-with-tags'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const changesetData = await getChangedFiles(
        repository,
        '7cd6640e5b6ca8dbfd0b33d0281ebe702127079c'
      )
      assert.equal(changesetData.files.length, 1)
      assert.equal(changesetData.files[0].path, 'README.md')
      assert.equal(changesetData.files[0].status.kind, AppFileStatusKind.New)
    })

    it('detects renames', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'rename-history-detection'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const first = await getChangedFiles(repository, '55bdecb')
      assert.equal(first.files.length, 1)

      assert.equal(first.files[0].path, 'NEWER.md')
      assert.deepStrictEqual(first.files[0].status, {
        kind: AppFileStatusKind.Renamed,
        oldPath: 'NEW.md',
        submoduleStatus: undefined,
        renameIncludesModifications: true,
      })

      const second = await getChangedFiles(repository, 'c898ca8')
      assert.equal(second.files.length, 1)

      assert.equal(second.files[0].path, 'NEW.md')
      assert.deepStrictEqual(second.files[0].status, {
        kind: AppFileStatusKind.Renamed,
        oldPath: 'OLD.md',
        submoduleStatus: undefined,
        renameIncludesModifications: false,
      })
    })

    it('detect copies', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'copies-history-detection'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      // ensure the test repository is configured to detect copies
      await setupLocalConfig(repository, [['diff.renames', 'copies']])

      const changesetData = await getChangedFiles(repository, 'a500bf415')
      assert.equal(changesetData.files.length, 2)

      assert.equal(changesetData.files[0].path, 'duplicate-with-edits.md')
      assert.deepStrictEqual(changesetData.files[0].status, {
        kind: AppFileStatusKind.Copied,
        oldPath: 'initial.md',
        renameIncludesModifications: false,
        submoduleStatus: undefined,
      })

      assert.equal(changesetData.files[1].path, 'duplicate.md')
      assert.deepStrictEqual(changesetData.files[1].status, {
        kind: AppFileStatusKind.Copied,
        oldPath: 'initial.md',
        renameIncludesModifications: false,
        submoduleStatus: undefined,
      })
    })

    it('handles commit when HEAD exists on disk', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'test-repo-with-tags'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const changesetData = await getChangedFiles(repository, 'HEAD')
      assert.equal(changesetData.files.length, 1)
      assert.equal(changesetData.files[0].path, 'README.md')
      assert.equal(
        changesetData.files[0].status.kind,
        AppFileStatusKind.Modified
      )
    })
  })

  it('detects submodule changes within commits', async t => {
    const repoPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const repository = new Repository(repoPath, -1, null, false)

    const changesetData = await getChangedFiles(repository, 'HEAD')
    assert.equal(changesetData.files.length, 2)
    assert.equal(changesetData.files[1].path, 'foo/submodule')
    assert(changesetData.files[1].status.submoduleStatus !== undefined)
  })
})
