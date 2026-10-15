import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnnouncementRegion } from '@/components/AnnouncementRegion'
import { NeedsYourDecision } from '../NeedsYourDecision'
import { useDecisionState } from '../useDecisionState'
import type { GroupModel } from '../quickGroupModel'

// A .ts file (no JSX), so react-refresh's one-components-per-file rule does not read this test helper as a component module.

/**
 * Renders a REAL group hook into the decisions section (its tab and panel) on a real QueryClient. A test mocks only `@/api/client`, so every request,
 * query key, mutation hook and invalidation is the app's own, and a test can assert the request body the server would get.
 */
export function renderGroup(useGroup: () => GroupModel) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  function Harness() {
    const model = useGroup()
    const state = useDecisionState()
    return [
      createElement(AnnouncementRegion, { key: 'announce', message: state.announcement }),
      createElement(NeedsYourDecision, { key: 'group', groups: [model], state }),
    ]
  }
  return { client, ...render(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(Harness)))) }
}

/** The page's AnnouncementRegion in these tests (the NoticesRegion is a status too, but not sr-only). */
export const announcement = () => document.querySelector('.sr-only[role="status"]')

/** The table's column headers, the empty actions header last. */
export const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent)

/** A decision row's row group (its row, and its detail row while it has one), found by its subject. */
export const rowOf = (subject: string) => screen.getByText(subject).closest('tbody')!

/** The subjects of the rows, in order. */
export const subjects = () => [...document.querySelectorAll('tbody > tr:not([data-detail]) > td:first-child span:first-child')].map((el) => el.textContent)

/** One row's fact cells, between its subject and its buttons. */
export const facts = (subject: string) => [...rowOf(subject).querySelectorAll('tr:not([data-detail]) > td')].slice(1, -1).map((td) => td.textContent)
