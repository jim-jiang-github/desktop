import { open, readFile, rename, unlink, FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Repository } from '../../models/repository'
import { git } from './core'
import { isErrnoException } from '../errno-exception'

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Delete by object ID while holding Git's shared stash reference lock.
 *
 * `git stash drop stash@{n}` cannot compare an expected object ID: even a
 * just-refreshed index can name another stash by the time Git acquires its lock.
 * The files backend rewrites the reflog and updates its ref under this same lock.
 * Keep the raw reflog bytes (including non-UTF8 messages) and rewrite only the
 * removed entry's successor old-OID, matching `reflog delete --rewrite`.
 */
export async function deleteStashEntry(repository: Repository, sha: string) {
  const format = await git(
    ['rev-parse', '--show-ref-format'],
    repository.path,
    'stashRefFormat'
  )
  if (format.stdout.trim() !== 'files') {
    throw new Error(
      'Safe stash deletion currently requires Git’s files reference format. Use Git to delete this stash.'
    )
  }
  const common = await git(
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    repository.path,
    'stashCommonDirectory'
  )
  const root = common.stdout.trim()
  const refPath = join(root, 'refs', 'stash')
  const logPath = join(root, 'logs', 'refs', 'stash')
  const packedPath = join(root, 'packed-refs')
  const locks: Array<{ path: string; handle: FileHandle; committed: boolean }> =
    []
  const lock = async (path: string) => {
    const item = {
      path: `${path}.lock`,
      handle: await open(`${path}.lock`, 'wx'),
      committed: false,
    }
    locks.push(item)
    return item
  }
  const commit = async (
    item: typeof locks[number],
    path: string,
    content: Buffer
  ) => {
    await item.handle.writeFile(content)
    await item.handle.sync()
    await item.handle.close()
    await rename(item.path, path)
    item.committed = true
  }
  try {
    // All worktrees use this ref lock. Never remove someone else's lock.
    const refLock = await lock(refPath)
    const packedLock = await lock(packedPath)
    const raw = await readOptional(logPath)
    if (raw === null) {
      throw new Error('This stash no longer exists. Refresh the stash list.')
    }
    const lines = raw
      .toString('latin1')
      .split('\n')
      .filter(line => line.length > 0)
    const oidLength = sha.length
    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) ||
      lines.some(
        line =>
          !new RegExp(
            `^[0-9a-f]{${oidLength}} [0-9a-f]{${oidLength}} .+\\t`
          ).test(line)
      )
    ) {
      throw new Error(
        'The stash reflog has an unsupported format. No entries were deleted.'
      )
    }
    const oid = (line: string) => line.slice(oidLength + 1, oidLength * 2 + 1)
    const matches = lines
      .map((line, index) => (oid(line) === sha ? index : -1))
      .filter(index => index >= 0)
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? 'This stash no longer exists. Refresh the stash list.'
          : 'This stash commit occurs more than once. Manage these duplicate entries with Git.'
      )
    }
    const loose = await readOptional(refPath)
    const packed = await readOptional(packedPath)
    const packedLines = packed?.toString('latin1').split('\n') ?? []
    const packedTip = packedLines
      .find(line => line.endsWith(' refs/stash'))
      ?.split(' ')[0]
    const currentTip = loose?.toString('ascii').trim() ?? packedTip
    if (currentTip !== oid(lines[lines.length - 1])) {
      throw new Error(
        'The stash reference and reflog disagree. No entries were deleted.'
      )
    }
    const index = matches[0]
    const remaining = lines.filter((_, i) => i !== index)
    if (index < remaining.length) {
      remaining[index] =
        lines[index].slice(0, oidLength) + remaining[index].slice(oidLength)
    }
    const logLock = await lock(logPath)
    // Prepare all bytes before replacing the reflog. Its lock and ref lock stay
    // held until the corresponding ref update (or rollback) has completed.
    const nextLog = Buffer.from(
      remaining.length === 0 ? '' : `${remaining.join('\n')}\n`,
      'latin1'
    )
    await commit(logLock, logPath, nextLog)
    let looseRemoved = false
    try {
      if (remaining.length > 0) {
        await commit(
          refLock,
          refPath,
          Buffer.from(`${oid(remaining[remaining.length - 1])}\n`)
        )
      } else {
        if (loose !== null) {
          await unlink(refPath)
          looseRemoved = true
        }
        if (packed !== null && packedTip !== undefined) {
          const nextPacked = packedLines
            .filter(
              (line, i) =>
                !line.endsWith(' refs/stash') &&
                !(
                  line.startsWith('^') &&
                  packedLines[i - 1]?.endsWith(' refs/stash')
                )
            )
            .join('\n')
          await commit(
            packedLock,
            packedPath,
            Buffer.from(nextPacked, 'latin1')
          )
        }
      }
    } catch (error) {
      // Restore the reflog if the ref update fails, while other stash writers
      // are still excluded. Do not turn a partial failure into success.
      const rollback = await open(join(dirname(logPath), 'stash.lock'), 'wx')
      try {
        await rollback.writeFile(raw)
        await rollback.close()
        await rename(`${logPath}.lock`, logPath)
      } finally {
        await rollback.close()
      }
      if (looseRemoved && loose !== null) {
        await commit(refLock, refPath, loose)
      }
      throw error
    }
  } finally {
    for (const item of locks.reverse()) {
      await item.handle.close()
      if (!item.committed) {
        await unlink(item.path)
      }
    }
  }
}
