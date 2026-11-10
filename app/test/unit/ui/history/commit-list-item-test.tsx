import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Commit } from '../../../../src/models/commit'
import { CommitIdentity } from '../../../../src/models/commit-identity'
import { formatDate } from '../../../../src/lib/format-date'
import { CommitListItem } from '../../../../src/ui/history/commit-list-item'
import { render, screen } from '../../../helpers/ui/render'

describe('CommitListItem', () => {
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
