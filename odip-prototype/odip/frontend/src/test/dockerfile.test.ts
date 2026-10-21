import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DOCKERFILE = resolve(__dirname, '../../Dockerfile')
// Repo-root .github is outside the image's build context; a checkout missing deploy.yml must fail, not skip.
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

const workflowLines = () => readFileSync(DEPLOY_WORKFLOW, 'utf8').split('\n').map((l) => l.trim())

// The "Wait for free memory" step in deploy.yml: from its name line to the next step's name line.
const waitStep = () => {
  const lines = workflowLines()
  const start = lines.indexOf('- name: Wait for free memory')
  expect(start).toBeGreaterThanOrEqual(0)
  const next = lines.findIndex((l, i) => i > start && l.startsWith('- name:'))
  return lines.slice(start, next).join('\n')
}

describe.skipIf(!existsSync(resolve(__dirname, '../../../../../.github')))('.github/workflows/deploy.yml: the memory wait', () => {
  it('runs before the source sync and the image build, so a failed wait changes nothing on the host', () => {
    const wait = workflowLines().indexOf('- name: Wait for free memory')
    expect(wait).toBeGreaterThanOrEqual(0)
    expect(wait).toBeLessThan(workflowLines().indexOf('- name: Sync source into stack directory'))
    expect(wait).toBeLessThan(workflowLines().indexOf('- name: Build images'))
  })

  it('reads MemAvailable from /proc/meminfo', () => {
    const step = waitStep()
    expect(step).toContain('/proc/meminfo')
    expect(step).toContain('MemAvailable')
  })

  it('waits for 4 GiB and polls 30 times, 15 minutes in all', () => {
    const step = waitStep()
    expect(step).toContain('4 * 1024 * 1024')
    expect(step).toContain('seq 1 30')
  })

  it('fails the deploy with an error and exit 1 when memory stays short', () => {
    const step = waitStep()
    expect(step).toContain('::error::')
    expect(step).toContain('after 15 minutes')
    const code = step.split('\n').filter((l) => !l.startsWith('#'))
    expect(code.some((l) => /\bexit 1\b/.test(l))).toBe(true)
  })
})
