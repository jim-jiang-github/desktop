import * as React from 'react'
import { matchesCommitSearch } from '../../lib/git/log'
import { Branch, IAheadBehind } from '../../models/branch'
import { Commit } from '../../models/commit'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IBranchComparisonGraphProps {
  readonly containerRef: React.Ref<HTMLElement>
  readonly mainline: Branch
  readonly currentBranch: Branch | null
  readonly aheadBehind: IAheadBehind
  readonly mergeBase?: string | null
  readonly commitSHAs: ReadonlyArray<string>
  readonly commitLookup: ReadonlyMap<string, Commit>
  readonly selectedSHA?: string
  readonly searchText: string
  readonly onCommitSelected: (commit: Commit) => void
}

/** A side-by-side summary of the commits in a branch comparison. */
export function BranchComparisonGraph({
  containerRef,
  mainline,
  currentBranch,
  aheadBehind,
  mergeBase,
  commitSHAs,
  commitLookup,
  selectedSHA,
  searchText,
  onCommitSelected,
}: IBranchComparisonGraphProps) {
  const { left, right, base } = React.useMemo(() => {
    // Git returns these commits in topological order, with children before
    // parents. Follow all visible parents to keep merged work on its owner lane.
    const mainlineSHAs = new Set([mainline.tip.sha])
    const left = new Array<Commit>()
    const right = new Array<Commit>()
    for (const sha of commitSHAs) {
      const commit = commitLookup.get(sha)
      if (commit === undefined || sha === mergeBase) {
        continue
      }

      if (mainlineSHAs.has(sha)) {
        left.push(commit)
        for (const parent of commit.parentSHAs) {
          mainlineSHAs.add(parent)
        }
      } else {
        right.push(commit)
      }
    }
    return {
      left,
      right,
      base: mergeBase ? commitLookup.get(mergeBase) : undefined,
    }
  }, [commitSHAs, commitLookup, mainline.tip.sha, mergeBase])
  const selectedRef = React.useRef<HTMLButtonElement>(null)
  const { ahead, behind } = aheadBehind
  const diverged = ahead > 0 && behind > 0
  const connectLeft = base !== undefined && left.length > 0
  const connectRight = base !== undefined && right.length > 0
  const relationship =
    mergeBase === null
      ? 'No common ancestor found'
      : diverged
      ? 'Branches have diverged'
      : ahead > 0
      ? 'Current branch contains the comparison branch'
      : behind > 0
      ? 'Comparison branch contains the current branch'
      : 'Both branches point to the same commit'

  const select = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const commit = commitLookup.get(event.currentTarget.dataset.sha ?? '')
      if (commit !== undefined) {
        onCommitSelected(commit)
      }
    },
    [commitLookup, onCommitSelected]
  )

  React.useEffect(() => {
    if (searchText.trim() !== '') {
      selectedRef.current?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [searchText, selectedSHA])

  const renderNode = (commit: Commit) => {
    const isBase = commit.sha === mergeBase
    const selected = commit.sha === selectedSHA
    const tip = [
      ...(commit.sha === mainline.tip.sha ? [mainline.name] : []),
      ...(commit.sha === currentBranch?.tip.sha ? [currentBranch.name] : []),
    ]
    const label = [
      ...tip,
      ...(isBase ? ['Merge base'] : []),
      `${commit.summary} (${commit.shortSha})`,
    ].join(': ')

    return (
      <TooltippedContent key={commit.sha} tagName="div" tooltip={label}>
        <button
          ref={selected ? selectedRef : undefined}
          type="button"
          className="branch-graph-node"
          aria-label={label}
          aria-pressed={selected}
          data-sha={commit.sha}
          data-search-context={!matchesCommitSearch(commit, searchText)}
          data-branch-tip={tip.length > 0 || isBase}
          onClick={select}
        >
          <span className="branch-graph-dot" aria-hidden={true} />
          {isBase && <span className="branch-graph-base">Merge base</span>}
          <span className="branch-graph-summary">{commit.summary}</span>
          <code>{commit.shortSha}</code>
        </button>
      </TooltippedContent>
    )
  }

  const renderLane = (
    branchName: string,
    commits: ReadonlyArray<Commit>,
    lane: 0 | 1,
    connected: boolean
  ) => (
    <div
      role="group"
      aria-label={branchName}
      className={`branch-graph-lane branch-graph-color-${lane}`}
      data-connected={connected}
    >
      {commits.length === 0 ? (
        <div className="branch-graph-empty">No unique commits</div>
      ) : (
        <div className="branch-graph-rail">{commits.map(renderNode)}</div>
      )}
    </div>
  )

  return (
    <section
      className="branch-comparison-graph"
      aria-label="Branch comparison graph"
      ref={containerRef}
    >
      <div className="branch-comparison-scroll">
        <header className="branch-comparison-header">
          <div className="branch-graph-relationship">{relationship}</div>
          <div className="branch-comparison-legend">
            <TooltippedContent
              className="branch-graph-color-0"
              tooltip={mainline.name}
            >
              {mainline.name}
            </TooltippedContent>
            {currentBranch !== null && (
              <TooltippedContent
                className="branch-graph-color-1"
                tooltip={currentBranch.name}
              >
                {currentBranch.name}
              </TooltippedContent>
            )}
          </div>
        </header>
        {left.length === 0 && right.length === 0 && base === undefined ? (
          <div className="panel blankslate">No commits to display</div>
        ) : (
          <>
            <div className="branch-comparison-diagram">
              {renderLane(mainline.name, left, 0, connectLeft)}
              {renderLane(
                currentBranch?.name ?? 'Current branch',
                right,
                1,
                connectRight
              )}
            </div>
            {base !== undefined && (
              <div
                className="branch-graph-shared"
                role="group"
                aria-label="Common ancestor"
                data-left={connectLeft}
                data-right={connectRight}
              >
                {connectLeft && (
                  <svg
                    className="branch-graph-connector branch-graph-color-0"
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                    aria-hidden={true}
                  >
                    <path
                      d={
                        connectRight
                          ? 'M 0 0 V 4 C 0 26 100 4 100 32'
                          : 'M 0 0 V 32'
                      }
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {connectRight && (
                  <span
                    className="branch-graph-connector branch-graph-color-1"
                    aria-hidden={true}
                  />
                )}
                <div className="branch-graph-base-card">
                  {renderNode(base)}
                  {(base.sha === mainline.tip.sha ||
                    base.sha === currentBranch?.tip.sha) && (
                    <div className="branch-graph-base-tips">
                      {base.sha === mainline.tip.sha && (
                        <span className="branch-graph-color-0">
                          Comparison branch tip: {mainline.name}
                        </span>
                      )}
                      {currentBranch !== null &&
                        base.sha === currentBranch.tip.sha && (
                          <span className="branch-graph-color-1">
                            Current branch tip: {currentBranch.name}
                          </span>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
