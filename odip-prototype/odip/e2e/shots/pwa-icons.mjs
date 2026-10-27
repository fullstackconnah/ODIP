// Repeatable icon build for the installable app (no image dependency): renders the two source SVGs in headless Chromium.
// Run: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <this file> <outdir>
// then copy <outdir>/icon-*.png into frontend/public/icons/. A logo redesign replaces the SVGs and re-runs this.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public')
const jobs = [
  ['favicon.svg', 192, 'icon-192.png'],
  ['favicon.svg', 512, 'icon-512.png'],
  ['icons/icon-maskable.svg', 512, 'icon-maskable-512.png'],
]
const browser = await chromium.launch()
for (const [svg, size, out] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const uri = 'data:image/svg+xml;base64,' + readFileSync(path.join(pub, svg)).toString('base64')
  await page.setContent(`<body style="margin:0;background:transparent"><img src="${uri}" width="${size}" height="${size}" style="display:block"></body>`)
  await page.screenshot({ path: path.join(process.env.OUT_DIR, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
}
await browser.close()
console.log('icons written')
