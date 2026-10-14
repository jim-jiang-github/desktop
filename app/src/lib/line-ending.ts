import * as FSPromises from 'fs/promises'
import { Repository } from '../models/repository'
import { git } from './git/core'

export type LineEnding = 'LF' | 'CRLF'

const DetectionChunkSize = 64 * 1024

const mismatchCache = new Map<string, Promise<boolean>>()

function getMismatchCacheKey(
  repositoryPath: string,
  relativePath: string
): string {
  return `${repositoryPath}\0${relativePath}`
}

/**
 * Clear cached line ending mismatch detection results.
 */
export function clearLineEndingMismatchCache(
  repositoryPath?: string,
  relativePath?: string
): void {
  if (repositoryPath === undefined) {
    mismatchCache.clear()
    return
  }

  if (relativePath === undefined) {
    for (const key of mismatchCache.keys()) {
      if (key.startsWith(`${repositoryPath}\0`)) {
        mismatchCache.delete(key)
      }
    }
    return
  }

  mismatchCache.delete(getMismatchCacheKey(repositoryPath, relativePath))
}

function parseNumstatTotal(stdout: string): number {
  const line = stdout.trim().split(/\r?\n/)[0]
  if (!line) {
    return 0
  }
  const parts = line.split(/\s+/)
  const added = parseInt(parts[0], 10) || 0
  const deleted = parseInt(parts[1], 10) || 0
  return added + deleted
}

/**
 * Check whether a modified file's diff is entirely (or overwhelmingly) caused by
 * inverted line endings (e.g. CRLF vs LF).
 */
export async function isFileLineEndingMismatch(
  repository: Repository,
  relativePath: string
): Promise<boolean> {
  const cacheKey = getMismatchCacheKey(repository.path, relativePath)
  const cached = mismatchCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const promise = (async () => {
    try {
      const quietResult = await git(
        [
          'diff',
          '--ignore-space-at-eol',
          '--quiet',
          'HEAD',
          '--',
          relativePath,
        ],
        repository.path,
        'checkLineEndingMismatchQuiet',
        { successExitCodes: new Set([0, 1]) }
      )

      if (quietResult.exitCode === 0) {
        return true
      }

      // If quiet check returned 1, check if the vast majority of the diff
      // is caused by inverted line endings across the file plus minor edits.
      const [normalResult, ignoreResult] = await Promise.all([
        git(
          ['diff', '--numstat', 'HEAD', '--', relativePath],
          repository.path,
          'checkLineEndingMismatchNormal',
          { successExitCodes: new Set([0, 1]) }
        ),
        git(
          [
            'diff',
            '--ignore-space-at-eol',
            '--numstat',
            'HEAD',
            '--',
            relativePath,
          ],
          repository.path,
          'checkLineEndingMismatchIgnore',
          { successExitCodes: new Set([0, 1]) }
        ),
      ])

      const normalTotal = parseNumstatTotal(normalResult.stdout)
      const ignoreTotal = parseNumstatTotal(ignoreResult.stdout)

      if (normalTotal >= 8 && ignoreTotal / normalTotal <= 0.2) {
        return true
      }

      return false
    } catch {
      // If HEAD is invalid (e.g. initial repository state), try against index
      try {
        const quietResult = await git(
          ['diff', '--ignore-space-at-eol', '--quiet', '--', relativePath],
          repository.path,
          'checkLineEndingMismatchQuietNoHead',
          { successExitCodes: new Set([0, 1]) }
        )
        return quietResult.exitCode === 0
      } catch {
        return false
      }
    }
  })()

  if (mismatchCache.size > 500) {
    const oldestKey = mismatchCache.keys().next().value
    if (oldestKey !== undefined) {
      mismatchCache.delete(oldestKey)
    }
  }

  mismatchCache.set(cacheKey, promise)
  return promise
}

/**
 * Detect the predominant line ending (LF or CRLF) of a file.
 * Returns null if the file cannot be read, does not exist,
 * or appears to be binary (contains null bytes).
 */
export async function detectLineEnding(
  fullPath: string
): Promise<LineEnding | null> {
  let fileHandle: FSPromises.FileHandle | null = null
  try {
    fileHandle = await FSPromises.open(fullPath, 'r')
    const buffer = Buffer.alloc(DetectionChunkSize)
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      DetectionChunkSize,
      0
    )
    if (bytesRead === 0) {
      return 'LF'
    }

    let crlfCount = 0
    let lfCount = 0

    for (let i = 0; i < bytesRead; i++) {
      const byte = buffer[i]
      if (byte === 0) {
        return null
      }
      if (byte === 0x0a) {
        if (i > 0 && buffer[i - 1] === 0x0d) {
          crlfCount++
        } else {
          lfCount++
        }
      }
    }

    if (crlfCount > lfCount) {
      return 'CRLF'
    }

    return 'LF'
  } catch (e) {
    return null
  } finally {
    if (fileHandle !== null) {
      await fileHandle.close().catch(() => {})
    }
  }
}

/**
 * Get the alternative line ending.
 */
export function getNextLineEnding(current: LineEnding): LineEnding {
  return current === 'CRLF' ? 'LF' : 'CRLF'
}

/**
 * Rewrite all line endings in the file to the target line ending (LF or CRLF).
 */
export async function toggleLineEnding(
  fullPath: string,
  targetEnding: LineEnding
): Promise<void> {
  const content = await FSPromises.readFile(fullPath, 'utf8')
  const newContent =
    targetEnding === 'CRLF'
      ? content.replace(/\r?\n/g, '\r\n')
      : content.replace(/\r?\n/g, '\n')
  await FSPromises.writeFile(fullPath, newContent, 'utf8')
}
