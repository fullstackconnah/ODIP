import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DOCKERFILE = resolve(__dirname, '../../Dockerfile')

// The deployed commit reaches Vite as VITE_BUILD_SHA (the platform footer's "Build 1a2b3c4"). Every RUN after an ARG sees it, so
// declared above `npm ci` a new sha each deploy would throw away the cached install; declared above `npm test` the tests could see it.
describe.skipIf(!existsSync(DOCKERFILE))('frontend/Dockerfile: the build sha', () => {
  it('declares VITE_BUILD_SHA as an ARG/ENV pair after the tests and before the build, and nowhere earlier', () => {
    const lines = readFileSync(DOCKERFILE, 'utf8').split('\n').map((l) => l.trim())
    const at = (line: string) => lines.indexOf(line)
    const arg = at('ARG VITE_BUILD_SHA')
    const env = at('ENV VITE_BUILD_SHA=$VITE_BUILD_SHA')
    expect(arg).toBeGreaterThan(at('RUN npm test'))
    expect(env).toBeGreaterThan(arg)
    expect(env).toBeLessThan(at('RUN npm run build'))
    const firstMention = lines.findIndex((l) => !l.startsWith('#') && l.includes('VITE_BUILD_SHA'))
    expect(firstMention).toBe(arg)
  })
})
