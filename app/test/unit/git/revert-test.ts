import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import * as Path from 'path'

import { revertCommit, revertFileChanges } from '../../../src/lib/git/revert'
import {
  getChangedFiles,
  getCommits,
  getStatus,
  git,
} from '../../../src/lib/git'
import { AppFileStatusKind } from '../../../src/models/status'
import { Repository } from '../../../src/models/repository'
import { parseRawLogWithNumstat } from '../../../src/lib/git/log'
import { setupEmptyRepository as setupRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { getTipOrError } from '../../helpers/git'

async function setupEmptyRepository(t: TestContext) {
  const repo = await setupRepository(t)
  await git(['config', 'core.autocrlf', 'false'], repo.path, 'test')
  return repo
}

async function getFileToRevert(repo: Repository, path = 'file.txt') {
  const commit = await getTipOrError(repo)
  const { files } = await getChangedFiles(repo, commit.sha)
  const file = files.find(f => f.path === path)
  assert.ok(file)
  return { commit, file }
}

describe('git/revert', () => {
  describe('revertFileChanges', () => {
    it('reverts only the selected file and preserves later edits without committing', async t => {
      const repo = await setupEmptyRepository(t)
      const initial = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n'
      const changed = initial.replace('two', 'changed two')
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: initial },
          { path: 'other.txt', contents: 'before\n' },
        ],
      })
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: changed },
          { path: 'other.txt', contents: 'after\n' },
        ],
      })
      const { commit, file } = await getFileToRevert(repo)
      await makeCommit(repo, {
        entries: [
          {
            path: 'file.txt',
            contents: changed.replace('eight', 'later eight'),
          },
        ],
      })
      const tip = await getTipOrError(repo)

      assert.strictEqual(await revertFileChanges(repo, commit, file), 'applied')
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        initial.replace('eight', 'later eight')
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'other.txt'), 'utf8'),
        'after\n'
      )
      assert.strictEqual((await getTipOrError(repo)).sha, tip.sha)
      const status = await getStatus(repo, true, true)
      assert.deepStrictEqual(
        status.workingDirectory.files.map(f => f.path),
        ['file.txt']
      )
    })

    it('leaves unrelated staged and unstaged changes untouched', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: 'before\n' },
          { path: 'other.txt', contents: 'other\n' },
          { path: 'unstaged.txt', contents: 'initial\n' },
        ],
      })
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'after\n' }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await writeFile(Path.join(repo.path, 'other.txt'), 'staged\n')
      await git(['add', '--', 'other.txt'], repo.path, 'test')
      await writeFile(Path.join(repo.path, 'other.txt'), 'unstaged on staged\n')
      await writeFile(Path.join(repo.path, 'unstaged.txt'), 'local\n')
      const before = await git(
        ['diff', '--cached', '--', 'other.txt', 'unstaged.txt'],
        repo.path,
        'test'
      )

      await revertFileChanges(repo, commit, file)

      const after = await git(
        ['diff', '--cached', '--', 'other.txt', 'unstaged.txt'],
        repo.path,
        'test'
      )
      assert.strictEqual(after.stdout, before.stdout)
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'other.txt'), 'utf8'),
        'unstaged on staged\n'
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'unstaged.txt'), 'utf8'),
        'local\n'
      )
    })

    for (const staged of [false, true]) {
      it(`rejects ${
        staged ? 'staged' : 'unstaged'
      } changes to the selected file`, async t => {
        const repo = await setupEmptyRepository(t)
        await makeCommit(repo, {
          entries: [{ path: 'file.txt', contents: 'before\n' }],
        })
        await makeCommit(repo, {
          entries: [{ path: 'file.txt', contents: 'after\n' }],
        })
        const { commit, file } = await getFileToRevert(repo)
        await writeFile(Path.join(repo.path, file.path), 'local\n')
        if (staged) {
          await git(['add', '--', file.path], repo.path, 'test')
        }
        const before = await git(['diff', '--cached', '--'], repo.path, 'test')

        await assert.rejects(
          revertFileChanges(repo, commit, file),
          /Commit or stash the local changes/
        )
        assert.strictEqual(
          await readFile(Path.join(repo.path, file.path), 'utf8'),
          'local\n'
        )
        const after = await git(['diff', '--cached', '--'], repo.path, 'test')
        assert.strictEqual(after.stdout, before.stdout)
      })
    }

    it('leaves overlapping later changes as conflicts and blocks another revert', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'before\n' }],
      })
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'after\n' }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'later\n' }],
      })
      const tip = await getTipOrError(repo)

      assert.strictEqual(
        await revertFileChanges(repo, commit, file),
        'conflicted'
      )
      const status = await getStatus(repo, true, true)
      assert.strictEqual(status.doConflictedFilesExist, true)
      const contents = await readFile(Path.join(repo.path, file.path), 'utf8')
      assert.ok(contents.includes('<<<<<<<'))
      assert.ok(contents.includes('later'))
      assert.ok(contents.includes('before'))
      assert.strictEqual((await getTipOrError(repo)).sha, tip.sha)
      await assert.rejects(
        revertFileChanges(repo, commit, file),
        /Finish the current Git operation/
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        contents
      )
    })

    it('reverts a file addition in the root commit without removing other files', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: 'new\n' },
          { path: 'other.txt', contents: 'keep\n' },
        ],
      })
      const { commit, file } = await getFileToRevert(repo)
      await revertFileChanges(repo, commit, file)
      assert.strictEqual(existsSync(Path.join(repo.path, file.path)), false)
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'other.txt'), 'utf8'),
        'keep\n'
      )
      assert.strictEqual((await getTipOrError(repo)).sha, commit.sha)
    })

    it('restores a deleted file', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'restore\n' }],
      })
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: null }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await revertFileChanges(repo, commit, file)
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'restore\n'
      )
    })

    it('does not silently delete later modifications to an added file', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'added\n' }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'later\n' }],
      })
      await assert.rejects(revertFileChanges(repo, commit, file))
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'later\n'
      )
      assert.strictEqual(
        (await getStatus(repo, true, true)).workingDirectory.files.length,
        0
      )
    })

    it('does not overwrite an ignored file when restoring a deletion', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'before\n' }],
      })
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: null },
          { path: '.gitignore', contents: 'file.txt\n' },
        ],
      })
      const { commit, file } = await getFileToRevert(repo)
      await writeFile(Path.join(repo.path, file.path), 'ignored local\n')

      await assert.rejects(revertFileChanges(repo, commit, file))
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'ignored local\n'
      )
      assert.strictEqual(
        (await getStatus(repo, true, true)).workingDirectory.files.length,
        0
      )
    })

    it('reverts a rename and preserves later content changes', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'old.txt', contents: 'one\ntwo\nthree\n' }],
      })
      await git(['mv', '--', 'old.txt', 'file.txt'], repo.path, 'test')
      await git(['commit', '-m', 'rename'], repo.path, 'test')
      const { commit, file } = await getFileToRevert(repo)
      assert.strictEqual(file.status.kind, AppFileStatusKind.Renamed)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'one\ntwo\nlater\n' }],
      })

      await revertFileChanges(repo, commit, file)
      assert.strictEqual(existsSync(Path.join(repo.path, file.path)), false)
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'old.txt'), 'utf8'),
        'one\ntwo\nlater\n'
      )
    })

    it('does not overwrite an untracked file at a restored rename path', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'old.txt', contents: 'keep\n' }],
      })
      await git(['mv', '--', 'old.txt', 'file.txt'], repo.path, 'test')
      await git(['commit', '-m', 'rename'], repo.path, 'test')
      const { commit, file } = await getFileToRevert(repo)
      await writeFile(Path.join(repo.path, 'old.txt'), 'local\n')

      await assert.rejects(
        revertFileChanges(repo, commit, file),
        /Commit or stash the local changes/
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'old.txt'), 'utf8'),
        'local\n'
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'keep\n'
      )
    })

    it('uses literal pathspecs for leading-dash and wildcard-like names', async t => {
      const repo = await setupEmptyRepository(t)
      const paths = ['-file.txt', '[file].txt']
      for (const contents of ['before\n', 'after\n']) {
        for (const path of paths) {
          await writeFile(Path.join(repo.path, path), contents)
        }
        await git(['add', '--', ...paths], repo.path, 'test')
        await git(['commit', '-m', 'change files'], repo.path, 'test')
      }
      const commit = await getTipOrError(repo)
      const { files } = await getChangedFiles(repo, commit.sha)
      for (const path of paths) {
        const file = files.find(f => f.path === path)
        assert.ok(file)
        await revertFileChanges(repo, commit, file)
        assert.strictEqual(
          await readFile(Path.join(repo.path, path), 'utf8'),
          'before\n'
        )
      }
    })

    it('reverts binary changes', async t => {
      const repo = await setupEmptyRepository(t)
      const before = Buffer.from([0, 1, 2, 255])
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: before }],
      })
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: Buffer.from([0, 3, 4, 255]) }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await revertFileChanges(repo, commit, file)
      assert.deepStrictEqual(
        await readFile(Path.join(repo.path, file.path)),
        before
      )
    })

    it('reverts a copy without reverting modifications to its source', async t => {
      const repo = await setupEmptyRepository(t)
      const original = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n'
      const modified = original.replace('eight', 'modified eight')
      await makeCommit(repo, {
        entries: [{ path: 'source.txt', contents: original }],
      })
      await makeCommit(repo, {
        entries: [
          { path: 'source.txt', contents: modified },
          { path: 'file.txt', contents: original },
        ],
      })
      const commit = await getTipOrError(repo)
      const { stdout } = await git(
        [
          'log',
          '-1',
          '-M',
          '-C',
          '--raw',
          '--numstat',
          '-z',
          '--format=format:',
          '--end-of-options',
          commit.sha,
          '--',
        ],
        repo.path,
        'test'
      )
      const file = parseRawLogWithNumstat(
        stdout,
        commit.sha,
        `${commit.sha}^`
      ).files.find(changed => changed.path === 'file.txt')
      assert.ok(file)
      assert.strictEqual(file.status.kind, AppFileStatusKind.Copied)

      await revertFileChanges(repo, commit, file)
      assert.strictEqual(existsSync(Path.join(repo.path, file.path)), false)
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'source.txt'), 'utf8'),
        modified
      )
    })

    it('uses the first parent of a merge commit', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [
          { path: 'file.txt', contents: 'before\n' },
          { path: 'other.txt', contents: 'initial\n' },
        ],
      })
      const base = await getTipOrError(repo)
      await git(['checkout', '-b', 'topic'], repo.path, 'test')
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'topic\n' }],
      })
      await git(['checkout', '-b', 'mainline', base.sha], repo.path, 'test')
      await makeCommit(repo, {
        entries: [{ path: 'other.txt', contents: 'mainline\n' }],
      })
      await git(['merge', '--no-ff', '-m', 'merge', 'topic'], repo.path, 'test')
      const { commit, file } = await getFileToRevert(repo)
      assert.strictEqual(commit.isMergeCommit, true)

      await revertFileChanges(repo, commit, file)
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'before\n'
      )
      assert.strictEqual(
        await readFile(Path.join(repo.path, 'other.txt'), 'utf8'),
        'mainline\n'
      )
    })

    it('reports an already reverted change without modifying the file', async t => {
      const repo = await setupEmptyRepository(t)
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'before\n' }],
      })
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'after\n' }],
      })
      const { commit, file } = await getFileToRevert(repo)
      await revertCommit(repo, commit, null)

      await assert.rejects(
        revertFileChanges(repo, commit, file),
        /already have been reverted/
      )
      const status = await getStatus(repo, true, true)
      assert.strictEqual(status.workingDirectory.files.length, 0)
      assert.strictEqual(
        await readFile(Path.join(repo.path, file.path), 'utf8'),
        'before\n'
      )
    })
  })

  describe('revertCommit', () => {
    it('reverts a simple commit', async t => {
      const repo = await setupEmptyRepository(t)

      // Create an initial commit with a file
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'initial content' }],
        commitMessage: 'initial commit',
      })

      // Create a second commit that modifies the file
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'modified content' }],
        commitMessage: 'modify file',
      })

      // Get the tip commit (the one to revert)
      const tip = await getTipOrError(repo)

      // Revert the second commit
      await revertCommit(repo, tip, null)

      // Verify a new revert commit was created
      const commits = await getCommits(repo, 'HEAD', 3)
      assert.equal(commits.length, 3)
      assert.ok(commits[0].summary.startsWith('Revert'))
      assert.equal(
        await readFile(`${repo.path}/file.txt`, 'utf8'),
        'initial content'
      )
    })

    it('reverts a commit that adds a new file', async t => {
      const repo = await setupEmptyRepository(t)

      // Create initial commit
      await makeCommit(repo, {
        entries: [{ path: 'initial.txt', contents: 'initial' }],
        commitMessage: 'initial commit',
      })

      // Create commit that adds a new file
      await makeCommit(repo, {
        entries: [
          { path: 'initial.txt', contents: 'initial' },
          { path: 'new-file.txt', contents: 'new content' },
        ],
        commitMessage: 'add new file',
      })

      const tip = await getTipOrError(repo)
      await revertCommit(repo, tip, null)

      // Verify the revert commit exists
      const commits = await getCommits(repo, 'HEAD', 3)
      assert.equal(commits.length, 3)
      assert.ok(commits[0].summary.startsWith('Revert'))
      assert.equal(existsSync(`${repo.path}/new-file.txt`), false)
    })
  })
})
