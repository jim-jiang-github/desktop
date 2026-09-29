import * as React from 'react'
import { createPortal } from 'react-dom'
import { IRepositoryStashEntry } from '../../models/stash-entry'
import { CommittedFileChange } from '../../models/status'
import { IDiff } from '../../models/diff'
import { getRepositoryStashedFiles } from '../../lib/git/stash'
import { getCommitDiff } from '../../lib/git/diff'
import { IStashDiffViewerProps } from './stash-diff-viewer'
import { Button } from '../lib/button'
import { PopupType } from '../../models/popup'
import { Dispatcher } from '../dispatcher'
import { List } from '../lib/list'
import { FileList } from '../history/file-list'
import { SeamlessDiffSwitcher } from '../diff/seamless-diff-switcher'
import { TooltippedContent } from '../lib/tooltipped-content'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { clamp } from '../../lib/clamp'

interface IRepositoryStashBrowserProps
  extends Omit<
    IStashDiffViewerProps,
    | 'stashEntry'
    | 'selectedStashedFile'
    | 'stashedFileDiff'
    | 'fileListWidth'
    | 'askForConfirmationOnDiscardStash'
    | 'dispatcher'
  > {
  readonly entries: ReadonlyArray<IRepositoryStashEntry>
  readonly sidebarHost: HTMLDivElement
  readonly sidebarWidth: number
  readonly dispatcher: Pick<
    Dispatcher,
    'refreshRepositoryStashes' | 'showPopup' | 'postError'
  >
}

function stashTitle(entry: IRepositoryStashEntry) {
  return entry.isDesktopStash
    ? 'Changes saved by GitHub Desktop'
    : entry.message.replace(/^(?:WIP on|On) .+?: /, '')
}

function stashMetadata(entry: IRepositoryStashEntry) {
  return `${entry.branchName || 'Unknown branch'} · ${new Date(
    entry.createdAt
  ).toLocaleString()}`
}

