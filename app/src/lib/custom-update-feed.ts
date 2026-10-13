import * as semver from 'semver'
import { ReleaseMetadata } from '../models/release-notes'

interface IGitHubReleaseAsset {
  readonly name: string
  readonly browser_download_url: string
}

interface ICustomRelease {
  readonly tag_name: string
  readonly draft: boolean
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
}

export function comparableVersion(version: string): string {
  return version.replace(/-(alpha|beta|rc)(\d+)(?=$|\+)/i, '-$1.$2')
}

/**
 * Parse a custom release body into release note entry strings formatted
 * for `parseReleaseEntries` (e.g. `[added] ...`, `[fixed] ...`, or `[pretext] ...`).
 */
export function parseCustomReleaseNotes(
  body: string | undefined
): ReadonlyArray<string> {
  if (body === undefined || body.trim().length === 0) {
    return []
  }

  const trimmed = body.trim()
  const lines = trimmed.split(/\r?\n/)

  const taggedEntryRe = /^\[([a-z]+)\]\s+(.+)/i
  const hasTaggedEntries = lines.some(line => taggedEntryRe.test(line.trim()))

  if (hasTaggedEntries) {
    const notes: string[] = []
    const pretextLines: string[] = []
    for (const line of lines) {
      const lineTrimmed = line.trim()
      if (taggedEntryRe.test(lineTrimmed)) {
        notes.push(lineTrimmed)
      } else if (lineTrimmed.length > 0 && notes.length === 0) {
        pretextLines.push(lineTrimmed)
      }
    }
    if (pretextLines.length > 0) {
      notes.unshift(`[pretext] ${pretextLines.join('\n')}`)
    }
    return notes
  }

  const headingRe = /^#{1,6}\s+(.+)$/
  const hasHeadings = lines.some(line => headingRe.test(line.trim()))

  if (hasHeadings) {
    const notes: string[] = []
    const pretextLines: string[] = []
    let currentKind: 'added' | 'fixed' | 'removed' | 'other' | null = null

    for (const line of lines) {
      const lineTrimmed = line.trim()
      const headingMatch = headingRe.exec(lineTrimmed)
      if (headingMatch !== null) {
        const title = headingMatch[1].toLowerCase()
        if (/enhancement|feature|improv|added|new/i.test(title)) {
          currentKind = 'added'
        } else if (/bug|fix/i.test(title)) {
          currentKind = 'fixed'
        } else if (/remov/i.test(title)) {
          currentKind = 'removed'
        } else {
          currentKind = 'other'
        }
        continue
      }

      const listItemMatch = /^[-*]\s+(.+)$/.exec(lineTrimmed)
      if (listItemMatch !== null && currentKind !== null) {
        notes.push(`[${currentKind}] ${listItemMatch[1].trim()}`)
      } else if (lineTrimmed.length > 0 && currentKind === null) {
        pretextLines.push(lineTrimmed)
      }
    }

    if (pretextLines.length > 0) {
      notes.unshift(`[pretext] ${pretextLines.join('\n')}`)
    }

    if (notes.length > 0) {
      return notes
    }
  }

  return [`[pretext] ${trimmed}`]
}

/**
 * Convert a GitHub Releases response into Custom release metadata sorted newest-first.
 */
export function parseCustomReleaseMetadata(
  releases: unknown
): ReadonlyArray<ReleaseMetadata> {
  if (!Array.isArray(releases)) {
    return []
  }

  const result: ReleaseMetadata[] = []
  for (const item of releases) {
    if (
      !isRecord(item) ||
      typeof item.tag_name !== 'string' ||
      !item.tag_name.startsWith('custom-v') ||
      item.draft === true
    ) {
      continue
    }

    const version = item.tag_name.slice('custom-v'.length)
    if (semver.valid(comparableVersion(version)) === null) {
      continue
    }

    const pub_date =
      typeof item.published_at === 'string'
        ? item.published_at
        : typeof item.created_at === 'string'
        ? item.created_at
        : new Date().toISOString()

    const name = typeof item.name === 'string' ? item.name : item.tag_name
    const body = typeof item.body === 'string' ? item.body : ''

    result.push({
      name,
      version,
      pub_date,
      notes: parseCustomReleaseNotes(body),
    })
  }

  return result.sort((a, b) =>
    semver.rcompare(comparableVersion(a.version), comparableVersion(b.version))
  )
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
