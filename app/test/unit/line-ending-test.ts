import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as FSPromises from 'fs/promises'
import * as Path from 'path'
import { createTempDirectory } from '../helpers/temp'
import { setupEmptyRepository } from '../helpers/repositories'
import { makeCommit } from '../helpers/repository-scaffolding'
import { exec } from 'dugite'
import {
  clearLineEndingMismatchCache,
  detectLineEnding,
  getNextLineEnding,
  isFileLineEndingMismatch,
  toggleLineEnding,
} from '../../src/lib/line-ending'

describe('line-ending', () => {
  it('detects LF line endings', async t => {
    const tempDir = await createTempDirectory(t)
    const filePath = Path.join(tempDir, 'lf-file.txt')
    await FSPromises.writeFile(filePath, 'line1\nline2\nline3\n', 'utf8')

    const ending = await detectLineEnding(filePath)
    assert.strictEqual(ending, 'LF')
  })

  it('detects CRLF line endings', async t => {
    const tempDir = await createTempDirectory(t)
    const filePath = Path.join(tempDir, 'crlf-file.txt')
    await FSPromises.writeFile(filePath, 'line1\r\nline2\r\nline3\r\n', 'utf8')

    const ending = await detectLineEnding(filePath)
    assert.strictEqual(ending, 'CRLF')
  })

  it('returns null for binary files', async t => {
    const tempDir = await createTempDirectory(t)
    const filePath = Path.join(tempDir, 'binary.bin')
    const buffer = Buffer.from([0x68, 0x65, 0x00, 0x6c, 0x6f, 0x0a])
    await FSPromises.writeFile(filePath, buffer)

    const ending = await detectLineEnding(filePath)
    assert.strictEqual(ending, null)
  })

  it('returns null for non-existent files', async t => {
    const ending = await detectLineEnding('non-existent-file-path-12345.txt')
    assert.strictEqual(ending, null)
  })

  it('toggles CRLF to LF and back to CRLF', async t => {
    const tempDir = await createTempDirectory(t)
    const filePath = Path.join(tempDir, 'toggle.txt')
    await FSPromises.writeFile(filePath, 'foo\r\nbar\r\nbaz\r\n', 'utf8')

    assert.strictEqual(await detectLineEnding(filePath), 'CRLF')
    assert.strictEqual(getNextLineEnding('CRLF'), 'LF')

    await toggleLineEnding(filePath, 'LF')
    const contentLF = await FSPromises.readFile(filePath, 'utf8')
    assert.strictEqual(contentLF, 'foo\nbar\nbaz\n')
    assert.strictEqual(await detectLineEnding(filePath), 'LF')

    assert.strictEqual(getNextLineEnding('LF'), 'CRLF')
    await toggleLineEnding(filePath, 'CRLF')
    const contentCRLF = await FSPromises.readFile(filePath, 'utf8')
    assert.strictEqual(contentCRLF, 'foo\r\nbar\r\nbaz\r\n')
    assert.strictEqual(await detectLineEnding(filePath), 'CRLF')
  })

  it('detects line ending mismatch when git diff is solely caused by CRLF vs LF', async t => {
    const repository = await setupEmptyRepository(t)
    await exec(['config', 'core.autocrlf', 'false'], repository.path)

    const relativePath = 'test-file.txt'
    const fullPath = Path.join(repository.path, relativePath)

    await makeCommit(repository, {
      entries: [
        { path: relativePath, contents: 'line1\nline2\nline3\nline4\n' },
      ],
    })

    // Invert line endings to CRLF on disk without any content edits
    await FSPromises.writeFile(
      fullPath,
      'line1\r\nline2\r\nline3\r\nline4\r\n',
      'utf8'
    )
    clearLineEndingMismatchCache(repository.path, relativePath)

    const isMismatch = await isFileLineEndingMismatch(repository, relativePath)
    assert.strictEqual(isMismatch, true)

    // Edit content with same original LF line endings -> not a line ending mismatch
    await FSPromises.writeFile(
      fullPath,
      'line1\nline2-edited\nline3\nline4\n',
      'utf8'
    )
    clearLineEndingMismatchCache(repository.path, relativePath)

    const isNotMismatch = await isFileLineEndingMismatch(
      repository,
      relativePath
    )
    assert.strictEqual(isNotMismatch, false)
  })

  it('detects line ending mismatch when overwhelmingly inverted with small edits', async t => {
    const repository = await setupEmptyRepository(t)
    await exec(['config', 'core.autocrlf', 'false'], repository.path)

    const relativePath = 'large-file.txt'
    const fullPath = Path.join(repository.path, relativePath)

    const originalLines = Array.from(
      { length: 25 },
      (_, i) => `line ${i + 1}\n`
    ).join('')
    await makeCommit(repository, {
      entries: [{ path: relativePath, contents: originalLines }],
    })

    // Invert all 25 lines to CRLF and modify line 3
    const modifiedLines = Array.from({ length: 25 }, (_, i) =>
      i === 2 ? 'line 3-modified\r\n' : `line ${i + 1}\r\n`
    ).join('')
    await FSPromises.writeFile(fullPath, modifiedLines, 'utf8')
    clearLineEndingMismatchCache(repository.path, relativePath)

    const isMismatch = await isFileLineEndingMismatch(repository, relativePath)
    assert.strictEqual(isMismatch, true)
  })
})
