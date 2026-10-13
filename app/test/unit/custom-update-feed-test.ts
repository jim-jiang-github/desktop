import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getCustomUpdateFeedUrl } from '../../src/lib/custom-update-feed'

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
})
