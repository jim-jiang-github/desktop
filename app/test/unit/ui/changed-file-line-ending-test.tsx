import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import * as FSPromises from 'fs/promises'
import * as Path from 'path'
import { exec } from 'dugite'

import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../../src/models/status'
import { DiffSelection, DiffSelectionType } from '../../../src/models/diff'
import { Repository } from '../../../src/models/repository'
import { ChangedFile } from '../../../src/ui/changes/changed-file'
import { createTempDirectory } from '../../helpers/temp'
import { setupEmptyRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { render, fireEvent, waitFor } from '../../helpers/ui/render'
import { clearLineEndingMismatchCache } from '../../../src/lib/line-ending'

function makeFile(
  path: string,
  kind:
    | AppFileStatusKind.New
    | AppFileStatusKind.Modified
    | AppFileStatusKind.Deleted
): WorkingDirectoryFileChange {
  return new WorkingDirectoryFileChange(
    path,
    { kind },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

describe('ChangedFile line ending toggle', () => {
  it('does not display line ending button for deleted files', async t => {
    const tempDir = await createTempDirectory(t)
    const repo = new Repository(tempDir, -1, null, false)
    const file = makeFile('deleted.txt', AppFileStatusKind.Deleted)

    const view = render(
      <ChangedFile
        file={file}
        include={true}
        availableWidth={300}
        disableSelection={false}
        focused={false}
        onIncludeChanged={() => {}}
        repository={repo}
      />
    )

    assert.strictEqual(
      view.container.querySelector('.line-ending-button'),
      null
    )
  })

  it('displays line ending button and toggles between CRLF and LF', async t => {
    const tempDir = await createTempDirectory(t)
    const repo = new Repository(tempDir, -1, null, false)
    const relativePath = 'example.txt'
    const fullPath = Path.join(tempDir, relativePath)

    await FSPromises.writeFile(fullPath, 'hello\r\nworld\r\n', 'utf8')

    const file = makeFile(relativePath, AppFileStatusKind.Modified)
    let refreshed = false
    const mockDispatcher: any = {
      refreshRepository: () => {
        refreshed = true
      },
    }

    const view = render(
      <ChangedFile
        file={file}
        include={true}
        availableWidth={300}
        disableSelection={false}
        focused={false}
        onIncludeChanged={() => {}}
        repository={repo}
        dispatcher={mockDispatcher}
      />
    )

    await waitFor(() => {
      const button = view.container.querySelector('.line-ending-button')
      assert.notStrictEqual(button, null)
      assert.strictEqual(button?.textContent?.trim(), 'CRLF')
    })

    const button = view.container.querySelector('.line-ending-button')!
    fireEvent.click(button)

    await waitFor(async () => {
      const content = await FSPromises.readFile(fullPath, 'utf8')
      assert.strictEqual(content, 'hello\nworld\n')
      assert.strictEqual(button.textContent?.trim(), 'LF')
      assert.strictEqual(refreshed, true)
    })

    // Toggle back to CRLF
    refreshed = false
    fireEvent.click(button)

    await waitFor(async () => {
      const content = await FSPromises.readFile(fullPath, 'utf8')
      assert.strictEqual(content, 'hello\r\nworld\r\n')
      assert.strictEqual(button.textContent?.trim(), 'CRLF')
      assert.strictEqual(refreshed, true)
    })
  })

  it('renders line-ending-mismatch class and descriptive aria-label on EOL mismatch', async t => {
    const repository = await setupEmptyRepository(t)
    await exec(['config', 'core.autocrlf', 'false'], repository.path)

    const relativePath = 'mismatch.txt'
    const fullPath = Path.join(repository.path, relativePath)

    await makeCommit(repository, {
      entries: [{ path: relativePath, contents: 'line1\nline2\nline3\n' }],
    })

    // Invert line endings to CRLF on disk
    await FSPromises.writeFile(fullPath, 'line1\r\nline2\r\nline3\r\n', 'utf8')
    clearLineEndingMismatchCache(repository.path, relativePath)

    const file = makeFile(relativePath, AppFileStatusKind.Modified)
    const view = render(
      <ChangedFile
        file={file}
        include={true}
        availableWidth={300}
        disableSelection={false}
        focused={false}
        onIncludeChanged={() => {}}
        repository={repository}
      />
    )

    await waitFor(() => {
      const button = view.container.querySelector('.line-ending-button')
      assert.notStrictEqual(button, null)
      assert.strictEqual(
        button?.classList.contains('line-ending-mismatch'),
        true
      )
      assert.strictEqual(
        button?.getAttribute('aria-label'),
        'Line ending mismatch: switch from CRLF to LF'
      )
    })
  })
})
