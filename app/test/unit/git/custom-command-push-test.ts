import assert from 'node:assert/strict'
import { it, TestContext } from 'node:test'
import { writeFile } from 'node:fs/promises'
import * as Path from 'node:path'
import { exec } from 'dugite'
import { setupEmptyRepository } from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { pushCustomCommandRequest } from '../../../src/lib/custom-command-push'

async function setup(t: TestContext) {
  const repo = await setupEmptyRepository(t, 'development')
  const run = async (...args: string[]) => {
    const result = await exec(args, repo.path)
    assert.equal(result.exitCode, 0, result.stderr)
    return result.stdout.trim()
  }
  await makeCommit(repo, {
    entries: [{ path: 'file', contents: 'initial' }],
    commitMessage: 'initial',
  })
  const remoteURL = await createTempDirectory(t)
  await run('clone', '--bare', repo.path, remoteURL)
  await run('remote', 'add', 'origin', remoteURL)
  await makeCommit(repo, {
    entries: [{ path: 'file', contents: 'release' }],
    commitMessage: 'release',
  })
  const commit = await run('rev-parse', 'HEAD')
  const tag = 'custom-v3.6.7-beta5'
  await run('tag', '-a', tag, '-m', 'release')
  const tagObject = await run('rev-parse', `refs/tags/${tag}`)
  return {
    repo,
    run,
    request: { remoteURL, branch: 'development', commit, tag, tagObject },
  }
}

it('pushes exactly the pinned commit and annotated tag through the shared Desktop push path', async t => {
  const { repo, run, request } = await setup(t)
  await run('tag', 'unrelated')
  await pushCustomCommandRequest(repo, request)
  assert.equal(
    await run(
      '--git-dir',
      request.remoteURL,
      'rev-parse',
      'refs/heads/development'
    ),
    request.commit
  )
  assert.equal(
    await run(
      '--git-dir',
      request.remoteURL,
      'rev-parse',
      `refs/tags/${request.tag}`
    ),
    request.tagObject
  )
  assert.equal(
    await run('--git-dir', request.remoteURL, 'tag', '--list', 'unrelated'),
    ''
  )
})

it('an existing remote tag rejects the entire atomic update and preserves local refs', async t => {
  const { repo, run, request } = await setup(t)
  const old = await run('rev-parse', 'HEAD^')
  await run(
    '--git-dir',
    request.remoteURL,
    'update-ref',
    `refs/tags/${request.tag}`,
    old
  )
  await assert.rejects(pushCustomCommandRequest(repo, request))
  assert.equal(
    await run(
      '--git-dir',
      request.remoteURL,
      'rev-parse',
      'refs/heads/development'
    ),
    old
  )
  assert.equal(
    await run('rev-parse', `refs/tags/${request.tag}`),
    request.tagObject
  )
  assert.equal(await run('rev-parse', 'HEAD'), request.commit)
})

for (const change of [
  'branch',
  'commit',
  'tag',
  'dirty',
  'origin',
  'multiple-urls',
] as const) {
  it(`refuses a changed ${change} before pushing`, async t => {
    const { repo, run, request } = await setup(t)
    if (change === 'branch') {
      await run('checkout', '-b', 'different')
    }
    if (change === 'commit') {
      await run('commit', '--allow-empty', '-m', 'other')
    }
    if (change === 'tag') {
      await run('tag', '-f', request.tag, 'HEAD^')
    }
    if (change === 'dirty') {
      await writeFile(Path.join(repo.path, 'dirty'), 'keep')
    }
    if (change === 'origin') {
      await run('remote', 'set-url', 'origin', 'https://example.com/changed')
    }
    if (change === 'multiple-urls') {
      await run(
        'remote',
        'set-url',
        '--add',
        '--push',
        'origin',
        request.remoteURL
      )
      await run(
        'remote',
        'set-url',
        '--add',
        '--push',
        'origin',
        request.remoteURL + '-other'
      )
    }
    await assert.rejects(
      pushCustomCommandRequest(repo, request),
      /changed|multiple URLs/
    )
    assert.equal(await run('--git-dir', request.remoteURL, 'tag', '--list'), '')
  })
}
