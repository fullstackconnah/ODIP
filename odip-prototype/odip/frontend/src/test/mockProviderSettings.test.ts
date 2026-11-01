import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The mock's PUT provider-settings treats a null contact field as "leave it" and a blank one as "clear it", as the server does (#533 N3). The mock loads in beforeAll, never in the describe
 * body, and the suite skips itself where the mock is not copied (the Docker build context).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '../../../mock-api/server.js')
const PORT = 43000 + Math.floor(Math.random() * 2000)
const API = `http://127.0.0.1:${PORT}/api/v1`

describe.skipIf(!existsSync(SERVER))('the mock saves the organisation contact fields as the server does', () => {
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

  const put = async (body: Record<string, unknown>) => {
    const res = await fetch(`${API}/provider-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    return json.data ?? json
  }

  it('leaves a field the body sends as null, and clears one it sends blank', async () => {
    expect(await put({ tradingName: 'Acme Care', website: 'https://acme.example.com' })).toMatchObject({ tradingName: 'Acme Care', website: 'https://acme.example.com' })

    expect(await put({ tradingName: null, website: '' })).toMatchObject({ tradingName: 'Acme Care', website: null })
  })
})
