import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * L5-11: App.tsx defined 58 routes and no catch-all, so any unknown URL (a typo, an old bookmark, /trips/:id/edit) rendered React Router's
 * bare default error page: no sidebar, no way home. The catch-all sits INSIDE the authenticated layout route, so the person keeps the shell.
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(__dirname, '../App.tsx'), 'utf-8')

describe('App routes: a catch-all inside the app shell (L5-11)', () => {
  it('has a path="*" route that renders the NotFoundPage', () => {
    expect(app).toMatch(/<Route path="\*" element=\{<NotFoundPage \/>\} \/>/)
    expect(app).toMatch(/const NotFoundPage = React\.lazy\(\(\) => import\('\.\/pages\/NotFoundPage'\)\)/)
  })

  it('puts it inside the authenticated layout, after the last real route, so the sidebar stays', () => {
    const catchAll = app.indexOf('path="*"')
    const shell = app.indexOf('<AppLayout />')
    const lastRoute = app.indexOf('path="/portal/leave"')
    const end = app.indexOf('export default function App')
    expect(shell).toBeGreaterThan(-1)
    expect(catchAll).toBeGreaterThan(lastRoute)
    expect(catchAll).toBeGreaterThan(shell)
    expect(catchAll).toBeLessThan(end)
    // Not the public caregiver route or the login page: the text between the layout route and the catch-all holds no closing of that layout.
    expect(app.slice(shell, catchAll)).not.toMatch(/<\/Route>\s*<\/Route>/)
  })
})
