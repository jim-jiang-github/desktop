import assert from 'node:assert'
import { describe, it } from 'node:test'
import { buildCommitGraph } from '../../src/lib/commit-graph'
import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'

function commit(sha: string, parents: ReadonlyArray<string> = []) {
  const identity = new CommitIdentity('Alice', 'alice@example.com', new Date(0))
  return new Commit(sha, sha, sha, '', identity, identity, parents, [], [])
}

describe('commit graph layout', () => {
  it('connects linear history and stops at the root', () => {
    const { rows, laneCount } = buildCommitGraph([
      commit('tip', ['middle']),
      commit('middle', ['root']),
      commit('root'),
    ])
    assert.strictEqual(laneCount, 1)
    assert.deepStrictEqual(rows.get('tip')?.edges, [
      { from: 0, to: 0, color: 0, half: 'bottom' },
    ])
    assert.strictEqual(rows.get('middle')?.edges.length, 2)
    assert.deepStrictEqual(rows.get('root')?.edges, [
      { from: 0, to: 0, color: 0, half: 'top' },
    ])
  })

  it('splits merge parents into lanes and rejoins at their shared ancestor', () => {
    const { rows, laneCount } = buildCommitGraph([
      commit('merge', ['main', 'topic']),
      commit('topic', ['base']),
      commit('main', ['base']),
      commit('base'),
    ])
    assert.strictEqual(laneCount, 2)
    assert.strictEqual(rows.get('merge')?.isMerge, true)
    assert.deepStrictEqual(
      rows.get('merge')?.edges.map(edge => edge.to),
      [0, 1]
    )
    assert.strictEqual(rows.get('topic')?.lane, 1)
    assert.ok(
      rows
        .get('main')
        ?.edges.some(
          edge => edge.from === 0 && edge.to === 1 && edge.half === 'bottom'
        )
    )
    assert.strictEqual(rows.get('base')?.lane, 1)
    assert.strictEqual(rows.get('base')?.edges.length, 1)
  })

  it('continues a parent lane when another lane joins that parent', () => {
    const { rows } = buildCommitGraph([
      commit('merge', ['main', 'revert']),
      commit('revert', ['main']),
      commit('main', ['root']),
      commit('root'),
    ])
    assert.deepStrictEqual(
      rows
        .get('revert')
        ?.edges.filter(edge => edge.half === 'bottom')
        .map(edge => [edge.from, edge.to]),
      [
        [1, 0],
        [0, 0],
      ]
    )
  })

  it('keeps octopus merges and pagination boundaries connected', () => {
    const commits = [
      commit('merge', ['a', 'b', 'c']),
      commit('a', ['root']),
      commit('b', ['root']),
      commit('c', ['root']),
    ]
    const first = buildCommitGraph(commits)
    const second = buildCommitGraph([...commits, commit('root')])
    assert.strictEqual(first.laneCount, 3)
    assert.deepStrictEqual([...first.rows], [...second.rows].slice(0, 4))
  })

  it('does not connect a missing parent to an unrelated visible commit', () => {
    const { rows } = buildCommitGraph([
      commit('tip', ['hidden']),
      commit('other'),
    ])
    assert.strictEqual(rows.get('tip')?.lane, 0)
    assert.strictEqual(rows.get('other')?.lane, 1)
    assert.ok(!rows.get('other')?.edges.some(edge => edge.to === 1))
  })
})