/** Browse shared stashes while reusing the repository sidebar and existing diff UI. */
export function RepositoryStashBrowser(props: IRepositoryStashBrowserProps) {
  const { entries, repository, dispatcher, sidebarHost, sidebarWidth } = props
  const [selectedSha, setSelectedSha] = React.useState(
    entries[0]?.stashSha ?? ''
  )
  const [files, setFiles] = React.useState<ReadonlyArray<CommittedFileChange>>(
    []
  )
  const [file, setFile] = React.useState<CommittedFileChange | null>(null)
  const [diff, setDiff] = React.useState<IDiff | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [listHeight, setListHeight] = React.useState(220)
  const [sidebarHeight, setSidebarHeight] = React.useState(600)
  const selected = entries.find(entry => entry.stashSha === selectedSha)
  const maxListHeight = Math.max(112, sidebarHeight - 180)
  const effectiveListHeight = clamp(listHeight, 112, maxListHeight)

  React.useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSidebarHeight(entry.contentRect.height)
    })
    observer.observe(sidebarHost)
    return () => observer.disconnect()
  }, [sidebarHost])

  React.useEffect(() => {
    if (selected === undefined) {
      setSelectedSha(entries[0]?.stashSha ?? '')
    }
  }, [entries, selected])

  React.useEffect(() => {
    let cancelled = false
    setFiles([])
    setFile(null)
    setDiff(null)
    if (selected === undefined) {
      setLoading(false)
      return
    }
    setLoading(true)
    getRepositoryStashedFiles(repository, selected).then(
      nextFiles => {
        if (!cancelled) {
          setFiles(nextFiles)
          setFile(nextFiles[0] ?? null)
          setLoading(false)
        }
      },
      error => {
        if (!cancelled) {
          setLoading(false)
          dispatcher.postError(error)
        }
      }
    )
    return () => {
      cancelled = true
    }
    // Refreshing metadata must not reload the preview for the same commit.
  }, [repository, selected?.stashSha, dispatcher])

  React.useEffect(() => {
    let cancelled = false
    setDiff(null)
    if (file !== null) {
      getCommitDiff(repository, file, file.commitish).then(
        nextDiff => {
          if (!cancelled) {
            setDiff(nextDiff)
          }
        },
        error => {
          if (!cancelled) {
            dispatcher.postError(error)
          }
        }
      )
    }
    return () => {
      cancelled = true
    }
  }, [repository, file, dispatcher])

  const refresh = React.useCallback(async () => {
    try {
      await dispatcher.refreshRepositoryStashes(repository)
    } catch (error) {
      dispatcher.postError(error)
    }
  }, [repository, dispatcher])

  React.useEffect(() => {
    const timer = window.setInterval(refresh, 5000)
    refresh()
    return () => window.clearInterval(timer)
  }, [refresh])

  const selectStash = React.useCallback(
    (row: number) => {
      setSelectedSha(entries[row].stashSha)
    },
    [entries]
  )

  const requestRestore = React.useCallback(() => {
    if (selected !== undefined) {
      dispatcher.showPopup({
        type: PopupType.ConfirmRestoreRepositoryStash,
        repository,
        stash: selected,
      })
    }
  }, [selected, repository, dispatcher])

  const requestDelete = React.useCallback(() => {
    if (selected !== undefined) {
      dispatcher.showPopup({
        type: PopupType.ConfirmDiscardStash,
        repository,
        stash: selected,
        allStashes: true,
      })
    }
  }, [selected, repository, dispatcher])

  const showMore = React.useCallback(() => {
    showContextualMenu([{ label: 'Delete stash…', action: requestDelete }])
  }, [requestDelete])

  const renderEntry = React.useCallback(
    (row: number) => {
      const entry = entries[row]
      return (
        <TooltippedContent
          className="repository-stash-row"
          tooltip={`${entry.message}\n${stashMetadata(entry)}`}
        >
          <span className="stash-title">{stashTitle(entry)}</span>
          <span className="stash-metadata">{stashMetadata(entry)}</span>
        </TooltippedContent>
      )
    },
    [entries]
  )
  const rowLabel = React.useCallback(
    (row: number) =>
      `${stashTitle(entries[row])}, ${stashMetadata(entries[row])}`,
    [entries]
  )

  const openFile = React.useCallback(
    (row: number) => {
      props.onOpenInExternalEditor(files[row].path)
    },
    [files, props.onOpenInExternalEditor]
  )

  const startResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button === 0) {
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
        event.preventDefault()
      }
    },
    []
  )
  const resize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        setListHeight(
          clamp(
            event.clientY - sidebarHost.getBoundingClientRect().top,
            112,
            maxListHeight
          )
        )
      }
    },
    [sidebarHost, maxListHeight]
  )
  const resizeWithKeyboard = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const height =
        event.key === 'ArrowUp'
          ? effectiveListHeight - 16
          : event.key === 'ArrowDown'
          ? effectiveListHeight + 16
          : event.key === 'Home'
          ? 112
          : event.key === 'End'
          ? maxListHeight
          : null
      if (height !== null) {
        setListHeight(clamp(height, 112, maxListHeight))
        event.preventDefault()
      }
    },
    [effectiveListHeight, maxListHeight]
  )
  const resetResize = React.useCallback(() => setListHeight(220), [])
  const selectedIndex = entries.findIndex(
    entry => entry.stashSha === selectedSha
  )

  const sidebar = (
    <div className="repository-stash-sidebar">
      <div
        className="repository-stash-list"
        style={{ height: effectiveListHeight }}
      >
        <div className="stash-section-heading">
          <span>All branches</span>
          <Button
            onClick={refresh}
            ariaLabel="Refresh stashes"
            className="stash-icon-button"
          >
            <Octicon symbol={octicons.sync} />
          </Button>
        </div>
        <List
          ariaLabel="Stashes"
          rowRenderer={renderEntry}
          rowCount={entries.length}
          rowHeight={52}
          selectedRows={selectedIndex < 0 ? [] : [selectedIndex]}
          onSelectedRowChanged={selectStash}
          getRowAriaLabel={rowLabel}
          invalidationProps={entries}
        />
      </div>
      <button
        className="stash-splitter"
        type="button"
        // Focusable ARIA separators are interactive window splitters.
        // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role
        role="separator"
        aria-label="Stash and file list divider"
        aria-orientation="horizontal"
        aria-valuemin={112}
        aria-valuemax={maxListHeight}
        aria-valuenow={effectiveListHeight}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={resize}
        onKeyDown={resizeWithKeyboard}
        onDoubleClick={resetResize}
      />
      <div className="stash-section-heading">
        Changed files ({files.length})
      </div>
      <FileList
        files={files}
        selectedFile={file}
        onSelectedFileChanged={setFile}
        availableWidth={sidebarWidth}
        onRowDoubleClick={openFile}
      />
      <div className="stash-sidebar-footer">Shared across worktrees</div>
    </div>
  )

  return (
    <>
      {createPortal(sidebar, sidebarHost)}
      <section id="repository-stash-detail">
        {selected === undefined ? (
          <div className="empty-stashes">
            <h3>No stashed changes</h3>
            <p>
              Stashes created in GitHub Desktop or on the command line appear
              here.
            </p>
          </div>
        ) : (
          <>
            <header className="repository-stash-header">
              <div className="stash-heading">
                <TooltippedContent
                  tooltip={selected.message}
                  className="stash-title"
                >
                  <h3>{stashTitle(selected)}</h3>
                </TooltippedContent>
                <TooltippedContent
                  tooltip={`${selected.name.replace(
                    'refs/',
                    ''
                  )} · ${stashMetadata(selected)}`}
                  className="stash-metadata"
                >
                  {selected.name.replace('refs/', '')} ·{' '}
                  {stashMetadata(selected)}
                </TooltippedContent>
              </div>
              <div className="stash-actions">
                <Button onClick={requestRestore} disabled={loading}>
                  Restore…
                </Button>
                <Button
                  onClick={showMore}
                  ariaLabel="More stash actions"
                  ariaHaspopup="menu"
                >
                  <Octicon symbol={octicons.kebabHorizontal} />
                </Button>
              </div>
            </header>
            {loading ? (
              <div role="status" className="stash-loading">
                Loading stashed files…
              </div>
            ) : null}
            {file === null ? null : (
              <>
                <TooltippedContent
                  className="stash-file-heading"
                  tooltip={file.path}
                >
                  {file.path}
                </TooltippedContent>
                <SeamlessDiffSwitcher
                  repository={repository}
                  readOnly={true}
                  file={file}
                  diff={diff}
                  imageDiffType={props.imageDiffType}
                  hideWhitespaceInDiff={false}
                  showDiffCheckMarks={false}
                  showSideBySideDiff={props.showSideBySideDiff}
                  onOpenBinaryFile={props.onOpenBinaryFile}
                  onChangeImageDiffType={props.onChangeImageDiffType}
                  onHideWhitespaceInDiffChanged={
                    props.onHideWhitespaceInDiffChanged
                  }
                  onOpenSubmodule={props.onOpenSubmodule}
                />
              </>
            )}
            <footer>
              Restore applies to the current worktree and keeps this stash.
            </footer>
          </>
        )}
      </section>
    </>
  )
}
