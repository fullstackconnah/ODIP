import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** public/theme.js is a classic script the CSP allows ('self') and index.html runs before first paint; this runs it as the browser would. */
const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND = join(__dirname, '../..')
const SCRIPT = readFileSync(join(FRONTEND, 'public/theme.js'), 'utf-8')

let osDark = false
let listener: (() => void) | undefined

function run() {
  listener = undefined
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() { return osDark },
    addEventListener: (_type: string, fn: () => void) => { listener = fn },
  })) as unknown as typeof window.matchMedia
  new Function(SCRIPT)()
}
const theme = () => document.documentElement.getAttribute('data-theme')
const signIn = (prefs?: string) => {
  localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
  if (prefs !== undefined) localStorage.setItem('odip_ui_prefs:u1', prefs)
}

describe('public/theme.js (pre-paint)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#fbf9f5" />'
  })
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it.each([false, true])('follows the OS when signed out (OS dark: %s)', dark => {
    osDark = dark
    run()
    expect(theme()).toBe(dark ? 'dark' : 'light')
  })

  it.each([false, true])('honours an explicit Dark whatever the OS says (OS dark: %s)', dark => {
    osDark = dark
    signIn('{"theme":"dark"}')
    run()
    expect(theme()).toBe('dark')
  })

  it.each([false, true])('honours an explicit Light whatever the OS says (OS dark: %s)', dark => {
    osDark = dark
    signIn('{"theme":"light"}')
    run()
    expect(theme()).toBe('light')
  })

  it.each([false, true])('follows the OS under System (OS dark: %s)', dark => {
    osDark = dark
    signIn('{"theme":"system"}')
    run()
    expect(theme()).toBe(dark ? 'dark' : 'light')
  })

  it.each([
    ['corrupt odip_user', () => localStorage.setItem('odip_user', '{nope')],
    ['corrupt prefs', () => signIn('{nope')],
    ['null prefs', () => signIn('null')],
    ['unknown theme', () => signIn('{"theme":"sepia"}')],
    ['storage that throws', () => { vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') }) }],
  ])('falls back to the OS for %s', (_name, arrange) => {
    arrange()
    osDark = true
    run()
    expect(theme()).toBe('dark')
  })

  it('follows a live OS change under System, but not under an explicit Dark', () => {
    osDark = false
    run()
    osDark = true
    listener!()
    expect(theme()).toBe('dark')

    osDark = false
    signIn('{"theme":"dark"}')
    run()
    listener!()
    expect(theme()).toBe('dark')
  })

  it('keeps the theme-color meta in step with the resolved theme, and exposes set() for React', () => {
    osDark = true
    run()
    const meta = () => document.querySelector('meta[name="theme-color"]')!.getAttribute('content')
    expect(meta()).toBe('#131512')
    window.odipTheme!.set('light')
    expect(theme()).toBe('light')
    expect(meta()).toBe('#fbf9f5')
  })
})

describe('odipTheme.reset (provider unmount)', () => {
  afterEach(() => localStorage.clear())

  it('re-resolves from the stored prefs of the signed-in user', () => {
    osDark = false
    signIn(JSON.stringify({ theme: 'dark' }))
    run()
    window.odipTheme!.set('light')
    window.odipTheme!.reset!()
    expect(theme()).toBe('dark')
  })

  it('falls back to System once nobody is signed in', () => {
    osDark = false
    signIn(JSON.stringify({ theme: 'dark' }))
    run()
    localStorage.removeItem('odip_user')
    window.odipTheme!.reset!()
    expect(theme()).toBe('light')
  })
})

describe('index.html and nginx wire the script in', () => {
  const html = readFileSync(join(FRONTEND, 'index.html'), 'utf-8')

  it('loads /theme.js as a blocking classic script in <head>, after the theme-color meta and before the app', () => {
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    const tag = '<script src="/theme.js"></script>'
    expect(head).toContain(tag)
    expect(head.indexOf('<meta name="theme-color"')).toBeGreaterThan(-1)
    expect(head.indexOf('<meta name="theme-color"')).toBeLessThan(head.indexOf(tag))
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf('/src/main.tsx'))
  })

  it('never caches /theme.js for a year like the other .js files (it keeps its name)', () => {
    const conf = join(FRONTEND, '../nginx/default.conf')
    if (!existsSync(conf)) return
    expect(readFileSync(conf, 'utf-8')).toMatch(/location = \/theme\.js \{\s*expires -1;/)
  })
})
