import * as React from 'react'
import * as Path from 'path'
import classNames from 'classnames'

import { PathLabel } from '../lib/path-label'
import { Octicon, iconForStatus } from '../octicons'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { mapStatus } from '../../lib/status'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../models/status'
import { TooltipDirection } from '../lib/tooltip'
import { TooltippedContent } from '../lib/tooltipped-content'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { IMatches } from '../../lib/fuzzy-find'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import {
  LineEnding,
  clearLineEndingMismatchCache,
  detectLineEnding,
  getNextLineEnding,
  isFileLineEndingMismatch,
  toggleLineEnding,
} from '../../lib/line-ending'

interface IChangedFileProps {
  readonly file: WorkingDirectoryFileChange
  readonly include: boolean | null
  readonly availableWidth: number
  readonly disableSelection: boolean
  readonly checkboxTooltip?: string
  readonly focused: boolean
  /** The characters in the file path to highlight */
  readonly matches?: IMatches
  readonly onIncludeChanged: (
    file: WorkingDirectoryFileChange,
    include: boolean
  ) => void
  readonly repository?: Repository
  readonly dispatcher?: Dispatcher
}

interface IChangedFileState {
  readonly lineEnding: LineEnding | null
  readonly isLineEndingMismatch: boolean
  readonly isTogglingLineEnding: boolean
}

/** a changed file in the working directory for a given repository */
export class ChangedFile extends React.Component<
  IChangedFileProps,
  IChangedFileState
