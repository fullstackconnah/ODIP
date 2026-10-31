# Shot capture helpers (`capture.mjs`)

Shared by shot scripts so captures are evidence-grade by default. Plain ESM, Playwright only.

- `prepareOutDir(outDir)`: deletes earlier PNGs and `full/`, recreates `full/`. One file per name.
- `settle(page, locator?)`: waits for fonts, finished animations and a bounding box (the locator, else `<main>`) unchanged across two frame pairs, then parks the mouse bottom-right. Throws after 5 s.
- `cropElement(page, locator, file, { pad = 16, touch })`: settles, grows the viewport if the element ends below it, re-pins touch emulation, shoots element plus pad, restores. Returns `{ file, cropHeight, elementHeight, pad, coarse, touch }`.
- `fullPage(page, file, { touch })`: full page; at touch it grows the viewport instead of using fullPage. Put `file` under `<outDir>/full/`.
- `checkCropHolds(result)`: `{ name, pass, detail }`; passes when `cropHeight >= elementHeight + 2*pad - 1` (and coarse for a touch crop).
- `writeChecks(outDir, checks)`: writes `checks.json`, prints `TOTAL n/m pass`, returns true when all pass.

```js
// The runner copies a script to e2e/.odiptest-shots/, so import by ../shots/lib (also valid in place).
import { prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'
prepareOutDir(OUT_DIR)
const touch = true // a 390 context made with hasTouch and isMobile
const card = page.getByRole('heading', { name: 'My card' }).locator('xpath=ancestor::div[1]')
const checks = []
const r = await cropElement(page, card, path.join(OUT_DIR, 'card-390-light.png'), { touch })
checks.push(checkCropHolds(r))
await fullPage(page, path.join(OUT_DIR, 'full', 'page-390-light.png'), { touch })
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
```

Faults it prevents: frames taken before layout settled; crops that cut the element (worst at 390 touch, where a fullPage clip drops touch emulation); duplicate or stale files under one name.
