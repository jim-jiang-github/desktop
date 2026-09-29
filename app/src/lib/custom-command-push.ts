import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import {
  ICustomCommandExecution,
  CustomCommandResult,
  startCustomCommand,
} from './custom-command'
import { Repository } from '../models/repository'
import { IPushProgress } from '../models/progress'
import { git } from './git/core'
import { push } from './git/push'
import { envForRemoteOperation } from './git/environment'

/** Immutable identities prepared by an explicitly opted-in command. No credentials. */
export interface ICustomCommandPushRequest {
  readonly remoteURL: string
  readonly branch: string
  readonly commit: string
  readonly tag: string
  readonly tagObject: string
}

/** Validate the handoff before it can reach the authenticated Git runner. */
export function parseCustomCommandPushRequest(
  contents: string
): ICustomCommandPushRequest {
  const value: unknown = JSON.parse(contents.replace(/^\uFEFF/, ''))
  if (
    typeof value !== 'object' ||
    value === null ||
    !('remoteURL' in value) ||
    typeof value.remoteURL !== 'string' ||
    !/^https:\/\/[^/\s@]+\/[^\s]+$/.test(value.remoteURL) ||
    !('branch' in value) ||
    typeof value.branch !== 'string' ||
    value.branch.length === 0 ||
    !('commit' in value) ||
    typeof value.commit !== 'string' ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.commit) ||
    !('tag' in value) ||
    typeof value.tag !== 'string' ||
    value.tag.length === 0 ||
    !('tagObject' in value) ||
    typeof value.tagObject !== 'string' ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.tagObject)
  ) {
    throw new Error('The command did not provide a valid Desktop push request.')
  }
  return {
    remoteURL: value.remoteURL,
    branch: value.branch,
    commit: value.commit,
    tag: value.tag,
    tagObject: value.tagObject,
  }
}

/** Keep one task alive across PowerShell preparation and Desktop's authenticated push. */
export function startCustomCommandWithDesktopPush(
  repositoryPath: string,
  command: string,
  onOutput: (chunk: Buffer) => void,
  pushRequest: (request: ICustomCommandPushRequest) => Promise<void>
): ICustomCommandExecution {
  let execution: ICustomCommandExecution | undefined
  let cancelled = false
  let pushing = false
  const result = (async (): Promise<CustomCommandResult> => {
    const directory = await mkdtemp(
      Path.join(tmpdir(), 'desktop-command-push-')
    )
    try {
      if (cancelled) {
        return { kind: 'cancelled' }
      }
      const requestPath = Path.join(directory, 'request.json')
      execution = startCustomCommand(
        repositoryPath,
        command,
        onOutput,
        requestPath
      )
      const prepared = await execution.result
      if (
        cancelled ||
        prepared.kind === 'cancelled' ||
        prepared.exitCode !== 0
      ) {
        return cancelled ? { kind: 'cancelled' } : prepared
      }
      const requestStat = await stat(requestPath)
      if (!requestStat.isFile() || requestStat.size > 16384) {
        throw new Error(
          'The Desktop push request must be a JSON file under 16 KiB.'
        )
      }
      const request = parseCustomCommandPushRequest(
        await readFile(requestPath, 'utf8')
      )
      if (cancelled) {
        return { kind: 'cancelled' }
      }
      pushing = true
      onOutput(
        Buffer.from(
          '\r\nPushing branch and tag using Desktop authentication...\r\n'
        )
      )
      await pushRequest(request)
      onOutput(
        Buffer.from('\r\nDesktop verified the pushed branch and tag.\r\n')
      )
      return prepared
    } finally {
      pushing = false
      await rm(directory, { recursive: true, force: true })
    }
  })()
  return {
    result,
    stop: async () => {
      if (pushing) {
        throw new Error(
          'Desktop is pushing. Wait for the remote result; stopping the preparation script cannot undo a push.'
        )
      }
      await execution?.stop()
      cancelled = true
    },
  }
}

/** Use the same Git/authentication path as Push origin, with pinned, atomic ref updates. */
export async function pushCustomCommandRequest(
  repository: Repository,
  request: ICustomCommandPushRequest,
  onProgress?: (progress: IPushProgress) => void
): Promise<void> {
  const { branch, commit, tag, tagObject, remoteURL } = request
  const branchRef = `refs/heads/${branch}`
  const tagRef = `refs/tags/${tag}`
  const run = async (args: ReadonlyArray<string>) =>
    (
      await git([...args], repository.path, 'validate Desktop push')
    ).stdout.trim()
  await run(['check-ref-format', branchRef])
  await run(['check-ref-format', tagRef])
  const fetchURL = await run(['remote', 'get-url', '--all', 'origin'])
  const pushURL = await run(['remote', 'get-url', '--push', '--all', 'origin'])
  if (fetchURL !== remoteURL || pushURL !== remoteURL) {
    throw new Error('Origin changed or has multiple URLs. Nothing was pushed.')
  }
  if (
    (await run(['symbolic-ref', '--quiet', 'HEAD'])) !== branchRef ||
    (await run(['rev-parse', '--verify', 'HEAD'])) !== commit ||
    (await run(['rev-parse', '--verify', tagRef])) !== tagObject ||
    (await run(['rev-parse', '--verify', `${tagObject}^{commit}`])) !==
      commit ||
    (await run(['status', '--porcelain', '--untracked-files=all'])) !== ''
  ) {
    throw new Error(
      'The prepared branch, commit, tag or working directory changed. Nothing was pushed.'
    )
  }
  // Use the validated URL and object IDs, not mutable remote names or local refs.
  await push(
    repository,
    { name: remoteURL, url: remoteURL },
    commit,
    branchRef,
    [`${tagObject}:${tagRef}`],
    { atomic: true },
    onProgress
  )
  const remoteRefs = await git(
    ['ls-remote', '--refs', '--', remoteURL, branchRef, tagRef],
    repository.path,
    'verify Desktop push',
    { env: await envForRemoteOperation(remoteURL) }
  )
  const rows = remoteRefs.stdout.trim().split(/\r?\n/)
  if (
    !rows.includes(`${commit}\t${branchRef}`) ||
    !rows.includes(`${tagObject}\t${tagRef}`)
  ) {
    throw new Error(
      'Push returned, but the remote branch/tag could not be verified. Inspect the remote before retrying.'
    )
  }
}
