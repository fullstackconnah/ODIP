// Dev-only, run by hand: node scripts/subset-icons.mjs
// Rebuilds src/assets/fonts/material-symbols-outlined-subset.woff2 from src/icons/materialSymbols.ts
// via Google Fonts' css2 API (icon_names must be sorted). Axes: opsz 24, wght 400, FILL 0..1, GRAD 0.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const names = [...readFileSync(new URL('src/icons/materialSymbols.ts', root), 'utf8').matchAll(/^\s+'([a-z0-9_]+)',$/gm)].map((m) => m[1])
const cssUrl =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0' +
  `&icon_names=${names.join(',')}&display=block`

// A modern browser UA makes the API answer with woff2.
const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } })).text()
const woff2 = css.match(/url\((https:[^)]+)\) format\('woff2'\)/)?.[1]
if (!woff2) throw new Error(`No woff2 url in the css2 response:\n${css.slice(0, 500)}`)
const buf = Buffer.from(await (await fetch(woff2)).arrayBuffer())
writeFileSync(new URL('src/assets/fonts/material-symbols-outlined-subset.woff2', root), buf)
console.log(`${names.length} icons, ${buf.length} bytes`)
