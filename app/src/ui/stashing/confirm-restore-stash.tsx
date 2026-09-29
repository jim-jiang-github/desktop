import * as React from 'react'
import { Repository } from '../../models/repository'
import { IStashEntry } from '../../models/stash-entry'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmRestoreStashProps {
  readonly repository: Repository
  readonly stash: IStashEntry
  readonly dispatcher: Pick<Dispatcher, 'applyRepositoryStash'>
  readonly onDismissed: () => void
}

/** Confirm the checkout that will receive a selected stash, without dropping it. */
export function ConfirmRestoreStashDialog(props: IConfirmRestoreStashProps) {
  const { repository, stash, dispatcher, onDismissed } = props
  const [restoring, setRestoring] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const restore = React.useCallback(async () => {
    setRestoring(true)
    setErrorMessage(null)
    try {
      await dispatcher.applyRepositoryStash(repository, stash.stashSha)
    } catch (error) {
      setRestoring(false)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      log.error('Unable to restore the selected stash; it was kept', error)
      return
    }
    onDismissed()
  }, [repository, stash, dispatcher, onDismissed])

  return (
    <Dialog
      id="restore-repository-stash"
      title="Restore selected stash?"
      onSubmit={restore}
      onDismissed={onDismissed}
      loading={restoring}
      disabled={restoring}
    >
      {errorMessage !== null && <DialogError>{errorMessage}</DialogError>}
      <DialogContent>
        <p>Apply this stash to the following worktree:</p>
        <p className="stash-restore-path">{repository.path}</p>
        <p>
          The stash will be kept, including when conflicts occur. You can delete
          it separately when no longer needed.
        </p>
        {errorMessage !== null && (
          <p role="status">
            Restore did not complete. The stash was kept. Cancel and open
            Changes to review any conflicts.
          </p>
        )}
      </DialogContent>
      <DialogFooter>
        <OkCancelButtonGroup okButtonText="Restore" />
      </DialogFooter>
    </Dialog>
  )
}
