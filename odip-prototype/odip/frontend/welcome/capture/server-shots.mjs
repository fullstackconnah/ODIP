// Entry for `odip-test.sh <slot> shots <this file> <outdir>`. The runner copies only this file into e2e/.odiptest-shots/ and runs
// it from e2e/, so playwright resolves from e2e's node_modules and the capture code is imported from the synced frontend by path.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import('playwright')
const { capture } = await import(pathToFileURL(path.resolve(process.cwd(), '../frontend/welcome/capture/capture.mjs')).href)
await capture({
  chromium,
  baseUrl: process.env.BASE_URL,
  pngDir: process.env.OUT_DIR,
  names: (process.env.SHOT_NAMES || '').split(',').filter(Boolean),
  probe: process.env.SHOT_PROBE === '1',
})
