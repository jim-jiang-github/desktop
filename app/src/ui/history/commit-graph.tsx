import * as React from 'react'
import { ICommitGraphRow } from '../../lib/commit-graph'

const LaneWidth = 8
const Padding = 5

/** Render the graph segment aligned with one virtualized commit row. */
export function CommitGraph({
  row,
  laneCount,
}: {
  readonly row: ICommitGraphRow
  readonly laneCount: number
}) {
  const x = (lane: number) => Padding + lane * LaneWidth
  return (
    <svg
      className="commit-graph"
      width={Padding * 2 + (laneCount - 1) * LaneWidth}
      height={50}
      aria-hidden={true}
      focusable="false"
    >
      {row.edges.map((edge, index) => {
        const fromY = edge.half === 'top' ? 0 : 25
        const toY = edge.half === 'top' ? 25 : 50
        return (
          <path
            key={index}
            className={`graph-color-${edge.color % 6}`}
            d={`M ${x(edge.from)} ${fromY} C ${x(edge.from)} ${
              fromY + 12.5
            }, ${x(edge.to)} ${toY - 12.5}, ${x(edge.to)} ${toY}`}
          />
        )
      })}
      <circle
        className={`graph-color-${row.lane % 6} ${
          row.isMerge ? 'merge-node' : 'commit-node'
        }`}
        cx={x(row.lane)}
        cy={25}
        r={row.isMerge ? 3.5 : 2.5}
      />
    </svg>
  )
}
