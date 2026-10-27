// Writes latest.json, which the desktop app's updater reads from the latest
// release: the version, and the signed installer to fetch for it.
//   node scripts/latest-json.mjs <version> <installer.sig> <installer URL> <out>
import { readFileSync, writeFileSync } from 'node:fs'

const [version, sigPath, url, out] = process.argv.slice(2)
if (!version || !sigPath || !url || !out) {
  console.error('usage: latest-json.mjs <version> <installer.sig> <installer URL> <out>')
  process.exit(1)
}
const signature = readFileSync(sigPath, 'utf8').trim()
const platform = { signature, url }
writeFileSync(
  out,
  JSON.stringify(
    {
      version,
      notes: `Cairn ${version}`,
      pub_date: new Date().toISOString(),
      // The NSIS installer serves both keys the updater may ask for.
      platforms: { 'windows-x86_64': platform, 'windows-x86_64-nsis': platform },
    },
    null,
    2,
  ) + '\n',
)
