import * as semver from 'semver'

interface IGitHubReleaseAsset {
  readonly name: string
  readonly browser_download_url: string
}

interface ICustomRelease {
  readonly tag_name: string
  readonly draft: boolean
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
}

function comparableVersion(version: string): string {
  return version.replace(/-(alpha|beta|rc)(\d+)(?=$|\+)/i, '-$1.$2')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseCustomRelease(value: unknown): ICustomRelease | null {
  if (
    !isRecord(value) ||
    typeof value.tag_name !== 'string' ||
    !value.tag_name.startsWith('custom-v') ||
    typeof value.draft !== 'boolean' ||
    !Array.isArray(value.assets)
  ) {
    return null
  }

  const assets: IGitHubReleaseAsset[] = []
  for (const asset of value.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.name !== 'string' ||
      typeof asset.browser_download_url !== 'string'
    ) {
      return null
    }
    assets.push({
      name: asset.name,
      browser_download_url: asset.browser_download_url,
    })
  }

  return {
    tag_name: value.tag_name,
    draft: value.draft,
    assets,
  }
}

/**
 * Find the newest published Custom release with a complete Squirrel feed.
 *
 * Returns null when no release is newer than the installed version.
 */
export function getCustomUpdateFeedUrl(
  releases: unknown,
  currentVersion: string
): string | null {
  if (!Array.isArray(releases)) {
    throw new Error('GitHub returned an invalid Custom releases response.')
  }

  const current = semver.valid(comparableVersion(currentVersion))
  if (current === null) {
    throw new Error(`The installed version '${currentVersion}' is invalid.`)
  }

  const availableReleases = releases
    .map(parseCustomRelease)
    .filter(
      (release): release is ICustomRelease => release !== null && !release.draft
    )
    .map(release => ({
      release,
      version: semver.valid(release.tag_name.slice('custom-v'.length)),
    }))
    .filter(
      (candidate): candidate is { release: ICustomRelease; version: string } =>
        candidate.version !== null &&
        semver.gt(comparableVersion(candidate.version), current)
    )
    .sort((a, b) =>
      semver.rcompare(
        comparableVersion(a.version),
        comparableVersion(b.version)
      )
    )

  const latest = availableReleases[0]
  if (latest === undefined) {
    return null
  }

  const packageName = `GitHubDesktopCustom-${latest.version}-full.nupkg`
  if (
    !latest.release.assets.some(asset => asset.name === 'RELEASES') ||
    !latest.release.assets.some(asset => asset.name === packageName)
  ) {
    throw new Error(
      `Custom release '${latest.release.tag_name}' is missing its Squirrel update feed assets.`
    )
  }

  const releasesAsset = latest.release.assets.find(
    asset => asset.name === 'RELEASES'
  )
  if (releasesAsset === undefined) {
    throw new Error(
      `Custom release '${latest.release.tag_name}' is missing its RELEASES asset.`
    )
  }

  const releasesUrl = new URL(releasesAsset.browser_download_url)
  const expectedPath = `/jim-jiang-github/desktop/releases/download/${latest.release.tag_name}/RELEASES`
  if (
    releasesUrl.protocol !== 'https:' ||
    releasesUrl.hostname !== 'github.com' ||
    releasesUrl.pathname !== expectedPath
  ) {
    throw new Error(
      `Custom release '${latest.release.tag_name}' has an invalid RELEASES asset URL.`
    )
  }

  releasesUrl.pathname = releasesUrl.pathname.slice(0, -'/RELEASES'.length)
  return releasesUrl.toString()
}
