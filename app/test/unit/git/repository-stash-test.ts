import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'dugite'
import { setupEmptyRepository } from '../../helpers/repositories'
import { Repository } from '../../../src/models/repository'
import {
  getStashes,
  applyRepositoryStash,
  dropRepositoryStash,
  getRepositoryStashedFiles,
} from '../../../src/lib/git/stash'
import { getCommitDiff } from '../../../src/lib/git/diff'
import { DiffType } from '../../../src/models/diff'
import { createTempDirectory } from '../../helpers/temp'

async function run(repository: Repository, ...args: string[]) {
  const result = await exec(args, repository.path)
  assert.equal(result.exitCode, 0, result.stderr)
  return result.stdout.trim()
}

async function setup(t: TestContext) {
  const repository = await setupEmptyRepository(t)
  await run(repository, 'config', 'core.autocrlf', 'false')
  await writeFile(join(repository.path, 'tracked.txt'), 'base\n')
  await run(repository, 'add', '--', 'tracked.txt')
  await run(repository, 'commit', '-m', 'initial')
  return repository
}

async function stash(repository: Repository, message: string) {
  await writeFile(join(repository.path, 'tracked.txt'), `${message}\n`)
  await run(repository, 'stash', 'push', '-m', message)
  return (await getStashes(repository)).allEntries[0]
}

