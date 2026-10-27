/**
 * New versions of the apps, from GitHub Releases. Every release carries its
 * files under the same names, so "the latest" is always one fixed address
 * (the site's download buttons use it too), and a tag of vX.Y.Z says which
 * version it is.
 */

export const REPOSITORY = 'Vishalk1604/Cairn'

/** The same names on every release. */
export const RELEASE_ASSETS = { apk: 'Cairn-android.apk', exe: 'Cairn-windows-setup.exe', updater: 'latest.json' } as const

export function latestDownload(asset: string): string {
  return `https://github.com/${REPOSITORY}/releases/latest/download/${asset}`
}

export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`

/** "v0.3.0" or "0.3.0" as numbers; null for anything else. A pre-release suffix sorts before the release itself. */
export function parseVersion(text: string): { parts: [number, number, number]; pre: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!match) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null }
}

/** Whether `candidate` is a later version than `current`. Anything unreadable is never newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i]! > b.parts[i]!
  // 1.0.0-beta < 1.0.0; two pre-releases of one version compare as text.
  if (a.pre === b.pre) return false
  if (a.pre === null) return true
  if (b.pre === null) return false
  return a.pre > b.pre
}

export interface AvailableRelease {
  version: string
  /** The phone's installer on that release. */
  apkUrl: string
  /** The release's page, for what changed. */
  pageUrl: string
}

/**
 * What GitHub's "latest release" says, if it is newer than this app. Drafts
 * and pre-releases never count: GitHub leaves them out of "latest" itself.
 */
export function newerRelease(release: unknown, current: string): AvailableRelease | null {
  const r = release as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: { name?: unknown; browser_download_url?: unknown }[] } | null
  if (!r || typeof r.tag_name !== 'string' || r.draft === true || r.prerelease === true) return null
  if (!isNewerVersion(r.tag_name, current)) return null
  const apk = Array.isArray(r.assets) ? r.assets.find((a) => a?.name === RELEASE_ASSETS.apk) : undefined
  if (!apk || typeof apk.browser_download_url !== 'string') return null
  return {
    version: r.tag_name.replace(/^v/, ''),
    apkUrl: apk.browser_download_url,
    pageUrl: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${REPOSITORY}/releases/latest`,
  }
}
