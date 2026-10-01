#!/usr/bin/env node
/**
 * Odip landing page: re-capture the canopy poster (../assets/canopy-poster.webp) from the shader itself.
 *
 *   PW_CORE_PATH=<abs path to the playwright-core package dir> POSTER_URL=<built /welcome/ URL> node poster.mjs
 *
 * The poster is the field's first paint and its fallback (no WebGL, or a lost context), so it must be the same field.
 * Serve a production build first (`npm run build`, then any static server on dist/), and point POSTER_URL at its
 * /welcome/ page. The page opens with reduced motion, so the field draws its one still frame at STILL_TIME
 * (canopy.ts), the clock the live field starts from; the page content is removed first, so no quiet zone or light
 * pool is baked in. Headless Chromium needs SwiftShader for WebGL, which the launch flags below ask for. Set
 * CHROMIUM_PATH to a Chromium or headless-shell executable when playwright-core's own browser build is not installed.
 *
 * Needs Python 3 + Pillow (override the interpreter with PYTHON): the 1920x1000 frame is scaled to 1600x833, softened
 * slightly (the grain does not compress and the field is soft anyway) and saved as WebP. Re-run whenever the shader
 * or STILL_TIME changes, and check the file stays well under 60 KB.
 */
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../assets/canopy-poster.webp')
const PNG = path.join(os.tmpdir(), 'odip-canopy-poster.png')
const URL = process.env.POSTER_URL || 'http://127.0.0.1:4173/welcome/'
const PYTHON = process.env.PYTHON || 'python'

const require = createRequire(import.meta.url)
if (!process.env.PW_CORE_PATH) throw new Error('Set PW_CORE_PATH to the playwright-core package directory (see the header comment).')
const { chromium } = require(process.env.PW_CORE_PATH)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '.site-header, .sections, main, .site-footer, .light-toggle, .skip { display: none !important; }' })
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(1500)
  const state = await page.evaluate(() => document.querySelector('[data-canopy-light]')?.getAttribute('data-state'))
  if (state !== 'still') throw new Error(`The field did not draw its still frame (state: ${state}); is WebGL available?`)
  await page.screenshot({ path: PNG })
} finally {
  await browser.close()
}

const encode = [
  'import os, sys',
  'from PIL import Image, ImageFilter',
  'im = Image.open(sys.argv[1]).convert("RGB").resize((1600, 833), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.9))',
  'im.save(sys.argv[2], "WEBP", quality=80, method=6)',
  'print(f"canopy-poster.webp {im.size[0]}x{im.size[1]}, {os.path.getsize(sys.argv[2]) / 1024:.1f} KB")',
].join('\n')
process.stdout.write(execFileSync(PYTHON, ['-c', encode, PNG, OUT], { encoding: 'utf8' }))
