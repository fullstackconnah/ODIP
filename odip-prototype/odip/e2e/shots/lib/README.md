# Shot capture helpers (`capture.mjs`)

Shared by shot scripts so captures are evidence-grade by default. Plain ESM, Playwright only.

- `prepareOutDir(outDir)`: deletes earlier PNGs and `full/`, recreates `full/`. One file per name.
- `settle(page, locator?)`: waits for fonts, finished animations and a bounding box (the locator, else `<main>`) unchanged across two frame pairs, then parks the mouse bottom-right. Throws after 5 s.
- `cropElement(page, locator, file, { pad = 16, touch = coarse now, also, natural, during })`: `also` widens the crop to a second locator (box = union); `natural` grows the viewport to the page height so sticky and fixed chrome (foot, bottom nav) sits in its natural place, not over the element; `during(clip)` runs in the grown viewport just before the shot and its result comes back as `measured`; settles (again after any resize), grows the viewport height to hold the element; the right pad may shrink at the viewport edge; the viewport width never changes and an element wider than it fails `checkCropHolds` (`detail.overflowX`), re-pins touch emulation, shoots element plus pad, restores. Returns `{ file, clip, box, viewport, pad, coarse, touch, elementHeight } (clip is the real post-settle clip)`.
- `fullPage(page, file, { touch })`: grows the viewport to the page height, settles again, then shoots; returns `{ file, coarse, checks }` (no horizontal scroll: scrollLeft 0 and scrollWidth <= clientWidth; coarse at touch). Push `checks` to your list. Put `file` under `<outDir>/full/`.
- `checkCropHolds(result)`: `{ name, pass, detail }`; passes when the clip holds the element box plus pad on all four sides (1px rounding), lies inside the viewport, and is coarse for a touch crop.
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
checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'page-390-light.png'), { touch })).checks)
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
```

Faults it prevents: frames taken before layout settled; crops that cut the element (worst at 390 touch, where a fullPage clip drops touch emulation); duplicate or stale files under one name.

fullPage measures document scrolling only; an inner scroll container is not measured.
