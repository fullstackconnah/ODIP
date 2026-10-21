import { vi } from 'vitest'

// The API hooks DashboardPage reads, as test doubles. A test file mocks the barrel with them:
//   vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
// This module imports nothing but vitest, so the mock factory never reaches the page (a circular import through the mocked barrel).
export const mockUseDashboard = vi.fn()
export const mockUseSettings = vi.fn()
export const mockUseStaff = vi.fn()
export const mockUseParticipantAlertsAggregate = vi.fn()
export const mockUsePendingLeaveQueue = vi.fn()
export const mockUsePendingCompletionQueue = vi.fn()
export const mockUseModuleVisibility = vi.fn(() => ({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false }))
// The page's decision groups (pages/dashboard/useDecisionGroups), mocked by the page tests beside the barrel.
export const mockUseDecisionGroups = vi.fn()

export const hooks = {
  useDashboard: mockUseDashboard,
  useSettings: mockUseSettings,
  useStaff: mockUseStaff,
  useParticipantAlertsAggregate: mockUseParticipantAlertsAggregate,
  usePendingLeaveQueue: mockUsePendingLeaveQueue,
  usePendingCompletionQueue: mockUsePendingCompletionQueue,
  useModuleVisibility: mockUseModuleVisibility,
}
