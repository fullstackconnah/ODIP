import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DOCKERFILE = resolve(__dirname, '../../Dockerfile')
// Repo-root .github is outside the image's build context; a checkout missing deploy.yml must fail, not skip.
const DEPLOY_WORKFLOW = resolve(__dirname, '../../../../../.github/workflows/deploy.yml')
const BACKEND_DOCKERFILE = resolve(__dirname, '../../../backend/Dockerfile')

// The deployed commit reaches Vite as VITE_BUILD_SHA (the platform footer's "Build 1a2b3c4"). Every RUN after an ARG sees it, so
// declared above `npm ci` a new sha each deploy would throw away the cached install; declared above the build it would leak into the install layer.
describe.skipIf(!existsSync(DOCKERFILE))('frontend/Dockerfile: the build sha', () => {
  it('declares VITE_BUILD_SHA as an ARG/ENV pair after `npm ci` and before the build, and nowhere earlier', () => {
    const lines = readFileSync(DOCKERFILE, 'utf8').split('\n').map((l) => l.trim())
    const at = (line: string) => lines.indexOf(line)
    const arg = at('ARG VITE_BUILD_SHA')
    const env = at('ENV VITE_BUILD_SHA=$VITE_BUILD_SHA')
    expect(at('COPY frontend/ .')).toBeGreaterThanOrEqual(0)
    expect(at('RUN npm run build')).toBeGreaterThanOrEqual(0)
    expect(arg).toBeGreaterThan(at('COPY frontend/ .'))
    expect(env).toBeGreaterThan(arg)
    expect(env).toBeLessThan(at('RUN npm run build'))
    const firstMention = lines.findIndex((l) => !l.startsWith('#') && l.includes('VITE_BUILD_SHA'))
    expect(firstMention).toBe(arg)
  })
})

// Owner decision 2026-10-25: tests run in CI (pr-validation.yml) on the PR merge ref, not again in the deploy image build.
describe.skipIf(!existsSync(DOCKERFILE) || !existsSync(BACKEND_DOCKERFILE))('Dockerfiles: no test run', () => {
  it.each([[DOCKERFILE, /\bnpm (run )?test\b/], [BACKEND_DOCKERFILE, /\bdotnet test\b/]])('%s has no test step', (file, pattern) => {
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'))
    expect(code.filter((l) => pattern.test(l))).toEqual([])
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
