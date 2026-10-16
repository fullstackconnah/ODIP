import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Start rostering in the mock API (2026-10-16), through its real router: POST rostering/weeks/{weekStart}/start answers 200 once, then the 409 roster-week-started the server gives, and the
 * board then says the week is started. matchRoute reads only an `:id` segment as a parameter, so a route written with another name never matched; this hits it over HTTP to prove it does.
 *
 * The mock lives next to the frontend but is not copied into the frontend's Docker build context, so this suite skips itself there (the existsSync guard). The server is started in beforeAll,
 * never in the describe body, which vitest runs even for a skipped describe.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '../../../mock-api/server.js')
const PORT = 41000 + Math.floor(Math.random() * 2000)
const API = `http://127.0.0.1:${PORT}/api/v1`

describe.skipIf(!existsSync(SERVER))('the mock starts a roster week once, as the server does', () => {
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

  it('answers 200 the first time, 409 roster-week-started the second, and the board then says started', async () => {
    const start = () => fetch(`${API}/rostering/weeks/2026-11-18/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })

    const first = await start()
    expect(first.status).toBe(200)
    const created = await first.json()
    expect(created.data ?? created).toMatchObject({ weekStart: '2026-11-16', regularAway: 0, skipped: [] })

    const second = await start()
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ success: false, code: 'roster-week-started' })

    const board = await (await fetch(`${API}/rostering/board?weekStart=2026-11-16&groupBy=participant`)).json()
    expect((board.data ?? board).weekStarted).toBe(true)
  })
})
