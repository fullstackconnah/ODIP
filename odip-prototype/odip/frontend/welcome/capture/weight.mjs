// The welcome page's own built JS (SHAPE section 10 #14, as redefined in PLAN-PR2 S2): every chunk dist/welcome/index.html loads
// or modulepreloads, at most 10 KB raw and 4.5 KB gzip (lead, 2026-10-17: platformFacts counts, a visitor has no app cache). Runs as `odip-test.sh <slot> shots <this file> <outdir>` (it needs a build,
// which the PC does not run); the runner starts it from e2e/, so the frontend is ../frontend.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const frontend = path.resolve(process.cwd(), '../frontend')
const dist = '/tmp/wdist'
execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: frontend, stdio: 'inherit' })
const html = fs.readFileSync(path.join(dist, 'welcome/index.html'), 'utf8')
const urls = [
  ...[...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]),
]
const files = [...new Set(urls)].map((u) => {
  const bytes = fs.readFileSync(path.join(dist, u.startsWith('/') ? u.slice(1) : path.join('welcome', u)))
  return { url: u, raw: bytes.length, gzip: zlib.gzipSync(bytes).length }
})
const raw = files.reduce((n, f) => n + f.raw, 0)
const gzip = files.reduce((n, f) => n + f.gzip, 0)
const pass = files.length > 0 && raw <= 10 * 1024 && gzip <= 4.5 * 1024
fs.writeFileSync(path.join(process.env.OUT_DIR, 'weight.json'), JSON.stringify({ files, raw, gzip, pass }, null, 2) + '\n')
for (const f of files) console.log(`  ${f.url} raw=${f.raw} gzip=${f.gzip}`)
console.log(`CHECK weight ${pass ? 'PASS' : 'FAIL'} raw=${raw} gzip=${gzip}`)
if (!pass) process.exitCode = 1
