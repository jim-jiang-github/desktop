import * as React from 'react'
import { Repository } from '../../models/repository'
import { IStashEntry } from '../../models/stash-entry'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmRestoreStashProps {
  readonly repository: Repository
  readonly stash: IStashEntry
  readonly dispatcher: Pick<
    Dispatcher,
    'applyRepositoryStash' | 'popRepositoryStash'
  >
  readonly deleteAfterRestore?: boolean
  readonly onDismissed: () => void
}

/** Confirm the checkout that will receive a selected stash, without dropping it. */
export function ConfirmRestoreStashDialog(props: IConfirmRestoreStashProps) {
  const { repository, stash, dispatcher, deleteAfterRestore, onDismissed } =
    props
  const [restoring, setRestoring] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const restore = React.useCallback(async () => {
    setRestoring(true)
    setErrorMessage(null)
    try {
      if (deleteAfterRestore === true) {
        await dispatcher.popRepositoryStash(repository, stash.stashSha)
      } else {
        await dispatcher.applyRepositoryStash(repository, stash.stashSha)
      }
    } catch (error) {
      setRestoring(false)
      setErrorMessage(error instanceof Error ? error.message : String(error))
      log.error('Unable to restore the selected stash; it was kept', error)
      return
    }
    onDismissed()
  }, [repository, stash, dispatcher, deleteAfterRestore, onDismissed])

  const title =
    deleteAfterRestore === true
      ? 'Restore and delete selected stash?'
      : 'Restore selected stash?'
  const okButtonText =
    deleteAfterRestore === true ? 'Restore and delete' : 'Restore'

  return (
    <Dialog
      id="restore-repository-stash"
      title={title}
      onSubmit={restore}
      onDismissed={onDismissed}
      loading={restoring}
      disabled={restoring}
    >
      {errorMessage !== null && <DialogError>{errorMessage}</DialogError>}
      <DialogContent>
        <p>Apply this stash to the following worktree:</p>
        <p className="stash-restore-path">{repository.path}</p>
        {deleteAfterRestore === true ? (
          <p>
            The stash will be deleted if it applies cleanly. If conflicts occur,
            the stash will be kept so you can resolve them safely.
          </p>
        ) : (
          <p>
            The stash will be kept, including when conflicts occur. You can
            delete it separately when no longer needed.
          </p>
        )}
        {errorMessage !== null && (
          <p role="status">
            Restore did not complete. The stash was kept. Cancel and open
            Changes to review any conflicts.
          </p>
        )}
      </DialogContent>
      <DialogFooter>
        <OkCancelButtonGroup okButtonText={okButtonText} />
      </DialogFooter>
    </Dialog>
  )
}
