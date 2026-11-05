import * as React from 'react'
import { Commit, shortenSHA } from '../../models/commit'
import { Repository } from '../../models/repository'
import { CommittedFileChange } from '../../models/status'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmRevertFileChangesProps {
  readonly repository: Repository
  readonly commit: Commit
  readonly file: CommittedFileChange
  readonly onRevert: (
    repository: Repository,
    commit: Commit,
    file: CommittedFileChange
  ) => Promise<void>
  readonly onDismissed: () => void
}

/** Confirms reverting a single file's changes from a historical commit. */
export function ConfirmRevertFileChangesDialog({
  repository,
  commit,
  file,
  onRevert,
  onDismissed,
}: IConfirmRevertFileChangesProps) {
  const [isReverting, setIsReverting] = React.useState(false)

  const onSubmit = React.useCallback(async () => {
    if (isReverting) {
      return
    }

    setIsReverting(true)
    try {
      await onRevert(repository, commit, file)
    } finally {
      setIsReverting(false)
      onDismissed()
    }
  }, [isReverting, onRevert, repository, commit, file, onDismissed])

  return (
    <Dialog
      id="revert-file-changes"
      title={
        __DARWIN__
          ? 'Revert Changes to This File?'
          : 'Revert changes to this file?'
      }
      type="warning"
      role="alertdialog"
      ariaDescribedBy="revert-file-changes-description"
      loading={isReverting}
      disabled={isReverting}
      dismissDisabled={isReverting}
      onSubmit={onSubmit}
      onDismissed={onDismissed}
    >
      <DialogContent>
        <div id="revert-file-changes-description">
          <p>
            Revert the changes to <strong>{file.path}</strong> made in commit{' '}
            <strong>{shortenSHA(commit.sha)}</strong> ({commit.summary})?
          </p>
          <p>
            Later changes will be preserved where possible. Overlapping changes
            may cause conflicts that you will need to resolve.
          </p>
          <p>
            The result will appear in Changes for you to review and commit. No
            commit will be created automatically. Commit or stash any local
            changes to this file first.
          </p>
          {commit.isMergeCommit && (
            <p>
              This is a merge commit. Changes will be reverted relative to its
              first parent.
            </p>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <OkCancelButtonGroup destructive={true} okButtonText="Revert changes" />
      </DialogFooter>
    </Dialog>
  )
}
