import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock's completion queue rows (CompletionQueueItemDto), over HTTP. The server always sends `missingDetails` (a non-null list), and the Admin dashboard
 * reads `item.missingDetails.length` unguarded, so a row without it threw the dashboard's error screen in the mock.
 *
 * The mock is not copied into the frontend's Docker build context, so this suite skips itself there (the existsSync guard); the server is started in beforeAll,
 * never in the describe body.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '../../../mock-api/server.js')
const PORT = 41000 + Math.floor(Math.random() * 2000)
const API = `http://127.0.0.1:${PORT}/api/v1`

describe.skipIf(!existsSync(SERVER))('the mock completion queue carries missingDetails, as the server does', () => {
  let server: ChildProcess

  beforeAll(async () => {
    server = spawn(process.execPath, [SERVER], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the mock API did not start')), 15_000)
      server.stdout!.on('data', (chunk: Buffer) => { if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve() } })
      server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`the mock API exited (${code})`)) })
    })
  }, 20_000)

  afterAll(() => { server?.kill() })

  it('gives every rostering/completions row a missingDetails list, the dashboard rows included', async () => {
    const body = await (await fetch(`${API}/rostering/completions`)).json()
    const page = body.data ?? body
    const rows: { shiftId: string; missingDetails?: unknown }[] = page.items ?? page
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((r) => !Array.isArray(r.missingDetails)).map((r) => r.shiftId)).toEqual([])
  })
})
