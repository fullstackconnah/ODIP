// Run: node --test e2e/shots/lib/capture.test.mjs (pure checkCropHolds only; cropElement needs a browser).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCropHolds } from './capture.mjs'

const good = { file: 'a/x.png', clip: { x: 0, y: 0, width: 300, height: 200 }, box: { x: 16, y: 16, width: 268, height: 168 }, viewport: { width: 390, height: 400 }, pad: 16, coarse: true, touch: true }

test('no overlap: geometry decides, as before', () => {
  const r = checkCropHolds(good)
  assert.equal(r.pass, true)
  assert.equal('overlap' in r.detail, false)
})

test('overlap passes: still passes', () => {
  const overlap = { name: 'n', pass: true, detail: {} }
  const r = checkCropHolds({ ...good, overlap })
  assert.equal(r.pass, true)
  assert.deepEqual(r.detail.overlap, overlap)
})

test('overlap fails: fails even when the geometry holds, and says why', () => {
  const overlap = { name: 'n', pass: false, detail: { covered: true, hit: 'DIV.sticky' } }
  const r = checkCropHolds({ ...good, overlap })
  assert.equal(r.pass, false)
  assert.equal(r.detail.holds, true)
  assert.deepEqual(r.detail.overlap, overlap)
})
