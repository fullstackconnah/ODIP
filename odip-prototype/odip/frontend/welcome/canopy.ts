// The canopy light field: one fixed WebGL canvas behind the page (aria-hidden), drawn by canopy-shader.ts.
// The pointer is a breeze with inertia, scrolling drifts the camera, light pools round the paper clearings in
// view, and quiet zones keep the ground dark behind every block of text (data-pool / data-quiet in the markup).
//
// It rests whenever it cannot be seen or should not move: the visible pause control (remembered), a hidden tab,
// no canopy on screen, and reduced motion (one still frame, the pointer ignored). Without WebGL, or while the
// context is lost, the authored poster (the CSS background of the same element) is the field.

import { FRAGMENT, VERTEX } from './canopy-shader'
import {
  CALM,
  FULL_GUST,
  MAX_POOLS,
  MAX_QUIET,
  canvasSize,
  leafLayers,
  packRects,
  pickVisible,
  rampToward,
  renderScale,
  stepBreeze,
  type Breeze,
  type Rect,
} from './canopy-math'

export const STORAGE_KEY = 'odip-welcome-canopy'
/** The field's clock when the poster was captured; the still frame and the first live frame both start here. */
export const STILL_TIME = 21.5
const UNIFORMS = ['uRes', 'uView', 'uTime', 'uScroll', 'uBreeze', 'uPush', 'uLayers', 'uPool', 'uPoolStr', 'uQuiet'] as const
type Uniform = (typeof UNIFORMS)[number]

interface Zone {
  el: HTMLElement
  fixed: boolean
  page: Rect
  rect: Rect
  strength: number
}

function readPaused(win: Window): boolean {
  try {
    return win.localStorage.getItem(STORAGE_KEY) === 'paused'
  } catch {
    return false
  }
}

