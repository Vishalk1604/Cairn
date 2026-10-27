import { describe, expect, it } from 'vitest'
import { isNewerVersion, latestDownload, newerRelease, parseVersion, RELEASE_ASSETS } from '../src'

describe('version comparison', () => {
  it('compares each part as a number, not as text', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('v0.3.1', '0.3.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true)
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false)
    expect(isNewerVersion('0.2.9', '0.3.0')).toBe(false)
  })

  it('puts a pre-release before its release', () => {
    expect(isNewerVersion('0.4.0', '0.4.0-beta.1')).toBe(true)
    expect(isNewerVersion('0.4.0-beta.1', '0.4.0')).toBe(false)
    expect(isNewerVersion('0.4.0-beta.2', '0.4.0-beta.1')).toBe(true)
    expect(isNewerVersion('0.4.0-beta.1', '0.3.0')).toBe(true)
  })

  it('never calls something unreadable newer', () => {
    expect(isNewerVersion('latest', '0.3.0')).toBe(false)
    expect(isNewerVersion('0.4', '0.3.0')).toBe(false)
    expect(parseVersion('v1.2.3+build.5')).toEqual({ parts: [1, 2, 3], pre: null })
  })
})

describe('the latest release', () => {
  const release = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    html_url: `https://github.com/Vishalk1604/Cairn/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      { name: RELEASE_ASSETS.exe, browser_download_url: `https://github.com/Vishalk1604/Cairn/releases/download/${tag}/${RELEASE_ASSETS.exe}` },
      { name: RELEASE_ASSETS.apk, browser_download_url: `https://github.com/Vishalk1604/Cairn/releases/download/${tag}/${RELEASE_ASSETS.apk}` },
    ],
    ...extra,
  })

  it('offers a newer release with its phone installer', () => {
    expect(newerRelease(release('v0.3.1'), '0.3.0')).toEqual({
      version: '0.3.1',
      apkUrl: `https://github.com/Vishalk1604/Cairn/releases/download/v0.3.1/${RELEASE_ASSETS.apk}`,
      pageUrl: 'https://github.com/Vishalk1604/Cairn/releases/tag/v0.3.1',
    })
  })

  it('offers nothing for the same version, a pre-release, or a release without the installer', () => {
    expect(newerRelease(release('v0.3.0'), '0.3.0')).toBeNull()
    expect(newerRelease(release('v0.4.0', { prerelease: true }), '0.3.0')).toBeNull()
    expect(newerRelease(release('v0.4.0', { assets: [] }), '0.3.0')).toBeNull()
    expect(newerRelease({ message: 'Not Found' }, '0.3.0')).toBeNull()
    expect(newerRelease(null, '0.3.0')).toBeNull()
  })

  it('always has the same address for the latest files', () => {
    expect(latestDownload(RELEASE_ASSETS.apk)).toBe('https://github.com/Vishalk1604/Cairn/releases/latest/download/Cairn-android.apk')
  })
})