describe('repository stash browser Git operations', () => {
  it('lists CLI and automatic stashes on all branches without changing automatic selection', async t => {
    const repo = await setup(t)
    await stash(repo, 'CLI changes')
    await run(repo, 'switch', '-c', 'other')
    await stash(repo, '!!GitHub_Desktop<other>')
    await stash(repo, 'another CLI stash')
    const result = await getStashes(repo)
    assert.equal(result.allEntries.length, 3)
    assert.equal(result.stashEntryCount, 3)
    assert.equal(result.desktopEntries.length, 1)
    assert.equal(result.desktopEntries[0].branchName, 'other')
    assert.match(result.allEntries[2].message, /CLI changes/)
    assert.ok(result.allEntries.every(entry => entry.createdAt > 0))
  })

  it('restores a selected SHA after its index changes and keeps every stash', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'selected')
    await stash(repo, 'newer')
    await applyRepositoryStash(repo, selected.stashSha)
    assert.equal(
      await readFile(join(repo.path, 'tracked.txt'), 'utf8'),
      'selected\n'
    )
    assert.equal((await getStashes(repo)).allEntries.length, 2)
  })

  it('deletes only the selected SHA after an external insertion', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'selected')
    const other = await stash(repo, 'newer')
    await dropRepositoryStash(repo, selected.stashSha)
    assert.deepEqual(
      (await getStashes(repo)).allEntries.map(e => e.stashSha),
      [other.stashSha]
    )
    await assert.rejects(
      dropRepositoryStash(repo, selected.stashSha),
      /no longer exists/
    )
    await assert.rejects(
      applyRepositoryStash(repo, selected.stashSha),
      /no longer exists/
    )
    assert.equal((await getStashes(repo)).allEntries.length, 1)
  })

  it('keeps the original stash when restoring conflicts', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'stashed')
    await writeFile(join(repo.path, 'tracked.txt'), 'conflicting\n')
    await run(repo, 'commit', '-am', 'conflicting commit')
    await assert.rejects(applyRepositoryStash(repo, selected.stashSha))
    assert.equal(
      (await getStashes(repo)).allEntries[0].stashSha,
      selected.stashSha
    )
    assert.match(await run(repo, 'status', '--porcelain'), /UU tracked.txt/)
  })

  it('previews and restores untracked stash content without losing it', async t => {
    const repo = await setup(t)
    await writeFile(join(repo.path, 'untracked.txt'), 'untracked preview\n')
    await run(repo, 'stash', 'push', '-u', '-m', 'with untracked')
    const selected = (await getStashes(repo)).allEntries[0]
    const files = await getRepositoryStashedFiles(repo, selected)
    const file = files.find(f => f.path === 'untracked.txt')
    assert.ok(file)
    const diff = await getCommitDiff(repo, file, file.commitish)
    assert.equal(diff.kind, DiffType.Text)
    await applyRepositoryStash(repo, selected.stashSha)
    assert.equal(
      await readFile(join(repo.path, 'untracked.txt'), 'utf8'),
      'untracked preview\n'
    )
    assert.equal((await getStashes(repo)).allEntries.length, 1)
  })

  it('shares stash identities across worktrees and applies to the requested checkout only', async t => {
    const repo = await setup(t)
    const worktreePath = await createTempDirectory(t)
    await run(repo, 'worktree', 'add', '-b', 'linked', worktreePath)
    const linked = new Repository(worktreePath, 2, null, false)
    const selected = await stash(repo, 'shared')
    assert.equal(
      (await getStashes(linked)).allEntries[0].stashSha,
      selected.stashSha
    )
    await applyRepositoryStash(linked, selected.stashSha)
    assert.equal(
      await readFile(join(repo.path, 'tracked.txt'), 'utf8'),
      'base\n'
    )
    assert.equal(
      await readFile(join(linked.path, 'tracked.txt'), 'utf8'),
      'shared\n'
    )
    await dropRepositoryStash(linked, selected.stashSha)
    assert.equal((await getStashes(repo)).allEntries.length, 0)
  })

  it('refuses ambiguous duplicate commit entries instead of deleting an arbitrary one', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'selected')
    await stash(repo, 'different')
    await run(repo, 'stash', 'store', '-m', 'duplicate', selected.stashSha)
    await assert.rejects(
      dropRepositoryStash(repo, selected.stashSha),
      /more than once/
    )
    assert.equal((await getStashes(repo)).allEntries.length, 3)
  })

  it('honors an external Git reference lock without changing any stash', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'selected')
    const lockPath = join(repo.path, '.git', 'refs', 'stash.lock')
    const handle = await open(lockPath, 'wx')
    try {
      await assert.rejects(
        dropRepositoryStash(repo, selected.stashSha),
        /EEXIST/
      )
      assert.equal(
        (await getStashes(repo)).allEntries[0].stashSha,
        selected.stashSha
      )
    } finally {
      await handle.close()
    }
  })

  it('updates the tip and packed refs correctly when deleting the last stash', async t => {
    const repo = await setup(t)
    const older = await stash(repo, 'older')
    const newer = await stash(repo, 'newer')
    await dropRepositoryStash(repo, newer.stashSha)
    assert.equal(await run(repo, 'rev-parse', 'refs/stash'), older.stashSha)
    await run(repo, 'pack-refs', '--all')
    await dropRepositoryStash(repo, older.stashSha)
    assert.equal((await getStashes(repo)).allEntries.length, 0)
    assert.equal(
      (await exec(['rev-parse', '--verify', 'refs/stash'], repo.path)).exitCode,
      128
    )
    await stash(repo, 'after deletion')
    assert.equal((await getStashes(repo)).allEntries.length, 1)
  })

  it('preserves message bytes and reflog links when removing a middle entry', async t => {
    const repo = await setup(t)
    const oldest = await stash(repo, 'oldest')
    const middle = await stash(repo, 'middle')
    const newest = await stash(repo, '\u4fdd\u7559 newest')
    const logPath = join(repo.path, '.git', 'logs', 'refs', 'stash')
    const before = (await readFile(logPath))
      .toString('latin1')
      .trimEnd()
      .split('\n')
    await dropRepositoryStash(repo, middle.stashSha)
    const after = (await readFile(logPath))
      .toString('latin1')
      .trimEnd()
      .split('\n')
    assert.deepEqual(after, [
      before[0],
      `${oldest.stashSha}${before[2].slice(40)}`,
    ])
    assert.deepEqual(
      (await getStashes(repo)).allEntries.map(entry => entry.stashSha),
      [newest.stashSha, oldest.stashSha]
    )
    await run(repo, 'fsck', '--no-dangling')
    await stash(repo, 'after middle deletion')
    assert.equal((await getStashes(repo)).allEntries.length, 3)
  })

  it('releases its own ref lock when a packed-ref lock is held externally', async t => {
    const repo = await setup(t)
    const selected = await stash(repo, 'selected')
    const logPath = join(repo.path, '.git', 'logs', 'refs', 'stash')
    const before = await readFile(logPath)
    const lockPath = join(repo.path, '.git', 'packed-refs.lock')
    const handle = await open(lockPath, 'wx')
    try {
      await assert.rejects(
        dropRepositoryStash(repo, selected.stashSha),
        /EEXIST/
      )
      assert.deepEqual(await readFile(logPath), before)
      await stat(lockPath)
      await assert.rejects(
        stat(join(repo.path, '.git', 'refs', 'stash.lock')),
        {
          code: 'ENOENT',
        }
      )
    } finally {
      await handle.close()
    }
  })
})
