// Renders the static brand icons from their SVGs, then checks the COMMITTED PNGs (decoded in the page via <canvas>).
// Run: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <this file> <outdir>
// then copy <outdir>/{apple-touch-icon,icon-192,icon-512,icon-maskable-512}.png into frontend/public (icons/ except apple-touch) and run it again.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public')
const out = process.env.OUT_DIR
const uri = (rel, type = 'image/svg+xml') => `data:${type};base64,` + readFileSync(path.join(pub, rel)).toString('base64')
const jobs = [ // [svg, size, out file, transparent]
  ['favicon.svg', 192, 'icon-192.png', true],
  ['favicon.svg', 512, 'icon-512.png', true],
  ['icons/icon-maskable.svg', 512, 'icon-maskable-512.png', false],
  ['icons/icon-touch.svg', 180, 'apple-touch-icon.png', false],
]
const browser = await chromium.launch()
const ctx = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 })

for (const [svg, size, file, transparent] of jobs) {
  const page = await ctx.newPage()
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:transparent"><img src="${uri(svg)}" width="${size}" height="${size}" style="display:block"></body>`)
  await page.screenshot({ path: path.join(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
}

// ---- checks on the committed PNGs
const files = { touch: 'apple-touch-icon.png', i192: 'icons/icon-192.png', i512: 'icons/icon-512.png', mask: 'icons/icon-maskable-512.png' }
const ihdr = (rel) => { const b = readFileSync(path.join(pub, rel)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const sizes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, ihdr(f)]))
const checker = await ctx.newPage()
await checker.setContent('<body></body>')
const decode = (src) => checker.evaluate(async (s) => {
  const img = new Image(); img.src = s; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d'); g.drawImage(img, 0, 0)
  return { w: c.width, h: c.height, d: Array.from(g.getImageData(0, 0, c.width, c.height).data) }
}, src)
const pix = (rel) => decode(uri(rel, 'image/png'))
const at = (p, x, y) => { const i = (y * p.w + x) * 4; return p.d.slice(i, i + 4) }
const near = (c, hex) => [1, 3, 5].every((o, k) => Math.abs(c[k] - parseInt(hex.slice(o, o + 2), 16)) <= 8)
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, k) => s + v * [0.2126, 0.7152, 0.0722][k], 0)
const lines = []
const report = (id, ok, detail) => lines.push(`${id} ${ok ? 'PASS' : 'FAIL'} ${detail}`)

const want = { touch: 180, i192: 192, i512: 512, mask: 512 }
report('P1', Object.entries(want).every(([k, s]) => sizes[k].w === s && sizes[k].h === s), Object.entries(sizes).map(([k, v]) => `${k}=${v.w}x${v.h}`).join(' '))

const any = []
for (const k of ['i192', 'i512']) { const p = await pix(files[k]); any.push([k, at(p, 0, 0)[3], at(p, Math.round(p.w / 2), 2)]) }
report('P2', any.every(([, a, c]) => a === 0 && near(c, '#bbf37c')), any.map(([k, a, c]) => `${k} corner alpha=${a} top-mid=rgb(${c.slice(0, 3)})`).join('; '))

const mp = await pix(files.mask)
const corners = [[0, 0], [511, 0], [0, 511], [511, 511]].map(([x, y]) => at(mp, x, y))
let maxR = 0
for (let y = 0; y < mp.h; y++) for (let x = 0; x < mp.w; x++) if (lum(at(mp, x, y)) < 0.3) maxR = Math.max(maxR, Math.hypot(x + 0.5 - 256, y + 0.5 - 256))
report('P3', corners.every((c) => near(c, '#bbf37c')) && maxR <= 204.8, `corners ${corners.map((c) => c.slice(0, 3).join(',')).join(' | ')}; max dark radius=${maxR.toFixed(1)} (limit 204.8)`)

const tp = await pix(files.touch)
let minA = 255
for (let i = 3; i < tp.d.length; i += 4) minA = Math.min(minA, tp.d[i])
const tc = [[0, 0], [179, 0], [0, 179], [179, 179]].map(([x, y]) => at(tp, x, y))
report('P4', minA === 255 && tc.every((c) => near(c, '#bbf37c')), `min alpha=${minA}; corners ${tc.map((c) => c.slice(0, 3).join(',')).join(' | ')}`)

// P5: the favicon SVG itself at 16 and 32 CSS px, DPR 1
const fav = {}
for (const [s, bowl, stem] of [[16, [7, 9], [5, 10]], [32, [15, 18], [10, 18]]]) {
  await checker.setViewportSize({ width: s, height: s })
  await checker.setContent(`<body style="margin:0;background:#fff"><img src="${uri('favicon.svg')}" width="${s}" height="${s}" style="display:block"></body>`)
  const shot = await checker.screenshot({ clip: { x: 0, y: 0, width: s, height: s } })
  const p = await decode('data:image/png;base64,' + shot.toString('base64'))
  fav[s] = { bowl: at(p, ...bowl), stem: at(p, ...stem) }
}
report('P5', [16, 32].every((s) => fav[s].bowl[1] > 200 && lum(fav[s].stem) < 0.5),
  `16px bowl G=${fav[16].bowl[1]} stem L=${lum(fav[16].stem).toFixed(2)}; 32px bowl G=${fav[32].bowl[1]} stem L=${lum(fav[32].stem).toFixed(2)}`)
console.log(lines.join('\n'))

// ---- icon sheet
const svgImg = (rel, style) => `<img src="${uri(rel)}" style="${style}">`
const pngImg = (rel, w) => `<img src="${uri(rel, 'image/png')}" width="${w}" height="${w}">`
const row = (bg, dark) => `<div style="background:${bg};padding:12px;display:flex;gap:16px;align-items:center;color:${dark ? '#eee' : '#222'}">${[16, 32, 40].map((s) => svgImg('favicon.svg', `width:${s}px;height:${s}px;${s === 40 ? 'border-radius:10px' : ''}`)).join('')}<span>${bg}</span></div>`
const sheet = await ctx.newPage()
await sheet.setViewportSize({ width: 900, height: 760 })
await sheet.setContent(`<body style="margin:0;background:#fff;font:12px sans-serif">
${row('#ffffff')}${row('#fbf9f5')}${row('#202124', true)}
<div style="display:flex;gap:16px;padding:12px;align-items:flex-start;background:#ddd">${pngImg('apple-touch-icon.png', 180)}${pngImg('icons/icon-192.png', 192)}${pngImg('icons/icon-512.png', 192)}${pngImg('icons/icon-maskable-512.png', 192)}</div>
<div style="display:flex;gap:16px;padding:12px;background:#888">${svgImg('icons/icon-maskable.svg', 'width:160px;height:160px;clip-path:circle(40%)')}${svgImg('icons/icon-maskable.svg', 'width:160px;height:160px;clip-path:inset(0 round 22%)')}</div></body>`)
await sheet.screenshot({ path: path.join(out, 'icon-sheet.png') })
await browser.close()
