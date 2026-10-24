import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useStaff } from '@/api/hooks'
import { useCompletionsGroup } from './useCompletionsGroup'
import { useComplianceGroup } from './useComplianceGroup'
import { useIncidentsGroup } from './useIncidentsGroup'
import { useLeaveGroup } from './useLeaveGroup'
import { useTasksGroup } from './useTasksGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))

// Disabled, so nothing is requested: the footer text is the hook's own string, and the tile actions on the same page ("Open incidents") are sentence case.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, children))

describe('the group footers read as sentences', () => {
  it.each([
    ['Incidents', () => useIncidentsGroup(false), 'Open incidents'],
    ['Leave', () => useLeaveGroup(false, null), 'Open leave'],
    ['Tasks', () => useTasksGroup(false, { today: '2026-10-14', mayCloseBudgetReview: false }), 'Open tasks'],
    ['Completions', () => useCompletionsGroup(false), 'Open completions'],
    ['Qualifications', () => useComplianceGroup(false, { staff: useStaff({ isActive: 'true' }), today: '2026-10-14', warningDays: 30, mayEditAdmins: false }), 'Open qualifications'],
  ] as const)('%s', (_name, useGroup, label) => {
    expect(renderHook(useGroup, { wrapper }).result.current.link.openLabel).toBe(label)
  })
})