> {
  private isComponentMounted = false

  public constructor(props: IChangedFileProps) {
    super(props)
    this.state = {
      lineEnding: null,
      isLineEndingMismatch: false,
      isTogglingLineEnding: false,
    }
  }

  public componentDidMount() {
    this.isComponentMounted = true
    this.updateLineEnding()
  }

  public componentWillUnmount() {
    this.isComponentMounted = false
  }

  public componentDidUpdate(prevProps: IChangedFileProps) {
    if (
      this.props.file.id !== prevProps.file.id ||
      this.props.file.path !== prevProps.file.path ||
      this.props.file.status !== prevProps.file.status ||
      this.props.repository !== prevProps.repository
    ) {
      this.updateLineEnding()
    }
  }

  private updateLineEnding = async () => {
    const { file, repository } = this.props
    if (
      repository === undefined ||
      file.status.kind === AppFileStatusKind.Deleted ||
      file.status.submoduleStatus !== undefined
    ) {
      if (
        (this.state.lineEnding !== null || this.state.isLineEndingMismatch) &&
        this.isComponentMounted
      ) {
        this.setState({ lineEnding: null, isLineEndingMismatch: false })
      }
      return
    }

    const fullPath = Path.join(repository.path, file.path)
    const lineEnding = await detectLineEnding(fullPath)
    if (
      !this.isComponentMounted ||
      this.props.file.id !== file.id ||
      this.props.repository?.path !== repository.path
    ) {
      return
    }

    if (lineEnding === null) {
      this.setState({ lineEnding: null, isLineEndingMismatch: false })
      return
    }

    let isLineEndingMismatch = false
    if (file.status.kind === AppFileStatusKind.Modified) {
      isLineEndingMismatch = await isFileLineEndingMismatch(
        repository,
        file.path
      )
    }

    if (
      this.isComponentMounted &&
      this.props.file.id === file.id &&
      this.props.repository?.path === repository.path
    ) {
      this.setState({ lineEnding, isLineEndingMismatch })
    }
  }

  private onLineEndingClick = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()

    const { lineEnding, isTogglingLineEnding } = this.state
    const { repository, file, dispatcher } = this.props

    if (
      lineEnding === null ||
      isTogglingLineEnding ||
      repository === undefined
    ) {
      return
    }

    const nextEnding = getNextLineEnding(lineEnding)
    const fullPath = Path.join(repository.path, file.path)

    clearLineEndingMismatchCache(repository.path, file.path)
    this.setState({ isTogglingLineEnding: true })

    try {
      await toggleLineEnding(fullPath, nextEnding)
      clearLineEndingMismatchCache(repository.path, file.path)
      if (this.isComponentMounted && this.props.file.id === file.id) {
        this.setState({
          lineEnding: nextEnding,
          isLineEndingMismatch: false,
          isTogglingLineEnding: false,
        })
      }
      if (dispatcher !== undefined) {
        dispatcher.refreshRepository(repository)
      }
    } catch (e) {
      log.error(`Failed to toggle line ending for ${fullPath}`, e)
      if (this.isComponentMounted && this.props.file.id === file.id) {
        this.setState({ isTogglingLineEnding: false })
        this.updateLineEnding()
      }
    }
  }

  private stopEventPropagation = (event: React.MouseEvent<any>) => {
    event.stopPropagation()
  }

  private handleCheckboxChange = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    this.props.onIncludeChanged(this.props.file, include)
  }

  private get checkboxValue(): CheckboxValue {
    if (this.props.include === true) {
      return CheckboxValue.On
    } else if (this.props.include === false) {
      return CheckboxValue.Off
    } else {
      return CheckboxValue.Mixed
    }
  }

  public render() {
    const {
      file,
      availableWidth,
      disableSelection,
      checkboxTooltip,
      focused,
      matches,
    } = this.props
    const { status, path } = file
    const fileStatus = mapStatus(status)

    const listItemPadding = 10 * 2
    const checkboxWidth = 20
    const statusWidth = 16
    const filePadding = 5
    const lineEndingButtonWidth = this.state.lineEnding !== null ? 36 : 0

    const availablePathWidth =
      availableWidth -
      listItemPadding -
      checkboxWidth -
      filePadding -
      statusWidth -
      lineEndingButtonWidth

    const includedText =
      this.props.include === true
        ? 'included'
        : this.props.include === undefined
        ? 'partially included'
        : 'not included'

    const pathScreenReaderMessage = `${path} ${mapStatus(
      status
    )} ${includedText}`

    return (
      <div className="file">
        <TooltippedContent
          tooltip={checkboxTooltip}
          direction={TooltipDirection.EAST}
          tagName="div"
        >
          <Checkbox
            // The checkbox doesn't need to be tab reachable since we emulate
            // checkbox behavior on the list item itself, ie hitting space bar
            // while focused on a row will toggle selection.
            tabIndex={-1}
            value={this.checkboxValue}
            onChange={this.handleCheckboxChange}
            disabled={disableSelection}
          />
        </TooltippedContent>

        <PathLabel
          path={path}
          status={status}
          availableWidth={availablePathWidth}
          ariaHidden={true}
          matches={matches}
        />

        {this.state.lineEnding !== null && (
          <TooltippedContent
            tooltip={
              this.state.isLineEndingMismatch
                ? `Line ending mismatch: entire diff is caused by line endings (${
                    this.state.lineEnding
                  }). Click to switch to ${getNextLineEnding(
                    this.state.lineEnding
                  )}`
                : `Line ending: ${
                    this.state.lineEnding
                  }. Click to switch to ${getNextLineEnding(
                    this.state.lineEnding
                  )}`
            }
            direction={TooltipDirection.NORTH}
          >
            <button
              type="button"
              className={classNames('line-ending-button', {
                'line-ending-mismatch': this.state.isLineEndingMismatch,
              })}
              onClick={this.onLineEndingClick}
              onMouseDown={this.stopEventPropagation}
              onMouseUp={this.stopEventPropagation}
              onDoubleClick={this.stopEventPropagation}
              disabled={this.state.isTogglingLineEnding}
              tabIndex={-1}
              aria-label={
                this.state.isLineEndingMismatch
                  ? `Line ending mismatch: switch from ${
                      this.state.lineEnding
                    } to ${getNextLineEnding(this.state.lineEnding)}`
                  : `Toggle line ending from ${
                      this.state.lineEnding
                    } to ${getNextLineEnding(this.state.lineEnding)}`
              }
            >
              {this.state.lineEnding}
            </button>
          </TooltippedContent>
        )}

        <AriaLiveContainer message={pathScreenReaderMessage} />
        <TooltippedContent
          ancestorFocused={focused}
          openOnFocus={true}
          tooltip={fileStatus}
          direction={TooltipDirection.EAST}
        >
          <Octicon
            symbol={iconForStatus(status)}
            className={'status status-' + fileStatus.toLowerCase()}
          />
        </TooltippedContent>
      </div>
    )
  }
}
