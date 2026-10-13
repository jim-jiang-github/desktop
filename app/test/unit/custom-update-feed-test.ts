import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as semver from 'semver'
import {
  comparableVersion,
  getCustomUpdateFeedUrl,
  parseCustomReleaseMetadata,
  parseCustomReleaseNotes,
} from '../../src/lib/custom-update-feed'
import { getReleaseSummary } from '../../src/lib/release-notes'

function makeRelease(tag: string) {
  const url = `https://github.com/jim-jiang-github/desktop/releases/download/${tag}`
  const version = tag.slice('custom-v'.length)
  return {
    tag_name: tag,
    draft: false,
    assets: [
      {
        name: 'RELEASES',
        browser_download_url: `${url}/RELEASES`,
      },
      {
        name: `GitHubDesktopCustom-${version}-full.nupkg`,
        browser_download_url: `${url}/GitHubDesktopCustom-${version}-full.nupkg`,
      },
    ],
  }
}

describe('Custom update feed', () => {
  it('correctly compares multi-digit beta versions', () => {
    assert.strictEqual(
      semver.gt(
        comparableVersion('3.6.7-beta10'),
        comparableVersion('3.6.7-beta8')
      ),
      true
    )
    assert.strictEqual(
      semver.gt(
        comparableVersion('3.6.7-beta11'),
        comparableVersion('3.6.7-beta10')
      ),
      true
    )
    assert.strictEqual(
      semver.gt(comparableVersion('3.6.7'), comparableVersion('3.6.7-beta11')),
      true
    )
  })

  it('selects the newest release newer than the installed version', () => {
    const feedUrl = getCustomUpdateFeedUrl(
      [
        makeRelease('custom-v3.6.7-beta9'),
        makeRelease('custom-v3.6.7-beta10'),
        makeRelease('custom-v3.6.7-beta8'),
      ],
      '3.6.7-beta8'
    )

    assert.strictEqual(
      feedUrl,
      'https://github.com/jim-jiang-github/desktop/releases/download/custom-v3.6.7-beta10'
    )
  })

  it('ignores draft releases and returns null when no newer release exists', () => {
    const draftRelease = {
      ...makeRelease('custom-v3.6.7-beta9'),
      draft: true,
    }

    assert.strictEqual(
      getCustomUpdateFeedUrl(
        [draftRelease, makeRelease('custom-v3.6.7-beta8')],
        '3.6.7-beta8'
      ),
      null
    )
  })

  it('requires the Squirrel feed assets for a newer release', () => {
    assert.throws(
      () =>
        getCustomUpdateFeedUrl(
          [
            {
              tag_name: 'custom-v3.6.7-beta9',
              draft: false,
              assets: [],
            },
          ],
          '3.6.7-beta8'
        ),
      /missing its Squirrel update feed assets/
    )
  })

  describe('custom release notes and metadata parsing', () => {
    it('parses unsectioned text as markdown pretext', () => {
      const body = `Community Custom build of GitHub Desktop for Windows x64.
Includes Custom commands and yellow icons.`

      const notes = parseCustomReleaseNotes(body)
      assert.deepStrictEqual(notes, [`[pretext] ${body}`])

      const summary = getReleaseSummary({
        name: 'v3.6.7-beta11',
        version: '3.6.7-beta11',
        pub_date: '2026-10-13T08:22:29Z',
        notes,
      })
      assert.strictEqual(summary.latestVersion, '3.6.7-beta11')
      assert.strictEqual(summary.pretext.length, 1)
      assert.strictEqual(summary.enhancements.length, 0)
      assert.strictEqual(summary.bugfixes.length, 0)
    })

    it('parses markdown headings with bullet points into enhancements and bugfixes', () => {
      const body = `Welcome to Custom beta 11.

### Enhancements
- Keep current worktree toolbar segment visible - #22888
- Support per-repository commit author

### Bugfixes
- Fix window titlebar hang - #22818`

      const notes = parseCustomReleaseNotes(body)
      const summary = getReleaseSummary({
        name: 'v3.6.7-beta11',
        version: '3.6.7-beta11',
        pub_date: '2026-10-13T08:22:29Z',
        notes,
      })
      assert.strictEqual(summary.latestVersion, '3.6.7-beta11')
      assert.strictEqual(
        summary.pretext[0]?.message,
        'Welcome to Custom beta 11.'
      )
      assert.strictEqual(summary.enhancements.length, 2)
      assert.strictEqual(
        summary.enhancements[0].message,
        'Keep current worktree toolbar segment visible - #22888'
      )
      assert.strictEqual(summary.bugfixes.length, 1)
      assert.strictEqual(
        summary.bugfixes[0].message,
        'Fix window titlebar hang - #22818'
      )
    })

    it('converts GitHub releases into sorted ReleaseMetadata list', () => {
      const releases = [
        {
          tag_name: 'custom-v3.6.7-beta8',
          name: 'Custom beta 8',
          draft: false,
          published_at: '2026-10-13T06:16:10Z',
          body: 'Beta 8 notes',
        },
        {
          tag_name: 'custom-v3.6.7-beta11',
          name: 'Custom beta 11',
          draft: false,
          published_at: '2026-10-13T08:22:29Z',
          body: 'Beta 11 notes',
        },
        {
          tag_name: 'custom-v3.6.7-beta12',
          draft: true,
          published_at: '2026-10-13T09:00:00Z',
        },
        {
          tag_name: 'official-v3.6.7',
          draft: false,
        },
      ]

      const metadata = parseCustomReleaseMetadata(releases)
      assert.strictEqual(metadata.length, 2)
      assert.strictEqual(metadata[0].version, '3.6.7-beta11')
      assert.strictEqual(metadata[1].version, '3.6.7-beta8')
    })
  })
})
