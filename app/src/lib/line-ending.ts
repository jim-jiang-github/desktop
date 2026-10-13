import * as FSPromises from 'fs/promises'

export type LineEnding = 'LF' | 'CRLF'

const DetectionChunkSize = 64 * 1024

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
