// The translation gate: a lived moment on the canopy crosses a seam of light and arrives as Odip's record.
// This file is the pure part (no DOM): the states, the events that move between them, and how far each
// visual piece has travelled at a given progress. crossing.ts wires it to the page.
//
//   waiting  --enter (once)-->  crossing  --ticks reach 1-->  arrived
//   any      --replay-------->  crossing from 0
//   any      --reduce-------->  arrived at once (reduced motion: nothing travels)
//   any      --drag---------->  crossing, held at the dragged progress; release carries it on to arrived

export type Phase = 'waiting' | 'crossing' | 'arrived'

export interface CrossingState {
  phase: Phase
  /** 0: the moment has not left the canopy side. 1: it has arrived as the record. */
  progress: number
  /** It plays once on entering view; after that only Replay or a drag moves it. */
  played: boolean
  dragging: boolean
}

export type CrossingEvent =
  | { type: 'enter' }
  | { type: 'tick'; dt: number }
  | { type: 'replay' }
  | { type: 'reduce' }
  | { type: 'drag'; progress: number }
  | { type: 'release' }

/** Seconds for one crossing. */
export const DURATION = 2.6

export const INITIAL: CrossingState = { phase: 'waiting', progress: 0, played: false, dragging: false }

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

export function step(state: CrossingState, event: CrossingEvent, duration = DURATION): CrossingState {
  switch (event.type) {
    case 'enter':
      return state.phase === 'waiting' && !state.played ? { ...state, phase: 'crossing', progress: 0, played: true } : state
    case 'tick': {
      if (state.phase !== 'crossing' || state.dragging) return state
      const progress = clamp01(state.progress + Math.max(0, event.dt) / Math.max(0.001, duration))
      return progress >= 1 ? { ...state, phase: 'arrived', progress: 1 } : { ...state, progress }
    }
    case 'replay':
      return { phase: 'crossing', progress: 0, played: true, dragging: false }
    case 'reduce':
      return { phase: 'arrived', progress: 1, played: true, dragging: false }
    case 'drag':
      return { phase: 'crossing', progress: clamp01(event.progress), played: true, dragging: true }
    case 'release':
      if (!state.dragging) return state
      return state.progress >= 1 ? { ...state, phase: 'arrived', progress: 1, dragging: false } : { ...state, dragging: false }
  }
}

/** True on the one step where the record lands: the moment to announce it. */
export function arrivedNow(prev: CrossingState, next: CrossingState): boolean {
  return prev.phase !== 'arrived' && next.phase === 'arrived'
}

/** A drag moves the progress by the distance dragged over the span of the crossing, from where it started. */
export function dragProgress(startProgress: number, dragged: number, span: number): number {
  return clamp01(startProgress + dragged / Math.max(1, span))
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

export interface CrossingVisuals {
  /** The moment's light travelling from the canopy side to the seam. */
  carrier: number
  /** The seam flaring as it passes through (0 at rest, at both ends). */
  flare: number
  /** The paper record opening outward from the seam. */
  reveal: number
  /** The record's caption settling in last. */
  settle: number
}

export function visuals(progress: number): CrossingVisuals {
  const p = clamp01(progress)
  const hump = clamp01((p - 0.3) / 0.45)
  return {
    carrier: easeInOutCubic(clamp01(p / 0.5)),
    flare: Math.sin(Math.PI * hump) ** 2,
    reveal: easeOutExpo(clamp01((p - 0.42) / 0.5)),
    settle: easeOutCubic(clamp01((p - 0.62) / 0.38)),
  }
}
