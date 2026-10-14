import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DOCKERFILE = resolve(__dirname, '../../Dockerfile')
// Repo-root workflow, outside the image's build context: absent inside the image, so its checks skip there.
const DEPLOY_WORKFLOW = resolve(__dirname, '../../../../../.github/workflows/deploy.yml')
// Capped at 4 workers: the deploy host also runs test jobs, and an uncapped run starved it (deploy of #244, 2026-10-15).
const TEST_RUN = 'RUN npm test -- --maxWorkers=4'

// The deployed commit reaches Vite as VITE_BUILD_SHA (the platform footer's "Build 1a2b3c4"). Every RUN after an ARG sees it, so
// declared above `npm ci` a new sha each deploy would throw away the cached install; declared above `npm test` the tests could see it.
describe.skipIf(!existsSync(DOCKERFILE))('frontend/Dockerfile: the build sha', () => {
  it('declares VITE_BUILD_SHA as an ARG/ENV pair after the tests and before the build, and nowhere earlier', () => {
    const lines = readFileSync(DOCKERFILE, 'utf8').split('\n').map((l) => l.trim())
    const at = (line: string) => lines.indexOf(line)
    const arg = at('ARG VITE_BUILD_SHA')
    const env = at('ENV VITE_BUILD_SHA=$VITE_BUILD_SHA')
    expect(arg).toBeGreaterThan(at(TEST_RUN))
    expect(env).toBeGreaterThan(arg)
    expect(env).toBeLessThan(at('RUN npm run build'))
    const firstMention = lines.findIndex((l) => !l.startsWith('#') && l.includes('VITE_BUILD_SHA'))
    expect(firstMention).toBe(arg)
  })
})

describe.skipIf(!existsSync(DOCKERFILE))('frontend/Dockerfile: the test run', () => {
  it('runs the test suite with 4 workers', () => {
    const lines = readFileSync(DOCKERFILE, 'utf8').split('\n').map((l) => l.trim())
    expect(lines).toContain(TEST_RUN)
  })
})

// The step text between "Wait for free memory" and "Build images" in deploy.yml.
const waitStep = () => {
  const lines = readFileSync(DEPLOY_WORKFLOW, 'utf8').split('\n').map((l) => l.trim())
  const start = lines.indexOf('- name: Wait for free memory')
  const end = lines.indexOf('- name: Build images')
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return lines.slice(start, end).join('\n')
}

describe.skipIf(!existsSync(DEPLOY_WORKFLOW))('.github/workflows/deploy.yml: the memory wait', () => {
  it('has a "Wait for free memory" step before "Build images"', () => {
    expect(waitStep()).toContain('MemAvailable')
  })

  it('reads MemAvailable from /proc/meminfo', () => {
    const step = waitStep()
    expect(step).toContain('/proc/meminfo')
    expect(step).toContain('MemAvailable')
  })

  it('warns and carries on when memory stays short, rather than exiting 1', () => {
    const step = waitStep()
    expect(step).toContain('::warning::')
    expect(step).not.toMatch(/exit 1\b/)
  })
})
