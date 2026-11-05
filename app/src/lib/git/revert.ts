import { git, GitError, IGitStringExecutionOptions } from './core'

import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { IRevertProgress } from '../../models/progress'

import { executionOptionsWithProgress } from '../progress/from-process'
import { RevertProgressParser } from '../progress/revert'
import {
  envForRemoteOperation,
  getFallbackUrlForProxyResolve,
} from './environment'
import { IRemote } from '../../models/remote'
import { AppFileStatusKind, CommittedFileChange } from '../../models/status'
import { getStatus } from './status'
import { getChangedFiles } from './log'

/**
 * Reverts one file's changes from a commit without creating a commit.
 *
 * Uses the first parent for merge commits. Three-way application preserves
 * later edits when possible and leaves overlapping edits as index conflicts.
 */
export async function revertFileChanges(
  repository: Repository,
  commit: Commit,
  file: CommittedFileChange
): Promise<'applied' | 'conflicted'> {
  const paths =
    file.status.kind === AppFileStatusKind.Renamed
      ? [file.path, file.status.oldPath]
      : [file.path]

  const status = await getStatus(repository, true, true)
  if (
    status.mergeHeadFound ||
    status.squashMsgFound ||
    status.rebaseInternalState !== null ||
    status.isCherryPickingHeadFound ||
    status.doConflictedFilesExist
  ) {
    throw new Error(
      'Finish the current Git operation and resolve any conflicts before reverting changes to a file.'
    )
  }

  if (
    status.workingDirectory.files.some(
      changed =>
        paths.includes(changed.path) ||
        (changed.status.kind === AppFileStatusKind.Renamed &&
          paths.includes(changed.status.oldPath))
    )
  ) {
    throw new Error(
      'Commit or stash the local changes to this file before reverting its changes.'
    )
  }

  if (file.status.kind === AppFileStatusKind.Renamed) {
    const oldPath = file.status.oldPath
    const { files } = await getChangedFiles(repository, commit.sha)
    if (files.some(changed => changed.path === oldPath)) {
      throw new Error(
        'This commit also changes another file at the original path. Reverting this rename alone would affect that file.'
      )
    }
  }

  const { stdout: patch } = await git(
    [
      '--literal-pathspecs',
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--diff-merges=first-parent',
      '-r',
      '-p',
      '--binary',
      '--full-index',
      '--no-renames',
      ...(file.status.kind === AppFileStatusKind.Renamed ? ['-M'] : []),
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--end-of-options',
      commit.sha,
      '--',
      ...paths,
    ],
    repository.path,
    'revertFileChanges',
    { encoding: 'buffer' }
  )

  if (patch.length === 0) {
    throw new Error('This commit has no changes to revert for this file.')
  }

  const args = ['apply', '--reverse', '--3way', '--whitespace=nowarn', '-']
  const result = await git(args, repository.path, 'revertFileChanges', {
    stdin: patch,
    successExitCodes: new Set([0, 1]),
  })
  const updatedStatus = await getStatus(repository, true, true)
  if (result.exitCode !== 0) {
    if (updatedStatus.doConflictedFilesExist) {
      return 'conflicted'
    }

    throw new GitError(result, args, result.stderr)
  }

  if (
    !updatedStatus.workingDirectory.files.some(
      changed =>
        paths.includes(changed.path) ||
        (changed.status.kind === AppFileStatusKind.Renamed &&
          paths.includes(changed.status.oldPath))
    )
  ) {
    throw new Error(
      'There are no changes to apply. This file may already have been reverted.'
    )
  }

  return 'applied'
}

/**
 * Creates a new commit that reverts the changes of a previous commit
 *
 * @param repository  - The repository to update
 *
 * @param commit         - The SHA of the commit to be reverted
 */
export async function revertCommit(
  repository: Repository,
  commit: Commit,
  currentRemote: IRemote | null,
  progressCallback?: (progress: IRevertProgress) => void
) {
  const args = ['revert']
  if (commit.parentSHAs.length > 1) {
    args.push('-m', '1')
  }

  args.push(commit.sha)

  let opts: IGitStringExecutionOptions = {}
  if (progressCallback) {
    const env = await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, currentRemote)
    )
    opts = await executionOptionsWithProgress(
      { env, trackLFSProgress: true },
      new RevertProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const title = progress.kind === 'progress' ? progress.details.title : ''
        const value = progress.percent

        progressCallback({ kind: 'revert', description, value, title })
      }
    )
  }

  await git(args, repository.path, 'revert', opts)
}
