import { Commit } from '../models/commit'

/** One connection between the top, center, or bottom of a graph row. */
export interface ICommitGraphEdge {
  readonly from: number
  readonly to: number
  readonly color: number
  readonly half: 'top' | 'bottom'
}

/** The graph geometry for one commit in topological order. */
export interface ICommitGraphRow {
  readonly lane: number
  readonly edges: ReadonlyArray<ICommitGraphEdge>
  readonly isMerge: boolean
}

/** Lay out commits without inventing connections across missing parents. */
export function buildCommitGraph(commits: ReadonlyArray<Commit>): {
  readonly rows: ReadonlyMap<string, ICommitGraphRow>
  readonly laneCount: number
} {
  const lanes: Array<string | null> = []
  const rows = new Map<string, ICommitGraphRow>()
  let laneCount = 1

  for (const commit of commits) {
    const incoming = lanes.map((sha, lane) => ({ sha, lane }))
    let lane = lanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) {
        lane = lanes.length
      }
      lanes[lane] = commit.sha
    }

    const edges: ICommitGraphEdge[] = []
    for (const { sha, lane: index } of incoming) {
      if (sha !== null) {
        edges.push({ from: index, to: index, color: index, half: 'top' })
      }
    }

    lanes[lane] = null
    for (const [index, parent] of commit.parentSHAs.entries()) {
      let parentLane = lanes.indexOf(parent)
      if (parentLane === -1) {
        parentLane = index === 0 ? lane : lanes.indexOf(null)
        if (parentLane === -1 || lanes[parentLane] !== null) {
          parentLane = lanes.length
        }
        lanes[parentLane] = parent
      }
      edges.push({
        from: lane,
        to: parentLane,
        color: parentLane,
        half: 'bottom',
      })
    }

    for (const { sha, lane: index } of incoming) {
      if (sha !== null && index !== lane && lanes[index] !== null) {
        edges.push({ from: index, to: index, color: index, half: 'bottom' })
      }
    }

    laneCount = Math.max(laneCount, lanes.length, lane + 1)
    rows.set(commit.sha, {
      lane,
      edges,
      isMerge: commit.parentSHAs.length > 1,
    })
  }

  return { rows, laneCount }
}
