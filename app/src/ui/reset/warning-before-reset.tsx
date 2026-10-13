import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Row } from '../lib/row'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Commit } from '../../models/commit'
import { GitResetMode } from '../../lib/git/reset'

interface IWarningBeforeResetProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly commit: Commit
  readonly mode?: GitResetMode
  readonly onDismissed: () => void
}

interface IWarningBeforeResetState {
  readonly isLoading: boolean
}

/**
 * Dialog that alerts user that there are uncommitted changes in the working
 * directory where they are gonna be resetting to a previous commit.
 */
export class WarningBeforeReset extends React.Component<
  IWarningBeforeResetProps,
  IWarningBeforeResetState
> {
  public constructor(props: IWarningBeforeResetProps) {
    super(props)
    this.state = { isLoading: false }
  }

  public render() {
    const isHard = this.props.mode === GitResetMode.Hard
    const title = isHard
      ? __DARWIN__
        ? 'Hard Reset to Commit'
        : 'Hard reset to commit'
      : __DARWIN__
      ? 'Soft Reset to Commit'
      : 'Soft reset to commit'

    const message = isHard
      ? 'This moves the current branch to the selected commit and discards all commits and working directory changes made after it. If those commits have already been pushed, you may need to force push. Are you sure you want to hard reset to this commit?'
      : 'This moves the current branch to the selected commit. Changes from the commits being removed will remain staged and your working directory will be preserved. If those commits have already been pushed, you may need to force push. Do you want to continue?'

    const okButtonText = isHard ? 'Hard Reset' : 'Continue'

    return (
      <Dialog
        id="warning-before-reset"
        type="warning"
        title={title}
        loading={this.state.isLoading}
        disabled={this.state.isLoading}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        role="alertdialog"
        ariaDescribedBy="reset-warning-message"
      >
        <DialogContent>
          <Row id="reset-warning-message">{message}</Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText={okButtonText} />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, commit, mode, onDismissed } = this.props
    this.setState({ isLoading: true })

    try {
      await dispatcher.resetToCommit(repository, commit, false, mode)
    } finally {
      this.setState({ isLoading: false })
    }

    onDismissed()
  }
}