function savePaused(win: Window, paused: boolean) {
  try {
    if (paused) win.localStorage.setItem(STORAGE_KEY, 'paused')
    else win.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

export function initCanopy(doc: Document = document, win: Window = window): { destroy(): void } | null {
  const hostEl = doc.querySelector<HTMLElement>('[data-canopy-light]')
  const canvasEl = hostEl?.querySelector('canvas')
  if (!hostEl || !canvasEl) return null
  const host: HTMLElement = hostEl
  const canvas: HTMLCanvasElement = canvasEl
  const root = doc.documentElement
  const toggle = doc.querySelector<HTMLButtonElement>('[data-light-toggle]')
  const toggleState = toggle?.querySelector<HTMLElement>('[data-light-state]')
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)')
  const coarse = win.matchMedia('(pointer: coarse)')

  let context: WebGLRenderingContext | null = null
  try {
    context = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    })
  } catch {
    context = null
  }
  if (!context) {
    host.dataset.state = 'poster'
    return null
  }
  const g: WebGLRenderingContext = context
  const loc = Object.fromEntries(UNIFORMS.map((u) => [u, null])) as Record<Uniform, WebGLUniformLocation | null>

  function build(): boolean {
    const make = (type: number, source: string) => {
      const s = g.createShader(type)
      if (!s) return null
      g.shaderSource(s, source)
      g.compileShader(s)
      if (g.getShaderParameter(s, g.COMPILE_STATUS)) return s
      if (!g.isContextLost()) console.warn('Canopy shader did not compile; the poster stays.', g.getShaderInfoLog(s))
      return null
    }
    const vs = make(g.VERTEX_SHADER, VERTEX)
    const fs = make(g.FRAGMENT_SHADER, FRAGMENT)
    const program = g.createProgram()
    if (!vs || !fs || !program) return false
    g.attachShader(program, vs)
    g.attachShader(program, fs)
    g.bindAttribLocation(program, 0, 'aPos')
    g.linkProgram(program)
    if (!g.getProgramParameter(program, g.LINK_STATUS)) return false
    g.useProgram(program)
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer())
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW)
    g.enableVertexAttribArray(0)
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
    for (const name of UNIFORMS) loc[name] = g.getUniformLocation(program, name)
    return true
  }
  if (!build()) {
    host.dataset.state = 'poster'
    return null
  }

  const zones = (selector: string): Zone[] =>
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).map((el) => ({
      el,
      fixed: el.dataset.quiet === 'fixed',
      page: { x: 0, y: 0, w: 0, h: 0 },
      rect: { x: 0, y: 0, w: 0, h: 0 },
      strength: 0,
    }))
  const pools = zones('[data-pool]')
  const quiet = zones('[data-quiet]')
  const all = [...pools, ...quiet]

  let still = reduce.matches
  let paused = readPaused(win)
  let tabHidden = doc.visibilityState === 'hidden'
  let onScreen = true
  let lost = false
  let raf = 0
  let last = 0
  let drawn = false
  let time = STILL_TIME
  // The camera follows the scroll while the field is live and holds still while it rests, without a jump on resume.
  let restCamera = 0
  let cameraOffset = 0
  let breeze: Breeze = CALM
  let pointer: { x: number; y: number } | null = null
  let view = { w: 1, h: 1 }
  let layers = 4

  const resting = () => still || paused
  const live = () => !resting() && !tabHidden && onScreen && !lost
  const camera = () => (resting() ? restCamera : win.scrollY - cameraOffset)

  /** Page-relative boxes, measured when layout changes rather than on every frame. */
  function measure() {
    for (const z of all) {
      const r = z.el.getBoundingClientRect()
      z.page =
        r.width === 0 || r.height === 0
          ? { x: 0, y: 0, w: 0, h: 0 }
          : { x: r.left + (z.fixed ? 0 : win.scrollX), y: r.top + (z.fixed ? 0 : win.scrollY), w: r.width, h: r.height }
    }
  }

  function resize() {
    view = { w: canvas.clientWidth || win.innerWidth, h: canvas.clientHeight || win.innerHeight }
    const size = canvasSize(view.w, view.h, win.devicePixelRatio, renderScale(view.w, coarse.matches))
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width
      canvas.height = size.height
    }
    layers = leafLayers(view.w, coarse.matches)
    measure()
  }

  const crossingWaits = (el: HTMLElement) => el.closest<HTMLElement>('[data-crossing]')?.dataset.phase === 'waiting'

  function draw(dt: number) {
    const sx = win.scrollX
    const sy = win.scrollY
    for (const z of all) {
      z.rect = z.fixed || z.page.w === 0 ? z.page : { x: z.page.x - sx, y: z.page.y - sy, w: z.page.w, h: z.page.h }
    }
    const pace = live() ? dt : Infinity
    for (const p of pools) {
      const showing = p.rect.w > 0 && p.rect.y < view.h && p.rect.y + p.rect.h > 0 && !crossingWaits(p.el)
      p.strength = rampToward(p.strength, showing ? 1 : 0, pace, 1.4, 0.9)
    }
    const lit = pickVisible(pools, view.w, view.h, MAX_POOLS, view.h * 0.25)
    const content = pickVisible(quiet.filter((z) => !z.fixed), view.w, view.h, MAX_QUIET - 2, 96)
    const chrome = quiet.filter((z) => z.fixed && z.rect.w > 0).slice(0, 2)

    g.viewport(0, 0, canvas.width, canvas.height)
    g.uniform2f(loc.uRes, canvas.width, canvas.height)
    g.uniform2f(loc.uView, view.w, view.h)
    g.uniform1f(loc.uTime, time)
    g.uniform1f(loc.uScroll, camera())
    g.uniform3f(loc.uBreeze, breeze.x, breeze.y, still ? 0 : breeze.energy)
    g.uniform1f(loc.uPush, Math.max(-1, Math.min(1, breeze.vx / FULL_GUST)))
    g.uniform1f(loc.uLayers, layers)
    g.uniform4fv(loc.uPool, packRects(lit.map((p) => p.rect), MAX_POOLS))
    g.uniform1fv(loc.uPoolStr, Float32Array.from({ length: MAX_POOLS }, (_, i) => lit[i]?.strength ?? 0))
    g.uniform4fv(loc.uQuiet, packRects([...content, ...chrome].map((z) => z.rect), MAX_QUIET))
    g.drawArrays(g.TRIANGLES, 0, 3)

    if (!drawn) {
      drawn = true
      root.classList.add('field-live')
    }
    host.dataset.state = still ? 'still' : paused ? 'paused' : 'live'
  }

  function frame(now: number) {
    raf = 0
    if (lost) return
    const moving = live()
    const dt = moving && last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    if (moving) {
      time += dt
      breeze = stepBreeze(breeze, pointer, dt)
    }
    last = moving ? now : 0
    draw(dt)
    if (moving) raf = win.requestAnimationFrame(frame)
  }

  /** Draws the next frame; the loop only keeps itself going while the field is live. */
  function wake() {
    if (!raf && !lost) raf = win.requestAnimationFrame(frame)
  }

  function setResting(update: () => void) {
    const before = resting()
    const liveCamera = win.scrollY - cameraOffset
    update()
    if (!before && resting()) restCamera = liveCamera
    if (before && !resting()) cameraOffset = win.scrollY - restCamera
  }

  function syncToggle() {
    if (!toggle) return
    toggle.hidden = still || lost
    toggle.setAttribute('aria-pressed', String(paused))
    if (toggleState) toggleState.textContent = paused ? 'Paused' : 'Live'
  }

  function onToggle() {
    setResting(() => {
      paused = !paused
    })
    savePaused(win, paused)
    syncToggle()
    wake()
  }

  const onPointer = (e: PointerEvent) => {
    pointer = { x: e.clientX, y: e.clientY }
  }
  const onLeave = () => {
    pointer = null
  }
  function listenToPointer(on: boolean) {
    if (on) {
      win.addEventListener('pointermove', onPointer, { passive: true })
      root.addEventListener('pointerleave', onLeave)
      return
    }
    win.removeEventListener('pointermove', onPointer)
    root.removeEventListener('pointerleave', onLeave)
    pointer = null
    breeze = CALM
  }

  function onMotionPreference() {
    setResting(() => {
      still = reduce.matches
    })
    listenToPointer(!still)
    syncToggle()
    wake()
  }
  const onVisibility = () => {
    tabHidden = doc.visibilityState === 'hidden'
    wake()
  }
  let resizeFrame = 0
  const onResize = () => {
    if (resizeFrame) return
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0
      resize()
      wake()
    })
  }
  // While the field rests, scrolling still moves the text over it, so the quiet zones are redrawn to follow.
  const onScroll = () => {
    if (!live()) wake()
  }
  const onLost = (e: Event) => {
    e.preventDefault()
    lost = true
    if (raf) win.cancelAnimationFrame(raf)
    raf = 0
    drawn = false
    root.classList.remove('field-live')
    host.dataset.state = 'poster'
    syncToggle()
  }
  const onRestored = () => {
    lost = false
    if (!build()) return
    resize()
    syncToggle()
    wake()
  }

  // No canopy on screen (a paper band filling the view): rest until some returns.
  const showing = new Set<Element>()
  const watch =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) showing.add(entry.target)
            else showing.delete(entry.target)
          }
          onScreen = showing.size > 0
          wake()
        })
      : null
  doc.querySelectorAll('[data-canopy]').forEach((el) => watch?.observe(el))
  const relayout = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null
  relayout?.observe(doc.body)

  toggle?.addEventListener('click', onToggle)
  reduce.addEventListener('change', onMotionPreference)
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('resize', onResize)
  win.addEventListener('scroll', onScroll, { passive: true })
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  doc.fonts?.ready.then(onResize)
  listenToPointer(!still)
  resize()
  syncToggle()
  wake()

  return {
    destroy() {
      if (raf) win.cancelAnimationFrame(raf)
      if (resizeFrame) win.cancelAnimationFrame(resizeFrame)
      listenToPointer(false)
      watch?.disconnect()
      relayout?.disconnect()
      toggle?.removeEventListener('click', onToggle)
      reduce.removeEventListener('change', onMotionPreference)
      doc.removeEventListener('visibilitychange', onVisibility)
      win.removeEventListener('resize', onResize)
      win.removeEventListener('scroll', onScroll)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    },
  }
}
