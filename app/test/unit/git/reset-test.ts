import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'

import { Repository } from '../../../src/models/repository'
import { reset, resetPaths, GitResetMode } from '../../../src/lib/git/reset'
import { getStatusOrThrow } from '../../helpers/status'
import {
  setupEmptyRepository,
  setupFixtureRepository,
} from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { exec } from 'dugite'

import { unlink, writeFile } from 'fs/promises'

describe('git/reset', () => {
  describe('reset', () => {
    it('soft resets a repository and keeps changes staged', async t => {
      const repository = await setupEmptyRepository(t)
      await makeCommit(repository, {
        entries: [{ path: 'README.md', contents: 'first commit\n' }],
      })
      const firstCommit = await exec(['rev-parse', 'HEAD'], repository.path)
      await makeCommit(repository, {
        entries: [{ path: 'README.md', contents: 'second commit\n' }],
      })

      await reset(repository, GitResetMode.Soft, firstCommit.stdout.trim())

      const currentCommit = await exec(['rev-parse', 'HEAD'], repository.path)
      assert.equal(currentCommit.stdout.trim(), firstCommit.stdout.trim())
      const stagedDiff = await exec(
        ['diff', '--cached', '--exit-code'],
        repository.path
      )
      const workingTreeDiff = await exec(
        ['diff', '--exit-code'],
        repository.path
      )
      assert.equal(stagedDiff.exitCode, 1)
      assert.equal(workingTreeDiff.exitCode, 0)
    })

    it('can hard reset a repository', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      const repoPath = repository.path
      const fileName = 'README.md'
      const filePath = path.join(repoPath, fileName)

      await writeFile(filePath, 'Hi world\n')

      await reset(repository, GitResetMode.Hard, 'HEAD')

      const status = await getStatusOrThrow(repository)
      assert.equal(status.workingDirectory.files.length, 0)
    })
  })

  describe('resetPaths', () => {
    it.skip('resets discarded staged file', async t => {
      const testRepoPath = await setupFixtureRepository(t, 'test-repo')
      const repository = new Repository(testRepoPath, -1, null, false)

      const repoPath = repository.path
      const fileName = 'README.md'
      const filePath = path.join(repoPath, fileName)

      // modify the file
      await writeFile(filePath, 'Hi world\n')

      // stage the file, then delete it to mimic discarding
      exec(['add', fileName], repoPath)
      await unlink(filePath)

      await resetPaths(repository, GitResetMode.Mixed, 'HEAD', [filePath])

      // then checkout the version from the index to restore it
      await exec(['checkout-index', '-f', '-u', '-q', '--', fileName], repoPath)

      const status = await getStatusOrThrow(repository)
      assert.equal(status.workingDirectory.files.length, 0)
    })
  })
})
