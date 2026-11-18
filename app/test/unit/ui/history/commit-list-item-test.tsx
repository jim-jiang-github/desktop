import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Commit } from '../../../../src/models/commit'
import { CommitIdentity } from '../../../../src/models/commit-identity'
import { formatDate } from '../../../../src/lib/format-date'
import { CommitListItem } from '../../../../src/ui/history/commit-list-item'
import { render, screen } from '../../../helpers/ui/render'
import { buildCommitGraph } from '../../../../src/lib/commit-graph'

describe('CommitListItem', () => {
  it('renders merge lanes and branch labels without hiding context commits', () => {
    const identity = new CommitIdentity(
      'Alice',
      'alice@example.com',
      new Date(0)
    )
    const commit = new Commit(
      'merge',
      'merge',
      'Merge topic',
      '',
      identity,
      identity,
      ['a', 'b'],
      [],
      []
    )
    const graph = buildCommitGraph([commit])
    const view = render(
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
        graphRow={graph.rows.get(commit.sha)}
        graphLaneCount={graph.laneCount}
        graphRefs={['HEAD → main', 'topic']}
        isSearchContext={true}
      />
    )
    assert.ok(screen.getByText('Merge topic'))
    assert.ok(screen.getByText('HEAD → main'))
    assert.ok(screen.getByText('topic'))
    assert.ok(view.container.querySelector('.graph-search-context'))
    assert.ok(
      view.container.querySelector('svg[aria-hidden="true"] .merge-node')
    )
    assert.strictEqual(
      view.container.querySelectorAll('.commit-graph path').length,
      2
    )
    assert.strictEqual(
      view.container.querySelector('.commit-graph')?.getAttribute('width'),
      '18'
    )
    view.rerender(
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
      />
    )
    assert.strictEqual(view.container.querySelector('.commit-graph'), null)
    assert.strictEqual(
      view.container.querySelector('.graph-search-context'),
      null
    )
  })

  it('shows the exact author date and time', () => {
    const date = new Date('2026-11-10T02:03:04.000Z')
    const identity = new CommitIdentity('Alice', 'alice@example.com', date)
    const commit = new Commit(
      'sha',
      'sha',
      'A commit title',
      '',
      identity,
      identity,
      [],
      [],
      []
    )

    render(
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
      />
    )

    assert.ok(
      screen.getByText(
        formatDate(date, { dateStyle: 'medium', timeStyle: 'medium' }),
        {
          exact: false,
        }
      )
    )
    assert.strictEqual(
      screen.queryByText(/days? ago|just now/, {
        exact: false,
      }),
      null
    )
  })
})
