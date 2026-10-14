import { createElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { QuickGroup } from '../QuickGroup'
import { useDecisionState } from '../useDecisionState'
import type { GroupModel } from '../quickGroup'

// A .ts file (no JSX), so react-refresh's one-components-per-file rule does not read this test helper as a component module.

/**
 * Renders a REAL group hook into QuickGroup on a real QueryClient. A test mocks only `@/api/client`, so every request, query key, mutation hook and
 * invalidation is the app's own, and a test can assert the request body the server would get.
 */
export function renderGroup(useGroup: () => GroupModel) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  function Harness() {
    const model = useGroup()
    const state = useDecisionState()
    return [
      createElement(AnnouncementRegion, { key: 'announce', message: state.announcement }),
      createElement(QuickGroup, { key: 'group', model, state }),
    ]
  }
  return { client, ...render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(Harness)))) }
}

/** The page's AnnouncementRegion in these tests (the NoticesRegion is a status too, but not sr-only). */
export const announcement = () => document.querySelector('.sr-only[role="status"]')
