// Run by the release workflow before anything is built: the tag must match
// the version every app reports, and the desktop updater must have a real
// public key, or the release would install and then never update.
import { readFileSync } from 'node:fs'

const tag = process.argv[2] ?? ''
const version = tag.replace(/^v/, '')
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const found = {
  'package.json': json('package.json').version,
  'apps/mobile/package.json': json('apps/mobile/package.json').version,
  'apps/mobile/app.json': json('apps/mobile/app.json').expo.version,
  'apps/desktop/package.json': json('apps/desktop/package.json').version,
  'apps/desktop/src-tauri/tauri.conf.json': json('apps/desktop/src-tauri/tauri.conf.json').version,
  'apps/desktop/src-tauri/Cargo.toml': /^version = "([^"]+)"/m.exec(readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8'))?.[1],
}
const problems = Object.entries(found)
  .filter(([, v]) => v !== version)
  .map(([file, v]) => `${file} says ${v ?? 'nothing'}, the tag says ${version}`)
if (!/^\d+\.\d+\.\d+$/.test(version)) problems.unshift(`The tag ${tag} is not vX.Y.Z`)
const pubkey = json('apps/desktop/src-tauri/tauri.conf.json').plugins?.updater?.pubkey ?? ''
if (!pubkey || /REPLACE/i.test(pubkey)) problems.push('The updater public key in tauri.conf.json is still a placeholder; see docs/release.md')
if (problems.length) {
  console.error(problems.map((p) => `::error::${p}`).join('\n'))
  process.exit(1)
}
console.log(`Releasing ${version}`)
