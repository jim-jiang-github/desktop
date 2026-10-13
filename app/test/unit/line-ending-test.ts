import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import * as FSPromises from 'fs/promises'
import * as Path from 'path'
import { createTempDirectory } from '../helpers/temp'
import {
  detectLineEnding,
  getNextLineEnding,
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
})
