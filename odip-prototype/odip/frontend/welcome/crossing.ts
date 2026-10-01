// The three crossings (the translation gate; rules in crossing-machine.ts). Each plays once as its seam comes
// into view, has a Replay button, and can be dragged across with a mouse or pen on wide screens as an enhancement
// (never on touch, so scrolling a phone is never caught). Reduced motion shows the arrived state at once.
// Every word is in the DOM all along; a polite live region says when a record arrives.

import { INITIAL, arrivedNow, dragProgress, step, visuals, type CrossingEvent, type CrossingState } from './crossing-machine'

interface Crossing {
  el: HTMLElement
  gate: HTMLElement | null
  replay: HTMLButtonElement | null
  message: string
  state: CrossingState
}

export function initCrossings(doc: Document = document, win: Window = window): { destroy(): void } | null {
  const items: Crossing[] = Array.from(doc.querySelectorAll<HTMLElement>('[data-crossing]')).map((el) => ({
    el,
    gate: el.querySelector<HTMLElement>('[data-gate]'),
    replay: el.querySelector<HTMLButtonElement>('[data-replay]'),
    message: el.dataset.arrived ?? '',
    state: INITIAL,
  }))
  if (items.length === 0) return null
  const status = doc.querySelector<HTMLElement>('[data-crossing-status]')
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)')
  const wide = win.matchMedia('(min-width: 1024px) and (pointer: fine)')
  let raf = 0
  let last = 0

  function paint(item: Crossing) {
    const v = visuals(item.state.progress)
    const s = item.el.style
    s.setProperty('--carrier', v.carrier.toFixed(4))
    s.setProperty('--flare', v.flare.toFixed(4))
    s.setProperty('--reveal', v.reveal.toFixed(4))
    s.setProperty('--settle', v.settle.toFixed(4))
    item.el.dataset.phase = item.state.phase
  }

  function send(item: Crossing, event: CrossingEvent) {
    const prev = item.state
    item.state = step(prev, event)
    if (item.state === prev) return
    paint(item)
    if (arrivedNow(prev, item.state) && status && event.type !== 'reduce') status.textContent = item.message
    if (item.state.phase === 'crossing' && !item.state.dragging) wake()
  }

  function frame(now: number) {
    raf = 0
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    last = now
    // A crossing still under way asks for the next frame itself (send, then wake); wake never doubles it.
    for (const item of items) {
      if (item.state.phase === 'crossing' && !item.state.dragging) send(item, { type: 'tick', dt })
    }
    if (!raf) last = 0
  }

  function wake() {
    if (!raf) raf = win.requestAnimationFrame(frame)
  }

  function settle() {
    for (const item of items) {
      send(item, { type: 'reduce' })
      if (item.replay) item.replay.hidden = true
    }
  }

  const onReplay = (item: Crossing) => () => send(item, { type: 'replay' })
  const replays = items.map((item) => {
    const handler = onReplay(item)
    item.replay?.addEventListener('click', handler)
    return handler
  })

  // Keyboard focus never lands on a record still hidden by its reveal: focusing into it lands the crossing at once.
  const records = items.map((item) => item.el.querySelector<HTMLElement>('.crossing__record'))
  const onFocusRecord = (item: Crossing) => () => {
    if (item.state.phase !== 'arrived') send(item, { type: 'reduce' })
  }
  const focusers = items.map((item, i) => {
    const handler = onFocusRecord(item)
    records[i]?.addEventListener('focusin', handler)
    return handler
  })

  // Drag: a mouse or pen on a wide screen pulls the moment across the seam; release lets it land.
  let drag: { item: Crossing; x: number; from: number; span: number; id: number } | null = null
  const onDown = (item: Crossing) => (e: PointerEvent) => {
    if (reduce.matches || !wide.matches || e.pointerType === 'touch' || e.button !== 0 || !item.gate) return
    drag = { item, x: e.clientX, from: item.state.progress, span: item.el.getBoundingClientRect().width * 0.5, id: e.pointerId }
    item.gate.setPointerCapture?.(e.pointerId)
    send(item, { type: 'drag', progress: item.state.progress })
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    send(drag.item, { type: 'drag', progress: dragProgress(drag.from, e.clientX - drag.x, drag.span) })
  }
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    const { item } = drag
    drag = null
    send(item, { type: 'release' })
  }
  const downs = items.map((item) => {
    const handler = onDown(item)
    item.gate?.addEventListener('pointerdown', handler)
    item.gate?.addEventListener('pointermove', onMove)
    item.gate?.addEventListener('pointerup', onUp)
    item.gate?.addEventListener('pointercancel', onUp)
    return handler
  })

  // Each crossing plays once, when its seam reaches the middle of the screen.
  const watch =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              const item = items.find((i) => i.gate === entry.target)
              if (item) send(item, { type: 'enter' })
              watch?.unobserve(entry.target)
            }
          },
          { rootMargin: '-20% 0px -30% 0px' },
        )
      : null

  const onPreference = () => {
    if (reduce.matches) settle()
    else for (const item of items) if (item.replay) item.replay.hidden = false
  }

  if (reduce.matches || !watch) {
    settle()
  } else {
    for (const item of items) {
      paint(item)
      if (item.gate) watch.observe(item.gate)
      else send(item, { type: 'reduce' })
    }
  }
  reduce.addEventListener('change', onPreference)

  return {
    destroy() {
      if (raf) win.cancelAnimationFrame(raf)
      watch?.disconnect()
      reduce.removeEventListener('change', onPreference)
      items.forEach((item, i) => {
        item.replay?.removeEventListener('click', replays[i])
        records[i]?.removeEventListener('focusin', focusers[i])
        item.gate?.removeEventListener('pointerdown', downs[i])
        item.gate?.removeEventListener('pointermove', onMove)
        item.gate?.removeEventListener('pointerup', onUp)
        item.gate?.removeEventListener('pointercancel', onUp)
      })
    },
  }
}
