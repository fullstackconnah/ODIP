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

// layoutFaults: pure, hand-made snapshots (the browser collector is proved by e2e/shots/layout-checks-proof.mjs).
import { layoutFaults } from './capture.mjs'

const el = (o) => ({ selector: 'div.x', overflowX: 'visible', scrollWidth: 100, clientWidth: 100, ownText: false, textOverflow: 'clip', matchedBy: [], ...o })
const rect = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h })
const snap = (o) => ({ elements: [], controls: [], texts: [], ...o })
const kinds = (s, opts) => layoutFaults(s, opts).map((f) => f.kind)

test('inner-scroll: scrolling container fails, fitting one passes, allow skips it', () => {
  const wide = snap({ elements: [el({ overflowX: 'auto', scrollWidth: 400, clientWidth: 300 })] })
  assert.deepEqual(kinds(wide), ['inner-scroll'])
  assert.deepEqual(kinds(snap({ elements: [el({ overflowX: 'auto', scrollWidth: 301, clientWidth: 300 })] })), [])
  assert.deepEqual(kinds(snap({ elements: [el({ overflowX: 'auto', matchedBy: ['.board'], scrollWidth: 400, clientWidth: 300 })] }), { allow: ['.board'] }), [])
})

test('clipped-text: silent cut fails, ellipsis and fitting text pass', () => {
  const cut = { overflowX: 'hidden', ownText: true, scrollWidth: 80, clientWidth: 60 }
  assert.deepEqual(kinds(snap({ elements: [el(cut)] })), ['clipped-text'])
  assert.deepEqual(kinds(snap({ elements: [el({ ...cut, textOverflow: 'ellipsis' })] })), [])
  assert.deepEqual(kinds(snap({ elements: [el({ ...cut, ownText: false })] })), [])
  assert.deepEqual(kinds(snap({ elements: [el({ ...cut, scrollWidth: 61 })] })), [])
})

test('control-over-text: overlap fails; own label, edge touch and text inside a containing control pass', () => {
  const btn = { selector: 'button.b', rect: rect(100, 100, 80, 30) }
  const text = (r, inControls = []) => ({ selector: 'p.t', rect: r, inControls })
  assert.deepEqual(kinds(snap({ controls: [btn], texts: [text(rect(90, 105, 40, 16))] })), ['control-over-text'])
  assert.deepEqual(kinds(snap({ controls: [btn], texts: [text(rect(110, 105, 40, 16), [0])] })), [])
  assert.deepEqual(kinds(snap({ controls: [btn], texts: [text(rect(60, 105, 41, 16))] })), []) // 1 px in
  assert.deepEqual(kinds(snap({ controls: [btn], texts: [text(rect(60, 105, 42, 16))] })), []) // exactly 2 px
  assert.deepEqual(kinds(snap({ controls: [btn], texts: [text(rect(60, 105, 43, 16))] })), ['control-over-text'])
})
