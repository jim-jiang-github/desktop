import * as React from 'react'
import { Dialog, DialogContent, DialogFooter, DialogError } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Row } from '../lib/row'
import { IStashEntry } from '../../models/stash-entry'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface IConfirmDiscardStashProps {
  readonly dispatcher: Pick<
    Dispatcher,
    | 'setConfirmDiscardStashSetting'
    | 'dropStash'
    | 'deleteRepositoryStash'
    | 'postError'
  >
  readonly repository: Repository
  readonly stash: IStashEntry
  readonly askForConfirmationOnDiscardStash: boolean
  readonly onDismissed: () => void
  readonly allStashes?: boolean
}

interface IConfirmDiscardStashState {
  readonly isDiscarding: boolean
  readonly confirmDiscardStash: boolean
  readonly errorMessage: string | null
}
/**
 * Dialog to confirm dropping a stash
 */
export class ConfirmDiscardStashDialog extends React.Component<
  IConfirmDiscardStashProps,
  IConfirmDiscardStashState
> {
  public constructor(props: IConfirmDiscardStashProps) {
    super(props)

    this.state = {
      isDiscarding: false,
      confirmDiscardStash: props.askForConfirmationOnDiscardStash,
      errorMessage: null,
    }
  }

  public render() {
    const title = this.props.allStashes
      ? 'Delete selected stash?'
      : __DARWIN__
      ? 'Discard Stash?'
      : 'Discard stash?'

    return (
      <Dialog
        id="discard-stash"
        type="warning"
        title={title}
        loading={this.state.isDiscarding}
        disabled={this.state.isDiscarding}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        role="alertdialog"
        ariaDescribedBy="discard-stash-warning-message"
      >
        {this.state.errorMessage !== null && (
          <DialogError>{this.state.errorMessage}</DialogError>
        )}
        <DialogContent>
          <Row id="discard-stash-warning-message">
            {this.props.allStashes
              ? 'Permanently delete this stash from all worktrees of this repository?'
              : 'Are you sure you want to discard these stashed changes?'}
          </Row>
          {this.props.allStashes ? (
            <Row>
              <code>{this.props.stash.stashSha}</code>
            </Row>
          ) : (
            <Row>
              <Checkbox
                label="Do not show this message again"
                value={
                  this.state.confirmDiscardStash
                    ? CheckboxValue.Off
                    : CheckboxValue.On
                }
                onChange={this.onAskForConfirmationOnDiscardStashChanged}
              />
            </Row>
          )}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={this.props.allStashes ? 'Delete stash' : 'Discard'}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onAskForConfirmationOnDiscardStashChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ confirmDiscardStash: value })
  }

  private onSubmit = async () => {
    const { dispatcher, repository, stash, onDismissed } = this.props

    this.setState({
      isDiscarding: true,
      errorMessage: null,
    })

    try {
      if (this.props.allStashes) {
        await dispatcher.deleteRepositoryStash(repository, stash.stashSha)
      } else {
        dispatcher.setConfirmDiscardStashSetting(this.state.confirmDiscardStash)
        await dispatcher.dropStash(repository, stash)
      }
    } catch (error) {
      if (this.props.allStashes) {
        log.error('Unable to delete the selected stash', error)
        this.setState({
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      } else {
        dispatcher.postError(error)
      }
      return
    } finally {
      this.setState({
        isDiscarding: false,
      })
    }

    onDismissed()
  }
}
